import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { clearAllValidationSnapshots } from "@/lib/validationSnapshots";
import {
  getVisibleProject,
  resolveOpenProject,
} from "@/src/blockbench/projects";
import {
  isProjectReadOnly,
  setProjectReadOnly,
} from "@/src/features/readOnly/service";
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
  clearAllValidationSnapshots();
});

afterEach(() => {
  clearAllValidationSnapshots();
  for (const key of keys) {
    const value = originalGlobals.get(key);
    if (value === undefined) delete (globalThis as any)[key];
    else (globalThis as any)[key] = value;
  }
  originalGlobals.clear();
});

describe("visible project context", () => {
  test("resolves one open project consistently and rejects ambiguous names", () => {
    const first = project("first");
    const second = project("second");
    first.name = second.name = "duplicate";
    (globalThis as any).ModelProject = { all: [first, second] };

    expect(resolveOpenProject("first")).toBe(first);
    expect(() => resolveOpenProject("duplicate")).toThrow(/ambiguous/i);
  });

  test("uses the visible tab", () => {
    const visible = project("visible", true);
    const other = project("other");
    (globalThis as any).ModelProject = { all: [visible, other] };
    (globalThis as any).Blockbench = {
      Project: visible,
      Format: visible.format,
    };

    expect(getVisibleProject()).toBe(visible);
    expect((globalThis as any).Blockbench.Project).toBe(visible);
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
    expect(isProjectReadOnly(target)).toBe(true);
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
