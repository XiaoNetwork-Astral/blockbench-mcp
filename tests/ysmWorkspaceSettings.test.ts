import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { YSM_WORKSPACE_SETTING } from "@/lib/pluginSettings";
import {
  chooseYsmWorkspace,
  getInitialYsmWorkspaceRoot,
  getYsmWorkspaceRoot,
  setYsmWorkspaceRoot,
  syncYsmWorkspaceRootFromSetting,
  teardownYsmWorkspace,
} from "@/lib/ysmWorkspace";

const originalGlobals = new Map<string, unknown>();

function replaceGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, (globalThis as any)[name]);
  (globalThis as any)[name] = value;
}

afterEach(() => {
  syncYsmWorkspaceRootFromSetting("");
  teardownYsmWorkspace();
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  originalGlobals.clear();
});

describe("YSM temporary directory setting", () => {
  test("reads Blockbench's persisted object shape when restoring the directory", () => {
    replaceGlobal("PathModule", path.win32);
    replaceGlobal("Settings", {
      stored: { [YSM_WORKSPACE_SETTING]: { value: "D:\\persisted-temp" } },
      get() {
        return undefined;
      },
    });
    replaceGlobal("localStorage", {
      getItem() {
        return null;
      },
      removeItem() {},
    });

    expect(getInitialYsmWorkspaceRoot()).toBe("D:\\persisted-temp");
  });

  test("migrates the old localStorage path and keeps MCP changes in the native setting", () => {
    let configured: unknown;
    let legacy = "D:\\legacy-ysm";
    replaceGlobal("PathModule", path.win32);
    replaceGlobal("Settings", {
      stored: {},
      get(id: string) {
        return id === YSM_WORKSPACE_SETTING ? configured : undefined;
      },
    });
    replaceGlobal("localStorage", {
      getItem() {
        return legacy;
      },
      removeItem() {
        legacy = "";
      },
    });
    replaceGlobal("settings", {
      [YSM_WORKSPACE_SETTING]: {
        set(value: unknown) {
          configured = value;
        },
      },
    });

    expect(getInitialYsmWorkspaceRoot()).toBe("D:\\legacy-ysm");
    expect(legacy).toBe("");

    expect(setYsmWorkspaceRoot("D:\\new-temp", false)).toBe(true);
    expect(configured).toBe("D:\\new-temp");
    expect(getYsmWorkspaceRoot()).toBe("D:\\new-temp");
  });

  test("updates the visible setting without showing a redundant success message", () => {
    let configured: unknown;
    let quickMessages = 0;
    replaceGlobal("PathModule", path.win32);
    replaceGlobal("Settings", {
      stored: {},
      get(id: string) {
        return id === YSM_WORKSPACE_SETTING ? configured : undefined;
      },
    });
    replaceGlobal("settings", {
      [YSM_WORKSPACE_SETTING]: {
        set(value: unknown) {
          configured = value;
        },
      },
    });
    replaceGlobal("Blockbench", {
      pickDirectory() {
        return "D:\\selected-temp";
      },
      showQuickMessage() {
        quickMessages += 1;
      },
    });
    replaceGlobal("requireNativeModule", () => ({}));
    replaceGlobal("tl", (key: string) => key);

    expect(chooseYsmWorkspace()).toBe(true);
    expect(configured).toBe("D:\\selected-temp");
    expect(getYsmWorkspaceRoot()).toBe("D:\\selected-temp");
    expect(quickMessages).toBe(0);
  });
});
