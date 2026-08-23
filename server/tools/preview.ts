/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createInternalTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";

export const setPreviewStateParameters = z.object({
  project: z
    .string()
    .optional()
    .describe("Project UUID, exact name, or exact save path. Defaults to the active tab."),
  animation: z
    .string()
    .optional()
    .describe("Exact animation name. Omit to show the default pose."),
  time: z.number().finite().optional().default(0).describe("Animation time in seconds."),
  hide_bones: z.array(z.string()).optional().default([]),
  show_bones: z.array(z.string()).optional().default([]),
  only_bones: z
    .array(z.string())
    .optional()
    .default([])
    .describe("If non-empty, isolates these bones together with their ancestors and descendants."),
});

export const previewOperationDocs: ToolSpec[] = [
  {
    name: "set_preview_state",
    description:
      "Selects a project and applies an animation/time plus temporary bone visibility for live inspection. It does not bake the pose into the model.",
    annotations: {
      title: "Edit Preview",
      destructiveHint: false,
    },
    parameters: setPreviewStateParameters,
    status: STATUS_STABLE,
  },
];

type SetPreviewStateArgs = z.infer<typeof setPreviewStateParameters>;

function findProject(reference: string): ModelProject | undefined {
  return ModelProject.all.find(
    (project) =>
      project.uuid === reference ||
      project.name === reference ||
      Boolean(project.save_path && project.save_path === reference)
  );
}

function isGroup(value: unknown): value is Group {
  return value instanceof Group;
}

function descendantsAndAncestors(selected: Group[]): Set<Group> {
  const hierarchy = new Set<Group>();
  for (const group of selected) {
    hierarchy.add(group);
    let parent = group.parent;
    while (isGroup(parent)) {
      hierarchy.add(parent);
      parent = parent.parent;
    }
    for (const candidate of Group.all) {
      let current: unknown = candidate;
      while (isGroup(current)) {
        if (current === group) {
          hierarchy.add(candidate);
          break;
        }
        current = current.parent;
      }
    }
  }
  return hierarchy;
}

export function registerPreviewOperation() {
  createInternalTool(previewOperationDocs[0].name, {
    ...previewOperationDocs[0],
    async execute(args: SetPreviewStateArgs) {
      const { project, animation, time, hide_bones, show_bones, only_bones } = args;
      const target = project ? findProject(project) : Project;
      if (!target) {
        throw new Error(
          project
            ? `Project "${project}" not found. Use inspect_projects with command.action "list_projects" to inspect open tabs.`
            : "No active project is open."
        );
      }
      if (!target.selected && !target.select()) {
        throw new Error(`Blockbench refused to select project "${target.name}".`);
      }

      Animator.showDefaultPose?.();
      let selectedAnimation: _Animation | null = null;
      if (animation) {
        selectedAnimation = target.animations.find((item) => item.name === animation) ?? null;
        if (!selectedAnimation) {
          throw new Error(
            `Animation "${animation}" was not found in project "${target.name}".`
          );
        }
        selectedAnimation.select();
        Timeline.setTime(time);
        Animator.preview();
      }

      const hide = new Set(hide_bones);
      const show = new Set(show_bones);
      const only = new Set(only_bones);
      const isolatedGroups = Group.all.filter((group) => only.has(group.name));
      const hierarchy = descendantsAndAncestors(isolatedGroups);
      const isolate = only.size > 0;
      const changed: Group[] = [];
      for (const group of Group.all) {
        let visible = !isolate || hierarchy.has(group);
        if (hide.has(group.name)) visible = false;
        if (show.has(group.name)) visible = true;
        if (group.visibility !== visible) {
          group.visibility = visible;
          changed.push(group);
        }
        if (group.mesh) group.mesh.visible = visible;
      }
      if (changed.length) {
        Canvas.updateView({ groups: changed, group_aspects: { visibility: true } });
      }
      Canvas.updateAll();

      const knownNames = new Set(Group.all.map((group) => group.name));
      return JSON.stringify(
        {
          project: { uuid: target.uuid, name: target.name },
          animation: selectedAnimation?.name ?? null,
          time: animation ? time : null,
          visibility: {
            hidden_bones: [...hide],
            shown_bones: [...show],
            isolated_bones: [...only],
            unknown_hidden_bones: [...hide].filter((name) => !knownNames.has(name)),
            unknown_shown_bones: [...show].filter((name) => !knownNames.has(name)),
            unknown_isolated_bones: [...only].filter((name) => !knownNames.has(name)),
          },
        },
        null,
        2
      );
    },
  }, previewOperationDocs[0].status);
}
