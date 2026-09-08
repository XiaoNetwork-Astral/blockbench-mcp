import { captureAnimationPreview } from "./animationPreview";
import { collectAnimationKeyframes } from "./animation";
import { defaultIKOptions, projectIKControllers, resolveIKChains, ikSamplingTimes, sampleIKFrames, compareBakedAnimation, type IKFrame } from "./ikAnimation";
import { MAX_ANIMATION_SAMPLES, type AnimationTimeStrategy } from "./animationSampling";

export function exactAnimationTimecode(time: number): string {
  const text = Number(time.toFixed(9)).toString();
  return text.includes(".") ? text : `${text}.0`;
}

export async function compileAnimationSelection(
  project: ModelProject, codec: AnimationCodec, items: Array<_Animation | AnimationController>,
  options: { kind: "animations" | "controllers"; sample_rate?: number; time_strategy: AnimationTimeStrategy },
) {
  if (options.sample_rate !== undefined && (codec.id !== "bedrock" || options.kind !== "animations")) {
    throw new Error("sample_rate is supported for Bedrock animation IK export.");
  }
  const restorePreview = captureAnimationPreview(project);
  const restorations: Array<() => void> = [];
  const sampling: Array<Record<string, unknown>> = [];
  function override(object: object, key: string, value: unknown) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    Object.defineProperty(object, key, { configurable: true, writable: true, value });
    restorations.push(() => {
      if (descriptor) Object.defineProperty(object, key, descriptor);
      else Reflect.deleteProperty(object, key);
    });
  }
  try {
    const animations = options.kind === "animations" ? items as _Animation[] : [];
    const controllers = codec.id === "bedrock" ? projectIKControllers(project) : [];
    const chains = controllers.length ? resolveIKChains(controllers) : [];
    const framesByAnimation = new Map<_Animation, IKFrame[]>();
    let totalSamples = 0;
    const rate = options.sample_rate ?? (chains.length ? Number(settings.animation_sample_rate.value) : undefined);
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 1 || rate > 240)) throw new Error("IK export sample_rate must be between 1 and 240 Hz.");
    for (const animation of animations) {
      const channels = new Map<string, Set<string>>();
      for (const keyframe of collectAnimationKeyframes<_Keyframe>(animation)) {
        const timecode = exactAnimationTimecode(keyframe.time);
        const id = `${keyframe.animator.uuid}/${keyframe.channel}`;
        if (!channels.has(id)) channels.set(id, new Set());
        if (channels.get(id)!.has(timecode)) throw new Error(`Duplicate export time ${timecode} in ${animation.name}/${id}.`);
        channels.get(id)!.add(timecode);
        if (options.time_strategy === "animation_grid" && Math.abs(keyframe.time - Math.round(keyframe.time * animation.snapping) / animation.snapping) > 1e-8) {
          throw new Error(`Keyframe ${keyframe.time}s does not fit the ${animation.snapping} fps grid; use time_strategy="exact".`);
        }
        override(keyframe, "getTimecodeString", () => timecode);
      }
      if (codec.id === "bedrock") {
        if (chains.length) {
          const times = ikSamplingTimes(animation, rate!, options.time_strategy);
          totalSamples += times.length * chains.reduce((total, chain) => total + chain.bones.length + 1, 0);
          if (totalSamples > MAX_ANIMATION_SAMPLES) throw new Error(`Export exceeds ${MAX_ANIMATION_SAMPLES} IK bone samples; select fewer animations or reduce sample_rate.`);
          framesByAnimation.set(animation, sampleIKFrames(project, animation, chains, times, defaultIKOptions()));
        }
        // The native compiler snaps and overwrites IK samples. Insert our
        // explicitly timed, measured rotation tracks after the native compile.
        override(animation, "sampleIK", () => ({}));
      }
    }
    let compiled: unknown;
    if (codec.compileFile) compiled = await codec.compileFile(items);
    else if (items.length === 1 && codec.compileAnimation) compiled = await codec.compileAnimation(items[0] as _Animation);
    else throw new Error(`Codec "${codec.id}" cannot compile this selection as one file.`);
    if (framesByAnimation.size) {
      const json = (typeof compiled === "string" ? JSON.parse(compiled) : compiled) as { animations: Record<string, { bones?: Record<string, { rotation?: unknown; [key: string]: unknown }> }> };
      for (const [animation, frames] of framesByAnimation) {
        const output = json.animations?.[animation.name];
        if (!output) throw new Error(`Bedrock codec did not produce animation "${animation.name}".`);
        output.bones ??= {};
        const nodes = [...project.groups, ...project.elements];
        for (const uuid of Object.keys(frames[0].rotations)) {
          const node = nodes.find(node => node.uuid === uuid)!;
          if (nodes.filter(other => other.name === node.name && (other as unknown as { constructor: { animator?: unknown } }).constructor.animator).length !== 1) throw new Error(`IK bone name "${node.name}" is ambiguous in the exported animation.`);
          const bone = output.bones[node.name] ??= {};
          delete bone.relative_to;
          const rotation: Record<string, number[]> = {};
          let previous: number[] | undefined;
          for (const frame of frames) {
            const angles = frame.rotations[uuid].map((angle, axis) => previous ? angle + 360 * Math.round((previous[axis] - angle) / 360) : angle);
            previous = angles;
            rotation[exactAnimationTimecode(frame.time)] = [-angles[0], -angles[1], angles[2]];
          }
          bone.rotation = rotation;
        }
        // Validate the actual exported numeric tracks after decoding Bedrock axes.
        const decoded = frames.map(frame => ({ ...frame, rotations: Object.fromEntries(Object.keys(frame.rotations).map(uuid => {
          const node = nodes.find(node => node.uuid === uuid)!;
          const value = (output.bones![node.name].rotation as Record<string, number[]>)[exactAnimationTimecode(frame.time)];
          return [uuid, [-value[0], -value[1], value[2]] as ArrayVector3];
        })) }));
        const validation = compareBakedAnimation(project, animation, chains, decoded, defaultIKOptions());
        if (validation.max_keyframe_position_error > 1e-4) throw new Error(`Exported IK keyframes do not reproduce the sampled pose: error ${validation.max_keyframe_position_error}.`);
        sampling.push({ animation: animation.uuid, sample_rate: rate, time_strategy: options.time_strategy, sample_count: frames.length, max_target_error: Math.max(...frames.flatMap(frame => frame.diagnostics.map(item => item.residual))), validation });
      }
      compiled = json;
    }
    return { compiled, sampling };
  } finally {
    for (const restore of restorations.reverse()) restore();
    restorePreview();
  }
}
