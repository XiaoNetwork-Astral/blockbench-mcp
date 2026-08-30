import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { withTemporaryAnimationPose } from "@/lib/util";

const runtime = globalThis as unknown as Record<string, any>;
const previousGlobals: Record<string, unknown> = {};

beforeEach(() => {
  for (const key of ["THREE", "Blockbench", "Animation", "Timeline", "Animator"]) {
    previousGlobals[key] = runtime[key];
  }
  runtime.THREE = THREE;
});

afterEach(() => {
  for (const key of Object.keys(previousGlobals)) {
    if (previousGlobals[key] === undefined) delete runtime[key];
    else runtime[key] = previousGlobals[key];
  }
});

function fixture() {
  const root = new THREE.Object3D();
  const child = new THREE.Object3D();
  child.position.set(1, 2, 3);
  child.visible = true;
  root.add(child);
  const previousAnimation = { uuid: "idle", selected: true };
  const sampledAnimation = { uuid: "walk", selected: false };
  const project = {
    uuid: "project",
    model_3d: root,
    animations: [previousAnimation, sampledAnimation],
  } as unknown as ModelProject;

  runtime.Blockbench = { Project: project };
  runtime.Animation = { selected: previousAnimation };
  runtime.Timeline = {
    time: 4,
    setTime(value: number) {
      this.time = value;
    },
  };
  runtime.Animator = {
    showDefaultPose() {
      child.position.set(0, 0, 0);
    },
    preview() {
      child.position.set(12, 13, 14);
      child.visible = false;
      previousAnimation.selected = false;
      sampledAnimation.selected = true;
    },
  };
  return { child, previousAnimation, sampledAnimation, project };
}

function expectRestored(f: ReturnType<typeof fixture>): void {
  expect(f.child.position.toArray()).toEqual([1, 2, 3]);
  expect(f.child.visible).toBe(true);
  expect(runtime.Animation.selected).toBe(f.previousAnimation);
  expect(runtime.Timeline.time).toBe(4);
  expect([f.previousAnimation.selected, f.sampledAnimation.selected]).toEqual([true, false]);
}

describe("temporary animation sampling", () => {
  test("exposes the requested pose only inside the callback and restores afterward", () => {
    const f = fixture();
    const observed = withTemporaryAnimationPose(f.project, "walk", 0.75, () => ({
      position: f.child.position.toArray(),
      visible: f.child.visible,
      selected: runtime.Animation.selected,
      time: runtime.Timeline.time,
    }));

    expect(observed).toEqual({
      position: [12, 13, 14],
      visible: false,
      selected: f.sampledAnimation,
      time: 0.75,
    });
    expectRestored(f);
  });

  test("restores transforms, selection, and time when the callback throws", () => {
    const f = fixture();
    expect(() => withTemporaryAnimationPose(f.project, "walk", 1.25, () => {
      throw new Error("capture failed");
    })).toThrow("capture failed");
    expectRestored(f);
  });
});
