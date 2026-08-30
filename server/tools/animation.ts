/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import { findElementOrThrow, findGroupOrThrow } from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { applyKeyframeValues } from "@/lib/toolFixes";
import {
  collectOutlinerSubtree,
  finishCreatedOutlinerEdit,
  resolveUniqueReference,
  resolveOutlinerParentOrThrow,
  rollbackCreatedOutlinerEdit,
} from "@/lib/modelSafety";
import {
  vec3,
  animationIdOptionalSchema,
  animationChannelEnum,
  axisEnum,
  timeRangeSchema,
  boneNameSchema,
  loopModeEnum,
  keyframeDataSchema,
} from "@/lib/zodObjects";

export function normalizeAnimationName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Animation name cannot be empty.");
  return normalized.startsWith("animation.")
    ? normalized
    : `animation.${normalized}`;
}

const KEYFRAME_TIME_EPSILON = 0.001;

type RuntimeAnimator = GeneralAnimator & {
  createKeyframe(
    value: KeyframeOptions | null,
    time: number,
    channel: string,
    undo?: boolean,
    select?: boolean
  ): _Keyframe;
};

function createRuntimeKeyframe(
  animator: GeneralAnimator,
  value: KeyframeOptions | null,
  time: number,
  channel: string
): _Keyframe {
  return (animator as RuntimeAnimator).createKeyframe(
    value,
    time,
    channel,
    false,
    false
  );
}

export function keyframeVector(value: unknown, fallback = 0): ArrayVector3 {
  if (typeof value === "number" && Number.isFinite(value)) return [value, value, value];
  if (Array.isArray(value)) {
    return [0, 1, 2].map((index) => {
      const component = Number(value[index]);
      return Number.isFinite(component) ? component : fallback;
    }) as ArrayVector3;
  }
  return [fallback, fallback, fallback];
}

type BezierVectorProperty =
  | "bezier_left_time"
  | "bezier_left_value"
  | "bezier_right_time"
  | "bezier_right_value";

export function setKeyframeVector(
  keyframe: Record<BezierVectorProperty, unknown>,
  property: BezierVectorProperty,
  value: unknown,
  fallback = 0
): void {
  const vector = keyframeVector(value, fallback);
  const current = keyframe[property];
  if (Array.isArray(current)) current.splice(0, current.length, ...vector);
  else keyframe[property] = vector;
}

export function collectAnimationKeyframes<T>(animation: {
  animators?: Record<string, { keyframes?: T[] }>;
}): T[] {
  return [...new Set(
    Object.values(animation.animators ?? {}).flatMap((animator) => animator.keyframes ?? [])
  )];
}

interface CopyableRuntimeKeyframe {
  channel: string;
  time: number;
  interpolation: string;
  uniform: boolean;
  data_points: Array<{ getUndoCopy(): Record<string, unknown> }>;
  bezier_linked: boolean;
  bezier_left_time?: unknown;
  bezier_left_value?: unknown;
  bezier_right_time?: unknown;
  bezier_right_value?: unknown;
}

export function copyRuntimeKeyframeData(keyframe: CopyableRuntimeKeyframe) {
  return {
    channel: keyframe.channel,
    time: keyframe.time,
    interpolation: keyframe.interpolation,
    uniform: keyframe.uniform,
    data_points: keyframe.data_points.map((point) => point.getUndoCopy()),
    bezier_linked: keyframe.bezier_linked,
    bezier_left_time: keyframeVector(keyframe.bezier_left_time, -0.1),
    bezier_left_value: keyframeVector(keyframe.bezier_left_value),
    bezier_right_time: keyframeVector(keyframe.bezier_right_time, 0.1),
    bezier_right_value: keyframeVector(keyframe.bezier_right_value),
  };
}

function numericKeyframeVector(values: Array<string | number>): ArrayVector3 {
  const vector = [Number(values[0]), Number(values[1]), Number(values[2])] as ArrayVector3;
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error("This operation requires numeric keyframe values, not Molang expressions.");
  }
  return vector;
}

function flipRuntimeKeyframe(keyframe: _Keyframe, axis: 0 | 1 | 2): void {
  (keyframe as unknown as { flip(axis: 0 | 1 | 2): unknown }).flip(axis);
}

export function resolveUniqueKeyframeAtTime<T extends { time: number }>(
  keyframes: readonly T[] | undefined,
  time: number,
  context: string
): T {
  const matches = (keyframes ?? []).filter(
    (keyframe) => Math.abs(keyframe.time - time) < KEYFRAME_TIME_EPSILON
  );
  if (matches.length === 0) {
    throw new Error(`No keyframe exists at ${time} seconds for ${context}.`);
  }
  if (matches.length > 1) {
    throw new Error(
      `Ambiguous keyframe reference at ${time} seconds for ${context}: ` +
        `${matches.length} keyframes are within ${KEYFRAME_TIME_EPSILON} seconds.`
    );
  }
  return matches[0];
}

export function assertKeyframeTimesAvailable(
  existingKeyframes: readonly { time: number }[] | undefined,
  requestedTimes: readonly number[],
  context: string
): void {
  requestedTimes.forEach((time, index) => {
    const duplicateRequest = requestedTimes
      .slice(0, index)
      .some((otherTime) => Math.abs(otherTime - time) < KEYFRAME_TIME_EPSILON);
    if (duplicateRequest) {
      throw new Error(
        `Duplicate keyframe time ${time} seconds in the request for ${context}.`
      );
    }

    const existingMatches = (existingKeyframes ?? []).filter(
      (keyframe) => Math.abs(keyframe.time - time) < KEYFRAME_TIME_EPSILON
    );
    if (existingMatches.length > 1) {
      throw new Error(
        `Ambiguous existing keyframes at ${time} seconds for ${context}: ` +
          `${existingMatches.length} keyframes are within ${KEYFRAME_TIME_EPSILON} seconds.`
      );
    }
    if (existingMatches.length === 1) {
      throw new Error(
        `A keyframe already exists at ${time} seconds for ${context}.`
      );
    }
  });
}

function findAnimationOrThrow(reference?: string): _Animation {
  if (!reference) {
    if (!Animator.selected) throw new Error("No animation is selected.");
    return Animator.selected;
  }
  return resolveUniqueReference(
    reference,
    Animator.animations,
    "Animation",
    "inspect_animation"
  );
}

function animationSummary(animation: _Animation, includeKeyframes: boolean) {
  const animators = Object.values(animation.animators ?? {}) as Array<GeneralAnimator & {
    name?: string;
    keyframes?: _Keyframe[];
    getGroup?: () => Group | undefined;
  }>;
  const populatedAnimators = animators.filter(
    (animator) => (animator.keyframes?.length ?? 0) > 0
  );
  const keyframeCount = populatedAnimators.reduce(
    (total, animator) => total + (animator.keyframes?.length ?? 0),
    0
  );
  const keyframes = includeKeyframes
    ? populatedAnimators.flatMap((animator) =>
        (animator.keyframes ?? []).map((keyframe) => ({
          uuid: keyframe.uuid,
          bone_uuid: animator.uuid,
          bone: animator.getGroup?.()?.name ?? animator.name ?? null,
          channel: keyframe.channel,
          time: keyframe.time,
          interpolation: keyframe.interpolation,
          values: typeof keyframe.getArray === "function" ? keyframe.getArray() : [],
          selected: Boolean(keyframe.selected),
        }))
      )
    : undefined;
  return {
    uuid: animation.uuid,
    name: animation.name,
    selected: Animator.selected === animation,
    loop: animation.loop,
    length: animation.length,
    snapping: animation.snapping,
    keyframe_count: keyframeCount,
    animator_count: populatedAnimators.length,
    ...(keyframes ? { keyframes } : {}),
  };
}

export const createAnimationParameters = z.object({
  name: z.string().describe("Name of the animation"),
  loop: z
    .boolean()
    .default(false)
    .describe("Whether the animation should loop"),
  animation_length: z
    .number()
    .optional()
    .describe("Length of the animation in seconds"),
  bones: z
    .record(
      z.array(
        z.object({
          time: z.number(),
          position: vec3().optional(),
          rotation: vec3().optional(),
          scale: z.union([vec3(), z.number()]).optional(),
        })
      )
    )
    .describe("Keyframes for each bone"),
  particle_effects: z
    .record(z.string().describe("Effect name"))
    .optional()
    .describe("Particle effects with timestamps as keys"),
});

export const manageKeyframesParameters = z.object({
  animation_id: animationIdOptionalSchema,
  action: z
    .enum(["create", "delete", "edit", "select"])
    .describe("Action to perform on keyframes."),
  bone_name: boneNameSchema.describe("Name of the bone/group to manage keyframes for."),
  channel: animationChannelEnum.describe("Animation channel to modify."),
  keyframes: z
    .array(keyframeDataSchema)
    .describe("Keyframe data for the action."),
});

export const animationGraphEditorParameters = z.object({
  animation_id: animationIdOptionalSchema,
  bone_name: boneNameSchema.describe("Name of the bone/group to modify curves for."),
  channel: animationChannelEnum.describe("Animation channel to modify."),
  action: z
    .enum([
      "smooth",
      "linear",
      "ease_in",
      "ease_out",
      "ease_in_out",
      "stepped",
      "custom",
    ])
    .describe("Type of curve modification to apply."),
  keyframe_range: timeRangeSchema
    .optional()
    .describe(
      "Time range to apply the curve modification. If not provided, applies to all keyframes."
    ),
  custom_curve: z
    .object({
      control_point_1: z
        .array(z.number())
        .length(2)
        .describe("First control point [time, value]."),
      control_point_2: z
        .array(z.number())
        .length(2)
        .describe("Second control point [time, value]."),
    })
    .optional()
    .describe(
      "Custom bezier curve control points (only for 'custom' action)."
    ),
}).superRefine(({ action, custom_curve }, context) => {
  if (action === "custom" && !custom_curve) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["custom_curve"],
      message: "custom_curve is required for the custom action.",
    });
  }
});

export const boneRiggingParameters = z
  .object({
    action: z
      .enum([
        "create",
        "parent",
        "unparent",
        "delete",
        "rename",
        "set_pivot",
        "set_ik",
        "mirror",
      ])
      .describe("Action to perform on the bone structure."),
    bone_data: z
      .object({
        name: z.string().min(1).describe("UUID or unique name of the bone."),
        parent: z
          .string()
          .min(1)
          .optional()
          .describe(
            'Target parent UUID or unique name. Creating defaults to root, mirroring defaults to the original parent, and only the parent action requires this field.'
          ),
        new_name: z
          .string()
          .min(1)
          .optional()
          .describe("Required replacement name for the rename action."),
        origin: vec3("Pivot point of the bone.").optional(),
        rotation: vec3("Initial rotation of the bone.").optional(),
        children: z
          .array(z.string().min(1))
          .optional()
          .describe("UUIDs or unique names of existing nodes to move into a newly created bone."),
        ik_enabled: z
          .boolean()
          .optional()
          .describe("Enable inverse kinematics for this bone."),
        ik_target: z
          .string()
          .optional()
          .describe("Target bone UUID or unique name for the IK chain."),
        mirror_axis: axisEnum.optional().describe("Axis to mirror the bone across."),
      })
      .describe("Bone configuration data."),
  })
  .superRefine(({ action, bone_data }, ctx) => {
    if (action === "parent" && !bone_data.parent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bone_data", "parent"],
        message:
          'parent is required for the parent action. Use the literal "root" for the root level.',
      });
    }
    if (action === "rename" && !bone_data.new_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bone_data", "new_name"],
        message: "new_name is required for the rename action.",
      });
    }
    if (action === "set_pivot" && !bone_data.origin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bone_data", "origin"],
        message: "origin is required for the set_pivot action.",
      });
    }
  });

export const animationTimelineParameters = z.object({
  animation_id: animationIdOptionalSchema,
  action: z
    .enum([
      "play",
      "pause",
      "stop",
      "set_time",
      "set_length",
      "set_fps",
      "loop",
      "select_range",
    ])
    .describe("Timeline action to perform."),
  time: z
    .number()
    .optional()
    .describe("Time in seconds (for set_time action)."),
  length: z
    .number()
    .optional()
    .describe("Animation length in seconds (for set_length action)."),
  fps: z
    .number()
    .min(1)
    .max(120)
    .optional()
    .describe("Frames per second (for set_fps action)."),
  loop_mode: loopModeEnum.optional().describe("Loop mode for the animation."),
  range: timeRangeSchema.optional().describe("Time range for selection."),
});

export const listAnimationsParameters = z.object({});

export const getAnimationParameters = z.object({
  animation_id: animationIdOptionalSchema.describe(
    "Animation UUID or exact name. Defaults to the selected animation."
  ),
});

export const manageAnimationParameters = z
  .object({
    action: z.enum(["select", "rename", "remove"]),
    animation_id: z.string().min(1).describe("Animation UUID or exact name."),
    new_name: z.string().min(1).optional().describe("Required for rename."),
  })
  .superRefine(({ action, new_name }, ctx) => {
    if (action === "rename" && !new_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["new_name"],
        message: "new_name is required for rename.",
      });
    }
  });

export const batchKeyframeOperationsParameters = z.object({
  selection: z
    .enum(["all", "selected", "range", "pattern"])
    .default("selected")
    .describe("Which keyframes to operate on."),
  range: timeRangeSchema.optional().describe("Time range for keyframe selection."),
  pattern: z
    .object({
      interval: z.number().positive().describe("Time interval between keyframes."),
      offset: z
        .number()
        .optional()
        .default(0)
        .describe("Time offset for the pattern."),
    })
    .optional()
    .describe("Pattern-based selection."),
  operation: z
    .enum(["offset", "scale", "reverse", "mirror", "smooth", "bake"])
    .describe("Operation to perform on keyframes."),
  parameters: z
    .object({
      offset_time: z.number().optional().describe("Time offset to apply."),
      offset_values: vec3("Value offset to apply.").optional(),
      scale_factor: z
        .number()
        .optional()
        .describe("Scale factor for time or values."),
      scale_pivot: z
        .number()
        .optional()
        .describe("Pivot point for scaling."),
      mirror_axis: axisEnum.optional().describe("Axis to mirror values across."),
      bake_interval: z
        .number()
        .positive()
        .optional()
        .describe("Interval for baking keyframes."),
    })
    .optional()
    .describe("Operation-specific parameters."),
}).superRefine(({ selection, range, pattern, operation, parameters }, context) => {
  if (selection === "range" && !range) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["range"],
      message: "range is required for range selection.",
    });
  }
  if (selection === "pattern" && !pattern) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["pattern"],
      message: "pattern is required for pattern selection.",
    });
  }
  if (operation === "mirror" && !parameters?.mirror_axis) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parameters", "mirror_axis"],
      message: "mirror_axis is required for the mirror operation.",
    });
  }
  if (
    operation === "offset" &&
    parameters?.offset_time === undefined &&
    parameters?.offset_values === undefined
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parameters"],
      message: "offset requires offset_time or offset_values.",
    });
  }
  if (operation === "scale" && parameters?.scale_factor === undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["parameters", "scale_factor"],
      message: "scale_factor is required for the scale operation.",
    });
  }
});

export const copyAnimationKeyframesParameters = z.object({
  source: z.object({
      animation: z
        .string()
        .optional()
        .describe("Source animation name or UUID."),
      bone: z.string().describe("Source bone name."),
      channels: z
        .array(animationChannelEnum)
        .optional()
        .default(["rotation", "position", "scale"])
        .describe("Channels to copy."),
      time_range: timeRangeSchema
        .optional()
        .describe(
          "Time range to copy. If not provided, copies all keyframes."
        ),
    }).describe("Animation data to copy."),
  target: z.object({
      animation: z
        .string()
        .optional()
        .describe("Target animation name or UUID."),
      bone: z.string().describe("Target bone name."),
      time_offset: z
        .number()
        .optional()
        .default(0)
        .describe("Time offset for pasted keyframes."),
      mirror_axis: axisEnum
        .optional()
        .describe("Optional axis to mirror while copying."),
    }).describe("Destination for the copied keyframes."),
});

export const animationToolDocs: ToolSpec[] = [
  {
    name: "create_animation",
    description: "Creates a new animation with keyframes for bones.",
    annotations: {
      title: "Create Animation",
      destructiveHint: true,
    },
    parameters: createAnimationParameters,
    status: STATUS_STABLE,
  },
  {
    name: "manage_keyframes",
    description:
      "Creates, deletes, or edits keyframes in the animation timeline for specific bones and channels.",
    annotations: {
      title: "Manage Keyframes",
      destructiveHint: true,
    },
    parameters: manageKeyframesParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "animation_graph_editor",
    description:
      "Controls animation curves in the graph editor for fine-tuning animations.",
    annotations: {
      title: "Animation Graph Editor",
      destructiveHint: true,
    },
    parameters: animationGraphEditorParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "bone_rigging",
    description:
      "Creates and manipulates the bone structure (rig) of a model for animation.",
    annotations: {
      title: "Bone Rigging",
      destructiveHint: true,
    },
    parameters: boneRiggingParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "animation_timeline",
    description:
      "Controls the animation timeline, including playback, time scrubbing, and timeline settings.",
    annotations: {
      title: "Animation Timeline",
      destructiveHint: true,
    },
    parameters: animationTimelineParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "batch_keyframe_operations",
    description: "Performs batch operations on multiple keyframes at once.",
    annotations: {
      title: "Batch Keyframe Operations",
      destructiveHint: true,
    },
    parameters: batchKeyframeOperationsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "copy_animation_keyframes",
    description:
      "Copies keyframes directly between bones or animations, optionally mirroring them, without a stored clipboard step.",
    annotations: {
      title: "Animation Copy/Paste",
      destructiveHint: true,
    },
    parameters: copyAnimationKeyframesParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

export const animationInspectionToolDocs: ToolSpec[] = [
  {
    name: "list_animations",
    description: "Lists animations and reports which one is currently selected.",
    annotations: { title: "List Animations", readOnlyHint: true },
    parameters: listAnimationsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_animation",
    description: "Returns one animation with its animators and keyframes.",
    annotations: { title: "Get Animation", readOnlyHint: true },
    parameters: getAnimationParameters,
    status: STATUS_STABLE,
  },
];

export const animationManagementToolDoc: ToolSpec = {
  name: "manage_animation",
  description: "Selects, renames, or removes one animation by exact UUID or name.",
  annotations: { title: "Manage Animation", destructiveHint: true },
  parameters: manageAnimationParameters,
  status: STATUS_STABLE,
};

export function registerAnimationTools() {
createInternalTool(
  animationInspectionToolDocs[0].name,
  {
    ...animationInspectionToolDocs[0],
    parameters: listAnimationsParameters,
    async execute() {
      return JSON.stringify({
        current: Animator.selected
          ? { uuid: Animator.selected.uuid, name: Animator.selected.name }
          : null,
        count: Animator.animations.length,
        animations: Animator.animations.map((animation) => animationSummary(animation, false)),
      }, null, 2);
    },
  },
  animationInspectionToolDocs[0].status
);

createInternalTool(
  animationInspectionToolDocs[1].name,
  {
    ...animationInspectionToolDocs[1],
    parameters: getAnimationParameters,
    async execute({ animation_id }) {
      return JSON.stringify(animationSummary(findAnimationOrThrow(animation_id), true), null, 2);
    },
  },
  animationInspectionToolDocs[1].status
);

createInternalTool(
  animationManagementToolDoc.name,
  {
    ...animationManagementToolDoc,
    parameters: manageAnimationParameters,
    async execute({ action, animation_id, new_name }) {
      const animation = findAnimationOrThrow(animation_id);
      if (action === "select") {
        animation.select();
        Animator.preview();
        return JSON.stringify(animationSummary(animation, false));
      }
      if (action === "rename") {
        const normalizedName = normalizeAnimationName(new_name!);
        Undo.initEdit({ animations: [animation] });
        animation.name = normalizedName;
        animation.createUniqueName(Animator.animations);
        Undo.finishEdit("Rename animation", { animations: [animation] });
        animation.select();
        return JSON.stringify(animationSummary(animation, false));
      }
      animation.remove(true, false);
      return JSON.stringify({ removed: { uuid: animation.uuid, name: animation.name } });
    },
  },
  animationManagementToolDoc.status
);

createInternalTool(
  animationToolDocs[0].name,
  {
    ...animationToolDocs[0],
    parameters: createAnimationParameters,
    async execute({ name, loop, animation_length, bones, particle_effects }) {
      const animationData = {
        loop,
        ...(animation_length && { animation_length }),
        bones: Object.fromEntries(
          Object.entries(bones).map(([boneName, keyframes]) => {
            const boneData: Record<
              string,
              Record<string, number | number[]>
            > = keyframes.reduce((acc, keyframe) => {
              const timeKey = keyframe.time.toString();
              if (keyframe.position) {
                (acc.position ??= {})[timeKey] = keyframe.position;
              }
              if (keyframe.rotation) {
                (acc.rotation ??= {})[timeKey] = keyframe.rotation;
              }
              if (keyframe.scale) {
                (acc.scale ??= {})[timeKey] = keyframe.scale;
              }
              return acc;
            }, {} as Record<string, Record<string, number | number[]>>);

            return [boneName, boneData];
          })
        ),
        ...(particle_effects && { particle_effects }),
      };

      const normalizedName = normalizeAnimationName(name);
      const allAnimations = Animator.animations;
      const animationsBefore = new Set(allAnimations);
      Animator.loadFile({
        content: JSON.stringify({
          format_version: "1.8.0",
          animations: {
            [normalizedName]: animationData,
          },
        }),
      });

      const createdAnimations = Animator.animations.filter(
        (animation) => !animationsBefore.has(animation)
      );
      if (createdAnimations.length !== 1) {
        throw new Error(
          `Blockbench added ${createdAnimations.length} animations for one request; expected exactly one.`
        );
      }
      const created = createdAnimations[0];
      created.select();
      Animator.preview();

      return JSON.stringify({
        ...animationSummary(created, false),
        requested_name: normalizedName,
        bone_count: Object.keys(bones).length,
        particle_effect_count: Object.keys(particle_effects ?? {}).length,
      });
    },
  },
  animationToolDocs[0].status
);

createInternalTool(
  animationToolDocs[1].name,
  {
    ...animationToolDocs[1],
    parameters: manageKeyframesParameters,
    async execute({ animation_id, action, bone_name, channel, keyframes }) {
      // Find or select animation
      const animation = findAnimationOrThrow(animation_id);
      animation.select();

      // Find the bone
      const group = findGroupOrThrow(bone_name);

      // Resolve the animator without mutating the animation. Only "create" may
      // add one, and it does so inside the Undo transaction below.
      let animator = animation.animators[group.uuid];
      if (!animator && action !== "create") {
        throw new Error(`No animator exists for bone ${bone_name}.`);
      }

      const context = `${bone_name}.${channel}`;
      const requestedTimes = keyframes.map((keyframe) => keyframe.time);
      if (action === "create") {
        assertKeyframeTimesAvailable(animator?.[channel], requestedTimes, context);
      } else {
        assertKeyframeTimesAvailable(undefined, requestedTimes, context);
      }

      const resolvedKeyframes: _Keyframe[] =
        action === "create"
          ? []
          : keyframes.map((keyframe) =>
              resolveUniqueKeyframeAtTime(
                animator?.[channel] as _Keyframe[] | undefined,
                keyframe.time,
                context
              )
            );

      if (action === "select") {
        Timeline.selected.empty();
        resolvedKeyframes.forEach((keyframe) => keyframe.select());
        return `Successfully selected ${resolvedKeyframes.length} keyframes for ${context}`;
      }

      const undoAspects = {
        animations: [animation],
        keyframes: [],
      };
      Undo.initEdit(undoAspects);

      try {
        if (!animator) {
          animator = new BoneAnimator(group.uuid, animation, bone_name);
          animation.animators[group.uuid] = animator;
        }
        const activeAnimator = animator;

        switch (action) {
          case "create":
            keyframes.forEach((kf) => {
              const keyframe = createRuntimeKeyframe(
                activeAnimator,
                {
                  time: kf.time,
                  channel,
                  interpolation: kf.interpolation,
                  data_points: [],
                },
                kf.time,
                channel
              );

              if (kf.values !== undefined) {
                applyKeyframeValues(keyframe, kf.values);
              }

              if (kf.interpolation === "bezier" && kf.bezier_handles) {
                if (kf.bezier_handles.left_time !== undefined)
                  setKeyframeVector(keyframe, "bezier_left_time", kf.bezier_handles.left_time);
                if (kf.bezier_handles.left_value)
                  setKeyframeVector(keyframe, "bezier_left_value", kf.bezier_handles.left_value);
                if (kf.bezier_handles.right_time !== undefined)
                  setKeyframeVector(keyframe, "bezier_right_time", kf.bezier_handles.right_time);
                if (kf.bezier_handles.right_value)
                  setKeyframeVector(keyframe, "bezier_right_value", kf.bezier_handles.right_value);
              }
            });
            break;

          case "delete":
            resolvedKeyframes.forEach((keyframe) => keyframe.remove());
            break;

          case "edit":
            keyframes.forEach((kf, index) => {
              const keyframe = resolvedKeyframes[index];
              if (kf.values !== undefined) {
                applyKeyframeValues(keyframe, kf.values);
              }
              if (kf.interpolation) {
                keyframe.interpolation = kf.interpolation;
              }
              if (kf.interpolation === "bezier" && kf.bezier_handles) {
                if (kf.bezier_handles.left_time !== undefined)
                  setKeyframeVector(keyframe, "bezier_left_time", kf.bezier_handles.left_time);
                if (kf.bezier_handles.left_value)
                  setKeyframeVector(keyframe, "bezier_left_value", kf.bezier_handles.left_value);
                if (kf.bezier_handles.right_time !== undefined)
                  setKeyframeVector(keyframe, "bezier_right_time", kf.bezier_handles.right_time);
                if (kf.bezier_handles.right_value)
                  setKeyframeVector(keyframe, "bezier_right_value", kf.bezier_handles.right_value);
              }
            });
            break;
        }

        Undo.finishEdit(`${action} keyframes`);
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      Animator.preview();

      return `Successfully performed ${action} on ${keyframes.length} keyframes for ${bone_name}.${channel}`;
    },
  },
  animationToolDocs[1].status
);

createInternalTool(
  animationToolDocs[2].name,
  {
    ...animationToolDocs[2],
    parameters: animationGraphEditorParameters,
    async execute({
      animation_id,
      bone_name,
      channel,
      action,
      keyframe_range,
      custom_curve,
    }) {
      const animation = findAnimationOrThrow(animation_id);
      animation.select();

      const group = findGroupOrThrow(bone_name);

      const animator = animation.animators[group.uuid];
      if (!animator || !animator[channel]) {
        throw new Error(`No keyframes found for ${bone_name}.${channel}`);
      }

      const keyframes = (animator[channel] as _Keyframe[]).filter((kf) => {
        if (!keyframe_range) return true;
        return kf.time >= keyframe_range.start && kf.time <= keyframe_range.end;
      }).sort((a, b) => a.time - b.time);
      if (keyframes.length === 0) {
        throw new Error(`No keyframes found for ${bone_name}.${channel} in the requested range.`);
      }

      Undo.initEdit({
        animations: [animation],
        keyframes,
      });

      try {
        keyframes.forEach((kf, index) => {
          switch (action) {
          case "linear":
            kf.interpolation = "linear";
            break;

          case "stepped":
            kf.interpolation = "step";
            break;

          case "smooth":
            kf.interpolation = "catmullrom";
            break;

          case "ease_in":
          case "ease_out":
          case "ease_in_out":
            kf.interpolation = "bezier";
            const previous = keyframes[index - 1];
            const next = keyframes[index + 1];
            const previousDuration = previous ? kf.time - previous.time : 0.1;
            const nextDuration = next ? next.time - kf.time : 0.1;
            const leftFactor = action === "ease_in" ? 0.4 : action === "ease_out" ? 0.6 : 0.3;
            const rightFactor = action === "ease_in" ? 0.6 : action === "ease_out" ? 0.4 : 0.3;
            setKeyframeVector(kf, "bezier_left_time", -previousDuration * leftFactor);
            setKeyframeVector(kf, "bezier_right_time", nextDuration * rightFactor);
            setKeyframeVector(kf, "bezier_left_value", 0);
            setKeyframeVector(kf, "bezier_right_value", 0);
            break;

          case "custom":
            if (!custom_curve) throw new Error("custom_curve is required for the custom action.");
            kf.interpolation = "bezier";
            setKeyframeVector(
              kf,
              "bezier_left_time",
              -Math.abs(custom_curve.control_point_1[0])
            );
            setKeyframeVector(kf, "bezier_left_value", custom_curve.control_point_1[1]);
            setKeyframeVector(
              kf,
              "bezier_right_time",
              Math.abs(custom_curve.control_point_2[0])
            );
            setKeyframeVector(kf, "bezier_right_value", custom_curve.control_point_2[1]);
            break;
          }
        });
        Undo.finishEdit("Modify animation curves");
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      Animator.preview();
      updateKeyframeSelection();

      return `Applied ${action} curve to ${keyframes.length} keyframes in ${bone_name}.${channel}`;
    },
  },
  animationToolDocs[2].status
);

createInternalTool(
  animationToolDocs[3].name,
  {
    ...animationToolDocs[3],
    parameters: boneRiggingParameters,
    async execute({ action, bone_data }) {
      switch (action) {
        case "create": {
          const parent = resolveOutlinerParentOrThrow(bone_data.parent ?? "root", "group");
          const children: Array<OutlinerElement | Group> = [...new Map<string, OutlinerElement | Group>(
            ((bone_data.children ?? []) as string[]).map((reference: string) => {
              const child = findElementOrThrow(reference);
              return [child.uuid, child] as const;
            })
          ).values()];
          const ikTarget = bone_data.ik_target
            ? findGroupOrThrow(bone_data.ik_target)
            : undefined;

          for (const child of children) {
            if (
              parent !== "root" &&
              (parent === child || parent.isChildOf(child, Number.POSITIVE_INFINITY))
            ) {
              throw new Error(
                `Cannot create a bone under "${parent.name}" while also moving its ancestor ` +
                  `"${child.name}" into that bone.`
              );
            }
          }

          const movedState = collectOutlinerSubtree(children);
          Undo.initEdit({
            outliner: true,
            elements: movedState.elements,
            groups: movedState.groups,
            collections: [],
          });

          let group: Group | undefined;
          try {
            group = new Group({
              name: bone_data.name,
              origin: (bone_data.origin ?? [0, 0, 0]) as ArrayVector3,
              rotation: (bone_data.rotation ?? [0, 0, 0]) as ArrayVector3,
            })
              .addTo(parent)
              .init();

            for (const child of children) child.addTo(group);
            group.ik_enabled = bone_data.ik_enabled ?? false;
            if (ikTarget) group.ik_target = ikTarget.uuid;
          } catch (error) {
            if (group) rollbackCreatedOutlinerEdit([group]);
            throw error;
          }

          finishCreatedOutlinerEdit(`Bone rigging: ${action}`, [group]);
          Canvas.updateAll();
          return `Created bone "${group.name}" with UUID ${group.uuid}`;
        }

        case "parent": {
          const child = findGroupOrThrow(bone_data.name);
          const parent = resolveOutlinerParentOrThrow(bone_data.parent!, "group");
          if (
            parent !== "root" &&
            (parent === child || parent.isChildOf(child, Number.POSITIVE_INFINITY))
          ) {
            throw new Error(
              `Cannot parent "${child.name}" to itself or one of its descendants.`
            );
          }

          const state = collectOutlinerSubtree([child]);
          Undo.initEdit({ ...state, outliner: true, collections: [] });
          child.addTo(parent);
          Undo.finishEdit(`Bone rigging: ${action}`, {
            ...state,
            outliner: true,
            collections: [],
          });
          Canvas.updateAll();
          return `Parented "${child.name}" to "${bone_data.parent}"`;
        }

        case "unparent": {
          const bone = findGroupOrThrow(bone_data.name);
          const state = collectOutlinerSubtree([bone]);
          Undo.initEdit({ ...state, outliner: true, collections: [] });
          bone.addTo("root");
          Undo.finishEdit(`Bone rigging: ${action}`, {
            ...state,
            outliner: true,
            collections: [],
          });
          Canvas.updateAll();
          return `Unparented "${bone.name}" to root`;
        }

        case "delete": {
          const bone = findGroupOrThrow(bone_data.name);
          const state = collectOutlinerSubtree([bone]);
          Undo.initEdit({ ...state, outliner: true, collections: [] });
          bone.remove(false);
          state.elements.length = 0;
          state.groups.length = 0;
          Undo.finishEdit(`Bone rigging: ${action}`, {
            ...state,
            outliner: true,
            collections: [],
          });
          Canvas.updateAll();
          return `Deleted bone "${bone_data.name}"`;
        }

        case "rename": {
          const bone = findGroupOrThrow(bone_data.name);
          Undo.initEdit({ groups: [bone], outliner: true, collections: [] });
          bone.name = bone_data.new_name!;
          Undo.finishEdit(`Bone rigging: ${action}`, {
            groups: [bone],
            outliner: true,
            collections: [],
          });
          Canvas.updateAll();
          return `Renamed bone to "${bone.name}"`;
        }

        case "set_pivot": {
          const bone = findGroupOrThrow(bone_data.name);
          const state = collectOutlinerSubtree([bone]);
          Undo.initEdit({ ...state, outliner: true, collections: [] });
          bone.transferOrigin(bone_data.origin! as ArrayVector3);
          Undo.finishEdit(`Bone rigging: ${action}`, {
            ...state,
            outliner: true,
            collections: [],
          });
          Canvas.updateAll();
          return `Set pivot point for "${bone.name}"`;
        }

        case "set_ik": {
          const bone = findGroupOrThrow(bone_data.name);
          const ikTarget = bone_data.ik_target
            ? findGroupOrThrow(bone_data.ik_target)
            : undefined;
          Undo.initEdit({ groups: [bone], outliner: true, collections: [] });
          bone.ik_enabled = bone_data.ik_enabled ?? false;
          bone.ik_target = ikTarget?.uuid ?? "";
          Undo.finishEdit(`Bone rigging: ${action}`, {
            groups: [bone],
            outliner: true,
            collections: [],
          });
          Canvas.updateAll();
          return `Updated IK settings for "${bone.name}"`;
        }

        case "mirror": {
          const bone = findGroupOrThrow(bone_data.name);
          const parent = bone_data.parent
            ? resolveOutlinerParentOrThrow(bone_data.parent, "group")
            : bone.parent;
          const axis = bone_data.mirror_axis || "x";
          const axisIndex = axis === "x" ? 0 : axis === "y" ? 1 : 2;
          Undo.initEdit({
            outliner: true,
            elements: [],
            groups: [],
            collections: [],
          });

          let mirroredBone: Group | undefined;
          try {
            mirroredBone = bone.duplicate();
            mirroredBone.addTo(parent);
            mirroredBone.origin[axisIndex] *= -1;
            mirroredBone.name = bone.name.includes("left")
              ? bone.name.replace("left", "right")
              : bone.name.includes("right")
              ? bone.name.replace("right", "left")
              : `${bone.name}_mirrored`;
          } catch (error) {
            if (mirroredBone) rollbackCreatedOutlinerEdit([mirroredBone]);
            throw error;
          }

          finishCreatedOutlinerEdit(`Bone rigging: ${action}`, [mirroredBone]);
          Canvas.updateAll();
          return `Mirrored bone "${bone.name}" across ${axis} axis as "${mirroredBone.name}"`;
        }
      }

      throw new Error(`Unsupported bone rigging action: ${String(action)}`);
    },
  },
  animationToolDocs[3].status
);

createInternalTool(
  animationToolDocs[4].name,
  {
    ...animationToolDocs[4],
    parameters: animationTimelineParameters,
    async execute({ animation_id, action, time, length, fps, loop_mode, range }) {
      const animation = findAnimationOrThrow(animation_id);
      animation.select();

      let result = "";

      switch (action) {
        case "play":
          Timeline.start();
          result = "Started animation playback";
          break;

        case "pause":
          Timeline.pause();
          result = "Paused animation playback";
          break;

        case "stop":
          Timeline.setTime(0);
          Timeline.pause();
          result = "Stopped animation playback";
          break;

        case "set_time":
          if (time === undefined) {
            throw new Error("Time parameter required for set_time action.");
          }
          Timeline.setTime(time);
          result = `Set timeline to ${time} seconds`;
          break;

        case "set_length":
          if (length === undefined) {
            throw new Error("Length parameter required for set_length action.");
          }
          animation.length = length;
          result = `Set animation length to ${length} seconds`;
          break;

        case "set_fps":
          if (fps === undefined) {
            throw new Error("FPS parameter required for set_fps action.");
          }
          animation.snapping = fps;
          result = `Set animation FPS to ${fps}`;
          break;

        case "loop":
          if (loop_mode) {
            animation.loop = loop_mode;
          }
          result = `Set loop mode to ${loop_mode || animation.loop}`;
          break;

        case "select_range":
          if (!range) {
            throw new Error(
              "Range parameter required for select_range action."
            );
          }
          // Select keyframes in range
          Timeline.keyframes.forEach((kf) => {
            if (kf.time >= range.start && kf.time <= range.end) {
              kf.select();
            } else {
              kf.selected = false;
            }
          });
          result = `Selected keyframes between ${range.start} and ${range.end} seconds`;
          break;
      }

      Animator.preview();

      return result;
    },
  },
  animationToolDocs[4].status
);

createInternalTool(
  animationToolDocs[5].name,
  {
    ...animationToolDocs[5],
    parameters: batchKeyframeOperationsParameters,
    async execute({ selection, range, pattern, operation, parameters = {} }) {
      const animation = Animator.selected;
      if (!animation) {
        throw new Error("No animation selected.");
      }

      const allKeyframes = collectAnimationKeyframes(animation);
      let keyframes: _Keyframe[] = [];

      switch (selection) {
        case "all":
          keyframes = allKeyframes;
          break;

        case "selected":
          const selected = new Set(Timeline.selected);
          keyframes = allKeyframes.filter((keyframe) => selected.has(keyframe));
          break;

        case "range":
          if (!range) {
            throw new Error("Range required for range selection.");
          }
          keyframes = allKeyframes.filter(
            (kf) => kf.time >= range.start && kf.time <= range.end
          );
          break;

        case "pattern":
          if (!pattern) {
            throw new Error("Pattern required for pattern selection.");
          }
          keyframes = allKeyframes.filter((kf) => {
            const intervalIndex = (kf.time - pattern.offset) / pattern.interval;
            return Math.abs(intervalIndex - Math.round(intervalIndex)) < KEYFRAME_TIME_EPSILON;
          });
          break;
      }

      if (keyframes.length === 0) {
        throw new Error("No keyframes found matching selection criteria.");
      }

      const undoAspects = { animations: [animation], keyframes: [...keyframes] };
      Undo.initEdit(undoAspects);

      try {
        switch (operation) {
        case "offset":
          keyframes.forEach((kf) => {
            if (parameters.offset_time !== undefined) {
              kf.time += parameters.offset_time;
            }
            if (parameters.offset_values) {
              const values = numericKeyframeVector(kf.getArray());
              applyKeyframeValues(kf, [
                values[0] + parameters.offset_values[0],
                values[1] + parameters.offset_values[1],
                values[2] + parameters.offset_values[2],
              ]);
            }
          });
          break;

        case "scale":
          const pivot = parameters.scale_pivot ?? 0;
          const factor = parameters.scale_factor ?? 1;
          keyframes.forEach((kf) => {
            kf.time = pivot + (kf.time - pivot) * factor;
          });
          break;

        case "reverse":
          const times = keyframes.map((kf) => kf.time);
          const minTime = Math.min(...times);
          const maxTime = Math.max(...times);
          keyframes.forEach((kf) => {
            kf.time = maxTime - (kf.time - minTime);
          });
          break;

        case "mirror":
          if (!parameters.mirror_axis) {
            throw new Error("Mirror axis required for mirror operation.");
          }
          const axisIndex =
            parameters.mirror_axis === "x"
              ? 0
              : parameters.mirror_axis === "y"
              ? 1
              : 2;
          keyframes.forEach((kf) => {
            const values = numericKeyframeVector(kf.getArray());
            values[axisIndex] *= -1;
            applyKeyframeValues(kf, values);
          });
          break;

        case "smooth":
          // Apply catmullrom interpolation to all keyframes
          keyframes.forEach((kf) => {
            kf.interpolation = "catmullrom";
          });
          break;

        case "bake":
          const interval = parameters.bake_interval ?? 1 / animation.snapping;
          const animators = new Set<GeneralAnimator>(
            keyframes.map((keyframe) => keyframe.animator)
          );

          animators.forEach((animator) => {
            const channels = ["rotation", "position", "scale"] as const;
            channels.forEach((channel) => {
              const channelKfs = animator[channel] as _Keyframe[];
              if (!channelKfs || channelKfs.length < 2) return;

              const startTime = Math.min(...channelKfs.map((kf) => kf.time));
              const endTime = Math.max(...channelKfs.map((kf) => kf.time));

              for (let time = startTime; time <= endTime; time += interval) {
                if (
                  !channelKfs.find((kf) => Math.abs(kf.time - time) < 0.001)
                ) {
                  Timeline.time = time;
                  const keyframe = createRuntimeKeyframe(
                    animator,
                    { time, channel, data_points: [] },
                    time,
                    channel
                  );
                  const values = animator.interpolate(channel, true);
                  if (values === false) {
                    throw new Error(`Could not interpolate ${channel} at ${time} seconds.`);
                  }
                  applyKeyframeValues(keyframe, numericKeyframeVector(values));
                  undoAspects.keyframes.push(keyframe);
                }
              }
            });
          });
            break;
        }

        Undo.finishEdit(`Batch keyframe operation: ${operation}`, undoAspects);
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      Animator.preview();

      return `Performed ${operation} on ${keyframes.length} keyframes`;
    },
  },
  animationToolDocs[5].status
);

createInternalTool(
  animationToolDocs[6].name,
  {
    ...animationToolDocs[6],
    parameters: copyAnimationKeyframesParameters,
    async execute({ source, target }) {
      const sourceAnimation = source.animation
        ? findAnimationOrThrow(source.animation)
        : Animator.selected;
      const targetAnimation = target.animation
        ? findAnimationOrThrow(target.animation)
        : Animator.selected;
      if (!sourceAnimation || !targetAnimation) {
        throw new Error("Select an animation or supply explicit source and target animations.");
      }

      const sourceBone = findGroupOrThrow(source.bone);
      const targetBone = findGroupOrThrow(target.bone);
      const sourceAnimator = sourceAnimation.animators[sourceBone.uuid];
      if (!sourceAnimator) {
        throw new Error(`No animation data exists for bone "${source.bone}".`);
      }

      const copied = source.channels.flatMap((channel) => {
        const channelKeyframes = sourceAnimator[channel] as _Keyframe[] | undefined;
        return (channelKeyframes ?? [])
          .filter((keyframe) => !source.time_range || (
            keyframe.time >= source.time_range.start &&
            keyframe.time <= source.time_range.end
          ))
          .map(copyRuntimeKeyframeData);
      });
      if (copied.length === 0) {
        throw new Error("No source keyframes match the requested channels and time range.");
      }

      const axisIndex = target.mirror_axis === "x"
        ? 0
        : target.mirror_axis === "y"
          ? 1
          : target.mirror_axis === "z"
            ? 2
            : undefined;
      const undoAspects = { animations: [targetAnimation], keyframes: [] };
      Undo.initEdit(undoAspects);
      try {
        let targetAnimator = targetAnimation.animators[targetBone.uuid];
        if (!targetAnimator) {
          targetAnimator = new BoneAnimator(targetBone.uuid, targetAnimation, target.bone);
          targetAnimation.animators[targetBone.uuid] = targetAnimator;
        }

        for (const keyframeData of copied) {
          const time = keyframeData.time + target.time_offset;
          const keyframe = createRuntimeKeyframe(
            targetAnimator,
            { ...keyframeData, time },
            time,
            keyframeData.channel
          );
          if (axisIndex !== undefined) flipRuntimeKeyframe(keyframe, axisIndex);
        }
        Undo.finishEdit("Copy animation keyframes", undoAspects);
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      targetAnimation.select();
      Animator.preview();

      return JSON.stringify({
        copied_keyframes: copied.length,
        source: { animation: sourceAnimation.name, bone: source.bone },
        target: { animation: targetAnimation.name, bone: target.bone },
        time_offset: target.time_offset,
        mirror_axis: target.mirror_axis ?? null,
      });
    },
  },
  animationToolDocs[6].status
);

}
