import type * as Three from "three";
import { solveTwoBone, type IKJointLimit } from "@/lib/ikSolver";
import { captureAnimationPreview } from "./animationPreview";
import { animationSampleTimes, MAX_ANIMATION_SAMPLES, type AnimationTimeStrategy } from "./animationSampling";
import { findIKController, resolveIKChain, type IKChain } from "./ik";
import { type AnimatableNode } from "./animation";

export interface IKSamplingOptions {
  solver: "native" | "two_bone";
  tolerance: number;
  pole?: number[];
  pole_space: "world" | "source_parent";
  bend_min: number;
  bend_max: number;
  joint_limits: IKJointLimit[];
  solve_tolerance?: number;
  max_iterations?: number;
}

export interface IKFrame {
  time: number;
  rotations: Record<string, ArrayVector3>;
  world: Record<string, { position: number[]; quaternion: number[] }>;
  diagnostics: Array<Record<string, unknown> & { residual: number; controller: string; constraints_satisfied: boolean }>;
}

const three = () => (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;
const nativeAnimationClass = () => (globalThis as unknown as { Animation: (new (data: Record<string, unknown>) => _Animation) & { selected: _Animation | null } }).Animation;

export function resolveIKChains(references: string[]): IKChain[] {
  const chains = references.map(reference => resolveIKChain(findIKController(reference)));
  const touched = new Set<string>();
  for (const chain of chains) {
    for (const bone of [...chain.bones, chain.endpoint]) {
      if (touched.has(bone.uuid)) throw new Error("Selected IK chains overlap. Sample or bake each independent chain selection separately.");
      touched.add(bone.uuid);
    }
  }
  return chains;
}

export function projectIKControllers(project: ModelProject): string[] {
  return project.elements.filter(node => node.type === "null_object" && Boolean((node as unknown as { ik_target: string }).ik_target)).map(node => node.uuid);
}

export function defaultIKOptions(): IKSamplingOptions {
  return { solver: "native", tolerance: 0.01, pole_space: "world", bend_min: 0, bend_max: 180, joint_limits: [] };
}

function runtimeAnimator(animation: _Animation, node: OutlinerNode) {
  const Constructor = (node as AnimatableNode).constructor.animator;
  if (!Constructor) return undefined;
  const animator = animation.animators[node.uuid] ?? new Constructor(node.uuid, animation, node.name);
  if ((animator as GeneralAnimator & { type: string }).type !== (Constructor.prototype as GeneralAnimator & { type: string }).type) {
    throw new Error(`Animator for "${node.name}" has the wrong native type. Recreate it with create_animation using this node's UUID.`);
  }
  return animator as GeneralAnimator & {
    getElement?: () => OutlinerNode; displayPosition?: (value: unknown) => void;
    displayIK?: (samples?: boolean) => unknown;
  };
}

export function evaluateAnimationBase(project: ModelProject, animation: _Animation, time: number): void {
  nativeAnimationClass().selected = animation;
  Timeline.time = time;
  Animator.showDefaultPose(true);
  for (const node of [...project.groups, ...project.elements]) {
    const animator = animation.animators[node.uuid];
    if (!animator || node.type === "null_object") continue;
    Animator.resetLastValues();
    animator.displayFrame(1);
  }
  for (const node of project.elements.filter(node => node.type === "null_object")) {
    const animator = runtimeAnimator(animation, node);
    animator?.getElement?.();
    if (animator && !animator.muted.position) {
      Animator.resetLastValues();
      animator.displayPosition?.(animator.interpolate("position", false));
    }
  }
  project.model_3d.updateMatrixWorld(true);
}

function nodePose(node: OutlinerNode) {
  const T = three();
  return { position: node.scene_object.getWorldPosition(new T.Vector3()).toArray(), quaternion: node.scene_object.getWorldQuaternion(new T.Quaternion()).toArray() };
}

export function sampleIKFrames(project: ModelProject, animation: _Animation, chains: IKChain[], times: number[], options: IKSamplingOptions): IKFrame[] {
  if (times.length * chains.reduce((total, chain) => total + chain.bones.length + 1, 0) > MAX_ANIMATION_SAMPLES) throw new Error(`IK sampling exceeds ${MAX_ANIMATION_SAMPLES} bone samples.`);
  if (options.solver === "two_bone" && chains.some(chain => chain.bones.length !== 2)) throw new Error("The constrained two_bone solver requires exactly two rotating bones and one endpoint per controller.");
  const restore = captureAnimationPreview(project);
  const T = three();
  const frames: IKFrame[] = [];
  try {
    const defaultPoleDirections = new Map<string, Three.Vector3>();
    if (options.solver === "two_bone" && !options.pole) {
      Animator.showDefaultPose(true);
      project.model_3d.updateMatrixWorld(true);
      for (const chain of chains) {
        const root = chain.bones[0].scene_object.getWorldPosition(new T.Vector3());
        const middle = chain.bones[1].scene_object.getWorldPosition(new T.Vector3());
        const axis = chain.endpoint.scene_object.getWorldPosition(new T.Vector3()).sub(root).normalize();
        const direction = middle.sub(root);
        direction.addScaledVector(axis, -direction.dot(axis));
        const parentRotation = chain.bones[0].scene_object.parent?.getWorldQuaternion(new T.Quaternion()) ?? new T.Quaternion();
        if (direction.lengthSq() < 1e-10) {
          direction.set(0, 0, 1).applyQuaternion(parentRotation);
          direction.addScaledVector(axis, -direction.dot(axis));
          if (direction.lengthSq() < 1e-10) direction.set(1, 0, 0).applyQuaternion(parentRotation).addScaledVector(axis, -new T.Vector3(1, 0, 0).applyQuaternion(parentRotation).dot(axis));
        }
        defaultPoleDirections.set(chain.controller.uuid, direction.normalize().applyQuaternion(parentRotation.invert()));
      }
    }
    for (const time of times) {
      evaluateAnimationBase(project, animation, time);
      const frame: IKFrame = { time, rotations: {}, world: {}, diagnostics: [] };
      for (const chain of chains) {
        const goal = chain.controller.getWorldCenter(true).clone();
        const points = [...chain.bones, chain.endpoint].map(node => node.scene_object.getWorldPosition(new T.Vector3()));
        const lengths = points.slice(1).map((point, index) => point.distanceTo(points[index]));
        const sum = lengths.reduce((total, length) => total + length, 0);
        const minimum = Math.max(0, 2 * Math.max(...lengths) - sum);
        const distance = points[0].distanceTo(goal);
        let diagnostic: Record<string, unknown> & { residual: number; constraints_satisfied: boolean };
        if (options.solver === "native") {
          const animator = runtimeAnimator(animation, chain.controller);
          if (!animator?.displayIK) throw new Error(`No native IK solver exists for "${chain.controller.name}".`);
          animator.getElement?.();
          const nativeChain = (animator as typeof animator & { chain: { solveDistanceThreshold: number; minIterationChange: number; maxIteration: number } }).chain;
          const previousPrecision = { solveDistanceThreshold: nativeChain.solveDistanceThreshold, minIterationChange: nativeChain.minIterationChange, maxIteration: nativeChain.maxIteration };
          if (options.solve_tolerance !== undefined) {
            nativeChain.solveDistanceThreshold = options.solve_tolerance;
            nativeChain.minIterationChange = Math.min(nativeChain.minIterationChange, options.solve_tolerance / 10);
          }
          if (options.max_iterations !== undefined) nativeChain.maxIteration = options.max_iterations;
          const solverParameters = { distance_threshold: nativeChain.solveDistanceThreshold, min_iteration_change: nativeChain.minIterationChange, max_iterations: nativeChain.maxIteration };
          try { animator.displayIK(); }
          finally { Object.assign(nativeChain, previousPrecision); }
          const endpoint = chain.endpoint.scene_object.getWorldPosition(new T.Vector3());
          const residual = endpoint.distanceTo(goal);
          const solvedPoints = [...chain.bones, chain.endpoint].map(node => node.scene_object.getWorldPosition(new T.Vector3()));
          diagnostic = {
            solver: "native", solver_parameters: solverParameters, residual, converged: residual <= options.tolerance, constraints_satisfied: true,
            geometrically_reachable: distance <= sum + options.tolerance && distance >= minimum - options.tolerance,
            lengths, max_length_error: Math.max(...lengths.map((length, index) => Math.abs(length - solvedPoints[index].distanceTo(solvedPoints[index + 1])))),
            target: goal.toArray(), endpoint: endpoint.toArray(),
          };
        } else {
          const parent = chain.bones[0].scene_object.parent;
          let pole: Three.Vector3;
          if (options.pole) {
            pole = new T.Vector3(...options.pole);
            if (options.pole_space === "source_parent" && parent) parent.localToWorld(pole);
          } else {
            // Preserve the rest chain's bend side, including mirrored limbs.
            const reference = defaultPoleDirections.get(chain.controller.uuid)!.clone();
            reference.applyQuaternion(parent?.getWorldQuaternion(new T.Quaternion()) ?? new T.Quaternion());
            pole = points[0].clone().addScaledVector(reference, sum);
          }
          const locked = chain.controller.lock_ik_target_rotation ? chain.endpoint.scene_object.getWorldQuaternion(new T.Quaternion()) : undefined;
          diagnostic = solveTwoBone(chain.bones[0].scene_object, chain.bones[1].scene_object, chain.endpoint.scene_object, goal, { ...options, pole });
          if (locked) {
            const parentRotation = chain.endpoint.scene_object.parent?.getWorldQuaternion(new T.Quaternion()) ?? new T.Quaternion();
            chain.endpoint.scene_object.quaternion.copy(parentRotation.invert().multiply(locked));
            chain.endpoint.scene_object.updateWorldMatrix(false, true);
          }
        }
        frame.diagnostics.push({ ...diagnostic, controller: chain.controller.uuid });
        for (const bone of [...chain.bones, chain.endpoint]) {
          const mesh = bone.scene_object as Three.Object3D & { fix_rotation?: Three.Euler };
          if (bone.getTypeBehavior("rotatable")) {
            frame.rotations[bone.uuid] = ["x", "y", "z"].map(axis => {
              const key = axis as "x" | "y" | "z";
              return T.MathUtils.radToDeg(mesh.rotation[key] - (mesh.fix_rotation?.[key] ?? 0));
            }) as ArrayVector3;
          }
          frame.world[bone.uuid] = nodePose(bone);
        }
      }
      frames.push(frame);
    }
    return frames;
  } finally { restore(); }
}

export function ikSamplingTimes(animation: _Animation, sampleRate: number, strategy: AnimationTimeStrategy, start = 0, end = animation.length): number[] {
  return animationSampleTimes(start, end, 1 / sampleRate, strategy === "animation_grid" ? animation.snapping : undefined);
}

export function bakedAnimationBlueprint(animation: _Animation, frames: IKFrame[]) {
  const blueprint = animation.getUndoCopy() as unknown as Record<string, any>;
  blueprint.animators ??= {};
  for (const uuid of Object.keys(frames[0].rotations)) {
    const animator = blueprint.animators[uuid] ??= { type: "bone", keyframes: [] };
    animator.rotation_global = false;
    animator.keyframes = (animator.keyframes ?? []).filter((key: KeyframeOptions) => key.channel !== "rotation" || key.time < frames[0].time || key.time > frames.at(-1)!.time);
    let previous: number[] | undefined;
    for (const frame of frames) {
      const vector = frame.rotations[uuid].map((angle, axis) => previous ? angle + 360 * Math.round((previous[axis] - angle) / 360) : angle);
      previous = vector;
      animator.keyframes.push({ channel: "rotation", time: frame.time, interpolation: "linear", data_points: [{ x: vector[0], y: vector[1], z: vector[2] }] });
    }
  }
  return blueprint;
}

export function compareBakedAnimation(project: ModelProject, animation: _Animation, chains: IKChain[], sampled: IKFrame[], options: IKSamplingOptions) {
  const times = [...new Set([...sampled.map(frame => frame.time), ...sampled.slice(1).map((frame, index) => (frame.time + sampled[index].time) / 2)])].sort((a, b) => a - b);
  const expected = sampleIKFrames(project, animation, chains, times, options);
  const baked = new (nativeAnimationClass())(bakedAnimationBlueprint(animation, sampled));
  const restore = captureAnimationPreview(project);
  const T = three();
  let maxPositionError = 0;
  let maxRotationError = 0;
  let worstTime = times[0];
  let maxKeyframeError = 0;
  const keyTimes = new Set(sampled.map(frame => frame.time));
  try {
    for (const frame of expected) {
      evaluateAnimationBase(project, baked, frame.time);
      for (const node of chains.flatMap(chain => [...chain.bones, chain.endpoint])) {
        const actual = nodePose(node);
        const saved = frame.world[node.uuid];
        const error = new T.Vector3(...actual.position).distanceTo(new T.Vector3(...saved.position));
        if (error > maxPositionError) { maxPositionError = error; worstTime = frame.time; }
        if (keyTimes.has(frame.time)) maxKeyframeError = Math.max(maxKeyframeError, error);
        const angle = new T.Quaternion().fromArray(actual.quaternion).angleTo(new T.Quaternion().fromArray(saved.quaternion));
        maxRotationError = Math.max(maxRotationError, T.MathUtils.radToDeg(angle));
      }
    }
  } finally { restore(); }
  const loop = chains.map(chain => {
    const first = sampled[0].world[chain.endpoint.uuid];
    const last = sampled.at(-1)!.world[chain.endpoint.uuid];
    return { controller: chain.controller.uuid, endpoint_position_gap: new T.Vector3(...first.position).distanceTo(new T.Vector3(...last.position)), endpoint_rotation_gap_degrees: T.MathUtils.radToDeg(new T.Quaternion().fromArray(first.quaternion).angleTo(new T.Quaternion().fromArray(last.quaternion))) };
  });
  return { checked_times: times.length, includes_midpoints: true, max_keyframe_position_error: maxKeyframeError, max_position_error: maxPositionError, max_rotation_error_degrees: maxRotationError, worst_time: worstTime, loop_boundaries: loop };
}
