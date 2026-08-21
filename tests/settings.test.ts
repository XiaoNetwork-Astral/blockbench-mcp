import { afterEach, describe, expect, test } from "bun:test";
import {
  reconcileSettingsDialog,
  settingsSetup,
  settingsTeardown,
} from "@/ui/settings";

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
  let reactiveSets = 0;
  let reactiveDeletes = 0;
  let forceUpdates = 0;
  let openCategoryWrites = 0;
  let addedAction: FakeAction | undefined;

  let openCategory = "general";
  const contentVue = {
    get open_category() {
      return openCategory;
    },
    set open_category(value: string) {
      openCategoryWrites += 1;
      openCategory = value;
    },
    search_term: "",
    $forceUpdate: () => {
      forceUpdates += 1;
    },
  };

  const sidebar = {
    pages: { [CATEGORY_ID]: "Stale Codex page" } as Record<string, string>,
    page: "general",
    onPageSwitch(page: string): unknown {
      contentVue.open_category = page;
      contentVue.search_term = "";
      return undefined;
    },
    setPage(page: string) {
      const result = this.onPageSwitch(page);
      if (result !== false) this.page = page;
    },
    build: () => {
      sidebarBuilds += 1;
    },
  };

  const dialog = {
    sidebar,
    content_vue: contentVue,
  };

  const settingsApi = {
    stored: {},
    structure: {} as Record<
      string,
      { name: string; open: boolean; items: Record<string, FakeSetting> }
    >,
    dialog: dialogReady ? dialog : null as typeof dialog | null,
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
  replaceGlobal("Vue", {
    set(target: Record<string, unknown>, key: string, value: unknown) {
      reactiveSets += 1;
      target[key] = value;
    },
    delete(target: Record<string, unknown>, key: string) {
      reactiveDeletes += 1;
      delete target[key];
    },
    nextTick(callback: () => void) {
      callback();
      return Promise.resolve();
    },
  });
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
    getReactiveSets: () => reactiveSets,
    getReactiveDeletes: () => reactiveDeletes,
    getForceUpdates: () => forceUpdates,
    getOpenCategoryWrites: () => openCategoryWrites,
    getAddedAction: () => addedAction,
    mountDialog: () => {
      settingsApi.dialog = dialog;
      return dialog;
    },
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
    expect(Object.keys(category.items)).toHaveLength(12);
    expect(category.items.codex_mcp_temporary_directory).toBeDefined();
    expect(category.items.codex_mcp_bind_host).toBeDefined();
    expect(category.items.codex_mcp_port).toBeDefined();
    expect(category.items.codex_mcp_auth_token).toBeDefined();
    expect(category.items.codex_mcp_instructions).toBeUndefined();
    expect(category.items.codex_mcp_copy_connection).toBeUndefined();
    expect(category.items.codex_mcp_regenerate_auth_token).toBeUndefined();
    expect((category.items.codex_mcp_auth_token as any).plugin).toBeUndefined();
    expect(mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID]).toBe(
      "mcp.settings.category_name"
    );
    expect(mock.getReactiveSets()).toBeGreaterThan(0);
    expect(mock.getAddedAction()).toBeUndefined();

    mock.settingsApi.dialog!.sidebar.setPage(CATEGORY_ID);
    expect(mock.getForceUpdates()).toBeGreaterThan(0);
    expect(mock.getOpenCategoryWrites()).toBeGreaterThanOrEqual(3);

    settingsTeardown();

    expect(mock.settingsApi.structure[CATEGORY_ID]).toBeUndefined();
    expect(mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID]).toBeUndefined();
    expect(mock.getAddedAction()).toBeUndefined();
    // An unmounted sidebar only needs its page map updated. Rebuilding it
    // here would append duplicate sidebar DOM once the dialog opens.
    expect(mock.getSidebarBuilds()).toBe(0);
    expect(mock.getReactiveDeletes()).toBeGreaterThan(0);

    // Also cover the inverse stale state: an empty structure entry left by an
    // interrupted load. Setup must populate it instead of leaving a blank page.
    mock.settingsApi.structure[CATEGORY_ID] = {
      name: "Old name",
      open: false,
      items: {
        codex_mcp_instructions: { id: "codex_mcp_instructions" } as any,
      },
    };
    mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID] = "Old name";

    settingsSetup();

    expect(Object.keys(mock.settingsApi.structure[CATEGORY_ID].items)).toHaveLength(12);
    expect(
      mock.settingsApi.structure[CATEGORY_ID].items.codex_mcp_instructions
    ).toBeUndefined();
    expect(mock.settingsApi.dialog!.sidebar.pages[CATEGORY_ID]).toBe(
      "mcp.settings.category_name"
    );
  });

  test("registers every setting before the settings dialog exists on cold start", () => {
    const mock = installBlockbenchSettingsMock({ dialogReady: false });

    settingsSetup();

    const category = mock.settingsApi.structure[CATEGORY_ID];
    expect(category).toBeDefined();
    expect(Object.keys(category.items)).toHaveLength(12);
    expect(category.items.codex_mcp_temporary_directory).toBeDefined();
    expect(category.items.codex_mcp_bind_host).toBeDefined();
    expect(category.items.codex_mcp_port).toBeDefined();
    expect(category.items.codex_mcp_auth_token).toBeDefined();
    expect(mock.getAddCategoryCalls()).toBe(0);

    // Simulate Blockbench mounting its settings dialog after plugin startup,
    // with a stale empty category list cached by Vue.
    category.items = {};
    const dialog = mock.mountDialog();
    expect(reconcileSettingsDialog()).toBe(true);
    dialog.sidebar.setPage(CATEGORY_ID);

    expect(Object.keys(category.items)).toHaveLength(12);
    expect(dialog.content_vue.open_category).toBe(CATEGORY_ID);
    expect(mock.getForceUpdates()).toBeGreaterThan(0);
  });
});
