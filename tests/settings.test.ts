import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
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

function installBlockbenchSettingsMock(options: {
  dialogReady?: boolean;
  storedSettings?: Record<string, unknown>;
  persistedSettings?: Record<string, unknown>;
} = {}) {
  const dialogReady = options.dialogReady ?? true;
  let sidebarBuilds = 0;
  let addCategoryCalls = 0;
  let reactiveSets = 0;
  let reactiveDeletes = 0;
  let forceUpdates = 0;
  let openCategoryWrites = 0;
  let addedAction: FakeAction | undefined;
  let saveLocalStoragesCalls = 0;
  const messageBoxes: Record<string, unknown>[] = [];
  const persistedSettings = { ...(options.persistedSettings ?? {}) };

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
    stored: { ...(options.storedSettings ?? {}) } as Record<string, unknown>,
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
    saveLocalStorages() {
      saveLocalStoragesCalls += 1;
      for (const [id, setting] of Object.entries(this.structure[CATEGORY_ID]?.items ?? {})) {
        persistedSettings[id] = { value: setting.master_value };
      }
    },
  };

  class FakeSetting {
    id: string;
    value: unknown;
    master_value: unknown;
    type: string;
    onChange?: (value: unknown) => void;
    private category: string;

    constructor(
      id: string,
      options: {
        category: string;
        type?: string;
        value?: unknown;
        onChange?: (value: unknown) => void;
      }
    ) {
      this.id = id;
      const stored = settingsApi.stored[id];
      const storedValue = stored && typeof stored === "object" && "value" in stored
        ? (stored as { value: unknown }).value
        : undefined;
      this.value = storedValue ?? options.value;
      this.master_value = this.value;
      this.type = options.type ?? "toggle";
      this.onChange = options.onChange;
      this.category = options.category;
      const category = settingsApi.structure[this.category];
      if (!category) throw new Error(`Missing settings category: ${this.category}`);
      category.items[id] = this;
    }

    set(value: unknown) {
      this.value = value;
      this.master_value = value;
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
  replaceGlobal("PathModule", path.win32);
  replaceGlobal("localStorage", {
    getItem(key: string) {
      return key === "settings" ? JSON.stringify(persistedSettings) : null;
    },
    removeItem() {},
  });
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
  replaceGlobal("Blockbench", {
    showMessageBox(options: Record<string, unknown>) {
      messageBoxes.push(options);
    },
    showQuickMessage() {},
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
    getSaveLocalStoragesCalls: () => saveLocalStoragesCalls,
    getPersistedSettings: () => persistedSettings,
    getMessageBoxes: () => messageBoxes,
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
  test("uses Blockbench's label contract to attach both inline setting buttons", () => {
    installBlockbenchSettingsMock();
    let observerOptions: MutationObserverInit | undefined;
    let observerCallback: MutationCallback | undefined;

    class FakeElement {
      className = "";
      dataset: Record<string, string> = {};
      id = "";
      checked = false;
      disabled = false;
      hidden = false;
      tabIndex = 0;
      parent: FakeElement | undefined;
      children: FakeElement[] = [];
      textContent = "";
      title = "";
      private attributes = new Map<string, string>();
      private listeners = new Map<string, Set<(event: Event) => void>>();
      private extraClasses = new Set<string>();
      readonly classList = {
        add: (...names: string[]) => names.forEach((name) => this.extraClasses.add(name)),
        remove: (...names: string[]) => names.forEach((name) => this.extraClasses.delete(name)),
        toggle: (name: string, force?: boolean) => {
          const enabled = force ?? !this.hasClass(name);
          if (enabled) this.extraClasses.add(name);
          else this.extraClasses.delete(name);
          return enabled;
        },
        contains: (name: string) => this.hasClass(name),
      };

      constructor(readonly tagName: string) {}

      private hasClass(name: string): boolean {
        return this.extraClasses.has(name) || this.className.split(/\s+/).includes(name);
      }

      appendChild(child: FakeElement): FakeElement {
        child.parent = this;
        this.children.push(child);
        return child;
      }

      insertBefore(child: FakeElement, reference: FakeElement): FakeElement {
        child.parent = this;
        const index = this.children.indexOf(reference);
        if (index < 0) this.children.push(child);
        else this.children.splice(index, 0, child);
        return child;
      }

      private findDescendant(predicate: (element: FakeElement) => boolean): FakeElement | null {
        for (const child of this.children) {
          if (predicate(child)) return child;
          const nested = child.findDescendant(predicate);
          if (nested) return nested;
        }
        return null;
      }

      querySelector(selector: string): FakeElement | null {
        if (selector === "input.dark_bordered") {
          return this.findDescendant(
            (child) => child.tagName === "input" && child.hasClass("dark_bordered")
          );
        }
        if (selector === "input.toggle_switch") {
          return this.findDescendant(
            (child) => child.tagName === "input" && child.hasClass("toggle_switch")
          );
        }
        if (selector === ":scope > .password_toggle") {
          return this.children.find((child) => child.hasClass("password_toggle")) ?? null;
        }
        if (selector === ":scope > .setting_label") {
          return this.children.find((child) => child.hasClass("setting_label")) ?? null;
        }
        if (selector.startsWith(".")) {
          const className = selector.slice(1);
          return this.findDescendant((child) => child.hasClass(className));
        }
        return null;
      }

      closest(selector: string): FakeElement | null {
        let current: FakeElement | undefined = this;
        while (current) {
          if (selector === "li" && current.tagName === "li") return current;
          current = current.parent;
        }
        return null;
      }

      setAttribute(name: string, value: string): void {
        this.attributes.set(name, value);
        if (name === "id") this.id = value;
        if (name === "tabindex") this.tabIndex = Number(value);
      }

      getAttribute(name: string): string | null {
        return this.attributes.get(name) ?? null;
      }

      removeAttribute(name: string): void {
        this.attributes.delete(name);
        if (name === "id") this.id = "";
      }

      addEventListener(type: string, listener: (event: Event) => void): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type: string, listener: (event: Event) => void): void {
        this.listeners.get(type)?.delete(listener);
      }

      dispatch(type: string): void {
        const event = {
          currentTarget: this,
          preventDefault() {},
          stopPropagation() {},
        } as unknown as Event;
        this.listeners.get(type)?.forEach((listener) => listener(event));
      }

      remove(): void {
        if (!this.parent) return;
        const index = this.parent.children.indexOf(this);
        if (index >= 0) this.parent.children.splice(index, 1);
        this.parent = undefined;
      }
    }

    function createSettingRow(options: { password?: boolean; toggle?: boolean } = {}) {
      const row = new FakeElement("li");
      const settingLabel = new FakeElement("div");
      settingLabel.className = "setting_label";
      const label = new FakeElement("label");
      const input = new FakeElement("input");
      settingLabel.appendChild(label);
      if (options.toggle) {
        const settingElement = new FakeElement("div");
        settingElement.className = "setting_element";
        input.className = "toggle_switch";
        input.checked = true;
        settingElement.appendChild(input);
        row.appendChild(settingElement);
        row.appendChild(settingLabel);
      } else {
        input.className = "dark_bordered";
        row.appendChild(settingLabel);
        row.appendChild(input);
      }
      const visibility = options.password ? new FakeElement("div") : undefined;
      if (visibility) {
        visibility.className = "password_toggle";
        row.appendChild(visibility);
      }
      return { row, settingLabel, label, input, visibility };
    }

    const directory = createSettingRow();
    const auth = createSettingRow({ toggle: true });
    const token = createSettingRow({ password: true });
    const labels = new Map([
      ["codex_mcp_temporary_directory", directory.label],
      ["codex_mcp_auth_enabled", auth.label],
      ["codex_mcp_auth_token", token.label],
    ]);
    replaceGlobal("document", {
      body: new FakeElement("body"),
      createElement: (tagName: string) => new FakeElement(tagName),
      querySelector(selector: string) {
        const id = selector.match(/label\[for="setting_([^"]+)"\]/)?.[1];
        return id ? labels.get(id) ?? null : null;
      },
      querySelectorAll: () => [],
    });
    replaceGlobal("MutationObserver", class FakeMutationObserver {
      constructor(callback: MutationCallback) {
        observerCallback = callback;
      }

      observe(_target: Node, options: MutationObserverInit): void {
        observerOptions = options;
      }

      disconnect(): void {}
    });

    settingsSetup();

    expect(directory.input.id).toBe("setting_codex_mcp_temporary_directory");
    expect(directory.row.querySelector(".codex-mcp-directory-browse")).not.toBeNull();
    expect(token.input.id).toBe("setting_codex_mcp_auth_token");
    const regenerate = token.row.querySelector(".codex-mcp-token-regenerate");
    expect(regenerate).not.toBeNull();
    expect(token.row.children.indexOf(regenerate!)).toBeLessThan(
      token.row.children.indexOf(token.visibility!)
    );
    const warning = auth.settingLabel.querySelector(".codex-mcp-auth-inline-warning");
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toBe("mcp.settings.auth_disabled_inline_warning");
    expect(warning!.hidden).toBe(true);
    expect(token.input.disabled).toBe(false);

    auth.input.checked = false;
    auth.input.dispatch("change");
    expect(warning!.hidden).toBe(false);
    expect(token.row.classList.contains("codex-mcp-setting-disabled")).toBe(true);
    expect(token.row.getAttribute("aria-disabled")).toBe("true");
    expect(token.input.disabled).toBe(true);
    expect(regenerate!.getAttribute("aria-disabled")).toBe("true");
    expect(regenerate!.tabIndex).toBe(-1);

    auth.input.checked = true;
    auth.input.dispatch("change");
    expect(warning!.hidden).toBe(true);
    expect(token.row.classList.contains("codex-mcp-setting-disabled")).toBe(false);
    expect(token.row.getAttribute("aria-disabled")).toBeNull();
    expect(token.input.disabled).toBe(false);
    expect(regenerate!.getAttribute("aria-disabled")).toBeNull();
    expect(regenerate!.tabIndex).toBe(0);
    expect(observerOptions).toEqual({ childList: true, subtree: true });

    const directoryChildCount = directory.row.children.length;
    const authLabelChildCount = auth.settingLabel.children.length;
    const tokenChildCount = token.row.children.length;
    observerCallback?.([], {} as MutationObserver);
    expect(directory.row.children).toHaveLength(directoryChildCount);
    expect(auth.settingLabel.children).toHaveLength(authLabelChildCount);
    expect(token.row.children).toHaveLength(tokenChildCount);
  });

  test("repairs a stale category, registers settings, and removes both category entries", () => {
    const mock = installBlockbenchSettingsMock();

    settingsSetup();

    const category = mock.settingsApi.structure[CATEGORY_ID];
    expect(category).toBeDefined();
    expect(Object.keys(category.items)).toHaveLength(11);
    expect(category.items.codex_mcp_temporary_directory).toBeDefined();
    expect(category.items.codex_mcp_bind_host).toBeDefined();
    expect(category.items.codex_mcp_port).toBeDefined();
    expect(category.items.codex_mcp_auth_enabled).toBeDefined();
    expect(category.items.codex_mcp_auth_token).toBeDefined();
    expect(Object.keys(category.items).indexOf("codex_mcp_auth_enabled")).toBeLessThan(
      Object.keys(category.items).indexOf("codex_mcp_auth_token")
    );
    category.items.codex_mcp_auth_enabled.onChange?.(false);
    expect(mock.getMessageBoxes()).toEqual([]);
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

    expect(Object.keys(mock.settingsApi.structure[CATEGORY_ID].items)).toHaveLength(11);
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
    expect(Object.keys(category.items)).toHaveLength(11);
    expect(category.items.codex_mcp_temporary_directory).toBeDefined();
    expect(category.items.codex_mcp_bind_host).toBeDefined();
    expect(category.items.codex_mcp_port).toBeDefined();
    expect(category.items.codex_mcp_auth_enabled).toBeDefined();
    expect(category.items.codex_mcp_auth_token).toBeDefined();
    expect(mock.getAddCategoryCalls()).toBe(0);

    // Simulate Blockbench mounting its settings dialog after plugin startup,
    // with a stale empty category list cached by Vue.
    category.items = {};
    const dialog = mock.mountDialog();
    expect(reconcileSettingsDialog()).toBe(true);
    dialog.sidebar.setPage(CATEGORY_ID);

    expect(Object.keys(category.items)).toHaveLength(11);
    expect(dialog.content_vue.open_category).toBe(CATEGORY_ID);
    expect(mock.getForceUpdates()).toBeGreaterThan(0);
  });

  test("uses the latest persisted values during a same-session plugin reload", () => {
    const token = "c".repeat(64);
    const mock = installBlockbenchSettingsMock({
      storedSettings: {
        codex_mcp_port: { value: 3000 },
        codex_mcp_temporary_directory: { value: "D:\\old-temp" },
      },
      persistedSettings: {
        codex_mcp_port: { value: 4312 },
        codex_mcp_temporary_directory: { value: "D:\\current-temp" },
        codex_mcp_auth_enabled: { value: false },
        codex_mcp_auth_token: { value: token },
      },
    });

    settingsSetup();

    let category = mock.settingsApi.structure[CATEGORY_ID];
    expect(category.items.codex_mcp_port.value).toBe(4312);
    expect(category.items.codex_mcp_temporary_directory.value).toBe("D:\\current-temp");
    expect(category.items.codex_mcp_auth_enabled.value).toBe(false);
    expect(category.items.codex_mcp_auth_token.value).toBe(token);

    category.items.codex_mcp_port.set(4789);
    settingsTeardown();

    expect(mock.getSaveLocalStoragesCalls()).toBeGreaterThan(0);
    expect(mock.settingsApi.stored.codex_mcp_port).toEqual({ value: 4789 });
    expect(mock.getPersistedSettings().codex_mcp_port).toEqual({ value: 4789 });

    settingsSetup();
    category = mock.settingsApi.structure[CATEGORY_ID];
    expect(category.items.codex_mcp_port.value).toBe(4789);
    expect(category.items.codex_mcp_temporary_directory.value).toBe("D:\\current-temp");
  });
});
