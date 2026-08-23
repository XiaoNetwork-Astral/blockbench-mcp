/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import {
  describeProject,
} from "@/lib/projectRoles";
import { scaleProjectElementUvs } from "@/lib/toolFixes";
import {
  normalizeLocalBbmodelPath,
  parseBbmodelText,
  portableBbmodelText,
} from "@/lib/projectFiles";
import { compileCodecResult } from "@/server/tools/export";

export const createProjectParameters = z.object({
  name: z.string().min(1),
  format: z
    .string()
    .default("bedrock_block")
    .describe("Project format ID from Blockbench's Formats registry."),
});

export const getProjectInfoParameters = z.object({});

export const listProjectsParameters = z.object({});

export const selectProjectParameters = z.object({
  project: z.string().describe("Project UUID, exact name, or exact save path."),
});

export const setProjectTextureResolutionParameters = z.object({
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  modify_uv: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Whether to scale existing UV coordinates with the resolution change. Defaults to false so geometry UVs are preserved."
    ),
});

export const closeProjectParameters = z.object({
  targets: z
    .union([
      z.enum(["active", "all"]),
      z.array(z.string().min(1)).min(1),
    ])
    .describe(
      'Use "active", "all", or an explicit array of project UUIDs, unique names, or exact save paths.'
    ),
  discard_unsaved_changes: z
    .boolean()
    .describe(
      "Required safety switch. true explicitly authorizes discarding unsaved changes in every selected target."
    ),
});

export const openBbmodelParameters = z.object({
  path: z
    .string()
    .min(1)
    .describe("Absolute local .bbmodel path or file:// URL. HTTP(S) is rejected."),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Optional tab name override after the project opens."),
  select: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to leave the newly opened project selected."),
});

export const duplicateProjectParameters = z.object({
  project: z
    .string()
    .optional()
    .describe(
      "Open project UUID, unique name, or exact save path. Defaults to the active project."
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Name for the unsaved duplicate tab. Defaults to '<source> copy'."),
  select: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to leave the duplicate selected."),
});

export const projectToolDocs: ToolSpec[] = [
  {
    name: "create_project",
    description: "Creates a new project with the given name and project type.",
    annotations: {
      title: "Create Project",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_project_info",
    description:
      "Returns read-only project orientation: format id and display name, project name/UUID, texture resolution (texture_width/height), element counts, and a summary of top-level groups.",
    annotations: {
      title: "Get Project Info",
      readOnlyHint: true,
    },
    parameters: getProjectInfoParameters,
    status: STATUS_STABLE,
  },
  {
    name: "list_projects",
    description:
      "Lists every open Blockbench project tab, its active state, persistent workflow role, and whether MCP model mutations are allowed.",
    annotations: {
      title: "List Projects",
      readOnlyHint: true,
    },
    parameters: listProjectsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "select_project",
    description:
      "Selects an existing Blockbench project tab by UUID, exact name, or exact save path without closing any other tab.",
    annotations: {
      title: "Select Project",
      destructiveHint: false,
    },
    parameters: selectProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_project_texture_resolution",
    description:
      "Sets the active project's texture resolution. Existing UV coordinates are preserved unless modify_uv is explicitly true.",
    annotations: {
      title: "Set Project Texture Resolution",
      destructiveHint: true,
    },
    parameters: setProjectTextureResolutionParameters,
    status: STATUS_STABLE,
  },
  {
    name: "close_project",
    description:
      "Closes the active project, all projects, or explicitly named project tabs. The required discard_unsaved_changes flag prevents accidental data loss.",
    annotations: {
      title: "Close Project",
      destructiveHint: true,
    },
    parameters: closeProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "open_bbmodel",
    description:
      "Validates and opens one absolute local .bbmodel file as a new Blockbench project tab. Remote URLs and oversized/invalid JSON are rejected before Blockbench state changes; the result identifies the exact new tab.",
    annotations: {
      title: "Open BBModel",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: openBbmodelParameters,
    status: STATUS_STABLE,
  },
  {
    name: "duplicate_project",
    description:
      "Copies an entire open project—including hierarchy, geometry, textures, UVs, animations, and project metadata—through Blockbench's portable project codec into a new unsaved tab. The source project is not modified.",
    annotations: {
      title: "Duplicate Project",
      destructiveHint: true,
    },
    parameters: duplicateProjectParameters,
    status: STATUS_STABLE,
  },
];

const projectReadOperations = [projectToolDocs[1], projectToolDocs[2]];
const projectEditOperations = [
  projectToolDocs[0],
  projectToolDocs[3],
  projectToolDocs[4],
  projectToolDocs[5],
  projectToolDocs[6],
  projectToolDocs[7],
];

export const projectPublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_projects",
    description:
      "Lists open Blockbench projects or returns detailed information for the active project through a read-only command.action.",
    annotations: { title: "Inspect Projects", readOnlyHint: true },
    parameters: createToolGroupParameters(projectReadOperations),
    status: STATUS_STABLE,
  },
  {
    name: "edit_projects",
    description:
      "Creates, selects, configures, closes, opens, or duplicates Blockbench projects through one explicit command.action.",
    annotations: {
      title: "Edit Projects",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createToolGroupParameters(projectEditOperations),
    status: STATUS_STABLE,
  },
];

export function findProjectOrThrow(reference: string): ModelProject {
  const uuidMatches = ModelProject.all.filter((project) => project.uuid === reference);
  if (uuidMatches.length === 1) return uuidMatches[0];

  const matches = ModelProject.all.filter(
    (project) =>
      project.name === reference ||
      Boolean(project.save_path && project.save_path === reference)
  );
  const uniqueMatches = [...new Map(matches.map((project) => [project.uuid, project])).values()];
  if (uniqueMatches.length === 1) return uniqueMatches[0];
  if (uniqueMatches.length > 1) {
    throw new Error(
      `Project reference "${reference}" is ambiguous (${uniqueMatches.length} matches: ` +
        `${uniqueMatches.map((project) => project.uuid).join(", ")}). Use an exact UUID from inspect_projects with command.action "list_projects".`
    );
  }
  throw new Error(
    `Project "${reference}" not found. Use inspect_projects with command.action "list_projects" to inspect open tabs.`
  );
}

function readLocalBbmodel(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error, text?: string): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (error) reject(error);
      else resolve(text ?? "");
    };
    const timeoutId = window.setTimeout(
      () => finish(new Error(`Timed out while reading local .bbmodel file "${path}".`)),
      15_000
    );
    const accepted = Blockbench.read(
      [path],
      { readtype: "text", errorbox: false, extensions: ["bbmodel"] },
      (files: Filesystem.FileResult[]) => {
        const content = files[0]?.content;
        if (typeof content !== "string") {
          finish(new Error(`Blockbench could not read text from "${path}".`));
          return;
        }
        try {
          parseBbmodelText(content, path);
          finish(undefined, content);
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
        }
      }
    );
    if (accepted === false) {
      finish(new Error(`Blockbench refused to read local .bbmodel file "${path}".`));
    }
  });
}

function openedProjectSince(before: ReadonlySet<ModelProject>): ModelProject {
  const opened = ModelProject.all.filter((project) => !before.has(project));
  if (opened.length !== 1) {
    throw new Error(
      `Expected Blockbench to open exactly one project tab, observed ${opened.length}.`
    );
  }
  return opened[0];
}

function sameLocalPath(first: string, second: string): boolean {
  const normalize = (value: string) =>
    value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
  return normalize(first) === normalize(second);
}

export function registerProjectTools() {
  createInternalTool(projectToolDocs[0].name, {
    ...projectToolDocs[0],
    async execute({ name, format }) {
      const selectedFormat = Formats[format];
      if (!selectedFormat) {
        const available = Object.keys(Formats).sort().slice(0, 30).join(", ");
        throw new Error(
          `Project format "${format}" was not found. Available format IDs include: ${available}`
        );
      }
      const created = newProject(selectedFormat);

      if (!created) {
        throw new Error("Failed to create project.");
      }

      Project!.name = name;

      return `Created project with name "${name}" (UUID: ${Project?.uuid}) and format "${format}".`;
    },
  }, projectToolDocs[0].status);

  createInternalTool(projectToolDocs[1].name, {
    ...projectToolDocs[1],
    async execute() {
      if (!Project) {
        throw new Error(
          "No project is open. Use edit_projects with command.action \"create_project\", or open an existing file in Blockbench."
        );
      }

      const format = Format as { id?: string; name?: string; display_name?: string } | undefined;

      const rootGroups = Outliner.root
        .filter((n): n is Group => n instanceof Group)
        .map((g) => ({
          name: g.name,
          uuid: g.uuid,
          children: g.children?.length ?? 0,
        }));

      return JSON.stringify(
        {
          project: {
            name: Project.name,
            uuid: Project.uuid,
            save_path: (Project as { save_path?: string }).save_path ?? null,
          },
          format: {
            id: format?.id ?? null,
            name: format?.display_name ?? format?.name ?? null,
          },
          resolution: {
            texture_width: Project.texture_width ?? null,
            texture_height: Project.texture_height ?? null,
          },
          counts: {
            cubes: Cube.all.length,
            meshes: Mesh.all.length,
            groups: Group.all.length,
            textures: Texture.all.length,
            outliner_elements: Outliner.elements.length,
            root_nodes: Outliner.root.length,
          },
          root_groups: rootGroups,
        },
        null,
        2
      );
    },
  }, projectToolDocs[1].status);

  createInternalTool(projectToolDocs[2].name, {
    ...projectToolDocs[2],
    async execute() {
      return JSON.stringify(
        {
          active_project: Project?.uuid ?? null,
          count: ModelProject.all.length,
          projects: ModelProject.all.map(describeProject),
        },
        null,
        2
      );
    },
  }, projectToolDocs[2].status);

  createInternalTool(projectToolDocs[3].name, {
    ...projectToolDocs[3],
    async execute({ project }) {
      const target = findProjectOrThrow(project);
      if (!target.selected && !target.select()) {
        throw new Error(`Blockbench refused to select project "${target.name}".`);
      }
      return JSON.stringify(describeProject(target), null, 2);
    },
  }, projectToolDocs[3].status);

  createInternalTool(projectToolDocs[4].name, {
    ...projectToolDocs[4],
    async execute({ width, height, modify_uv }) {
      if (!Project) {
        throw new Error(
          "No active project. Use edit_projects with command.action \"create_project\" or \"select_project\" first."
        );
      }
      const previousWidth = Project.texture_width;
      const previousHeight = Project.texture_height;
      if (previousWidth === width && previousHeight === height) {
        return JSON.stringify({
          project: { name: Project.name, uuid: Project.uuid },
          texture_width: Project.texture_width,
          texture_height: Project.texture_height,
          uv_scaled: false,
          changed: false,
        });
      }

      const elements = modify_uv ? [...Outliner.elements] : [];
      const textures = Format.per_texture_uv_size ? [...Texture.all] : [];
      const aspects: UndoAspects = {
        uv_mode: true,
        elements,
        textures,
        collections: [],
      };
      Undo.initEdit(aspects);
      if (modify_uv) {
        scaleProjectElementUvs(
          elements,
          width / previousWidth,
          height / previousHeight
        );
      }
      Project.texture_width = width;
      Project.texture_height = height;
      for (const texture of textures) {
        texture.uv_width = width;
        texture.uv_height = height;
      }
      Undo.finishEdit("Agent set project texture resolution", aspects);
      Canvas.updateAllUVs();
      if (Outliner.selected.length > 0) UVEditor.loadData();

      return JSON.stringify({
        project: { name: Project.name, uuid: Project.uuid },
        texture_width: Project.texture_width,
        texture_height: Project.texture_height,
        uv_scaled: modify_uv,
        changed: true,
      });
    },
  }, projectToolDocs[4].status);

  createInternalTool(projectToolDocs[5].name, {
    ...projectToolDocs[5],
    async execute({ targets, discard_unsaved_changes }) {
      const selectedTargets = targets === "all"
        ? [...ModelProject.all]
        : targets === "active"
        ? Project
          ? [Project]
          : []
        : [...new Map(
            (targets as string[]).map((reference: string) => {
              const project = findProjectOrThrow(reference);
              return [project.uuid, project] as const;
            })
          ).values()];

      if (selectedTargets.length === 0) {
        throw new Error("No matching open projects to close.");
      }
      const unsaved = selectedTargets.filter((project) => !project.saved);
      if (unsaved.length > 0 && !discard_unsaved_changes) {
        throw new Error(
          `Refusing to close ${unsaved.length} unsaved project(s): ` +
            `${unsaved.map((project) => `${project.name} (${project.uuid})`).join(", ")}. ` +
            "Save them first or explicitly set discard_unsaved_changes to true."
        );
      }

      const closed: Array<{ name: string; uuid: string }> = [];
      for (const project of selectedTargets) {
        const identity = { name: project.name, uuid: project.uuid };
        if (!(await project.close(true))) {
          throw new Error(
            `Blockbench refused to close project "${identity.name}" (${identity.uuid}). ` +
              `Already closed: ${closed.map((entry) => entry.uuid).join(", ") || "none"}.`
          );
        }
        closed.push(identity);
      }

      return JSON.stringify({ closed });
    },
  }, projectToolDocs[5].status);

  createInternalTool(projectToolDocs[6].name, {
    ...projectToolDocs[6],
    async execute({ path, name, select }) {
      const normalizedPath = normalizeLocalBbmodelPath(path);
      const existing = ModelProject.all.find((project) =>
        Boolean(project.save_path && sameLocalPath(project.save_path, normalizedPath)) ||
        Boolean(project.export_path && sameLocalPath(project.export_path, normalizedPath))
      );
      if (existing) {
        if (select && !existing.selected) existing.select();
        return JSON.stringify({
          source_path: normalizedPath,
          opened: describeProject(existing),
          selected: existing.selected,
          reused_existing_tab: true,
          ignored_name_override: name ?? null,
        }, null, 2);
      }
      const content = await readLocalBbmodel(normalizedPath);
      const previous = Project ?? null;
      const before = new Set(ModelProject.all);
      loadModelFile({
        name: normalizedPath.split(/[\\/]/).pop() || "project.bbmodel",
        path: normalizedPath,
        content,
      }, {});
      const opened = openedProjectSince(before);
      if (name) opened.name = name;
      if (select) opened.select();
      else if (previous && ModelProject.all.includes(previous)) previous.select();

      return JSON.stringify({
        source_path: normalizedPath,
        opened: describeProject(opened),
        selected: opened.selected,
        reused_existing_tab: false,
      }, null, 2);
    },
  }, projectToolDocs[6].status);

  createInternalTool(projectToolDocs[7].name, {
    ...projectToolDocs[7],
    async execute({ project, name, select }) {
      const source = project
        ? findProjectOrThrow(project)
        : Project;
      if (!source) {
        throw new Error("No active project to duplicate.");
      }
      const previous = Project ?? null;
      if (!source.selected && !source.select()) {
        throw new Error(`Blockbench refused to select source project "${source.name}".`);
      }
      if (!Codecs.project || typeof Codecs.project.compile !== "function") {
        if (previous && previous !== source) previous.select();
        throw new Error("Blockbench's portable project codec is unavailable.");
      }

      let content: string;
      try {
        content = portableBbmodelText(await compileCodecResult(
          Codecs.project.compile.bind(Codecs.project),
          { bitmaps: true, absolute_paths: false }
        ));
      } catch (error) {
        if (previous && previous !== source) previous.select();
        throw error;
      }

      const before = new Set(ModelProject.all);
      loadModelFile({
        name: `${source.name}.bbmodel`,
        // loadModelFile chooses a codec from the path extension before it
        // examines the content. This synthetic path is cleared immediately
        // after the new tab is identified.
        path: `codex-duplicate-${source.uuid}.bbmodel`,
        content,
      }, {});
      const duplicate = openedProjectSince(before);
      duplicate.name = name ?? `${source.name} copy`;
      duplicate.save_path = "";
      duplicate.export_path = "";
      duplicate.saved = false;
      if (select) duplicate.select();
      else if (previous && ModelProject.all.includes(previous)) previous.select();

      return JSON.stringify({
        source: describeProject(source),
        duplicate: describeProject(duplicate),
        portable_bytes: new TextEncoder().encode(content).byteLength,
        selected: duplicate.selected,
      }, null, 2);
    },
  }, projectToolDocs[7].status);

  createToolGroup(projectPublicToolDocs[0], projectReadOperations);
  createToolGroup(projectPublicToolDocs[1], projectEditOperations);

}
