import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import { YSM_WORKSPACE_SETTING } from "@/lib/pluginSettings";
import {
  getInitialYsmWorkspaceRoot,
  getYsmWorkspaceRoot,
  setYsmWorkspaceRoot,
  syncYsmWorkspaceRootFromSetting,
} from "@/lib/ysmWorkspace";

const originalGlobals = new Map<string, unknown>();

function replaceGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, (globalThis as any)[name]);
  (globalThis as any)[name] = value;
}

afterEach(() => {
  syncYsmWorkspaceRootFromSetting("");
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  originalGlobals.clear();
});

describe("YSM temporary directory setting", () => {
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
});
