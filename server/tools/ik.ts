import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { findAnimationOrThrow } from "@/src/blockbench/animation";
import { resolveIKChains, sampleIKFrames, compareBakedAnimation, bakedAnimationBlueprint, ikSamplingTimes, type IKSamplingOptions } from "@/src/blockbench/ikAnimation";

export const ikSolverFields = {
  solver: z.enum(["native", "two_bone"]).default("native").describe("Native Blockbench IK, or an analytic two-bone solver with pole and joint constraints applied for this inspection/bake."),
  tolerance: z.number().positive().max(100).default(0.01).describe("Endpoint convergence tolerance in model units; reported separately from bake reproduction error."),
  solve_tolerance: z.number().positive().max(100).optional().describe("Optional native solver distance threshold in model units. Applies only during this operation; otherwise retains the actual native setting."),
  max_iterations: z.number().int().min(1).max(200).optional().describe("Optional iteration limit for the native solver, restored after sampling."),
  pole: z.array(z.number()).length(3).optional().describe("Pole target point defining the bend direction. Without it, two_bone preserves the rest chain's bend side in source-parent coordinates; straight chains use a fixed perpendicular direction."),
  pole_space: z.enum(["world", "source_parent"]).default("world").describe("Coordinates of the pole point. source_parent uses the source bone's scene-parent coordinate system."),
  bend_min: z.number().min(0).max(180).default(0).describe("Minimum angle between the two segments in degrees; 0 is fully extended."),
  bend_max: z.number().min(0).max(180).default(180).describe("Maximum bend angle; 180 permits a fully folded chain."),
  joint_limits: z.array(z.object({
    joint: z.enum(["root", "middle"]),
    swing_limit: z.number().min(0).max(180).default(180).describe("Maximum swing cone angle relative to the joint's rest orientation."),
    twist_min: z.number().min(-180).max(180).default(-180),
    twist_max: z.number().min(-180).max(180).default(180),
  }).strict()).max(2).default([]).describe("Swing and signed twist limits around each segment's rest axis, in degrees; applies to the two_bone solver."),
};

function validateSolver(input: IKSamplingOptions, ctx: z.RefinementCtx) {
  if (input.bend_min > input.bend_max) ctx.addIssue({ code: "custom", message: "bend_min must not exceed bend_max." });
  if (new Set(input.joint_limits.map(limit => limit.joint)).size !== input.joint_limits.length) ctx.addIssue({ code: "custom", message: "Specify each joint limit only once." });
  if (input.joint_limits.some(limit => limit.twist_min > limit.twist_max)) ctx.addIssue({ code: "custom", message: "twist_min must not exceed twist_max." });
  if (input.solver === "native" && (input.pole || input.bend_min !== 0 || input.bend_max !== 180 || input.joint_limits.length)) ctx.addIssue({ code: "custom", message: "Pole, bend, and joint constraints require solver=two_bone; the native solver does not expose those controls." });
  if (input.solver === "two_bone" && (input.solve_tolerance !== undefined || input.max_iterations !== undefined)) ctx.addIssue({ code: "custom", message: "solve_tolerance and max_iterations apply only to the native iterative solver; two_bone is analytic." });
}

const common = {
  animation_id: z.string().min(1).optional(),
  controllers: z.array(z.string().min(1)).min(1).max(16).describe("Explicit UUIDs or unique names of the native null object controllers to inspect or bake."),
  ...ikSolverFields,
};

export const inspectIKParameters = z.object({
  ...common, times: z.array(z.number().nonnegative()).min(1).max(512).optional().describe("Sample times in seconds; defaults to the current timeline time. Restores the calling preview afterward."),
}).strict().superRefine(validateSolver);

export const bakeIKParameters = z.object({
  ...common,
  sample_rate: z.number().int().min(1).max(240),
  time_strategy: z.enum(["exact", "animation_grid"]).default("exact"),
  disable_ik: z.boolean().describe("Clear the selected controllers' native ik_target after baking so ordinary rotations play without a second IK solve. This controller setting applies to all animations in the project and is included in Undo. false retains live IK."),
  max_bake_error: z.number().nonnegative().default(0.01).describe("Maximum permitted reproduction error in model units at samples and midpoints. Exceeding it rejects the bake before editing."),
  max_target_error: z.number().nonnegative().optional().describe("Optional upper bound on IK endpoint-to-target error; unreachable or unconverged samples above this bound reject the bake."),
}).strict().superRefine(validateSolver);

export const ikTools: ToolDefinition[] = [
  defineTool({
    name: "inspect_ik", description: "Reads native IK chains and samples their solved world poses, lengths, reachability, convergence, residuals, and rotations. Can evaluate constrained two-bone IK without modifying the model or animation. All preview state is restored.",
    annotations: { title: "Inspect IK", readOnlyHint: true }, parameters: inspectIKParameters, status: "stable",
    async execute(args, context) {
      const animation = findAnimationOrThrow(args.animation_id);
      const chains = resolveIKChains(args.controllers);
      const frames = sampleIKFrames(context.project!, animation, chains, [...new Set(args.times ?? [Timeline.time])].sort((a, b) => a - b), args);
      return JSON.stringify({ animation: animation.uuid, solver: args.solver, tolerance: args.tolerance, chains: chains.map(chain => ({ controller: chain.controller.uuid, name: chain.controller.name, bones: chain.bones.map(bone => ({ uuid: bone.uuid, name: bone.name })), endpoint: chain.endpoint.uuid, lock_ik_target_rotation: chain.controller.lock_ik_target_rotation })), frames });
    },
  }),
  defineTool({
    name: "bake_ik_animation", description: "Bakes explicitly selected IK chains into ordinary bone rotation tracks of one animation. Uses an explicit sample rate and time strategy, validates sample/midpoint reproduction and loop boundaries, and returns target residuals. One Undo restores rotations and any disabled native controllers. disable_ik explicitly chooses whether to turn off those project-wide controllers.",
    annotations: { title: "Bake IK Animation", destructiveHint: true }, parameters: bakeIKParameters, status: "stable",
    async execute(args, context) {
      const animation = findAnimationOrThrow(args.animation_id);
      if (animation.blend_weight && Number(animation.blend_weight) !== 1) throw new Error("Bake an IK animation with unit blend weight; a varying weight would be applied again to the baked rotations.");
      const chains = resolveIKChains(args.controllers);
      const times = ikSamplingTimes(animation, args.sample_rate, args.time_strategy);
      const frames = sampleIKFrames(context.project!, animation, chains, times, args);
      if (frames.some(frame => frame.diagnostics.some(item => !item.constraints_satisfied))) throw new Error("The requested bend and joint constraints conflict at a sampled pose. No animation data was changed.");
      const targetError = Math.max(...frames.flatMap(frame => frame.diagnostics.map(item => item.residual)));
      if (args.max_target_error !== undefined && targetError > args.max_target_error) throw new Error(`Maximum IK target error ${targetError} exceeds max_target_error=${args.max_target_error}.`);
      const validation = compareBakedAnimation(context.project!, animation, chains, frames, args);
      if (validation.max_position_error > args.max_bake_error) throw new Error(`IK bake reproduction error ${validation.max_position_error} at ${validation.worst_time}s exceeds max_bake_error=${args.max_bake_error}. Increase sample_rate or adjust the requested tolerance.`);
      const blueprint = bakedAnimationBlueprint(animation, frames);
      animation.select();
      const controllers = chains.map(chain => chain.controller);
      const aspects = { animations: [animation], elements: args.disable_ik ? controllers : [] };
      Undo.initEdit(aspects);
      try {
        animation.extend(blueprint);
        if (args.disable_ik) controllers.forEach(controller => { controller.ik_target = ""; });
        Undo.finishEdit("Bake IK animation", aspects);
      } catch (error) {
        (Undo.cancelEdit as unknown as (revert?: boolean) => void)(true);
        throw error;
      }
      Animator.preview();
      return JSON.stringify({ animation: animation.uuid, solver: args.solver, sample_rate: args.sample_rate, time_strategy: args.time_strategy, sample_count: frames.length, rotation_tracks: Object.keys(frames[0].rotations), ik_disabled: args.disable_ik, controllers: controllers.map(controller => controller.uuid), max_target_error: targetError, unconverged_samples: frames.filter(frame => frame.diagnostics.some(item => item.converged === false)).map(frame => frame.time), validation });
    },
  }),
];
