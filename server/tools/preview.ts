/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createInternalTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { resolveOpenProject } from "@/lib/projectContext";
import { resolveUniqueReference } from "@/lib/modelSafety";
import {
  setSessionPreviewAnimationState,
  setSessionPreviewVisibilityState,
} from "@/lib/previewState";

export const setPreviewStateParameters = z.object({
  project: z
    .string()
    .optional()
    .describe("Project UUID, exact name, or exact save path. Defaults to the MCP working project."),
  animation: z
    .string()
    .optional()
    .describe("Exact animation name. Omit to show the default pose."),
  time: z.number().finite().optional().default(0).describe("Animation time in seconds."),
  hide_bones: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Bones to hide only in this MCP session's offscreen screenshots."),
  show_bones: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Bones to show only in this MCP session's offscreen screenshots."),
  only_bones: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "If non-empty, isolates these bones with their ancestors and descendants only in this MCP session's offscreen screenshots. Pass empty visibility arrays to clear the filter."
    ),
});

export const previewOperationDocs: ToolSpec[] = [
  {
    name: "set_preview_state",
    description:
      "Stores an animation/time and bone filter for this session's cloned offscreen screenshots. It never changes the user's visible pose, viewport, or Outliner visibility.",
    annotations: {
      title: "Edit Preview",
      destructiveHint: false,
    },
    parameters: setPreviewStateParameters,
    status: STATUS_STABLE,
  },
];

type SetPreviewStateArgs = z.infer<typeof setPreviewStateParameters>;

function resolveOptionalGroup(reference: string): Group | null {
  const uuidMatches = Group.all.filter((group) => group.uuid === reference);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(`Bone UUID "${reference}" is duplicated in the current project.`);
  }
  const nameMatches = Group.all.filter((group) => group.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Bone name "${reference}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((group) => group.uuid).join(", ")}). Use an exact UUID.`
    );
  }
  return null;
}

export function registerPreviewOperation() {
  createInternalTool(previewOperationDocs[0].name, {
    ...previewOperationDocs[0],
    async execute(args: SetPreviewStateArgs, context) {
      const { project, animation, time, hide_bones, show_bones, only_bones } = args;
      const target = project
        ? resolveOpenProject(project)
        : context.project ?? Project;
      if (!target) {
        throw new Error(
          project
            ? `Project "${project}" not found. Use inspect_projects with command.action "list_projects" to inspect open tabs.`
            : "No MCP working project is open."
        );
      }
      const apply = () => {
        let selectedAnimation: _Animation | null = null;
        if (animation) {
          selectedAnimation = resolveUniqueReference(
            animation,
            target.animations,
            "Animation",
            "inspect_animation"
          );
        }

        const hideEntries = hide_bones.map((reference) => [reference, resolveOptionalGroup(reference)] as const);
        const showEntries = show_bones.map((reference) => [reference, resolveOptionalGroup(reference)] as const);
        const onlyEntries = only_bones.map((reference) => [reference, resolveOptionalGroup(reference)] as const);
        const hide = new Set(hideEntries.map(([, group]) => group).filter((group): group is Group => Boolean(group)));
        const show = new Set(showEntries.map(([, group]) => group).filter((group): group is Group => Boolean(group)));
        const only = new Set(onlyEntries.map(([, group]) => group).filter((group): group is Group => Boolean(group)));
        setSessionPreviewVisibilityState(context.sessionId, target.uuid, {
          hiddenBoneIds: [...hide].map((group) => group.uuid),
          shownBoneIds: [...show].map((group) => group.uuid),
          isolatedBoneIds: [...only].map((group) => group.uuid),
        });
        setSessionPreviewAnimationState(context.sessionId, target.uuid, {
          animationId: selectedAnimation?.uuid ?? null,
          time: selectedAnimation ? time : null,
        });

        return JSON.stringify(
          {
            project: { uuid: target.uuid, name: target.name },
            animation: selectedAnimation?.name ?? null,
            time: animation ? time : null,
            preview_scope: {
              offscreen_only: true,
              session_id: context.sessionId ?? null,
              persists_until_reset: true,
              visible_editor_state_changed: false,
              reset:
                "Call set_preview_state again for this project without animation and with empty visibility arrays.",
            },
            visibility: {
              hidden_bones: [...hide].map((group) => ({ name: group.name, uuid: group.uuid })),
              shown_bones: [...show].map((group) => ({ name: group.name, uuid: group.uuid })),
              isolated_bones: [...only].map((group) => ({ name: group.name, uuid: group.uuid })),
              unknown_hidden_bones: hideEntries.filter(([, group]) => !group).map(([reference]) => reference),
              unknown_shown_bones: showEntries.filter(([, group]) => !group).map(([reference]) => reference),
              unknown_isolated_bones: onlyEntries.filter(([, group]) => !group).map(([reference]) => reference),
            },
          },
          null,
          2
        );
      };
      return context.runInProject(apply, target);
    },
  }, previewOperationDocs[0].status);
}
