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

class FakeDialog {
  shown = false;
  deleted = false;

  constructor(public readonly options: Record<string, unknown>) {}

  show(): this {
    this.shown = true;
    return this;
  }

  hide(): this {
    this.shown = false;
    return this;
  }

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
  test("registers stateless server actions and removes them on teardown", async () => {
    const actions: FakeAction[] = [];
    const dialogs: FakeDialog[] = [];
    let starts = 0;
    let stops = 0;

    replaceGlobal("Action", FakeAction);
    replaceGlobal("Dialog", class extends FakeDialog {
      constructor(options: Record<string, unknown>) {
        super(options);
        dialogs.push(this);
      }
    });
    replaceGlobal("MenuBar", {
      menus: {
        tools: {
          addAction(action: FakeAction) {
            actions.push(action);
          },
        },
      },
    });
    replaceGlobal("tl", (key: string) =>
      key === "mcp.server_controls.authentication_disabled" ? "Disabled" : key
    );
    replaceGlobal("Blockbench", {
      showQuickMessage() {},
      showMessageBox() {},
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
      }),
    });

    expect(actions.map((action) => action.id)).toEqual([
      "blockbench_mcp_start_server",
      "blockbench_mcp_stop_server",
      "blockbench_mcp_show_server_status",
    ]);

    (actions[0].options.click as () => void)();
    (actions[1].options.click as () => void)();
    (actions[2].options.click as () => void)();
    await Promise.resolve();

    expect(starts).toBe(1);
    expect(stops).toBe(1);
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0].shown).toBe(true);
    const lines = (dialogs[0].options.lines as string[]).join("\n");
    expect(lines).toContain("http://127.0.0.1:3000/bb-mcp");
    expect(lines).toContain(">Disabled</span>");
    expect(lines).not.toContain("Disabled (warning)");
    expect(lines).toContain("color: var(--color-warning, #f0a020)");
    expect(lines).not.toContain("status_sessions");
    expect(lines).toContain("display: grid");

    serverControlsTeardown();
    expect(actions.every((action) => action.deleted)).toBe(true);
    expect(dialogs[0].deleted).toBe(true);
  });
});
