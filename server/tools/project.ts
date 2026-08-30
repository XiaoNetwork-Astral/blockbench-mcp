/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { describeProject } from "@/lib/projectAccess";
import {
  isProjectReadOnly,
  setProjectReadOnly,
} from "@/src/features/readOnly/service";
import { forgetProjectValidationSnapshots } from "@/lib/validationSnapshots";
import {
  getVisibleProject,
  selectProject,
} from "@/src/blockbench/projects";
import {
  scaleProjectElementUvs,
  type ProjectUvElementTarget,
} from "@/lib/toolFixes";
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
});

export const getProjectInfoParameters = z.object({});

export const listProjectsParameters = z.object({});

export const selectProjectParameters = z.object({
  project: z.string().describe("Project UUID, exact name, or exact save path."),
});

export const saveProjectParameters = z.object({
  path: z
    .string()
    .optional()
    .describe("Optional absolute .bbmodel path. Omit it to use the visible project's current save path."),
});

export const setProjectReadOnlyParameters = z.object({
  read_only: z
    .boolean()
    .describe("true blocks model editing and saving while view navigation remains available; false removes the explicit lock."),
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

export const closeProjectParameters = z.object({});

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
});

export const duplicateProjectParameters = z.object({
  name: z
    .string()
    .min(1)
    .optional()
    .describe("Name for the unsaved duplicate tab. Defaults to '<source> copy'."),
});

export const projectToolDocs: ToolSpec[] = [
  {
    name: "create_project",
    description: "Creates a new project with the given name and project type.",
    project: "none",
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
      "Lists every open Blockbench project tab, its active state, read-only state, and whether MCP model mutations are allowed.",
    project: "none",
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
      "Selects an open project tab in Blockbench by exact UUID, exact save path, or unique exact name.",
    project: "none",
    writableProject: false,
    annotations: {
      title: "Select Project",
      destructiveHint: false,
    },
    parameters: selectProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "save_project",
    description:
      "Saves the visible project as a portable .bbmodel, using its current save path unless an absolute path is supplied.",
    annotations: {
      title: "Save Project",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: saveProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_project_read_only",
    description:
      "Turns the visible project's read-only lock on or off for both the user and MCP while preserving tab switching and camera navigation.",
    writableProject: false,
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
      "Sets the visible project's texture resolution. Existing UV coordinates are preserved unless modify_uv is explicitly true.",
    annotations: {
      title: "Set Project Texture Resolution",
      destructiveHint: true,
    },
    parameters: setProjectTextureResolutionParameters,
    status: STATUS_STABLE,
  },
  {
    name: "close_project_without_saving",
    description:
      "Closes the Blockbench tab visible when the call begins and explicitly discards its unsaved changes.",
    annotations: {
      title: "Close Project Without Saving",
      destructiveHint: true,
    },
    parameters: closeProjectParameters,
    status: STATUS_STABLE,
  },
  {
    name: "open_bbmodel",
    description:
      "Validates and opens one absolute local .bbmodel file as a new Blockbench project tab. Remote URLs and oversized/invalid JSON are rejected before Blockbench state changes; the result identifies the exact new tab.",
    project: "none",
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
    writableProject: false,
    annotations: {
      title: "Duplicate Project",
      destructiveHint: true,
    },
    parameters: duplicateProjectParameters,
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

async function saveVisibleProject(project: ModelProject, path?: string): Promise<{
  path: string;
  bytes: number;
}> {
  const targetPath = normalizeLocalBbmodelPath(path ?? project.save_path);
  const previousPath = project.save_path;
  project.save_path = targetPath;

  let content: string;
  try {
    content = portableBbmodelText(Codecs.project.compile());
  } catch (error) {
    project.save_path = previousPath;
    throw error;
  }

  await new Promise<void>((resolve) => {
    Blockbench.writeFile(targetPath, { content }, (writtenPath: string) => {
      Codecs.project.afterSave(writtenPath);
      resolve();
    });
  });

  return {
    path: targetPath,
    bytes: new TextEncoder().encode(content).byteLength,
  };
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

      if (!created || !Project) {
        throw new Error("Failed to create project.");
      }

      const createdProject = Project;
      createdProject.name = name;

      return JSON.stringify({
        created: describeProject(createdProject),
        visible_project: createdProject.uuid,
      }, null, 2);
    },
  }, projectToolDocs[0].status);

  createInternalTool(projectToolDocs[1].name, {
    ...projectToolDocs[1],
    async execute(_args, { project }) {
      const target = project!;
      const format = target.format as ModelFormat & { display_name?: string };

      const rootGroups = target.outliner
        .filter((n): n is Group => n instanceof Group)
        .map((g) => ({
          name: g.name,
          uuid: g.uuid,
          children: g.children?.length ?? 0,
        }));

      return JSON.stringify(
        {
          project: {
            name: target.name,
            uuid: target.uuid,
            save_path: target.save_path || null,
            visible: true,
          },
          format: {
            id: format?.id ?? null,
            name: format?.display_name ?? format?.name ?? null,
          },
          resolution: {
            texture_width: target.texture_width,
            texture_height: target.texture_height,
          },
          counts: {
            cubes: target.elements.filter((element) => element instanceof Cube).length,
            meshes: target.elements.filter((element) => element instanceof Mesh).length,
            groups: target.groups.length,
            textures: target.textures.length,
            outliner_elements: target.elements.length,
            root_nodes: target.outliner.length,
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
      const visible = getVisibleProject();
      return JSON.stringify(
        {
          visible_project: visible?.uuid ?? null,
          count: ModelProject.all.length,
          projects: ModelProject.all.map((project) => ({
            ...describeProject(project),
            visible: project.uuid === visible?.uuid,
          })),
        },
        null,
        2
      );
    },
  }, projectToolDocs[2].status);

  createInternalTool(projectToolDocs[3].name, {
    ...projectToolDocs[3],
    async execute({ project }) {
      const target = selectProject(project);
      return JSON.stringify({
        visible_project: target.uuid,
        project: describeProject(target),
      }, null, 2);
    },
  }, projectToolDocs[3].status);

  createInternalTool(projectToolDocs[4].name, {
    ...projectToolDocs[4],
    async execute({ path }, { project }) {
      const target = project!;
      const saved = await saveVisibleProject(target, path);
      return JSON.stringify({
        project: describeProject(target),
        ...saved,
      }, null, 2);
    },
  }, projectToolDocs[4].status);

  createInternalTool(projectToolDocs[5].name, {
    ...projectToolDocs[5],
    async execute({ read_only }, { project }) {
      const target = project!;
      setProjectReadOnly(target, read_only);
      return JSON.stringify({
        project: describeProject(target),
        requested_read_only: read_only,
        effective_read_only: isProjectReadOnly(target),
      }, null, 2);
    },
  }, projectToolDocs[5].status);

  createInternalTool(projectToolDocs[6].name, {
    ...projectToolDocs[6],
    async execute({ width, height, modify_uv }, { project }) {
      const target = project!;
      const previousWidth = target.texture_width;
      const previousHeight = target.texture_height;
      if (previousWidth === width && previousHeight === height) {
        return JSON.stringify({
          project: { name: target.name, uuid: target.uuid },
          texture_width: target.texture_width,
          texture_height: target.texture_height,
          uv_scaled: false,
          changed: false,
        });
      }

      const elements = modify_uv ? [...target.elements] : [];
      const textures = target.format.per_texture_uv_size ? [...target.textures] : [];
      const aspects: UndoAspects = {
        uv_mode: true,
        elements,
        textures,
        collections: [],
      };
      Undo.initEdit(aspects);
      if (modify_uv) {
        scaleProjectElementUvs(
          elements as unknown as ProjectUvElementTarget[],
          width / previousWidth,
          height / previousHeight
        );
      }
      target.texture_width = width;
      target.texture_height = height;
      for (const texture of textures) {
        texture.uv_width = width;
        texture.uv_height = height;
      }
      Undo.finishEdit("Agent set project texture resolution", aspects);
      Canvas.updateAllUVs();
      if (Outliner.selected.length > 0) UVEditor.loadData();

      return JSON.stringify({
        project: { name: target.name, uuid: target.uuid },
        texture_width: target.texture_width,
        texture_height: target.texture_height,
        uv_scaled: modify_uv,
        changed: true,
      });
    },
  }, projectToolDocs[6].status);

  createInternalTool(projectToolDocs[7].name, {
    ...projectToolDocs[7],
    async execute(_args, { project }) {
      const target = project!;
      const identity = { name: target.name, uuid: target.uuid };
      if (!(await target.close(true))) {
        throw new Error(
          `Blockbench refused to close project "${identity.name}" (${identity.uuid}).`
        );
      }
      forgetProjectValidationSnapshots(identity.uuid);

      return JSON.stringify({ closed: identity });
    },
  }, projectToolDocs[7].status);

  createInternalTool(projectToolDocs[8].name, {
    ...projectToolDocs[8],
    async execute({ path, name }) {
      const normalizedPath = normalizeLocalBbmodelPath(path);
      const existingMatches = ModelProject.all.filter((project) =>
        Boolean(project.save_path && sameLocalPath(project.save_path, normalizedPath)) ||
        Boolean(project.export_path && sameLocalPath(project.export_path, normalizedPath))
      );
      if (existingMatches.length > 1) {
        throw new Error(
          `Local project path "${normalizedPath}" is already owned by multiple open tabs: ` +
            `${existingMatches.map((project) => project.uuid).join(", ")}. Close the duplicates first.`
        );
      }
      const existing = existingMatches[0];
      if (existing) {
        if (!existing.selected) existing.select();
        return JSON.stringify({
          source_path: normalizedPath,
          opened: describeProject(existing),
          visible_project: existing.uuid,
          reused_existing_tab: true,
          ignored_name_override: name ?? null,
        }, null, 2);
      }
      const content = await readLocalBbmodel(normalizedPath);
      const before = new Set(ModelProject.all);
      loadModelFile({
        name: normalizedPath.split(/[\\/]/).pop() || "project.bbmodel",
        path: normalizedPath,
        content,
      }, {});
      const opened = openedProjectSince(before);
      if (name) opened.name = name;
      if (!opened.selected) opened.select();

      return JSON.stringify({
        source_path: normalizedPath,
        opened: describeProject(opened),
        visible_project: opened.uuid,
        reused_existing_tab: false,
      }, null, 2);
    },
  }, projectToolDocs[8].status);

  createInternalTool(projectToolDocs[9].name, {
    ...projectToolDocs[9],
    async execute({ name }, { project }) {
      const source = project!;
      if (!Codecs.project || typeof Codecs.project.compile !== "function") {
        throw new Error("Blockbench's portable project codec is unavailable.");
      }

      const compiled = Codecs.project.compile({ bitmaps: true, absolute_paths: false });
      const content = portableBbmodelText(compiled);

      const before = new Set(ModelProject.all);
      loadModelFile({
        name: `${source.name}.bbmodel`,
        // loadModelFile chooses a codec from the path extension before it
        // examines the content. This synthetic path is cleared immediately
        // after the new tab is identified.
        path: `blockbench-mcp-duplicate-${source.uuid}.bbmodel`,
        content,
      }, {});
      const duplicate = openedProjectSince(before);
      duplicate.name = name ?? `${source.name} copy`;
      duplicate.save_path = "";
      duplicate.export_path = "";
      duplicate.saved = false;
      if (!duplicate.selected) duplicate.select();

      return JSON.stringify({
        source: describeProject(source),
        duplicate: describeProject(duplicate),
        portable_bytes: new TextEncoder().encode(content).byteLength,
        visible_project: duplicate.uuid,
      }, null, 2);
    },
  }, projectToolDocs[9].status);

}
