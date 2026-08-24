import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { PLUGIN_WORKSPACE_SETTING } from "@/lib/pluginSettings";
import {
  choosePluginWorkspace,
  getInitialPluginWorkspaceRoot,
  getPluginWorkspaceRoot,
  setPluginWorkspaceRoot,
  syncPluginWorkspaceRootFromSetting,
  teardownPluginWorkspace,
} from "@/lib/pluginWorkspace";

const originalGlobals = new Map<string, unknown>();

function replaceGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, (globalThis as any)[name]);
  (globalThis as any)[name] = value;
}

afterEach(() => {
  syncPluginWorkspaceRootFromSetting("");
  teardownPluginWorkspace();
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  originalGlobals.clear();
});

describe("plugin workspace setting", () => {
  test("reads Blockbench's persisted object shape when restoring the directory", () => {
    replaceGlobal("PathModule", path.win32);
    replaceGlobal("Settings", {
      stored: { [PLUGIN_WORKSPACE_SETTING]: { value: "D:\\persisted-temp" } },
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

    expect(getInitialPluginWorkspaceRoot()).toBe("D:\\persisted-temp");
  });

  test("migrates the former YSM directory setting", () => {
    replaceGlobal("PathModule", path.win32);
    replaceGlobal("Settings", {
      stored: { codex_mcp_temporary_directory: { value: "D:\\legacy-setting" } },
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

    expect(getInitialPluginWorkspaceRoot()).toBe("D:\\legacy-setting");
  });

  test("migrates the old localStorage path and keeps MCP changes in the native setting", () => {
    let configured: unknown;
    let legacy = "D:\\legacy-ysm";
    replaceGlobal("PathModule", path.win32);
    replaceGlobal("Settings", {
      stored: {},
      get(id: string) {
        return id === PLUGIN_WORKSPACE_SETTING ? configured : undefined;
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
      [PLUGIN_WORKSPACE_SETTING]: {
        set(value: unknown) {
          configured = value;
        },
      },
    });

    expect(getInitialPluginWorkspaceRoot()).toBe("D:\\legacy-ysm");
    expect(legacy).toBe("");

    expect(setPluginWorkspaceRoot("D:\\new-temp", false)).toBe(true);
    expect(configured).toBe("D:\\new-temp");
    expect(getPluginWorkspaceRoot()).toBe("D:\\new-temp");
  });

  test("updates the visible setting without showing a redundant success message", () => {
    let configured: unknown;
    let quickMessages = 0;
    replaceGlobal("PathModule", path.win32);
    replaceGlobal("Settings", {
      stored: {},
      get(id: string) {
        return id === PLUGIN_WORKSPACE_SETTING ? configured : undefined;
      },
    });
    replaceGlobal("settings", {
      [PLUGIN_WORKSPACE_SETTING]: {
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

    expect(choosePluginWorkspace()).toBe(true);
    expect(configured).toBe("D:\\selected-temp");
    expect(getPluginWorkspaceRoot()).toBe("D:\\selected-temp");
    expect(quickMessages).toBe(0);
  });
});
