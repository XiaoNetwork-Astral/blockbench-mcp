import { afterEach, describe, expect, test } from "bun:test";
import { serverControlsSetup, serverControlsTeardown } from "@/ui/serverControls";

const originalGlobals = new Map<string, unknown>();

function replaceGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, (globalThis as any)[name]);
  (globalThis as any)[name] = value;
}

class FakeAction {
  deleted = false;

  constructor(
    public readonly id: string,
    public readonly options: Record<string, unknown>
  ) {}

  delete(): void {
    this.deleted = true;
  }
}

afterEach(() => {
  serverControlsTeardown();
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  originalGlobals.clear();
});

describe("Blockbench Tools menu server controls", () => {
  test("registers start, stop, and status actions and removes them on teardown", async () => {
    const actions: FakeAction[] = [];
    const messages: Array<Record<string, unknown>> = [];
    let starts = 0;
    let stops = 0;

    replaceGlobal("Action", FakeAction);
    replaceGlobal("MenuBar", {
      menus: {
        tools: {
          addAction(action: FakeAction) {
            actions.push(action);
          },
        },
      },
    });
    replaceGlobal("tl", (key: string) => key);
    replaceGlobal("Blockbench", {
      showMessageBox(options: Record<string, unknown>) {
        messages.push(options);
      },
    });

    serverControlsSetup({
      start: async () => {
        starts += 1;
      },
      stop: async () => {
        stops += 1;
      },
      getStatus: () => ({
        state: "running",
        url: "http://127.0.0.1:3000/bb-mcp",
        authenticationEnabled: false,
        connectedClients: 2,
      }),
    });

    expect(actions.map((action) => action.id)).toEqual([
      "codex_blockbench_mcp_start_server",
      "codex_blockbench_mcp_stop_server",
      "codex_blockbench_mcp_show_server_status",
    ]);

    (actions[0].options.click as () => void)();
    (actions[1].options.click as () => void)();
    (actions[2].options.click as () => void)();
    await Promise.resolve();

    expect(starts).toBe(1);
    expect(stops).toBe(1);
    expect(String(messages[0].message)).toContain("http://127.0.0.1:3000/bb-mcp");
    expect(String(messages[0].message)).toContain("mcp.server_controls.authentication_disabled");

    serverControlsTeardown();
    expect(actions.every((action) => action.deleted)).toBe(true);
  });
});
