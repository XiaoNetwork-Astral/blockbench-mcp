import { afterEach, describe, expect, test } from "bun:test";
import { settingsSetup, settingsTeardown } from "@/ui/settings";

const CATEGORY_ID = "codex_blockbench_mcp";
const originalGlobals = new Map<string, unknown>();

function replaceGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, (globalThis as any)[name]);
  (globalThis as any)[name] = value;
}

function installBlockbenchSettingsMock(options: { dialogReady?: boolean } = {}) {
  const dialogReady = options.dialogReady ?? true;
  let sidebarBuilds = 0;
  let addCategoryCalls = 0;
  let addedAction: FakeAction | undefined;

  const sidebar = {
    pages: { [CATEGORY_ID]: "Stale Codex page" } as Record<string, string>,
    build: () => {
      sidebarBuilds += 1;
    },
  };

  const settingsApi = {
    stored: {},
    structure: {} as Record<
      string,
      { name: string; open: boolean; items: Record<string, FakeSetting> }
    >,
    dialog: dialogReady ? { sidebar } : null as { sidebar: typeof sidebar } | null,
    addCategory(id: string, data: { name: string; open: boolean }) {
      addCategoryCalls += 1;
      this.structure[id] = { ...data, items: {} };
      if (!this.dialog) throw new Error("Settings dialog is not initialized");
      this.dialog.sidebar.pages[id] = data.name;
      this.dialog.sidebar.build();
    },
    openDialog() {},
    get(id: string) {
      return this.structure[CATEGORY_ID]?.items[id]?.value;
    },
  };

  class FakeSetting {
    id: string;
    value: unknown;
    private category: string;

    constructor(id: string, options: { category: string; value?: unknown }) {
      this.id = id;
      this.value = options.value;
      this.category = options.category;
      const category = settingsApi.structure[this.category];
      if (!category) throw new Error(`Missing settings category: ${this.category}`);
      category.items[id] = this;
    }

    set(value: unknown) {
      this.value = value;
      return this;
    }

    delete() {
      delete settingsApi.structure[this.category]?.items[this.id];
    }
  }

  class FakeAction {
    deleted = false;

    constructor(
      public readonly id: string,
      public readonly options: Record<string, unknown>
    ) {}

    delete() {
      this.deleted = true;
    }
  }

  replaceGlobal("Settings", settingsApi);
  replaceGlobal("Setting", FakeSetting);
  replaceGlobal("Action", FakeAction);
  replaceGlobal("MenuBar", {
    menus: {
      tools: {
        addAction(action: FakeAction) {
          addedAction = action;
        },
      },
    },
  });
  replaceGlobal("tl", (key: string, values?: unknown[]) =>
    values?.length ? `${key}:${values.join(",")}` : key
  );

  return {
    settingsApi,
    getSidebarBuilds: () => sidebarBuilds,
    getAddCategoryCalls: () => addCategoryCalls,
    getAddedAction: () => addedAction,
  };
}

afterEach(() => {
  try {
    settingsTeardown();
  } catch {
    // A failed setup may not have installed enough of the mock for teardown.
  }
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  originalGlobals.clear();
});

describe("Blockbench settings integration", () => {
  test("repairs a stale category, registers settings, and removes both category entries", () => {
    const mock = installBlockbenchSettingsMock();

    settingsSetup();

    const category = mock.settingsApi.structure[CATEGORY_ID];
    expect(category).toBeDefined();
    expect(Object.keys(category.items)).toHaveLength(13);
    expect(category.items.codex_mcp_port).toBeDefined();
    expect(category.items.codex_mcp_auth_token).toBeDefined();
    expect(mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID]).toBe(
      "mcp.settings.category_name"
    );
    expect(mock.getAddedAction()?.id).toBe("codex_blockbench_mcp_open_settings");

    settingsTeardown();

    expect(mock.settingsApi.structure[CATEGORY_ID]).toBeUndefined();
    expect(mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID]).toBeUndefined();
    expect(mock.getAddedAction()?.deleted).toBe(true);
    expect(mock.getSidebarBuilds()).toBeGreaterThanOrEqual(2);

    // Also cover the inverse stale state: an empty structure entry left by an
    // interrupted load. Setup must populate it instead of leaving a blank page.
    mock.settingsApi.structure[CATEGORY_ID] = {
      name: "Old name",
      open: false,
      items: {},
    };
    mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID] = "Old name";

    settingsSetup();

    expect(Object.keys(mock.settingsApi.structure[CATEGORY_ID].items)).toHaveLength(13);
    expect(mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID]).toBe(
      "mcp.settings.category_name"
    );
  });

  test("registers every setting before the settings dialog exists on cold start", () => {
    const mock = installBlockbenchSettingsMock({ dialogReady: false });

    settingsSetup();

    const category = mock.settingsApi.structure[CATEGORY_ID];
    expect(category).toBeDefined();
    expect(Object.keys(category.items)).toHaveLength(13);
    expect(category.items.codex_mcp_port).toBeDefined();
    expect(category.items.codex_mcp_auth_token).toBeDefined();
    expect(mock.getAddCategoryCalls()).toBe(0);
  });
});
