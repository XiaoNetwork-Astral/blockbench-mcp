import { afterEach, describe, expect, test } from "bun:test";
import {
  MCP_AUTH_ENABLED_SETTING,
  MCP_AUTH_TOKEN_SETTING,
  getInitialMcpAuthToken,
  getMcpAuthEnabled,
  getMcpAuthToken,
} from "@/lib/pluginSettings";

const originalSettings = (globalThis as any).Settings;

function installSettings(values: Record<string, unknown>): void {
  (globalThis as any).Settings = {
    get(id: string) {
      return values[id];
    },
  };
}

afterEach(() => {
  if (originalSettings === undefined) {
    delete (globalThis as any).Settings;
  } else {
    (globalThis as any).Settings = originalSettings;
  }
});

describe("MCP authentication settings", () => {
  test("reads Blockbench's persisted object shape when restoring a token", () => {
    const token = "d".repeat(64);
    (globalThis as any).Settings = {
      stored: { [MCP_AUTH_TOKEN_SETTING]: { value: `  ${token}  ` } },
      get() {
        return undefined;
      },
    };

    expect(getInitialMcpAuthToken()).toBe(token);
  });

  test("keeps bearer authentication enabled unless the toggle is explicitly false", () => {
    const token = "a".repeat(64);
    installSettings({ [MCP_AUTH_TOKEN_SETTING]: `  ${token}  ` });

    expect(getMcpAuthEnabled()).toBe(true);
    expect(getMcpAuthToken()).toBe(token);
  });

  test("disables authentication without deleting the configured token", () => {
    const token = "b".repeat(64);
    const values = {
      [MCP_AUTH_ENABLED_SETTING]: false,
      [MCP_AUTH_TOKEN_SETTING]: token,
    };
    installSettings(values);

    expect(getMcpAuthEnabled()).toBe(false);
    expect(getMcpAuthToken()).toBe("");
    expect(values[MCP_AUTH_TOKEN_SETTING]).toBe(token);
  });
});
