import { describe, expect, test } from "bun:test";
import {
  applyPreviewVisibilityToClone,
  resolvePreviewBoneVisibility,
} from "@/lib/previewState";

interface FakeBone {
  uuid: string;
  name: string;
  type?: string;
  parent?: FakeBone;
  mesh: { visible: boolean };
  scene_object?: { visible: boolean };
}

describe("one-shot preview visibility", () => {
  test("isolates a bone together with its ancestors and descendants", () => {
    const root = { uuid: "root", name: "root", mesh: { visible: true } } as FakeBone;
    const head = { uuid: "head", name: "head", parent: root, mesh: { visible: true } } as FakeBone;
    const face = { uuid: "face", name: "face", parent: head, mesh: { visible: true } } as FakeBone;
    const body = { uuid: "body", name: "body", parent: root, mesh: { visible: true } } as FakeBone;

    const visibility = resolvePreviewBoneVisibility([root, head, face, body], {
      hiddenBoneIds: [],
      shownBoneIds: [],
      isolatedBoneIds: ["head"],
    });

    expect(Object.fromEntries(visibility)).toEqual({
      root: true,
      head: true,
      face: true,
      body: false,
    });
  });

  test("changes only cloned offscreen meshes and leaves editor visibility untouched", () => {
    const root = { uuid: "root", name: "root", mesh: { visible: true } } as FakeBone;
    const head = { uuid: "head", name: "head", parent: root, mesh: { visible: true } } as FakeBone;
    const body = { uuid: "body", name: "body", parent: root, mesh: { visible: true } } as FakeBone;
    const rootClone = { visible: true };
    const headClone = { visible: true };
    const bodyClone = { visible: true };
    const project = {
      uuid: "project",
      groups: [root, head, body],
      elements: [],
    } as unknown as ModelProject;
    const sourceToClone = new Map<any, any>([
      [root.mesh, rootClone],
      [head.mesh, headClone],
      [body.mesh, bodyClone],
    ]);
    const visibility = {
      hiddenBoneIds: [],
      shownBoneIds: [],
      isolatedBoneIds: ["head"],
    };

    expect(applyPreviewVisibilityToClone(project, sourceToClone, visibility)).toBe(1);
    expect([rootClone.visible, headClone.visible, bodyClone.visible]).toEqual([true, true, false]);
    expect([root.mesh.visible, head.mesh.visible, body.mesh.visible]).toEqual([true, true, true]);
  });

  test("applies capture-only visibility to armature bone scene objects", () => {
    const rig = {
      uuid: "rig",
      name: "rig",
      type: "armature",
      mesh: { visible: true },
      scene_object: { visible: true },
    } as FakeBone;
    const bone = {
      uuid: "armature-bone",
      name: "armature-bone",
      type: "armature_bone",
      parent: rig,
      mesh: { visible: true },
      scene_object: { visible: true },
    } as FakeBone;
    const rigClone = { visible: true };
    const boneClone = { visible: true };
    const project = {
      uuid: "project",
      groups: [],
      elements: [rig, bone],
    } as unknown as ModelProject;
    const sourceToClone = new Map<any, any>([
      [rig.scene_object, rigClone],
      [bone.scene_object, boneClone],
    ]);

    expect(applyPreviewVisibilityToClone(project, sourceToClone, {
      hiddenBoneIds: [bone.uuid],
      shownBoneIds: [],
      isolatedBoneIds: [],
    })).toBe(1);
    expect(rigClone.visible).toBe(true);
    expect(boneClone.visible).toBe(false);
    expect(bone.scene_object!.visible).toBe(true);
  });
});
