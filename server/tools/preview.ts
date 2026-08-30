/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { resolveUniqueReference } from "@/lib/modelSafety";
import {
  previewNodesForProject,
  type McpPreviewState,
} from "@/lib/previewState";

export const previewParameters = z.object({
  animation: z
    .string().min(1)
    .optional()
    .describe("Exact animation UUID or unique name. Omit for the default pose."),
  time: z.number().finite().optional().default(0).describe("Animation time in seconds."),
  hide_bones: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Bones to hide in this capture."),
  show_bones: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Bones to show in this capture."),
  only_bones: z
    .array(z.string())
    .optional()
    .default([])
    .describe(
      "If non-empty, isolates these bones with their ancestors and descendants in this capture."
    ),
}).strict();

type PreviewInput = z.infer<typeof previewParameters>;

function resolveBone(reference: string, project: ModelProject): { uuid: string; name?: string } {
  return resolveUniqueReference(
    reference,
    previewNodesForProject(project),
    "Preview bone",
    "list_outline or list_armature_bones"
  );
}

/** Resolve one call's preview options; nothing is stored between MCP requests. */
export function resolvePreviewState(
  input: PreviewInput | undefined,
  project: ModelProject
): McpPreviewState | undefined {
  if (!input) return undefined;
  const animation = input.animation
    ? resolveUniqueReference(input.animation, Animator.animations, "Animation", "list_animations")
    : null;
  return {
    animation: animation
      ? { animationId: animation.uuid, time: input.time }
      : undefined,
    visibility: {
      hiddenBoneIds: [...new Set(input.hide_bones.map((id) => resolveBone(id, project).uuid))],
      shownBoneIds: [...new Set(input.show_bones.map((id) => resolveBone(id, project).uuid))],
      isolatedBoneIds: [...new Set(input.only_bones.map((id) => resolveBone(id, project).uuid))],
    },
  };
}
