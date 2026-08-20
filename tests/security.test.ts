import { describe, expect, test } from "bun:test";
import {
  assertToolRegistrationAllowed,
  isAuthorizedMcpRequest,
  MCP_LOOPBACK_HOST,
} from "@/lib/security";
import { createMcpAuthToken, isValidMcpAuthToken } from "@/lib/pluginSettings";

describe("local MCP security policy", () => {
  test("pins the network boundary to IPv4 loopback", () => {
    expect(MCP_LOOPBACK_HOST).toBe("127.0.0.1");
  });

  test("requires the exact bearer credential", () => {
    const token = "a".repeat(64);
    expect(isAuthorizedMcpRequest({}, token)).toBe(false);
    expect(isAuthorizedMcpRequest({ authorization: "Bearer wrong" }, token)).toBe(false);
    expect(isAuthorizedMcpRequest({ authorization: `Bearer ${token} trailing` }, token)).toBe(false);
    expect(isAuthorizedMcpRequest({ authorization: `Bearer ${token}` }, token)).toBe(true);
  });

  test("generates a strong setting-safe token", () => {
    const first = createMcpAuthToken();
    const second = createMcpAuthToken();
    expect(first).toHaveLength(64);
    expect(isValidMcpAuthToken(first)).toBe(true);
    expect(first).not.toBe(second);
    expect(isValidMcpAuthToken("short")).toBe(false);
  });

  test("cannot register arbitrary JavaScript evaluation", () => {
    expect(() => assertToolRegistrationAllowed("risky_eval")).toThrow("permanently disabled");
    expect(() => assertToolRegistrationAllowed("place_cube")).not.toThrow();
  });

  test("cannot register generic UI automation bypasses", () => {
    for (const tool of ["trigger_action", "emulate_clicks", "fill_dialog"]) {
      expect(() => assertToolRegistrationAllowed(tool)).toThrow("permanently disabled");
    }
    expect(() => assertToolRegistrationAllowed("set_preview_state")).not.toThrow();
  });
});
