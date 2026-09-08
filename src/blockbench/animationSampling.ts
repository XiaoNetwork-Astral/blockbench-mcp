import { createRuntimeKeyframe, numericKeyframeVector } from "./animation";
import { applyKeyframeValues } from "@/lib/toolFixes";

export const MAX_ANIMATION_SAMPLES = 100_000;
export type AnimationTimeStrategy = "exact" | "animation_grid";

export function animationSampleTimes(start: number, end: number, interval: number, snapping?: number): number[] {
  if (![start, end, interval].every(Number.isFinite) || start < 0 || end < start || interval <= 0) {
    throw new Error("Sampling requires finite times with 0 <= start <= end and a positive interval.");
  }
  const steps = Math.floor((end - start) / interval + 1e-9);
  if (steps + 2 > MAX_ANIMATION_SAMPLES) throw new Error(`Sampling exceeds ${MAX_ANIMATION_SAMPLES} samples; narrow the range or lower the sample rate.`);
  const times = Array.from({ length: steps + 1 }, (_, index) => Number((start + index * interval).toFixed(9)));
  if (Math.abs(times[times.length - 1] - end) > 1e-8) times.push(Number(end.toFixed(9)));
  else times[times.length - 1] = Number(end.toFixed(9));
  if (snapping !== undefined) {
    if (!Number.isFinite(snapping) || snapping <= 0) throw new Error("The animation time grid must be positive.");
    if (times.some(time => Math.abs(time - Math.round(time * snapping) / snapping) > 1e-8)) {
      throw new Error(`The requested samples do not fit the ${snapping} fps animation grid. Use time_strategy="exact" or a compatible interval.`);
    }
  }
  if (times.some((time, index) => index > 0 && time <= times[index - 1])) throw new Error("Sampling interval is too small to represent distinct timestamps.");
  return times;
}

export function resampleAnimationCurves(animation: _Animation, selected: _Keyframe[], interval: number, strategy: AnimationTimeStrategy) {
  const channels = new Map<GeneralAnimator, Map<string, _Keyframe[]>>();
  for (const keyframe of selected) {
    if (!["position", "rotation", "scale"].includes(keyframe.channel)) continue;
    if (!channels.has(keyframe.animator)) channels.set(keyframe.animator, new Map());
    const group = channels.get(keyframe.animator)!;
    if (!group.has(keyframe.channel)) group.set(keyframe.channel, []);
    group.get(keyframe.channel)!.push(keyframe);
  }
  const plans: Array<{ animator: GeneralAnimator; channel: string; replace: _Keyframe[]; times: number[]; values: ArrayVector3[] }> = [];
  let count = 0;
  for (const [animator, selectedChannels] of channels) {
    for (const [channel, keys] of selectedChannels) {
      const start = Math.min(...keys.map(key => key.time));
      const end = Math.max(...keys.map(key => key.time));
      const replace = (animator[channel] as _Keyframe[]).filter(key => key.time >= start && key.time <= end);
      if (replace.some(key => !keys.includes(key))) throw new Error(`Select all keys inside ${start}–${end} seconds for ${animator.uuid}.${channel} before resampling that range.`);
      const times = animationSampleTimes(start, end, interval, strategy === "animation_grid" ? animation.snapping : undefined);
      count += times.length;
      if (count > MAX_ANIMATION_SAMPLES) throw new Error(`Resampling exceeds ${MAX_ANIMATION_SAMPLES} keyframes.`);
      plans.push({ animator, channel, replace, times, values: [] });
    }
  }
  if (!plans.length) throw new Error("No transform curves were selected for resampling.");
  const previousTime = Timeline.time;
  try {
    for (const plan of plans) {
      for (const time of plan.times) {
        Timeline.time = time;
        Animator.resetLastValues();
        const value = plan.animator.interpolate(plan.channel, false);
        if (value === false) throw new Error(`Could not interpolate ${plan.animator.uuid}.${plan.channel} at ${time} seconds.`);
        plan.values.push(numericKeyframeVector(value));
      }
    }
  } finally {
    Timeline.time = previousTime;
    Animator.resetLastValues();
  }
  Undo.initEdit({ animations: [animation] });
  try {
    for (const plan of plans) {
      plan.replace.forEach(keyframe => keyframe.remove());
      plan.times.forEach((time, index) => {
        const keyframe = createRuntimeKeyframe(plan.animator, { interpolation: "linear" }, time, plan.channel);
        applyKeyframeValues(keyframe, plan.values[index]);
      });
    }
    animation.setLength();
    Undo.finishEdit("Resample animation curves", { animations: [animation] });
  } catch (error) {
    (Undo.cancelEdit as unknown as (revert?: boolean) => void)(true);
    throw error;
  }
  Animator.preview();
  return {
    operation: "bake", kind: "curve_resampling", time_strategy: strategy, interval,
    input_keyframes: selected.length, sample_count: count,
    channels: plans.map(plan => ({ node_uuid: plan.animator.uuid, node: plan.animator.name, channel: plan.channel, start: plan.times[0], end: plan.times.at(-1), replaced_keys: plan.replace.length, sample_count: plan.times.length })),
  };
}
