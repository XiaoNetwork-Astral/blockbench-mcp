import { afterEach, beforeEach, expect, test } from "bun:test";
import * as THREE from "three";
import { compileAnimationSelection } from "@/src/blockbench/animationExport";

const runtime = globalThis as unknown as Record<string, any>;
const previous: Record<string, unknown> = {};
beforeEach(() => {
  for (const key of ["Animation", "Animator", "Timeline", "Outliner", "Modes"]) previous[key] = runtime[key];
});
afterEach(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete runtime[key];
    else runtime[key] = value;
  }
});

function fixture(playing: boolean) {
  const root = new THREE.Group();
  const node = new THREE.Group();
  root.add(node);
  node.position.set(1, 2, 3);
  node.rotation.set(0.2, 0.3, 0.4, "ZYX");
  node.scale.set(2, 3, 4);
  const quaternion = node.quaternion.toArray();
  const key = { time: 0.05, channel: "position", selected: true, animator: { uuid: "bone" }, getTimecodeString: () => "0.1" };
  const originalTimecode = key.getTimecodeString;
  const track = { keyframes: [key] };
  const animation = { name: "walk", snapping: 10, animators: { bone: track }, selected: true, playing: true };
  const selectedNode = { selected: true };
  runtime.Animation = { selected: animation };
  runtime.Animator = { _last_values: { rotation: [4, 5, 6] } };
  const editMode = { select() { runtime.Modes.selected = this; } };
  runtime.Modes = { selected: editMode };
  runtime.Outliner = { selected: [selectedNode] };
  runtime.Timeline = {
    time: 0.37, playing, selected: [key], animators: [track], selected_animator: track,
    setTime(time: number) { this.time = time; },
    pause() { this.playing = false; },
    start() { this.playing = true; node.position.set(99, 99, 99); this.time = 0; },
  };
  const project = { model_3d: root, animations: [animation], elements: [] } as unknown as ModelProject;
  function mutatePreview() {
    node.position.set(7, 8, 9); node.rotation.set(1, 2, 3); node.scale.set(1, 1, 1); node.visible = false;
    animation.selected = false; animation.playing = false;
    (animation.animators as Record<string, unknown>).temporary = {};
    runtime.Animation.selected = null;
    runtime.Timeline.time = 1; runtime.Timeline.selected = []; runtime.Timeline.animators = []; runtime.Timeline.selected_animator = null;
    runtime.Outliner.selected = []; runtime.Modes.selected = {};
    runtime.Animator._last_values.rotation = [0, 0, 0];
  }
  function expectRestored() {
    expect(node.position.toArray()).toEqual([1, 2, 3]);
    expect(node.quaternion.toArray()).toEqual(quaternion);
    expect(node.rotation.order).toBe("ZYX");
    expect(node.scale.toArray()).toEqual([2, 3, 4]);
    expect(node.visible).toBe(true);
    expect(runtime.Animation.selected).toBe(animation);
    expect([animation.selected, animation.playing]).toEqual([true, true]);
    expect(Object.keys(animation.animators)).toEqual(["bone"]);
    expect(runtime.Timeline.time).toBe(0.37);
    expect(runtime.Timeline.playing).toBe(playing);
    expect(runtime.Timeline.selected).toEqual([key]);
    expect(runtime.Timeline.animators).toEqual([track]);
    expect(runtime.Timeline.selected_animator).toBe(track);
    expect(runtime.Outliner.selected).toEqual([selectedNode]);
    expect(runtime.Modes.selected).toBe(editMode);
    expect(runtime.Animator._last_values).toEqual({ rotation: [4, 5, 6] });
    expect(key.getTimecodeString).toBe(originalTimecode);
  }
  return { project, animation: animation as unknown as _Animation, key, mutatePreview, expectRestored };
}

for (const playing of [false, true]) {
  for (const failure of [false, true]) {
    test(`async animation export restores preview: playing=${playing}, failure=${failure}`, async () => {
      const f = fixture(playing);
      const codec = {
        id: "test", async compileFile() {
          expect(f.key.getTimecodeString()).toBe("0.05");
          expect(runtime.Timeline.playing).toBe(false);
          await Promise.resolve();
          f.mutatePreview();
          if (failure) throw new Error("codec failed after sampling");
          return { animations: {} };
        },
      } as unknown as AnimationCodec;
      const operation = compileAnimationSelection(f.project, codec, [f.animation], { kind: "animations", time_strategy: "exact" });
      if (failure) await expect(operation).rejects.toThrow("codec failed after sampling");
      else expect((await operation).compiled).toEqual({ animations: {} });
      f.expectRestored();
    });
  }
}

test("incompatible export grid rejects before codec execution and restores preview", async () => {
  const f = fixture(true);
  let called = false;
  const codec = { id: "test", compileFile() { called = true; } } as unknown as AnimationCodec;
  await expect(compileAnimationSelection(f.project, codec, [f.animation], { kind: "animations", time_strategy: "animation_grid" })).rejects.toThrow(/does not fit/);
  expect(called).toBe(false);
  f.expectRestored();
});
