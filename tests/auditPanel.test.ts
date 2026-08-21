import { afterEach, describe, expect, test } from "bun:test";
import { showAuditPanel } from "@/ui/auditPanel";

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
