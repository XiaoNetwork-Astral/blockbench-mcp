import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("MCP status bar presentation", () => {
  test("shows server state and a project lock without session accounting or the server address", () => {
    const source = readFileSync(new URL("../ui/statusBar.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../ui/statusBar.css", import.meta.url), "utf8");

    expect(source).not.toContain("sessionManager");
    expect(source).toContain("getMcpServerState()");
    expect(source).toContain("subscribeMcpServerState(updateStatus)");
    expect(source).not.toContain("clientCount");
    expect(source).not.toContain("sessionCount");
    expect(source).not.toContain("getMcpBindHost");
    expect(source).not.toContain("mcp.status.server_address");
    expect(source).not.toContain("statusIndicator.title");
    expect(source).toContain("mcp-project-protection");
    expect(source).toContain("setProjectReadOnly");
    expect(source).not.toContain("removeLegacyStatusBarStyles");
    expect(styles).toContain("#mcp-status-bar .mcp-project-protection");
    expect(styles).toContain("#mcp-status-bar .mcp-status-indicator");
    expect(styles).toContain("pointer-events: auto !important;");
    expect(styles).toContain("pointer-events: none;");
    expect(styles).toContain("user-select: none;");
    expect(styles).toContain(".mcp-status-dot.running");
    expect(styles).toContain(".mcp-status-dot.stopped");
  });
});
