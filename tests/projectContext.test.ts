import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearAllProjectSessionState,
  getSessionCameraState,
  getSessionWorkingProjectId,
  peekSessionWorkingProject,
  requireSessionWorkingProject,
  resolveOpenProject,
  runInProjectContext,
  setSessionCameraState,
  setSessionWorkingProject,
} from "@/lib/projectContext";
import {
  isProjectExplicitlyReadOnly,
  isProjectProtected,
  setProjectReadOnly,
  setProjectRole,
} from "@/lib/projectRoles";
import {
  blockProtectedProjectSave,
  isProtectedViewOnlyEdit,
  refreshProjectProtection,
  setupProjectProtection,
  teardownProjectProtection,
} from "@/lib/projectProtection";

const originalGlobals = new Map<string, unknown>();
const keys = [
  "ModelProject",
  "Project",
  "Blockbench",
  "BarItems",
  "Preview",
  "OutlinerElement",
  "Group",
  "Transformer",
  "Toolbox",
  "Modes",
  "tl",
  "Outliner",
  "OutlinerNode",
  "Canvas",
  "Animation",
  "AnimationController",
  "Timeline",
  "UVEditor",
  "updateSelection",
  "updateNslideValues",
  "localStorage",
  "document",
  "Prop",
];

function project(uuid: string, selected = false) {
  return {
    uuid,
    name: uuid,
    selected,
    saved: true,
    save_path: "",
    export_path: "",
    format: { id: "free" },
    elements: [],
    groups: [],
    textures: [],
    animations: [],
    animation_controllers: [],
    timeline_animators: [],
    outliner: [],
    nodes_3d: {},
    model_3d: {},
    undo: { history: [], index: 0 },
  } as unknown as ModelProject;
}

beforeEach(() => {
  for (const key of keys) originalGlobals.set(key, (globalThis as any)[key]);
  clearAllProjectSessionState();
});

afterEach(() => {
  clearAllProjectSessionState();
  for (const key of keys) {
    const value = originalGlobals.get(key);
    if (value === undefined) delete (globalThis as any)[key];
    else (globalThis as any)[key] = value;
  }
  originalGlobals.clear();
});

describe("per-session project routing", () => {
  test("keeps arbitrary sessions bound to independent project UUIDs", () => {
    const first = project("first", true);
    const second = project("second");
    (globalThis as any).ModelProject = { all: [first, second] };
    (globalThis as any).Blockbench = { Project: first, Format: first.format };

    setSessionWorkingProject("session-a", first);
    setSessionWorkingProject("session-b", second);
    expect(peekSessionWorkingProject("session-a")).toBe(first);
    expect(peekSessionWorkingProject("session-b")).toBe(second);
    expect(getSessionWorkingProjectId("session-a")).toBe("first");
  });

  test("resolves one open project consistently and rejects ambiguous names", () => {
    const first = project("first");
    const second = project("second");
    first.name = second.name = "duplicate";
    (globalThis as any).ModelProject = { all: [first, second] };

    expect(resolveOpenProject("first")).toBe(first);
    expect(() => resolveOpenProject("duplicate")).toThrow(/ambiguous/i);
  });

  test("requires an explicit binding and never retargets a stale one", () => {
    const foreground = project("foreground", true);
    (globalThis as any).ModelProject = { all: [foreground] };
    (globalThis as any).Blockbench = {
      Project: foreground,
      Format: foreground.format,
    };

    expect(() => requireSessionWorkingProject("session")).toThrow(
      /never adopts the foreground tab/i
    );
    setSessionWorkingProject("session", foreground);
    expect(requireSessionWorkingProject("session")).toBe(foreground);
    (globalThis as any).ModelProject.all = [];
    expect(() => requireSessionWorkingProject("session")).toThrow(/no longer open/i);
  });

  test("routes synchronous globals and restores the visible project immediately", () => {
    const foreground = project("foreground", true);
    const background = project("background");
    const foregroundRoot = [{ uuid: "front-root" }];
    const backgroundRoot = [{ uuid: "back-root" }];
    (foreground as any).outliner = foregroundRoot;
    (background as any).outliner = backgroundRoot;
    (globalThis as any).ModelProject = { all: [foreground, background] };
    (globalThis as any).Blockbench = {
      Project: foreground,
      Format: foreground.format,
    };
    (globalThis as any).Outliner = { root: foregroundRoot };
    (globalThis as any).OutlinerNode = { uuids: { front: foregroundRoot[0] } };
    (globalThis as any).Canvas = {
      updateView() {},
      updateAll() {},
      updateAllPositions() {},
      updateVisibility() {},
      updateAllBones() {},
      updateAllFaces() {},
      updateAllUVs() {},
      updateLayeredTextures() {},
    };
    (globalThis as any).Animation = { selected: "front-animation" };
    (globalThis as any).AnimationController = { selected: null };
    (globalThis as any).Timeline = {
      time: 4,
      animators: ["front"],
      vue: {
        animators: ["front"],
        _data: { markers: ["front-marker"], animation_length: 8 },
      },
    };
    const headerFreeBar = { innerText: "foreground header" };
    (globalThis as any).document = {
      title: "foreground title",
      getElementById(id: string) {
        return id === "header_free_bar" ? headerFreeBar : null;
      },
    };
    (globalThis as any).Prop = {
      file_name: "foreground file",
      file_name_alt: "foreground alternate file",
    };

    const observed = runInProjectContext(background, () => {
      (globalThis as any).Timeline.vue._data.markers = ["background-marker"];
      (globalThis as any).Timeline.vue._data.animation_length = 2;
      (globalThis as any).document.title = "background title";
      headerFreeBar.innerText = "background header";
      (globalThis as any).Prop.file_name = "background file";
      (globalThis as any).Prop.file_name_alt = "background alternate file";
      return {
        project: (globalThis as any).Blockbench.Project,
        format: (globalThis as any).Blockbench.Format,
        root: (globalThis as any).Outliner.root,
      };
    });
    expect(observed.project).toBe(background);
    expect(observed.format).toBe(background.format);
    expect(observed.root).toBe(backgroundRoot);
    expect((globalThis as any).Blockbench.Project).toBe(foreground);
    expect((globalThis as any).Outliner.root).toBe(foregroundRoot);
    expect((globalThis as any).Timeline.time).toBe(4);
    expect((globalThis as any).Timeline.vue._data.markers).toEqual(["front-marker"]);
    expect((globalThis as any).Timeline.vue._data.animation_length).toBe(8);
    expect((globalThis as any).document.title).toBe("foreground title");
    expect(headerFreeBar.innerText).toBe("foreground header");
    expect((globalThis as any).Prop.file_name).toBe("foreground file");
    expect((globalThis as any).Prop.file_name_alt).toBe(
      "foreground alternate file"
    );
  });

  test("stores offscreen cameras per session and project", () => {
    setSessionCameraState("a", "project", {
      position: [1, 2, 3],
      target: [4, 5, 6],
      projection: "perspective",
    });
    setSessionCameraState("b", "project", {
      position: [7, 8, 9],
      projection: "orthographic",
    });
    expect(getSessionCameraState("a", "project")?.position).toEqual([1, 2, 3]);
    expect(getSessionCameraState("b", "project")?.position).toEqual([7, 8, 9]);
  });
});

describe("project read-only lock", () => {
  test("allows native visibility toggles but not model edits", () => {
    expect(isProtectedViewOnlyEdit({ message: "Toggle visibility" })).toBe(true);
    expect(isProtectedViewOnlyEdit({ message: "Toggle visibility property" })).toBe(true);
    expect(isProtectedViewOnlyEdit({ message: "Toggle collection visibility" })).toBe(true);
    expect(isProtectedViewOnlyEdit({
      message: "Toggle visibility on everything except selection",
    })).toBe(true);
    expect(isProtectedViewOnlyEdit({ message: "Toggle locked" })).toBe(false);
    expect(isProtectedViewOnlyEdit({ message: "Toggle locked property" })).toBe(false);
    expect(isProtectedViewOnlyEdit({ message: "Move elements" })).toBe(false);
    expect(isProtectedViewOnlyEdit(undefined)).toBe(false);
  });

  test("locks user editing and MCP editing while restoring pre-existing node locks", () => {
    const values = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const unlocked = { locked: false };
    const alreadyLocked = { locked: true };
    const target = project("read-only");
    (target as any).elements = [unlocked];
    (target as any).groups = [alreadyLocked];
    (globalThis as any).ModelProject = { all: [target] };
    (globalThis as any).Project = 0;

    setProjectReadOnly(target, true);
    refreshProjectProtection(target);
    expect(isProjectExplicitlyReadOnly(target)).toBe(true);
    expect(isProjectProtected(target)).toBe(true);
    expect(unlocked.locked).toBe(true);
    expect(alreadyLocked.locked).toBe(true);

    setProjectReadOnly(target, false);
    refreshProjectProtection(target);
    expect(unlocked.locked).toBe(false);
    expect(alreadyLocked.locked).toBe(true);
  });

  test("keeps protected selections visible without attaching the transformer", () => {
    const values = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    let lockedDuringClick = true;
    let revealCount = 0;
    class FakeElement {
      locked = false;
      selected = false;
      select() {
        if (this.locked) return false;
        this.selected = true;
        return this;
      }
      clickSelect() {
        return this.select();
      }
      showInOutliner() {
        revealCount++;
      }
    }
    class FakeGroup {
      locked = false;
      selected = false;
      select() {
        if (this.locked) return this;
        this.selected = true;
        (globalThis as any).updateSelection();
        return this;
      }
      clickSelect() {
        if (this.locked) return this;
        return this.select();
      }
      multiSelect() {
        if (this.locked) return this;
        this.selected = true;
        return this;
      }
    }
    const element = new FakeElement();
    const group = new FakeGroup();
    const target = project("selectable-read-only", true);
    (target as any).elements = [element];
    (target as any).groups = [group];
    const transformer = {
      attached: false,
      attach() {
        this.attached = true;
      },
      detach() {
        this.attached = false;
      },
    };
    class FakePreview {
      selection: { click_target?: { element: FakeElement } } = {};
      click(_event?: { type: string; button: number }) {
        lockedDuringClick = element.locked;
        if (element.locked) return false;
        element.selected = true;
        this.selection.click_target = { element };
        (globalThis as any).updateSelection();
        return true;
      }
    }

    const listeners = new Map<string, Set<(data: any) => void>>();
    (globalThis as any).Project = target;
    (globalThis as any).ModelProject = { all: [target] };
    (globalThis as any).BarItems = {};
    (globalThis as any).Preview = FakePreview;
    (globalThis as any).OutlinerElement = FakeElement;
    (globalThis as any).Group = FakeGroup;
    (globalThis as any).Transformer = transformer;
    (globalThis as any).Toolbox = {
      selected: { id: "move_tool", selectElements: true, paintTool: false },
    };
    (globalThis as any).Modes = { selected: { selectElements: true } };
    (globalThis as any).updateSelection = () => {
      if (element.locked) element.selected = false;
      if (group.locked) group.selected = false;
      if (element.selected || group.selected) transformer.attach();
    };
    (globalThis as any).Blockbench = {
      on(event: string, callback: (data: any) => void) {
        const callbacks = listeners.get(event) ?? new Set();
        callbacks.add(callback);
        listeners.set(event, callbacks);
      },
      removeListener(event: string, callback: (data: any) => void) {
        listeners.get(event)?.delete(callback);
      },
    };

    setProjectReadOnly(target, true);
    setupProjectProtection();
    try {
      const preview = new FakePreview();
      preview.click({ type: "pointerdown", button: 0 });
      expect(lockedDuringClick).toBe(false);
      expect(element.locked).toBe(true);
      expect(element.selected).toBe(true);
      expect(revealCount).toBe(1);
      expect(transformer.attached).toBe(false);

      (globalThis as any).Toolbox.selected.paintTool = true;
      element.selected = false;
      preview.click({ type: "pointerdown", button: 0 });
      expect(lockedDuringClick).toBe(true);
      expect(element.locked).toBe(true);
      expect(element.selected).toBe(false);

      (globalThis as any).Toolbox.selected.paintTool = false;
      element.clickSelect();
      expect(element.selected).toBe(true);
      expect(element.locked).toBe(true);
      expect(transformer.attached).toBe(false);

      group.clickSelect();
      expect(group.selected).toBe(true);
      expect(group.locked).toBe(true);
      expect(transformer.attached).toBe(false);
    } finally {
      teardownProjectProtection();
    }
  });

  test("removing an explicit lock does not remove workflow-role protection", () => {
    const values = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const target = project("reference");
    setProjectRole(target, "legacy_reference");
    setProjectReadOnly(target, true);
    setProjectReadOnly(target, false);
    expect(isProjectExplicitlyReadOnly(target)).toBe(false);
    expect(isProjectProtected(target)).toBe(true);
  });

  test("blocks every native project save action while protected", () => {
    const values = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const target = project("protected-save", true);
    const messages: string[] = [];
    const blockbenchListeners = new Map<string, Set<(data: any) => void>>();
    class FakeAction {
      listeners = new Set<(data: any) => void>();
      on(event: string, callback: (data: any) => void) {
        if (event === "use") this.listeners.add(callback);
      }
      removeListener(event: string, callback: (data: any) => void) {
        if (event === "use") this.listeners.delete(callback);
      }
      use(): unknown {
        let result: unknown;
        for (const listener of this.listeners) result = listener({}) ?? result;
        return result;
      }
    }
    const actions = {
      save_project: new FakeAction(),
      save_project_as: new FakeAction(),
      save_project_incremental: new FakeAction(),
      export_over: new FakeAction(),
    };
    (globalThis as any).Project = target;
    (globalThis as any).ModelProject = { all: [target] };
    (globalThis as any).BarItems = actions;
    (globalThis as any).Preview = class {
      click() {
        return false;
      }
    };
    (globalThis as any).OutlinerElement = class {
      clickSelect() {}
    };
    (globalThis as any).Group = class {
      select() {}
      clickSelect() {}
      multiSelect() {}
    };
    (globalThis as any).Transformer = {
      attach() {},
      detach() {},
    };
    (globalThis as any).tl = (key: string) => key;
    (globalThis as any).Blockbench = {
      on(event: string, callback: (data: any) => void) {
        const callbacks = blockbenchListeners.get(event) ?? new Set();
        callbacks.add(callback);
        blockbenchListeners.set(event, callbacks);
      },
      removeListener(event: string, callback: (data: any) => void) {
        blockbenchListeners.get(event)?.delete(callback);
      },
      showQuickMessage(message: string) {
        messages.push(message);
      },
    };

    setProjectReadOnly(target, true);
    setupProjectProtection();
    try {
      expect(blockProtectedProjectSave()).toBe(false);
      for (const action of Object.values(actions)) expect(action.use()).toBe(false);
      expect(messages.every((message) => message === "mcp.project.save_blocked")).toBe(true);

      setProjectReadOnly(target, false);
      expect(blockProtectedProjectSave()).toBeUndefined();
      for (const action of Object.values(actions)) expect(action.use()).toBeUndefined();
    } finally {
      teardownProjectProtection();
    }
    for (const action of Object.values(actions)) expect(action.listeners.size).toBe(0);
  });
});
