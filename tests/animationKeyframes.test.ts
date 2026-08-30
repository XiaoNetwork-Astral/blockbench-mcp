import { describe, expect, test } from "bun:test";
import {
  animationGraphEditorParameters,
  batchKeyframeOperationsParameters,
  collectAnimationKeyframes,
  copyRuntimeKeyframeData,
  setKeyframeVector,
} from "@/server/tools/animation";

describe("animation keyframe regression helpers", () => {
  test("collects every keyframe from the selected animation's animators", () => {
    const first = { time: 0 };
    const second = { time: 1 };
    expect(collectAnimationKeyframes({
      animators: {
        bone_a: { keyframes: [first] },
        bone_b: { keyframes: [second, first] },
      },
    })).toEqual([first, second]);
  });

  test("normalizes legacy scalar and absent Bezier handles while copying", () => {
    const copied = copyRuntimeKeyframeData({
      channel: "rotation",
      time: 1,
      interpolation: "bezier",
      uniform: false,
      data_points: [{ getUndoCopy: () => ({ x: "1", y: "2", z: "3" }) }],
      bezier_linked: true,
      bezier_left_time: -0.25,
      bezier_left_value: 2,
      bezier_right_time: undefined,
      bezier_right_value: [1, 2, 3],
    });

    expect(copied.bezier_left_time).toEqual([-0.25, -0.25, -0.25]);
    expect(copied.bezier_left_value).toEqual([2, 2, 2]);
    expect(copied.bezier_right_time).toEqual([0.1, 0.1, 0.1]);
    expect(copied.bezier_right_value).toEqual([1, 2, 3]);
  });

  test("repairs scalar runtime handles as three-axis arrays", () => {
    const keyframe = {
      bezier_left_time: 0,
      bezier_left_value: [0, 0, 0],
      bezier_right_time: [0.1, 0.1, 0.1],
      bezier_right_value: [0, 0, 0],
    };
    setKeyframeVector(keyframe, "bezier_left_time", -0.4);
    expect(keyframe.bezier_left_time as unknown).toEqual([-0.4, -0.4, -0.4]);
  });

  test("rejects incomplete operation-specific requests before execution", () => {
    expect(animationGraphEditorParameters.safeParse({
      bone_name: "Bone",
      channel: "rotation",
      action: "custom",
    }).success).toBe(false);
    expect(batchKeyframeOperationsParameters.safeParse({
      selection: "range",
      operation: "smooth",
    }).success).toBe(false);
    expect(batchKeyframeOperationsParameters.safeParse({
      selection: "all",
      operation: "offset",
    }).success).toBe(false);
  });
});
