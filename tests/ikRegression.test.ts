import { afterEach, describe, expect, test } from "bun:test";
import * as THREE from "three";
import { solveTwoBone, type TwoBoneOptions } from "@/lib/ikSolver";
import { animationSampleTimes, resampleAnimationCurves } from "@/src/blockbench/animationSampling";
import { effectiveUvSize } from "@/src/features/validation/geometry";
import { exactAnimationTimecode } from "@/src/blockbench/animationExport";
import { assertAnimationChannel, createNodeAnimator, type AnimatableNode } from "@/src/blockbench/animation";
import { inspectIKParameters } from "@/server/tools/ik";

const originals = new Map<string, PropertyDescriptor | undefined>();
function global(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

describe("UV resolution after atlas expansion", () => {
  test("ignores stale per-texture dimensions unless the format actually uses them", () => {
    const texture = { uv_width: 80, uv_height: 80, width: 128, height: 128 } as Texture;
    const project = { texture_width: 128, texture_height: 128, format: { per_texture_uv_size: false } } as ModelProject;
    expect(effectiveUvSize(project, texture)).toEqual([128, 128]);
    project.format.per_texture_uv_size = true;
    expect(effectiveUvSize(project, texture)).toEqual([80, 80]);
    expect(effectiveUvSize(project, null)).toEqual([128, 128]);
  });
});

describe("native animator selection", () => {
  test("creates the node's animator and rejects unsupported null-object channels", () => {
    class NullAnimator {}
    Object.assign(NullAnimator.prototype, { type: "null_object", channels: { position: {} } });
    const node = { uuid: "target", name: "Target", type: "null_object", constructor: { animator: NullAnimator } } as unknown as AnimatableNode;
    const animation = { animators: {} } as _Animation;
    expect(createNodeAnimator(animation, node)).toBeInstanceOf(NullAnimator);
    expect(() => assertAnimationChannel(node, "position")).not.toThrow();
    expect(() => assertAnimationChannel(node, "rotation")).toThrow(/does not support/);
  });
});

describe("precise animation sampling", () => {
  test("keeps incompatible sample times distinct and includes the exact endpoint", () => {
    expect(animationSampleTimes(0, 1, 0.05)).toHaveLength(21);
    expect(animationSampleTimes(0, 1, 1 / 24)).toHaveLength(25);
    expect(animationSampleTimes(0, 1, 1 / 30, 30)).toHaveLength(31);
    expect(animationSampleTimes(0, 0.37, 0.1)).toEqual([0, 0.1, 0.2, 0.3, 0.37]);
    expect(() => animationSampleTimes(0, 1, 0.05, 10)).toThrow(/do not fit/);
    const times = animationSampleTimes(0, 1, 1 / 24);
    expect(new Set(times.map(exactAnimationTimecode)).size).toBe(25);
    expect(() => animationSampleTimes(0, 200, 0.0001)).toThrow(/exceeds/);
  });

  function curveFixture() {
    const timeline = { time: 0.37 };
    global("Timeline", timeline);
    global("Animator", { resetLastValues() {}, preview() {} });
    const animator: any = {
      uuid: "null-target", name: "Target", position: [],
      interpolate() {
        const sorted = [...this.position].sort((a, b) => a.time - b.time);
        const before = sorted.findLast(key => key.time <= timeline.time) ?? sorted[0];
        const after = sorted.find(key => key.time >= timeline.time) ?? sorted.at(-1);
        const mix = after.time === before.time ? 0 : (timeline.time - before.time) / (after.time - before.time);
        return before.values.map((value: number, axis: number) => value + (after.values[axis] - value) * mix);
      },
      createKeyframe() { throw new Error("The snapping/replacing native method must not be used here."); },
      addKeyframe(data: any) {
        const key: any = { time: data.time, channel: "position", animator: this, values: [0, 0, 0], uniform: false };
        key.set = (axis: string, value: number) => { key.values["xyz".indexOf(axis)] = value; };
        key.remove = () => this.position.splice(this.position.indexOf(key), 1);
        this.position.push(key);
        return key;
      },
    };
    const original = [{ time: 0, values: [0, 0, 0] }, { time: 0.5, values: [0, 2, 3] }, { time: 1, values: [0, 0, 0] }];
    const snapshot = () => animator.position.map((key: any) => ({ time: key.time, values: [...key.values] }));
    const restore = (keys: typeof original) => {
      animator.position = [];
      keys.forEach(data => { animator.addKeyframe(data).values = [...data.values]; });
    };
    restore(original);
    let before = original;
    let after = original;
    global("Undo", {
      initEdit(aspects: any) { expect(aspects.keyframes).toBeUndefined(); before = snapshot(); },
      finishEdit() { after = snapshot(); },
      cancelEdit() { restore(before); },
    });
    const animation = { snapping: 10, setLength() {} } as _Animation;
    return { animator, animation, timeline, snapshot, original, undo: () => restore(before), redo: () => restore(after) };
  }

  test("samples the original lift curve before writing and fully undoes/redoes all 21 keys", () => {
    const fixture = curveFixture();
    const result = resampleAnimationCurves(fixture.animation, [...fixture.animator.position], 0.05, "exact");
    expect(result).toMatchObject({ kind: "curve_resampling", input_keyframes: 3, sample_count: 21 });
    expect(fixture.animator.position.find((key: any) => key.time === 0.5).values).toEqual([0, 2, 3]);
    expect(fixture.animator.position.find((key: any) => key.time === 0.25).values).toEqual([0, 1, 1.5]);
    expect(fixture.timeline.time).toBe(0.37);
    fixture.undo();
    expect(fixture.snapshot()).toEqual(fixture.original);
    fixture.redo();
    expect(fixture.animator.position).toHaveLength(21);
  });

  test("rejects a sparse selection instead of changing unselected keys between it", () => {
    const fixture = curveFixture();
    expect(() => resampleAnimationCurves(fixture.animation, [fixture.animator.position[0], fixture.animator.position[2]], 0.05, "exact")).toThrow(/Select all keys/);
    expect(fixture.snapshot()).toEqual(fixture.original);
  });

  test("rolls back a partial write and preserves the calling time", () => {
    const fixture = curveFixture();
    const addKeyframe = fixture.animator.addKeyframe;
    let writes = 0;
    fixture.animator.addKeyframe = function(data: unknown) {
      if (++writes === 2) throw new Error("simulated write failure");
      return addKeyframe.call(this, data);
    };
    expect(() => resampleAnimationCurves(fixture.animation, [...fixture.animator.position], 0.05, "exact")).toThrow(/simulated write failure/);
    expect(fixture.snapshot()).toEqual(fixture.original);
    expect(fixture.timeline.time).toBe(0.37);
  });
});

function limb(mirror = 1, rotated = false) {
  global("THREE", THREE);
  const parent = new THREE.Group();
  if (rotated) parent.rotation.set(...[20, 35, 15].map(THREE.MathUtils.degToRad) as [number, number, number]);
  const root = new THREE.Group(); root.position.set(0, 10, 0); parent.add(root);
  const middle = new THREE.Group(); middle.position.set(0, -5, mirror); root.add(middle);
  const end = new THREE.Group(); end.position.set(0, -5, -mirror); middle.add(end);
  for (const node of [root, middle, end]) (node as any).fix_rotation = node.rotation.clone();
  parent.updateMatrixWorld(true);
  const options: TwoBoneOptions = { pole: parent.localToWorld(new THREE.Vector3(0, 5, 6 * mirror)), bend_min: 0, bend_max: 180, joint_limits: [], tolerance: 1e-5 };
  return { parent, root, middle, end, options };
}

describe("constrained two-bone IK", () => {
  test("keeps both limbs on the chosen bend side under rotated common parents", () => {
    for (const mirror of [-1, 1]) for (const rotated of [false, true]) {
      for (const target of [[0, 0.8, 1.2], [0, 2, 3], [3, 2, 0]]) {
        const f = limb(mirror, rotated);
        const goal = f.parent.localToWorld(new THREE.Vector3(...target));
        const result = solveTwoBone(f.root, f.middle, f.end, goal, f.options);
        expect(result.converged).toBe(true);
        expect(result.residual).toBeLessThan(1e-7);
        expect(result.max_length_error).toBeLessThan(1e-7);
        const root = f.root.getWorldPosition(new THREE.Vector3());
        const axis = goal.clone().sub(root).normalize();
        const kneeSide = f.middle.getWorldPosition(new THREE.Vector3()).sub(root).addScaledVector(axis, -f.middle.getWorldPosition(new THREE.Vector3()).sub(root).dot(axis));
        expect(kneeSide.dot(f.options.pole.clone().sub(root))).toBeGreaterThan(0);
      }
    }
  });

  test("reports unreachable targets without stretching and respects a maximum bend", () => {
    const f = limb();
    const result = solveTwoBone(f.root, f.middle, f.end, new THREE.Vector3(0, -5, 0), f.options);
    expect(result.geometrically_reachable).toBe(false);
    expect(result.residual).toBeCloseTo(15 - 2 * Math.sqrt(26), 7);
    expect(result.max_length_error).toBeLessThan(1e-7);
    const folded = limb();
    const limited = solveTwoBone(folded.root, folded.middle, folded.end, new THREE.Vector3(0, 10, 0), { ...folded.options, bend_max: 150 });
    expect(limited.bend_angle).toBeCloseTo(150, 7);
    expect(limited.constraints_satisfied).toBe(true);
    expect(limited.converged).toBe(false);
  });

  test("enforces swing and twist limits and rejects constraints silently assigned to native IK", () => {
    const f = limb();
    const result = solveTwoBone(f.root, f.middle, f.end, new THREE.Vector3(3, 2, 0), { ...f.options, joint_limits: [{ joint: "root", swing_limit: 0, twist_min: 0, twist_max: 0 }] });
    expect(result.joint_angles[0].swing).toBeCloseTo(0, 7);
    expect(result.joint_angles[0].twist).toBeCloseTo(0, 7);
    expect(inspectIKParameters.safeParse({ controllers: ["Target"], pole: [0, 0, 4] }).success).toBe(false);
  });

  test("handles exact extension, a fully folded target, and a straight starting chain", () => {
    const extended = limb();
    const extension = solveTwoBone(extended.root, extended.middle, extended.end, new THREE.Vector3(0, 10 - 2 * Math.sqrt(26), 0), extended.options);
    expect(extension.residual).toBeLessThan(1e-7);
    expect(extension.bend_angle).toBeCloseTo(0, 5);
    const folded = limb();
    const fold = solveTwoBone(folded.root, folded.middle, folded.end, new THREE.Vector3(0, 10, 0), folded.options);
    expect(fold.residual).toBeLessThan(1e-7);
    expect(fold.bend_angle).toBeCloseTo(180, 5);
    const straight = limb();
    straight.middle.position.z = 0; straight.end.position.z = 0;
    const result = solveTwoBone(straight.root, straight.middle, straight.end, new THREE.Vector3(0, 2, 3), straight.options);
    expect(result.converged).toBe(true);
    expect(result.max_length_error).toBeLessThan(1e-7);
  });
});
