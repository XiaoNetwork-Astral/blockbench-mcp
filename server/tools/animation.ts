/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { findElementOrThrow, findGroupOrThrow } from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { resampleAnimationCurves } from "@/src/blockbench/animationSampling";
import { configureNativeIK } from "@/src/blockbench/ik";
import { applyKeyframeValues } from "@/lib/toolFixes";
import { collectOutlinerSubtree, finishCreatedOutlinerEdit, resolveOutlinerParentOrThrow, rollbackCreatedOutlinerEdit } from "@/lib/modelSafety";
import { vec3, animationIdOptionalSchema, animationChannelEnum, axisEnum, timeRangeSchema, boneNameSchema, loopModeEnum, keyframeDataSchema } from "@/lib/zodObjects";
import { normalizeAnimationName, animationSummary, findAnimationOrThrow, assertKeyframeTimesAvailable, resolveUniqueKeyframeAtTime, createRuntimeKeyframe, setKeyframeVector, collectAnimationKeyframes, KEYFRAME_TIME_EPSILON, numericKeyframeVector, copyRuntimeKeyframeData, flipRuntimeKeyframe, findAnimatableNodeOrThrow, assertAnimationChannel, createNodeAnimator } from "@/src/blockbench/animation";

export const createAnimationParameters = z.object({
  name: z.string().describe("Name of the animation"),
  loop: z
    .boolean()
    .default(false)
    .describe("Whether the animation should loop"),
  animation_length: z
    .number()
    .nonnegative()
    .optional()
    .describe("Length of the animation in seconds"),
  bones: z
    .record(
      z.string(), z.array(
        z.object({
          time: z.number().nonnegative(),
          position: vec3().optional(),
          rotation: vec3().optional(),
          scale: z.union([vec3(), z.number()]).optional(),
        })
      )
    )
    .describe("Native node-local keyframes keyed by UUID or unique name. Supports groups and animatable elements such as null objects; channels must be supported by the node."),
  particle_effects: z
    .record(z.string(), z.string().describe("Effect name"))
    .optional()
    .describe("Particle effects with timestamps as keys"),
});

export const manageKeyframesParameters = z.object({
  animation_id: animationIdOptionalSchema,
  action: z
    .enum(["create", "delete", "edit", "select"])
    .describe("Action to perform on keyframes."),
  bone_name: boneNameSchema.describe("UUID or unique name of the group or animatable element, including null objects."),
  channel: animationChannelEnum.describe("Animation channel to modify."),
  keyframes: z
    .array(keyframeDataSchema)
    .describe("Keyframe data for the action."),
});

export const animationGraphEditorParameters = z.object({
  animation_id: animationIdOptionalSchema,
  bone_name: boneNameSchema.describe("UUID or unique name of the group or animatable element whose curves should be modified."),
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
        name: z.string().min(1).describe("UUID or unique name of the bone; for set_ik, identify the native null object controller."),
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
          .describe("Enable native IK on the null object controller. Disabling clears its native ik_target."),
        ik_source: z.string().optional().describe("Root bone UUID or unique name of the IK chain. Empty uses the controller's parent as the exclusive chain root."),
        ik_target: z
          .string()
          .optional()
          .describe("Target bone UUID or unique name for the IK chain."),
        lock_ik_target_rotation: z.boolean().optional().describe("Preserve the endpoint's world orientation during IK."),
        target_position: vec3("Controller position; interpreted using position_space.").optional(),
        position_space: z.enum(["native", "world"]).default("native").describe("Native stored position, or a world position converted through the controller's current parent."),
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
        .describe("Interval in seconds for resampling selected transform curves; this does not bake IK into bone rotations."),
      time_strategy: z.enum(["exact", "animation_grid"]).default("exact").describe("Keep exact sample times, or reject intervals that do not fit the animation grid. Never silently snap or overwrite samples."),
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

export const animationTools: ToolDefinition[] = [
  defineTool({
    name: "create_animation",
    description: "Creates a new animation with keyframes for bones.",
    annotations: {
      title: "Create Animation",
      destructiveHint: true,
    },
    parameters: createAnimationParameters,
    status: STATUS_STABLE,
    async execute({ name, loop, animation_length, bones, particle_effects }) {
      if (!Format.animation_mode) throw new Error(`Format "${Format.id}" does not support animation.`);
      const normalizedName = normalizeAnimationName(name);
      if (Animator.animations.some(animation => animation.name === normalizedName)) {
        throw new Error(`Animation "${normalizedName}" already exists.`);
      }
      const blueprints: Record<string, { type: string; name?: string; keyframes: KeyframeOptions[] }> = {};
      let lastTime = 0;
      let keyframeCount = 0;
      for (const [reference, frames] of Object.entries(bones)) {
        const node = findAnimatableNodeOrThrow(reference);
        if (blueprints[node.uuid]) throw new Error(`Node "${node.name}" was specified more than once.`);
        const nativeType = (node.constructor.animator.prototype as GeneralAnimator & { type: string }).type;
        const keyframes: KeyframeOptions[] = [];
        for (const channel of ["position", "rotation", "scale"] as const) {
          const channelFrames = frames.filter(frame => frame[channel] !== undefined);
          if (!channelFrames.length) continue;
          assertAnimationChannel(node, channel);
          assertKeyframeTimesAvailable(undefined, channelFrames.map(frame => frame.time), `${node.name}.${channel}`);
          for (const frame of channelFrames) {
            const value = frame[channel]!;
            const vector = typeof value === "number" ? [value, value, value] : value;
            keyframes.push({ time: frame.time, channel, interpolation: "linear", data_points: [{ x: vector[0], y: vector[1], z: vector[2] }] });
            lastTime = Math.max(lastTime, frame.time);
          }
        }
        keyframeCount += keyframes.length;
        blueprints[node.uuid] = { type: nativeType, name: node.name, keyframes };
      }
      if (particle_effects) {
        const keyframes = Object.entries(particle_effects).map(([timeString, effect]) => {
          const time = Number(timeString);
          if (!Number.isFinite(time) || time < 0) throw new Error(`Invalid particle timestamp "${timeString}".`);
          lastTime = Math.max(lastTime, time);
          return { time, channel: "particle", data_points: [{ effect }] } as KeyframeOptions;
        });
        assertKeyframeTimesAvailable(undefined, keyframes.map(frame => frame.time!), "effects.particle");
        blueprints.effects = { type: "effect", keyframes };
        keyframeCount += keyframes.length;
      }
      if (keyframeCount > 100_000) throw new Error("Create at most 100,000 keyframes per call.");
      const NativeAnimation = (globalThis as unknown as { Animation: new (data: Record<string, unknown>) => _Animation }).Animation;
      const animations: _Animation[] = [];
      Undo.initEdit({ animations });
      let created: _Animation;
      try {
        created = new NativeAnimation({ name: normalizedName, loop: loop ? "loop" : "once", length: Math.max(animation_length ?? 0, lastTime), animators: blueprints });
        animations.push(created);
        created.add(false);
        Undo.finishEdit("Create animation", { animations });
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      created.select();
      Animator.preview();
      return JSON.stringify({
        ...animationSummary(created, false),
        requested_name: normalizedName,
        bone_count: Object.keys(bones).length,
        particle_effect_count: Object.keys(particle_effects ?? {}).length,
      });
    }
  }),
  defineTool({
    name: "manage_keyframes",
    description: "Creates, deletes, or edits keyframes in the animation timeline for specific bones and channels.",
    annotations: {
      title: "Manage Keyframes",
      destructiveHint: true,
    },
    parameters: manageKeyframesParameters,
    status: STATUS_EXPERIMENTAL,
    async execute({ animation_id, action, bone_name, channel, keyframes }) {
      // Find or select animation
      const animation = findAnimationOrThrow(animation_id);
      animation.select();
      // Find the bone
      const group = findAnimatableNodeOrThrow(bone_name);
      assertAnimationChannel(group, channel);
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
      }
      else {
        assertKeyframeTimesAvailable(undefined, requestedTimes, context);
      }
      const resolvedKeyframes: _Keyframe[] = action === "create"
        ? []
        : keyframes.map((keyframe) => resolveUniqueKeyframeAtTime(animator?.[channel] as _Keyframe[] | undefined, keyframe.time, context));
      if (action === "select") {
        Timeline.selected.empty();
        resolvedKeyframes.forEach((keyframe) => keyframe.select());
        return `Successfully selected ${resolvedKeyframes.length} keyframes for ${context}`;
      }
      const undoAspects = {
        animations: [animation],
      };
      Undo.initEdit(undoAspects);
      try {
        if (!animator) {
          animator = createNodeAnimator(animation, group);
        }
        const activeAnimator = animator;
        switch (action) {
          case "create":
            keyframes.forEach((kf) => {
              const keyframe = createRuntimeKeyframe(activeAnimator, {
                time: kf.time,
                channel,
                interpolation: kf.interpolation,
                data_points: [],
              }, kf.time, channel);
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
        animation.setLength();
        Undo.finishEdit(`${action} keyframes`);
      }
      catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      Animator.preview();
      return `Successfully performed ${action} on ${keyframes.length} keyframes for ${bone_name}.${channel}`;
    }
  }),
  defineTool({
    name: "animation_graph_editor",
    description: "Controls animation curves in the graph editor for fine-tuning animations.",
    annotations: {
      title: "Animation Graph Editor",
      destructiveHint: true,
    },
    parameters: animationGraphEditorParameters,
    status: STATUS_EXPERIMENTAL,
    async execute({ animation_id, bone_name, channel, action, keyframe_range, custom_curve, }) {
      const animation = findAnimationOrThrow(animation_id);
      animation.select();
      const group = findAnimatableNodeOrThrow(bone_name);
      assertAnimationChannel(group, channel);
      const animator = animation.animators[group.uuid];
      if (!animator || !animator[channel]) {
        throw new Error(`No keyframes found for ${bone_name}.${channel}`);
      }
      const keyframes = (animator[channel] as _Keyframe[]).filter((kf) => {
        if (!keyframe_range)
          return true;
        return kf.time >= keyframe_range.start && kf.time <= keyframe_range.end;
      }).sort((a, b) => a.time - b.time);
      if (keyframes.length === 0) {
        throw new Error(`No keyframes found for ${bone_name}.${channel} in the requested range.`);
      }
      Undo.initEdit({
        animations: [animation],
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
              if (!custom_curve)
                throw new Error("custom_curve is required for the custom action.");
              kf.interpolation = "bezier";
              setKeyframeVector(kf, "bezier_left_time", -Math.abs(custom_curve.control_point_1[0]));
              setKeyframeVector(kf, "bezier_left_value", custom_curve.control_point_1[1]);
              setKeyframeVector(kf, "bezier_right_time", Math.abs(custom_curve.control_point_2[0]));
              setKeyframeVector(kf, "bezier_right_value", custom_curve.control_point_2[1]);
              break;
          }
        });
        Undo.finishEdit("Modify animation curves");
      }
      catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      Animator.preview();
      updateKeyframeSelection();
      return `Applied ${action} curve to ${keyframes.length} keyframes in ${bone_name}.${channel}`;
    }
  }),
  defineTool({
    name: "bone_rigging",
    description: "Creates and manipulates the bone structure (rig) of a model for animation.",
    annotations: {
      title: "Bone Rigging",
      destructiveHint: true,
    },
    parameters: boneRiggingParameters,
    status: STATUS_EXPERIMENTAL,
    async execute({ action, bone_data }) {
      switch (action) {
        case "create": {
          if (bone_data.ik_enabled || bone_data.ik_target || bone_data.ik_source) {
            throw new Error("Native IK belongs to a null_object controller. Create the bone normally, then configure the controller with set_ik.");
          }
          const parent = resolveOutlinerParentOrThrow(bone_data.parent ?? "root", "group");
          const children: Array<OutlinerElement | Group> = [...new Map<string, OutlinerElement | Group>(((bone_data.children ?? []) as string[]).map((reference: string) => {
            const child = findElementOrThrow(reference);
            return [child.uuid, child] as const;
          })).values()];
          for (const child of children) {
            if (parent !== "root" &&
              (parent === child || parent.isChildOf(child, Number.POSITIVE_INFINITY))) {
              throw new Error(`Cannot create a bone under "${parent.name}" while also moving its ancestor ` +
                `"${child.name}" into that bone.`);
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
            for (const child of children)
              child.addTo(group);
          }
          catch (error) {
            if (group)
              rollbackCreatedOutlinerEdit([group]);
            throw error;
          }
          finishCreatedOutlinerEdit(`Bone rigging: ${action}`, [group]);
          Canvas.updateAll();
          return `Created bone "${group.name}" with UUID ${group.uuid}`;
        }
        case "parent": {
          const child = findGroupOrThrow(bone_data.name);
          const parent = resolveOutlinerParentOrThrow(bone_data.parent!, "group");
          if (parent !== "root" &&
            (parent === child || parent.isChildOf(child, Number.POSITIVE_INFINITY))) {
            throw new Error(`Cannot parent "${child.name}" to itself or one of its descendants.`);
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
          return JSON.stringify(configureNativeIK(bone_data));
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
          }
          catch (error) {
            if (mirroredBone)
              rollbackCreatedOutlinerEdit([mirroredBone]);
            throw error;
          }
          finishCreatedOutlinerEdit(`Bone rigging: ${action}`, [mirroredBone]);
          Canvas.updateAll();
          return `Mirrored bone "${bone.name}" across ${axis} axis as "${mirroredBone.name}"`;
        }
      }
      throw new Error(`Unsupported bone rigging action: ${String(action)}`);
    }
  }),
  defineTool({
    name: "animation_timeline",
    description: "Controls the animation timeline, including playback, time scrubbing, and timeline settings.",
    annotations: {
      title: "Animation Timeline",
      destructiveHint: true,
    },
    parameters: animationTimelineParameters,
    status: STATUS_EXPERIMENTAL,
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
            throw new Error("Range parameter required for select_range action.");
          }
          // Select keyframes in range
          Timeline.keyframes.forEach((kf) => {
            if (kf.time >= range.start && kf.time <= range.end) {
              kf.select();
            }
            else {
              kf.selected = false;
            }
          });
          result = `Selected keyframes between ${range.start} and ${range.end} seconds`;
          break;
      }
      Animator.preview();
      return result;
    }
  }),
  defineTool({
    name: "batch_keyframe_operations",
    description: "Performs batch operations on keyframes. bake resamples only selected transform curves after evaluating the original data, using exact timestamps by default and one complete Undo transaction. Use bake_ik_animation to bake solved IK into bone rotations.",
    annotations: {
      title: "Batch Keyframe Operations",
      destructiveHint: true,
    },
    parameters: batchKeyframeOperationsParameters,
    status: STATUS_EXPERIMENTAL,
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
          keyframes = allKeyframes.filter((kf) => kf.time >= range.start && kf.time <= range.end);
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
      if (operation === "bake") {
        return JSON.stringify(resampleAnimationCurves(animation, keyframes, parameters.bake_interval ?? 1 / animation.snapping, parameters.time_strategy ?? "exact"));
      }
      const undoAspects = { animations: [animation] };
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
            const axisIndex = parameters.mirror_axis === "x"
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
        }
        Undo.finishEdit(`Batch keyframe operation: ${operation}`, undoAspects);
      }
      catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }
      Animator.preview();
      return `Performed ${operation} on ${keyframes.length} keyframes`;
    }
  }),
  defineTool({
    name: "copy_animation_keyframes",
    description: "Copies keyframes directly between bones or animations, optionally mirroring them, without a stored clipboard step.",
    annotations: {
      title: "Animation Copy/Paste",
      destructiveHint: true,
    },
    parameters: copyAnimationKeyframesParameters,
    status: STATUS_EXPERIMENTAL,
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
      const sourceBone = findAnimatableNodeOrThrow(source.bone);
      const targetBone = findAnimatableNodeOrThrow(target.bone);
      const sourceAnimator = sourceAnimation.animators[sourceBone.uuid];
      if (!sourceAnimator) {
        throw new Error(`No animation data exists for bone "${source.bone}".`);
      }
      const copied = source.channels.flatMap((channel) => {
        const channelKeyframes = sourceAnimator[channel] as _Keyframe[] | undefined;
        return (channelKeyframes ?? [])
          .filter((keyframe) => !source.time_range || (keyframe.time >= source.time_range.start &&
            keyframe.time <= source.time_range.end))
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
      for (const keyframeData of copied) assertAnimationChannel(targetBone, keyframeData.channel);
      const undoAspects = { animations: [targetAnimation] };
      Undo.initEdit(undoAspects);
      try {
        let targetAnimator = targetAnimation.animators[targetBone.uuid];
        if (!targetAnimator) {
          targetAnimator = createNodeAnimator(targetAnimation, targetBone);
        }
        for (const keyframeData of copied) {
          const time = keyframeData.time + target.time_offset;
          const keyframe = createRuntimeKeyframe(targetAnimator, { ...keyframeData, time }, time, keyframeData.channel);
          if (axisIndex !== undefined)
            flipRuntimeKeyframe(keyframe, axisIndex);
        }
        targetAnimation.setLength();
        Undo.finishEdit("Copy animation keyframes", undoAspects);
      }
      catch (error) {
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
    }
  })
];

export const animationInspectionTools: ToolDefinition[] = [
  defineTool({
    name: "list_animations",
    description: "Lists animations and reports which one is currently selected.",
    annotations: { title: "List Animations", readOnlyHint: true },
    parameters: listAnimationsParameters,
    status: STATUS_STABLE,
    async execute() {
      return JSON.stringify({
        current: Animator.selected
          ? { uuid: Animator.selected.uuid, name: Animator.selected.name }
          : null,
        count: Animator.animations.length,
        animations: Animator.animations.map((animation) => animationSummary(animation, false)),
      }, null, 2);
    }
  }),
  defineTool({
    name: "get_animation",
    description: "Returns one animation with its animators and keyframes.",
    annotations: { title: "Get Animation", readOnlyHint: true },
    parameters: getAnimationParameters,
    status: STATUS_STABLE,
    async execute({ animation_id }) {
      return JSON.stringify(animationSummary(findAnimationOrThrow(animation_id), true), null, 2);
    }
  })
];

export const animationManagementTool: ToolDefinition = defineTool({
  name: "manage_animation",
  description: "Selects, renames, or removes one animation by exact UUID or name.",
  annotations: { title: "Manage Animation", destructiveHint: true },
  parameters: manageAnimationParameters,
  status: STATUS_STABLE,
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
  }
});
