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
  isProjectProtected,
  setProjectReadOnly,
} from "@/lib/projectRoles";
import {
  forgetProjectState,
  getForegroundProject,
  getSessionWorkingProjectId,
  peekSessionWorkingProject,
  resolveOpenProject,
  setSessionWorkingProject,
} from "@/lib/projectContext";
import { scaleProjectElementUvs } from "@/lib/toolFixes";
import {
  normalizeLocalBbmodelPath,
  parseBbmodelText,
  portableBbmodelText,
} from "@/lib/projectFiles";

export const createProjectParameters = z.object({
  name: z.string().min(1),
  format: z
    .string()
    .default("bedrock_block")
    .describe("Project format ID from Blockbench's Formats registry."),
  show: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also show the new tab in Blockbench. By default it becomes the MCP working project without taking the foreground."),
});

export const getProjectInfoParameters = z.object({});

export const listProjectsParameters = z.object({});

export const setWorkingProjectParameters = z.object({
  project: z.string().describe("Project UUID, exact name, or exact save path."),
});

export const showProjectParameters = setWorkingProjectParameters;

export const setProjectReadOnlyParameters = z.object({
  project: z
    .string()
    .optional()
    .describe("Project UUID, exact name, or exact save path. Defaults to this session's MCP working project."),
  read_only: z
    .boolean()
    .describe("true blocks model editing by both the user and MCP while view navigation remains available; false removes only the explicit read-only flag."),
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
      z.enum(["working", "foreground", "all"]),
      z.array(z.string().min(1)).min(1),
    ])
    .describe(
      'Use "working", "foreground", "all", or an explicit array of project UUIDs, unique names, or exact save paths.'
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
  show: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also show the newly opened tab in Blockbench. It always becomes this MCP session's working project."),
});

export const duplicateProjectParameters = z.object({
  project: z
    .string()
    .optional()
    .describe(
      "Open project UUID, unique name, or exact save path. Defaults to the MCP working project."
    ),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Name for the unsaved duplicate tab. Defaults to '<source> copy'."),
  show: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also show the duplicate in Blockbench. It always becomes this MCP session's working project."),
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
    name: "set_working_project",
    description:
      "Binds this MCP session to an open project without changing the visible tab. Use this before background work.",
    annotations: {
      title: "Set MCP Working Project",
      destructiveHint: false,
    },
    parameters: setWorkingProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "show_project",
    description:
      "Changes the visible Blockbench tab without changing this MCP session's working project. Use only when the user asks to see that tab.",
    annotations: {
      title: "Show Project in Blockbench",
      destructiveHint: false,
    },
    parameters: showProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_project_read_only",
    description:
      "Turns project editing on or off for both the user and MCP while preserving tab switching and camera navigation. Turning it off removes only this explicit lock, not workflow-role protection.",
    annotations: {
      title: "Set Project Read Only",
      destructiveHint: false,
    },
    parameters: setProjectReadOnlyParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_project_texture_resolution",
    description:
      "Sets the MCP working project's texture resolution. Existing UV coordinates are preserved unless modify_uv is explicitly true.",
    annotations: {
      title: "Set Project Texture Resolution",
      destructiveHint: true,
    },
    parameters: setProjectTextureResolutionParameters,
    status: STATUS_STABLE,
  },
  {
    name: "close_projects_without_saving",
    description:
      "Closes the MCP working project, foreground project, all projects, or explicitly named tabs and explicitly discards unsaved changes.",
    annotations: {
      title: "Close Projects Without Saving",
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
  projectToolDocs[8],
  projectToolDocs[9],
];

export const projectPublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_projects",
    description:
      "Lists open tabs with separate foreground/MCP-working markers or returns details for the MCP working project.",
    annotations: { title: "Inspect Projects", readOnlyHint: true },
    parameters: createToolGroupParameters(projectReadOperations),
    status: STATUS_STABLE,
  },
  {
    name: "edit_projects",
    description:
      "Creates, binds, configures, closes, opens, duplicates, or explicitly shows projects. Bind with set_working_project for background work; show_project changes the user's visible tab.",
    annotations: {
      title: "Edit Projects",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createToolGroupParameters(projectEditOperations),
    status: STATUS_STABLE,
  },
];

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
    async execute({ name, format, show }, context) {
      const selectedFormat = Formats[format];
      if (!selectedFormat) {
        const available = Object.keys(Formats).sort().slice(0, 30).join(", ");
        throw new Error(
          `Project format "${format}" was not found. Available format IDs include: ${available}`
        );
      }
      const previous = getForegroundProject();
      const created = newProject(selectedFormat);

      if (!created || !Project) {
        throw new Error("Failed to create project.");
      }

      const createdProject = Project;
      createdProject.name = name;
      setSessionWorkingProject(context.sessionId, createdProject);
      if (!show && previous && previous !== createdProject && ModelProject.all.includes(previous)) {
        previous.select();
      }

      return JSON.stringify({
        created: describeProject(createdProject),
        mcp_working_project: createdProject.uuid,
        foreground_project: getForegroundProject()?.uuid ?? null,
      }, null, 2);
    },
  }, projectToolDocs[0].status);

  createInternalTool(projectToolDocs[1].name, {
    ...projectToolDocs[1],
    async execute(_args, context) {
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
            mcp_working: context.project?.uuid === Project.uuid,
            foreground: context.foregroundProject?.uuid === Project.uuid,
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
    async execute(_args, context) {
      const foreground = getForegroundProject();
      const workingId = getSessionWorkingProjectId(context.sessionId);
      return JSON.stringify(
        {
          foreground_project: foreground?.uuid ?? null,
          mcp_working_project: workingId,
          count: ModelProject.all.length,
          projects: ModelProject.all.map((project) => ({
            ...describeProject(project),
            foreground: project.uuid === foreground?.uuid,
            mcp_working: project.uuid === workingId,
          })),
        },
        null,
        2
      );
    },
  }, projectToolDocs[2].status);

  createInternalTool(projectToolDocs[3].name, {
    ...projectToolDocs[3],
    async execute({ project }, context) {
      const target = resolveOpenProject(project);
      setSessionWorkingProject(context.sessionId, target);
      return JSON.stringify({
        mcp_working_project: target.uuid,
        foreground_project: getForegroundProject()?.uuid ?? null,
        project: describeProject(target),
      }, null, 2);
    },
  }, projectToolDocs[3].status);

  createInternalTool(projectToolDocs[4].name, {
    ...projectToolDocs[4],
    async execute({ project }) {
      const target = resolveOpenProject(project);
      if (!target.selected && !target.select()) {
        throw new Error(`Blockbench refused to show project "${target.name}".`);
      }
      return JSON.stringify({
        foreground_project: target.uuid,
        project: describeProject(target),
      }, null, 2);
    },
  }, projectToolDocs[4].status);

  createInternalTool(projectToolDocs[5].name, {
    ...projectToolDocs[5],
    async execute({ project, read_only }, context) {
      const target = project
        ? resolveOpenProject(project)
        : peekSessionWorkingProject(context.sessionId);
      if (!target) {
        throw new Error(
          'No MCP working project. Use command.action "set_working_project" or provide project explicitly.'
        );
      }
      setProjectReadOnly(target, read_only);
      return JSON.stringify({
        project: describeProject(target),
        requested_read_only: read_only,
        effective_read_only: isProjectProtected(target),
      }, null, 2);
    },
  }, projectToolDocs[5].status);

  createInternalTool(projectToolDocs[6].name, {
    ...projectToolDocs[6],
    async execute({ width, height, modify_uv }) {
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
  }, projectToolDocs[6].status);

  createInternalTool(projectToolDocs[7].name, {
    ...projectToolDocs[7],
    async execute({ targets }, context) {
      let selectedTargets: ModelProject[];
      if (targets === "all") {
        selectedTargets = [...ModelProject.all];
      } else if (targets === "working") {
        const working = peekSessionWorkingProject(context.sessionId);
        selectedTargets = working ? [working] : [];
      } else if (targets === "foreground") {
        const foreground = getForegroundProject();
        selectedTargets = foreground ? [foreground] : [];
      } else {
        selectedTargets = [...new Map(
          targets.map((reference: string) => {
            const project = resolveOpenProject(reference);
            return [project.uuid, project] as const;
          })
        ).values()];
      }

      if (selectedTargets.length === 0) {
        throw new Error("No matching open projects to close.");
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
        forgetProjectState(identity.uuid);
      }

      return JSON.stringify({ closed });
    },
  }, projectToolDocs[7].status);

  createInternalTool(projectToolDocs[8].name, {
    ...projectToolDocs[8],
    async execute({ path, name, show }, context) {
      const normalizedPath = normalizeLocalBbmodelPath(path);
      const existing = ModelProject.all.find((project) =>
        Boolean(project.save_path && sameLocalPath(project.save_path, normalizedPath)) ||
        Boolean(project.export_path && sameLocalPath(project.export_path, normalizedPath))
      );
      if (existing) {
        setSessionWorkingProject(context.sessionId, existing);
        if (show && !existing.selected) existing.select();
        return JSON.stringify({
          source_path: normalizedPath,
          opened: describeProject(existing),
          shown: existing.selected,
          mcp_working_project: existing.uuid,
          foreground_project: getForegroundProject()?.uuid ?? null,
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
      setSessionWorkingProject(context.sessionId, opened);
      if (show) opened.select();
      else if (previous && ModelProject.all.includes(previous)) previous.select();

      return JSON.stringify({
        source_path: normalizedPath,
        opened: describeProject(opened),
        shown: opened.selected,
        mcp_working_project: opened.uuid,
        foreground_project: getForegroundProject()?.uuid ?? null,
        reused_existing_tab: false,
      }, null, 2);
    },
  }, projectToolDocs[8].status);

  createInternalTool(projectToolDocs[9].name, {
    ...projectToolDocs[9],
    async execute({ project, name, show }, context) {
      const source = project
        ? resolveOpenProject(project)
        : peekSessionWorkingProject(context.sessionId) ?? getForegroundProject();
      if (!source) {
        throw new Error("No MCP working project to duplicate.");
      }
      const previous = Project ?? null;
      if (!Codecs.project || typeof Codecs.project.compile !== "function") {
        throw new Error("Blockbench's portable project codec is unavailable.");
      }

      const compiled = context.runInProject(
        () => Codecs.project.compile({ bitmaps: true, absolute_paths: false }),
        source
      );
      const content = portableBbmodelText(compiled);

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
      setSessionWorkingProject(context.sessionId, duplicate);
      if (show) duplicate.select();
      else if (previous && ModelProject.all.includes(previous)) previous.select();

      return JSON.stringify({
        source: describeProject(source),
        duplicate: describeProject(duplicate),
        portable_bytes: new TextEncoder().encode(content).byteLength,
        shown: duplicate.selected,
        mcp_working_project: duplicate.uuid,
        foreground_project: getForegroundProject()?.uuid ?? null,
      }, null, 2);
    },
  }, projectToolDocs[9].status);

  createToolGroup(projectPublicToolDocs[0], projectReadOperations);
  createToolGroup(projectPublicToolDocs[1], projectEditOperations);

}
