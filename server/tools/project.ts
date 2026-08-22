/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import {
  describeProject,
} from "@/lib/projectRoles";
import { scaleProjectElementUvs } from "@/lib/toolFixes";

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
];

function findProjectOrThrow(reference: string): ModelProject {
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
        `${uniqueMatches.map((project) => project.uuid).join(", ")}). Use an exact UUID from list_projects.`
    );
  }
  throw new Error(
    `Project "${reference}" not found. Use list_projects to inspect open tabs.`
  );
}

export function registerProjectTools() {
  createTool(projectToolDocs[0].name, {
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

  createTool(projectToolDocs[1].name, {
    ...projectToolDocs[1],
    async execute() {
      if (!Project) {
        throw new Error(
          "No project is open. Use create_project to start a new one, or open an existing file in Blockbench."
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

  createTool(projectToolDocs[2].name, {
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

  createTool(projectToolDocs[3].name, {
    ...projectToolDocs[3],
    async execute({ project }) {
      const target = findProjectOrThrow(project);
      if (!target.selected && !target.select()) {
        throw new Error(`Blockbench refused to select project "${target.name}".`);
      }
      return JSON.stringify(describeProject(target), null, 2);
    },
  }, projectToolDocs[3].status);

  createTool(projectToolDocs[4].name, {
    ...projectToolDocs[4],
    async execute({ width, height, modify_uv }) {
      if (!Project) {
        throw new Error("No active project. Use create_project or select_project first.");
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

  createTool(projectToolDocs[5].name, {
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

}
