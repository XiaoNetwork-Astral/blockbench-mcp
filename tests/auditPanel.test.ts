import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  buildAuditRawData,
  showAuditPanel,
} from "@/ui/auditPanel";
import type {
  AuditOperationDetails,
  AuditOperationSummary,
  AuditUndoPoint,
} from "@/lib/audit";

const originalGlobals = new Map<string, unknown>();

function replaceGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, (globalThis as any)[name]);
  (globalThis as any)[name] = value;
}

afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  originalGlobals.clear();
});

describe("operations panel project guard", () => {
  test("asks the user to open a project before showing project history", () => {
    const messages: Array<Record<string, unknown>> = [];
    replaceGlobal("Project", null);
    replaceGlobal("tl", (key: string) => key);
    replaceGlobal("Blockbench", {
      showMessageBox(options: Record<string, unknown>) {
        messages.push(options);
      },
    });

    showAuditPanel();

    expect(messages).toHaveLength(1);
    expect(messages[0].title).toBe("mcp.audit.open_project_title");
    expect(messages[0].message).toBe("mcp.audit.open_project_message");
  });
});

describe("operations panel presentation", () => {
  test("keeps raw JSON out of list rows and removes the standalone MCP panel", () => {
    const template = readFileSync(new URL("../ui/auditPanel.html", import.meta.url), "utf8");
    const styles = readFileSync(new URL("../ui/auditPanel.css", import.meta.url), "utf8");
    const translations = readFileSync(new URL("../ui/i18n.ts", import.meta.url), "utf8");
    const uiSetup = readFileSync(new URL("../ui/index.ts", import.meta.url), "utf8");

    expect(template).not.toContain("codex-audit-inline-summary");
    expect(template).not.toContain("filters.source");
    expect(template).not.toContain("filters.status");
    expect(template).toContain("mcp.audit.show_raw_data");
    expect(styles).toContain("#panel_codex_mcp_audit_panel");
    expect(styles).toContain("justify-content: center !important");
    expect(translations).not.toContain("No live native Undo state");
    expect(translations).not.toContain("Sanitized result");
    expect(uiSetup).not.toContain("mcp_panel");
    expect(uiSetup).not.toContain("new Panel");
  });

  test("builds readable JSON data from the stored sanitized payloads", () => {
    const before: AuditUndoPoint = {
      runtimeId: "runtime",
      projectId: "project",
      projectName: "Model",
      projectRole: "working_copy",
      index: 2,
      total: 3,
      prefixHash: "before-hash",
      appliedEntryId: "entry-2",
      redoEntryId: "entry-3",
    };
    const after: AuditUndoPoint = {
      ...before,
      index: 3,
      prefixHash: "after-hash",
      appliedEntryId: "entry-3",
      redoEntryId: null,
    };
    const item: AuditOperationSummary = {
      id: "operation",
      sortKey: "sort",
      runtimeId: "runtime",
      source: "mcp",
      status: "success",
      toolName: "create_texture",
      title: "Create Texture",
      startedAt: Date.parse("2026-08-21T10:00:00.000Z"),
      finishedAt: Date.parse("2026-08-21T10:00:00.025Z"),
      durationMs: 25,
      sessionId: "session",
      clientName: "codex-mcp-client",
      readOnly: false,
      projectId: "project",
      projectName: "Model",
      projectRole: "working_copy",
      argumentsSummary: "{}",
      resultSummary: "{}",
      errorSummary: "",
      before,
      after,
      undoEntryCount: 1,
      undoDelta: 1,
      reversible: true,
      searchText: "create texture",
    };
    const details: AuditOperationDetails = {
      id: "operation",
      argumentsText: '{"name":"[redacted]"}',
      resultText: '{"ok":true}',
      errorText: "",
      undoEntries: [
        {
          id: "entry-3",
          action: "Create texture",
          type: "edit",
          time: 1,
          ownerSource: "mcp",
        },
      ],
    };

    const raw = buildAuditRawData(item, details) as {
      sanitized: { arguments: unknown; result: unknown; error: unknown };
      undo: { changedEntryCount: number };
    };

    expect(raw.sanitized.arguments).toEqual({ name: "[redacted]" });
    expect(raw.sanitized.result).toEqual({ ok: true });
    expect(raw.sanitized.error).toBeNull();
    expect(raw.undo.changedEntryCount).toBe(1);
  });
});
