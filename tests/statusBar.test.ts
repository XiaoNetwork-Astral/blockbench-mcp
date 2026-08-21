import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("MCP status bar presentation", () => {
  test("shows client and session counts without exposing an interactive address", () => {
    const source = readFileSync(new URL("../ui/statusBar.ts", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../ui/statusBar.css", import.meta.url), "utf8");

    expect(source).toContain("sessionManager.getClientCount()");
    expect(source).toContain("sessionManager.getCount()");
    expect(source).toContain("clientUnit");
    expect(source).toContain("sessionUnit");
    expect(source).not.toContain("getMcpBindHost");
    expect(source).not.toContain("mcp.status.server_address");
    expect(source).not.toContain("statusIndicator.title");
    expect(styles).toContain("pointer-events: none !important");
    expect(styles).toContain("user-select: none !important");
  });
});
