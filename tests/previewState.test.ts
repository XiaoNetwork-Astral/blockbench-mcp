import { afterEach, describe, expect, test } from "bun:test";
import {
  applySessionPreviewVisibilityToClone,
  clearAllPreviewVisibilityStates,
  getSessionPreviewVisibilityState,
  resolvePreviewBoneVisibility,
  setSessionPreviewVisibilityState,
} from "@/lib/previewState";

interface FakeBone {
  uuid: string;
  parent?: FakeBone;
  mesh: { visible: boolean };
}

afterEach(() => {
  clearAllPreviewVisibilityStates();
});

describe("session-scoped preview visibility", () => {
  test("keeps filters independent by session and clears them with empty arrays", () => {
    setSessionPreviewVisibilityState("session-a", "project", {
      hiddenBoneIds: ["body"],
      shownBoneIds: [],
      isolatedBoneIds: ["head"],
    });
    setSessionPreviewVisibilityState("session-b", "project", {
      hiddenBoneIds: [],
      shownBoneIds: ["body"],
      isolatedBoneIds: [],
    });

    expect(getSessionPreviewVisibilityState("session-a", "project")).toEqual({
      hiddenBoneIds: ["body"],
      shownBoneIds: [],
      isolatedBoneIds: ["head"],
    });
    expect(getSessionPreviewVisibilityState("session-b", "project")?.shownBoneIds).toEqual(["body"]);

    setSessionPreviewVisibilityState("session-a", "project", {
      hiddenBoneIds: [],
      shownBoneIds: [],
      isolatedBoneIds: [],
    });
    expect(getSessionPreviewVisibilityState("session-a", "project")).toBeNull();
    expect(getSessionPreviewVisibilityState("session-b", "project")).not.toBeNull();
  });

  test("isolates a bone together with its ancestors and descendants", () => {
    const root = { uuid: "root", mesh: { visible: true } } as FakeBone;
    const head = { uuid: "head", parent: root, mesh: { visible: true } } as FakeBone;
    const face = { uuid: "face", parent: head, mesh: { visible: true } } as FakeBone;
    const body = { uuid: "body", parent: root, mesh: { visible: true } } as FakeBone;

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
    const root = { uuid: "root", mesh: { visible: true } } as FakeBone;
    const head = { uuid: "head", parent: root, mesh: { visible: true } } as FakeBone;
    const body = { uuid: "body", parent: root, mesh: { visible: true } } as FakeBone;
    const rootClone = { visible: true };
    const headClone = { visible: true };
    const bodyClone = { visible: true };
    const project = {
      uuid: "project",
      groups: [root, head, body],
    } as unknown as ModelProject;
    const sourceToClone = new Map<any, any>([
      [root.mesh, rootClone],
      [head.mesh, headClone],
      [body.mesh, bodyClone],
    ]);
    setSessionPreviewVisibilityState("session", "project", {
      hiddenBoneIds: [],
      shownBoneIds: [],
      isolatedBoneIds: ["head"],
    });

    expect(applySessionPreviewVisibilityToClone(project, sourceToClone, "session")).toBe(1);
    expect([rootClone.visible, headClone.visible, bodyClone.visible]).toEqual([true, true, false]);
    expect([root.mesh.visible, head.mesh.visible, body.mesh.visible]).toEqual([true, true, true]);
  });
});
