import { resolveUniqueReference } from "@/lib/modelSafety";
import { findElementOrThrow } from "@/lib/util";

export function normalizeAnimationName(name: string): string {
  const normalized = name.trim();
  if (!normalized) throw new Error("Animation name cannot be empty.");
  return normalized.startsWith("animation.")
    ? normalized
    : `animation.${normalized}`;
}

export const KEYFRAME_TIME_EPSILON = 0.001;

export type AnimatableNode = OutlinerNode & {
  constructor: { animator: new (uuid: string, animation: _Animation, name?: string) => GeneralAnimator };
};

export function findAnimatableNodeOrThrow(reference: string): AnimatableNode {
  const node = findElementOrThrow(reference) as unknown as AnimatableNode;
  if (!node.constructor.animator) throw new Error(`Node "${reference}" does not support native animation.`);
  return node;
}

export function assertAnimationChannel(node: AnimatableNode, channel: string): void {
  if (!node.constructor.animator.prototype.channels[channel]) {
    throw new Error(`Node "${node.name}" (${node.type}) does not support the ${channel} animation channel.`);
  }
}

export function createNodeAnimator(animation: _Animation, node: AnimatableNode): GeneralAnimator {
  return animation.animators[node.uuid] = new node.constructor.animator(node.uuid, animation, node.name);
}

export function createRuntimeKeyframe(
  animator: GeneralAnimator,
  value: Partial<KeyframeOptions> | null,
  time: number,
  channel: string
): _Keyframe {
  // Native createKeyframe snaps to the selected timeline and replaces neighbours.
  // MCP callers supply exact times and validate collisions before editing.
  const keyframe = animator.addKeyframe({ ...value, data_points: value?.data_points ?? [], time, channel });
  if (!keyframe) throw new Error(`Animator "${animator.uuid}" does not support ${channel}.`);
  return keyframe;
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

export function numericKeyframeVector(values: Array<string | number>): ArrayVector3 {
  const vector = [Number(values[0]), Number(values[1]), Number(values[2])] as ArrayVector3;
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new Error("This operation requires numeric keyframe values, not Molang expressions.");
  }
  return vector;
}

export function flipRuntimeKeyframe(keyframe: _Keyframe, axis: 0 | 1 | 2): void {
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

export function findAnimationOrThrow(reference?: string): _Animation {
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

export function animationSummary(animation: _Animation, includeKeyframes: boolean) {
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
