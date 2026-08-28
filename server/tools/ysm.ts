/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolContext,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { geometryCounts, mergeCompiledGeometry, selectGeometry } from "@/lib/ysmGeometry";
import {
  atomicWriteWorkspaceBytes,
  atomicWriteWorkspaceJson,
  atomicWriteWorkspaceText,
  ensurePluginWorkspaceAccess,
  getPluginWorkspaceRoot,
  readWorkspaceJson,
  relativePluginWorkspacePath,
  resolvePluginWorkspacePath,
  setPluginWorkspaceRoot,
  sha256WorkspaceFile,
  workspaceFileExists,
} from "@/lib/pluginWorkspace";
import {
  getYsmBinding,
  listYsmBindings,
  removeYsmBinding,
  setYsmBinding,
  type YsmBinding,
} from "@/lib/ysmBindings";
import {
  assertProjectMayBeMutated,
  describeProject,
} from "@/lib/projectRoles";
import {
  peekSessionWorkingProject,
  resolveOpenProject,
} from "@/lib/projectContext";
import { portableBbmodelText } from "@/lib/projectFiles";
import {
  assertExternalWriteAllowed,
  normalizeExternalPath,
} from "@/lib/textureSafety";

export const ysmSetWorkspaceParameters = z.object({
  path: z
    .string()
    .optional()
    .describe("Absolute plugin workspace path. Omit to report the current path."),
});

export const ysmWorkspaceStatusParameters = z.object({});

export const ysmBindProjectParameters = z.object({
  project: z
    .string()
    .optional()
    .describe("Project UUID, exact name, or exact save path. Defaults to this MCP session's working project."),
  geometry: z.string().describe("Workspace-relative YSM geometry JSON path."),
  geometry_identifier: z.string().optional(),
  texture: z
    .string()
    .optional()
    .describe("Workspace-relative texture path. Defaults to textures/default.png beside the model package."),
  bbmodel: z
    .string()
    .optional()
    .describe("Workspace-relative .bbmodel path. Defaults to the selected project's save path when scoped."),
  allow_count_mismatch: z.boolean().optional().default(false),
});

export const ysmSaveProjectParameters = z.object({
  project: z
    .string()
    .optional()
    .describe("Project UUID, exact name, or exact save path. Defaults to this MCP session's working project."),
  expected_source_sha256: z
    .string()
    .length(64)
    .optional()
    .describe("Optional explicit geometry hash precondition."),
  include_texture: z.boolean().optional().default(true),
  include_bbmodel: z.boolean().optional().default(true),
});

export const ysmUnbindProjectParameters = z.object({
  project: z
    .string()
    .optional()
    .describe("Project UUID, exact name, or exact save path. Defaults to this MCP session's working project."),
});

export const ysmToolDocs: ToolSpec[] = [
  {
    name: "ysm_set_workspace",
    description:
      "Configures the plugin workspace used by optional YSM synchronization. Access remains folder-scoped.",
    annotations: { title: "Set Plugin Workspace", destructiveHint: false, openWorldHint: true },
    parameters: ysmSetWorkspaceParameters,
    status: STATUS_STABLE,
  },
  {
    name: "ysm_workspace_status",
    description:
      "Reports the plugin workspace, open Blockbench tabs, project roles, and YSM source bindings.",
    annotations: { title: "YSM Workspace Status", readOnlyHint: true },
    parameters: ysmWorkspaceStatusParameters,
    status: STATUS_STABLE,
  },
  {
    name: "ysm_bind_project",
    description:
      "Binds an open Bedrock project tab to its authoritative YSM geometry/texture/.bbmodel files after validating identifiers, hashes, and counts.",
    annotations: { title: "Bind YSM Project", destructiveHint: false, openWorldHint: true },
    parameters: ysmBindProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "ysm_save_project",
    description:
      "Synchronizes the live Blockbench project back to bound YSM geometry, texture, and portable .bbmodel files with hash preconditions and atomic writes. Unknown YSM fields are preserved.",
    annotations: { title: "Save Bound YSM Project", destructiveHint: true, openWorldHint: true },
    parameters: ysmSaveProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "ysm_unbind_project",
    description: "Removes the persisted YSM source binding from an open project tab without changing model files.",
    annotations: { title: "Unbind YSM Project", destructiveHint: false },
    parameters: ysmUnbindProjectParameters,
    status: STATUS_STABLE,
  },
];

export const ysmWorkspaceEditOperations = [
  ysmToolDocs[0],
  ysmToolDocs[2],
  ysmToolDocs[3],
  ysmToolDocs[4],
];

export const ysmPublicToolDocs: ToolSpec[] = [
  {
    name: "edit_ysm_workspace",
    description:
      "Configures the plugin workspace and binds, saves, or unbinds YSM projects through one command.action.",
    annotations: {
      title: "Edit YSM Workspace",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createToolGroupParameters(ysmWorkspaceEditOperations),
    status: STATUS_STABLE,
  },
];

function requireProject(reference: string | undefined, context: ToolContext): ModelProject {
  if (reference) return resolveOpenProject(reference);
  const project = peekSessionWorkingProject(context.sessionId);
  if (!project) {
    throw new Error(
      'No MCP working project. Use edit_projects with command.action "set_working_project" first.'
    );
  }
  return project;
}

function slashPath(value: string): string {
  return value.split(PathModule.sep).join("/");
}

function inferTexturePath(geometry: string): string | null {
  const characterRoot = PathModule.dirname(PathModule.dirname(geometry));
  const candidate = slashPath(PathModule.join(characterRoot, "textures", "default.png"));
  return workspaceFileExists(candidate) ? candidate : null;
}

function projectCubeCount(project: ModelProject): number {
  return project.elements.filter((element) => element instanceof Cube).length;
}

export function findBoundTexture(
  project: ModelProject,
  relativePath: string,
  textureUuid?: string | null
): Texture {
  if (textureUuid) {
    const uuidMatches = project.textures.filter((candidate) => candidate.uuid === textureUuid);
    if (uuidMatches.length === 1) return uuidMatches[0];
    if (uuidMatches.length > 1) {
      throw new Error(
        `Bound texture UUID "${textureUuid}" is duplicated in project "${project.name}".`
      );
    }
    throw new Error(
      `Bound texture UUID "${textureUuid}" is no longer present in project "${project.name}". Rebind before saving.`
    );
  }

  const expectedName = PathModule.basename(relativePath);
  const absolute = resolvePluginWorkspacePath(relativePath);
  const normalizedAbsolute = normalizeExternalPath(absolute);
  const pathMatches = project.textures.filter((candidate) => {
    const linked = candidate as Texture & { relative_path?: string };
    const paths = [linked.path, linked.relative_path].filter(
      (path): path is string => typeof path === "string" && path.length > 0
    );
    return paths.some((path) => {
      const resolved = PathModule.isAbsolute(path)
        ? path
        : project.save_path
          ? PathModule.resolve(PathModule.dirname(project.save_path), path)
          : path;
      return normalizeExternalPath(resolved) === normalizedAbsolute;
    });
  });
  if (pathMatches.length === 1) return pathMatches[0];
  if (pathMatches.length > 1) {
    throw new Error(
      `Bound texture path ${relativePath} is ambiguous in project "${project.name}" ` +
        `(${pathMatches.map((texture) => texture.uuid).join(", ")}).`
    );
  }

  const nameMatches = project.textures.filter((candidate) => candidate.name === expectedName);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Bound texture name "${expectedName}" is ambiguous in project "${project.name}" ` +
        `(${nameMatches.map((texture) => texture.uuid).join(", ")}). Rebind using unique texture data.`
    );
  }
  throw new Error(
    `Bound texture ${relativePath} is not loaded in project "${project.name}".`
  );
}

function compileBedrockDocument(): Record<string, unknown> {
  if (!Codecs.bedrock || typeof Codecs.bedrock.compile !== "function") {
    throw new Error("This Blockbench build does not expose the Bedrock geometry compiler.");
  }
  let compiled = Codecs.bedrock.compile({ raw: true, visible_box: false });
  if (typeof compiled === "string") compiled = JSON.parse(compiled);
  if (!compiled || typeof compiled !== "object" || Array.isArray(compiled)) {
    throw new Error("Blockbench returned an invalid Bedrock geometry document.");
  }
  return compiled as Record<string, unknown>;
}

function dataUrlBytes(dataUrl: string): Uint8Array {
  const match = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("Blockbench texture data is not a PNG data URL.");
  return Buffer.from(match[1], "base64");
}

export function registerYsmTools() {
  createInternalTool(ysmToolDocs[0].name, {
    ...ysmToolDocs[0],
    async execute({ path }) {
      if (path && !setPluginWorkspaceRoot(path, true)) {
        throw new Error("Blockbench did not grant access to the plugin workspace.");
      }
      return JSON.stringify(
        {
          workspace: getPluginWorkspaceRoot() || null,
          access_granted: getPluginWorkspaceRoot()
            ? ensurePluginWorkspaceAccess(false)
            : false,
        },
        null,
        2
      );
    },
  }, ysmToolDocs[0].status);

  createInternalTool(ysmToolDocs[1].name, {
    ...ysmToolDocs[1],
    async execute() {
      return JSON.stringify(
        {
          workspace: getPluginWorkspaceRoot() || null,
          open_projects: ModelProject.all.map((project) => ({
            ...describeProject(project),
            ysm_binding: getYsmBinding(project),
          })),
          stored_bindings: listYsmBindings(),
        },
        null,
        2
      );
    },
  }, ysmToolDocs[1].status);

  createInternalTool(ysmToolDocs[2].name, {
    ...ysmToolDocs[2],
    async execute({
      project: projectReference,
      geometry,
      geometry_identifier,
      texture,
      bbmodel,
      allow_count_mismatch,
    }, context) {
      const project = requireProject(projectReference, context);
      if (project.format?.id !== "bedrock") {
        throw new Error(
          `Project "${project.name}" uses format "${project.format?.id}", not Bedrock Entity.`
        );
      }
      const source = readWorkspaceJson(geometry);
      const selected = selectGeometry(source, geometry_identifier);
      const counts = geometryCounts(selected.geometry);
      const liveCounts = { bones: project.groups.length, cubes: projectCubeCount(project) };
      if (
        !allow_count_mismatch &&
        (counts.bones !== liveCounts.bones || counts.cubes !== liveCounts.cubes)
      ) {
        throw new Error(
          `Source/live count mismatch for "${project.name}": source ${counts.bones} bones/${counts.cubes} cubes, ` +
            `live ${liveCounts.bones} bones/${liveCounts.cubes} cubes. ` +
            "Refusing to bind unless allow_count_mismatch=true."
        );
      }

      const texturePath = texture ?? inferTexturePath(geometry);
      if (texturePath && !workspaceFileExists(texturePath)) {
        throw new Error(`Texture does not exist inside the plugin workspace: ${texturePath}`);
      }
      const inferredBbmodel = project.save_path
        ? relativePluginWorkspacePath(project.save_path)
        : null;
      const bbmodelPath = bbmodel ?? inferredBbmodel;
      if (bbmodelPath && !workspaceFileExists(bbmodelPath)) {
        throw new Error(`Portable project does not exist inside the plugin workspace: ${bbmodelPath}`);
      }

      const boundTexture = texturePath
        ? findBoundTexture(project, texturePath)
        : null;
      const binding: YsmBinding = {
        geometry,
        geometryIdentifier: selected.identifier,
        texture: texturePath,
        textureUuid: boundTexture?.uuid ?? null,
        bbmodel: bbmodelPath,
        sourceSha256: sha256WorkspaceFile(geometry),
        textureSha256: texturePath ? sha256WorkspaceFile(texturePath) : null,
        bbmodelSha256: bbmodelPath ? sha256WorkspaceFile(bbmodelPath) : null,
        projectName: project.name,
        projectUuid: project.uuid,
        projectSavePath: project.save_path || null,
        updatedAt: new Date().toISOString(),
      };
      setYsmBinding(project, binding);
      return JSON.stringify({ project: describeProject(project), binding, source_counts: counts, live_counts: liveCounts }, null, 2);
    },
  }, ysmToolDocs[2].status);

  createInternalTool(ysmToolDocs[3].name, {
    ...ysmToolDocs[3],
    async execute({
      project: projectReference,
      expected_source_sha256,
      include_texture,
      include_bbmodel,
    }, context) {
      const project = requireProject(projectReference, context);
      assertProjectMayBeMutated(project, "ysm_save_project");
      const binding = getYsmBinding(project);
      if (!binding) {
        throw new Error(
          `Project "${project.name}" has no YSM binding. Use edit_ysm_workspace with command.action "ysm_bind_project" first.`
        );
      }

      const currentSourceHash = sha256WorkspaceFile(binding.geometry);
      const expectedSourceHash = expected_source_sha256 ?? binding.sourceSha256;
      if (currentSourceHash !== expectedSourceHash) {
        throw new Error(
          `Geometry changed outside this bound Blockbench project. Expected ${expectedSourceHash}, got ${currentSourceHash}. Rebind before saving.`
        );
      }
      if (include_texture && binding.texture && binding.textureSha256) {
        const currentTextureHash = sha256WorkspaceFile(binding.texture);
        if (currentTextureHash !== binding.textureSha256) {
          throw new Error(
            `Texture changed outside this bound Blockbench project. Expected ${binding.textureSha256}, got ${currentTextureHash}. Rebind before saving.`
          );
        }
      }
      if (include_bbmodel && binding.bbmodel && binding.bbmodelSha256) {
        const currentProjectHash = sha256WorkspaceFile(binding.bbmodel);
        if (currentProjectHash !== binding.bbmodelSha256) {
          throw new Error(
            `Portable project changed outside this bound Blockbench project. Expected ${binding.bbmodelSha256}, got ${currentProjectHash}. Rebind before saving.`
          );
        }
      }

      const plannedWrites = [
        { path: binding.geometry, allowOwnTextureDependency: false },
        { path: include_texture ? binding.texture : null, allowOwnTextureDependency: true },
        { path: include_bbmodel ? binding.bbmodel : null, allowOwnTextureDependency: false },
      ].filter((write): write is { path: string; allowOwnTextureDependency: boolean } =>
        Boolean(write.path)
      );
      for (const write of plannedWrites) {
        assertExternalWriteAllowed(
          resolvePluginWorkspacePath(write.path),
          project,
          "ysm_save_project",
          { allowOwnTextureDependency: write.allowOwnTextureDependency }
        );
      }

      const source = readWorkspaceJson(binding.geometry);
      const compiled = context!.runInProject(() => compileBedrockDocument(), project);
      const merged = mergeCompiledGeometry(source, compiled, binding.geometryIdentifier);
      const mergedSelection = selectGeometry(merged, binding.geometryIdentifier);
      const liveCounts = geometryCounts(mergedSelection.geometry);

      let textureToSave: Texture | null = null;
      let textureBytes: Uint8Array | null = null;
      if (include_texture && binding.texture) {
        textureToSave = findBoundTexture(project, binding.texture, binding.textureUuid);
        textureBytes = dataUrlBytes(textureToSave.getDataURL());
      }

      let projectText: string | null = null;
      if (include_bbmodel && binding.bbmodel) {
        if (!Codecs.project || typeof Codecs.project.compile !== "function") {
          throw new Error("This Blockbench build does not expose the portable project compiler.");
        }
        const previousSavePath = project.save_path;
        try {
          project.save_path = resolvePluginWorkspacePath(binding.bbmodel);
          projectText = portableBbmodelText(context!.runInProject(
            () => Codecs.project.compile({ bitmaps: true, absolute_paths: false }),
            project
          ));
        } finally {
          project.save_path = previousSavePath;
        }
      }

      atomicWriteWorkspaceJson(binding.geometry, merged);
      if (binding.texture && textureBytes) {
        atomicWriteWorkspaceBytes(binding.texture, textureBytes);
      }
      if (binding.bbmodel && projectText !== null) {
        atomicWriteWorkspaceText(binding.bbmodel, projectText);
      }

      const updated: YsmBinding = {
        ...binding,
        textureUuid: textureToSave?.uuid ?? binding.textureUuid ?? null,
        sourceSha256: sha256WorkspaceFile(binding.geometry),
        textureSha256: binding.texture ? sha256WorkspaceFile(binding.texture) : null,
        bbmodelSha256: binding.bbmodel ? sha256WorkspaceFile(binding.bbmodel) : null,
        projectName: project.name,
        projectUuid: project.uuid,
        projectSavePath: project.save_path || null,
        updatedAt: new Date().toISOString(),
      };
      setYsmBinding(project, updated);
      if (textureToSave) textureToSave.saved = true;
      project.saved = true;

      return JSON.stringify(
        {
          project: describeProject(project),
          geometry: {
            path: binding.geometry,
            sha256: updated.sourceSha256,
            counts: liveCounts,
          },
          texture: binding.texture
            ? { path: binding.texture, sha256: updated.textureSha256, saved: Boolean(textureBytes) }
            : null,
          bbmodel: binding.bbmodel
            ? { path: binding.bbmodel, sha256: updated.bbmodelSha256, saved: projectText !== null }
            : null,
        },
        null,
        2
      );
    },
  }, ysmToolDocs[3].status);

  createInternalTool(ysmToolDocs[4].name, {
    ...ysmToolDocs[4],
    async execute({ project: projectReference }, context) {
      const project = requireProject(projectReference, context);
      const previous = getYsmBinding(project);
      removeYsmBinding(project);
      return JSON.stringify({ project: describeProject(project), removed_binding: previous }, null, 2);
    },
  }, ysmToolDocs[4].status);

  createToolGroup(ysmPublicToolDocs[0], ysmWorkspaceEditOperations);
}
