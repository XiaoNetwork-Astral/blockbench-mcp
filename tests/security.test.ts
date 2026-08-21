import { describe, expect, test } from "bun:test";
import {
  assertToolRegistrationAllowed,
  isAuthorizedMcpRequest,
  isLoopbackMcpHost,
} from "@/lib/security";
import {
  DEFAULT_MCP_BIND_HOST,
  createMcpAuthToken,
  formatMcpHostForUrl,
  isValidMcpAuthToken,
  normalizeMcpAuthToken,
  normalizeMcpBindHost,
} from "@/lib/pluginSettings";

describe("local MCP security policy", () => {
  test("defaults to loopback but accepts explicit bind addresses", () => {
    expect(DEFAULT_MCP_BIND_HOST).toBe("127.0.0.1");
    expect(normalizeMcpBindHost(" 192.168.1.20 ")).toBe("192.168.1.20");
    expect(normalizeMcpBindHost("*")).toBe("0.0.0.0");
    expect(normalizeMcpBindHost("http://example.test")).toBe(DEFAULT_MCP_BIND_HOST);
    expect(normalizeMcpBindHost("example.test:3000")).toBe(DEFAULT_MCP_BIND_HOST);
    expect(formatMcpHostForUrl("::1")).toBe("[::1]");
  });

  test("distinguishes local-only and network-exposed listen addresses", () => {
    for (const host of ["127.0.0.1", "127.9.8.7", "localhost", "::1", "[::1]"]) {
      expect(isLoopbackMcpHost(host)).toBe(true);
    }
    for (const host of ["0.0.0.0", "::", "192.168.1.20", "mcp.example.test"]) {
      expect(isLoopbackMcpHost(host)).toBe(false);
    }
  });

  test("requires the exact bearer credential", () => {
    const token = "a".repeat(64);
    expect(isAuthorizedMcpRequest({}, token)).toBe(false);
    expect(isAuthorizedMcpRequest({ authorization: "Bearer wrong" }, token)).toBe(false);
    expect(isAuthorizedMcpRequest({ authorization: `Bearer ${token} trailing` }, token)).toBe(false);
    expect(isAuthorizedMcpRequest({ authorization: `Bearer ${token}` }, token)).toBe(true);
  });

  test("allows requests when the user explicitly disables bearer authentication", () => {
    expect(normalizeMcpAuthToken("   ")).toBe("");
    expect(isAuthorizedMcpRequest({}, "")).toBe(true);
    expect(isAuthorizedMcpRequest({ authorization: "Bearer anything" }, "")).toBe(true);
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
