import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clientMatchesSearch } from "@/ui/clientManager";

describe("MCP client manager search", () => {
  const client = {
    clientName: "codex-mcp-client",
    clientVersion: "0.149.0-alpha.4",
    remoteAddress: "127.0.0.1",
    userAgent: "codex-mcp-client/0.149.0-alpha.4",
    sessions: [
      { id: "0493b0e2-example-session-ee7fa1" },
      { id: "1f74e57e-another-session-cd092e" },
    ],
  };

  test("matches identity, address, version, and nested session IDs", () => {
    expect(clientMatchesSearch(client, "")).toBe(true);
    expect(clientMatchesSearch(client, "CODEX-MCP")).toBe(true);
    expect(clientMatchesSearch(client, "127.0.0.1")).toBe(true);
    expect(clientMatchesSearch(client, "alpha.4")).toBe(true);
    expect(clientMatchesSearch(client, "ee7fa1")).toBe(true);
    expect(clientMatchesSearch(client, "inspector")).toBe(false);
  });
});

describe("MCP client manager presentation", () => {
  test("uses a scrollable client list with collapsed, independently scrollable sessions", () => {
    const template = readFileSync(new URL("../ui/clientManager.html", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../ui/clientManager.css", import.meta.url), "utf8");

    expect(template).toContain('v-model.trim="searchQuery"');
    expect(template).toContain('v-for="client in filteredClients"');
    expect(template).toContain('v-if="isClientExpanded(client.key)"');
    expect(template).toContain("setAllVisible(true)");
    expect(template).toContain("setAllVisible(false)");
    expect(template).not.toContain("toggleAllVisible");
    expect(template.match(/codex-mcp-client-expand-button/g)).toHaveLength(2);
    expect(styles).toContain(".codex-mcp-client-scroll-region");
    expect(styles).toContain(".codex-mcp-client-expand-controls");
    expect(styles).toContain("max-width: 34px");
    expect(styles).toContain("max-height: 34px");
    expect(styles).toContain(".codex-mcp-client-expand-button:not(:disabled):focus");
    expect(styles).toContain("-webkit-text-fill-color: var(--color-text) !important");
    expect(styles).toContain(".codex-mcp-client-toggle:focus-visible");
    expect(styles).toContain("text-decoration: none !important");
    expect(styles).toContain("user-select: none");
    expect(styles).toContain(".codex-mcp-client-expand-button:disabled:focus");
    expect(styles).toContain("max-height: min(280px, 36vh)");
    expect(styles.match(/overflow-y: auto/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});
