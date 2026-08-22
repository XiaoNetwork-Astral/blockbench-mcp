/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import {
  describeProject,
} from "@/lib/projectRoles";

export const createProjectParameters = z.object({
  name: z.string(),
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
];

function findProject(reference: string): ModelProject | undefined {
  return ModelProject.all.find(
    (project) =>
      project.uuid === reference ||
      project.name === reference ||
      Boolean(project.save_path && project.save_path === reference)
  );
}

export function registerProjectTools() {
  createTool(projectToolDocs[0].name, {
    ...projectToolDocs[0],
    async execute({ name, format }) {
      const created = newProject(Formats[format]);

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
      const target = findProject(project);
      if (!target) {
        throw new Error(
          `Project "${project}" not found. Use list_projects to inspect open tabs.`
        );
      }
      if (!target.selected && !target.select()) {
        throw new Error(`Blockbench refused to select project "${target.name}".`);
      }
      return JSON.stringify(describeProject(target), null, 2);
    },
  }, projectToolDocs[3].status);

}
