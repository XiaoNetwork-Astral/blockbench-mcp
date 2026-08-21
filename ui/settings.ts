import { auditManager } from "@/lib/audit";
import { PLUGIN_ID } from "@/lib/constants";
import {
  DEFAULT_AUDIT_RETENTION,
  DEFAULT_MCP_BIND_HOST,
  DEFAULT_MCP_ENDPOINT,
  DEFAULT_MCP_PORT,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SSE_HEARTBEAT_SECONDS,
  MAX_AUDIT_RETENTION,
  MAX_MCP_PORT,
  MAX_SESSION_TIMEOUT_MINUTES,
  MAX_SSE_HEARTBEAT_SECONDS,
  MCP_AUTH_TOKEN_SETTING,
  MCP_BIND_HOST_SETTING,
  MIN_AUDIT_RETENTION,
  MIN_MCP_PORT,
  createMcpAuthToken,
  getInitialMcpAuthToken,
  normalizeMcpBindHost,
} from "@/lib/pluginSettings";
import { isLoopbackMcpHost } from "@/lib/security";
import settingsCSS from "@/ui/settings.css";

const CATEGORY_ID = PLUGIN_ID;
const TOKEN_ACTION_CLASS = "codex-mcp-token-regenerate";
const settings: Setting[] = [];
let openSettingsAction: Action | undefined;
let settingsStyle: Deletable | undefined;
let settingsObserver: MutationObserver | undefined;
let settingsReadyTimer: ReturnType<typeof setInterval> | undefined;
let hookedSidebar: SettingsSidebar | undefined;
let originalPageSwitch: SettingsSidebar["onPageSwitch"] | undefined;

type SettingsSidebar = {
  pages: Record<string, string>;
  build?: () => void;
  node?: HTMLElement;
  page_menu?: Record<string, HTMLElement>;
  onPageSwitch?: (page: string) => unknown;
  setPage?: (page: string) => void;
};

type SettingsContentVue = {
  $forceUpdate?: () => void;
  open_category?: string;
  search_term?: string;
};

type SettingsDialogState = {
  sidebar?: SettingsSidebar;
  content_vue?: SettingsContentVue;
};

type VueReactivity = {
  set: (target: object, key: string, value: unknown) => void;
  delete: (target: object, key: string) => void;
  nextTick: (callback: () => void) => unknown;
};

function getVueReactivity(): VueReactivity | undefined {
  return (globalThis as typeof globalThis & { Vue?: VueReactivity }).Vue;
}

function getSettingsDialog(): SettingsDialogState | undefined {
  return (
    Settings as unknown as {
      dialog?: SettingsDialogState;
    }
  ).dialog;
}

function getSettingsSidebar(): SettingsSidebar | undefined {
  return getSettingsDialog()?.sidebar;
}

function reactiveSet(target: object, key: string, value: unknown): void {
  const vue = getVueReactivity();
  if (vue && typeof vue.set === "function") {
    vue.set(target, key, value);
  } else {
    (target as Record<string, unknown>)[key] = value;
  }
}

function reactiveDelete(target: object, key: string): void {
  const vue = getVueReactivity();
  if (vue && typeof vue.delete === "function") {
    vue.delete(target, key);
  } else {
    delete (target as Record<string, unknown>)[key];
  }
}

function rebuildSettingsSidebar(sidebar: SettingsSidebar): void {
  // DialogSidebar.build() appends a new node but does not remove the previous
  // one. Remove it first when a reload adds the category to an open dialog.
  sidebar.node?.remove();
  sidebar.build?.();
}

function syncSettingsSidebar(): void {
  const category = Settings.structure[CATEGORY_ID];
  const sidebar = getSettingsSidebar();
  if (!category || !sidebar) return;

  reactiveSet(sidebar.pages, CATEGORY_ID, category.name);
  if (sidebar.node?.isConnected && !sidebar.page_menu?.[CATEGORY_ID]) {
    rebuildSettingsSidebar(sidebar);
  }
}

/**
 * Reconcile Blockbench's structure and sidebar state without relying on
 * Settings.addCategory(). That method assumes the dialog already exists and
 * uses plain assignment, which is not reactive when a plugin loads after the
 * settings Vue instance has been created.
 */
function ensureSettingsCategory(): void {
  const name = tl("mcp.settings.category_name");
  const sidebar = getSettingsSidebar();
  const existing = Settings.structure[CATEGORY_ID];
  const category = {
    name,
    open: existing?.open ?? false,
    // Rebuild from the plugin's current schema. Reusing stale item objects
    // would keep settings that were removed in a newer plugin version.
    items: {},
  };

  if (sidebar && existing) reactiveDelete(Settings.structure, CATEGORY_ID);
  if (sidebar) reactiveSet(Settings.structure, CATEGORY_ID, category);
  else Settings.structure[CATEGORY_ID] = category;

  if (sidebar) syncSettingsSidebar();
}

/** Make all newly registered items visible to an already-mounted Vue list. */
function refreshSettingsCategory(): void {
  const category = Settings.structure[CATEGORY_ID];
  if (!category) return;

  // Reconstruct the category from this plugin's live Setting objects. During
  // a cold start Blockbench may mount its settings Vue instance after the
  // plugin registered them; during a reload it may retain a stale category.
  // Vue.set covers both orders.
  reactiveSet(
    category,
    "items",
    Object.fromEntries(settings.map((setting) => [setting.id, setting]))
  );
  syncSettingsSidebar();
}

/**
 * Invalidate Blockbench's cached `list` computed property without showing a
 * different category to the user. Both assignments happen in the same Vue
 * tick, so only the requested category is painted.
 */
function invalidateVisibleSettingsList(): void {
  const content = getSettingsDialog()?.content_vue;
  if (!content || content.open_category !== CATEGORY_ID) return;

  const current = content.open_category;
  const alternate = Object.keys(Settings.structure).find((id) => id !== current) ?? "general";
  content.open_category = alternate;
  content.open_category = current;
  content.$forceUpdate?.();

  const finish = () => ensureInlineTokenAction();
  const vue = getVueReactivity();
  if (vue && typeof vue.nextTick === "function") void vue.nextTick(finish);
  else finish();
}

function hookSettingsSidebar(sidebar: SettingsSidebar): void {
  if (hookedSidebar === sidebar) return;
  if (hookedSidebar) hookedSidebar.onPageSwitch = originalPageSwitch;

  hookedSidebar = sidebar;
  originalPageSwitch = sidebar.onPageSwitch;
  sidebar.onPageSwitch = function onCodexSettingsPageSwitch(page: string): unknown {
    const result = originalPageSwitch?.call(this, page);
    if (page === CATEGORY_ID && result !== false) {
      refreshSettingsCategory();
      invalidateVisibleSettingsList();
    }
    return result;
  };
}

/**
 * Reconcile the settings dialog once Blockbench's Vue setup has completed.
 * This is intentionally public so the cold-start order can be regression
 * tested without relying on timing.
 */
export function reconcileSettingsDialog(): boolean {
  const dialog = getSettingsDialog();
  if (!dialog?.sidebar || !dialog.content_vue) return false;

  refreshSettingsCategory();
  hookSettingsSidebar(dialog.sidebar);
  invalidateVisibleSettingsList();
  return true;
}

function scheduleSettingsDialogReconciliation(): void {
  if (reconcileSettingsDialog() || settingsReadyTimer) return;

  let attempts = 0;
  settingsReadyTimer = setInterval(() => {
    attempts += 1;
    if (reconcileSettingsDialog() || attempts >= 300) {
      clearInterval(settingsReadyTimer);
      settingsReadyTimer = undefined;
    }
  }, 100);
}

function repairSettingsUiFromDom(): void {
  const dialog = getSettingsDialog();
  if (dialog?.sidebar && hookedSidebar !== dialog.sidebar) {
    reconcileSettingsDialog();
  } else if (
    dialog?.content_vue?.open_category === CATEGORY_ID &&
    typeof document !== "undefined" &&
    !document.querySelector("dialog#settings #settingslist li")
  ) {
    refreshSettingsCategory();
    invalidateVisibleSettingsList();
  }
  ensureInlineTokenAction();
}

function removeSettingsCategory(): void {
  reactiveDelete(Settings.structure, CATEGORY_ID);

  const sidebar = getSettingsSidebar();
  if (sidebar?.pages[CATEGORY_ID]) {
    reactiveDelete(sidebar.pages, CATEGORY_ID);
    if (sidebar.node?.isConnected) rebuildSettingsSidebar(sidebar);
  }
}

function addSetting(id: string, options: SettingOptions): Setting {
  const setting = new Setting(id, {
    ...options,
    category: CATEGORY_ID,
  });

  // The page already identifies its owner. Removing the per-row plugin badge
  // restores Blockbench's normal settings alignment.
  setting.plugin = undefined;
  settings.push(setting);
  return setting;
}

function regenerateMcpAuthToken(): void {
  settings.find((setting) => setting.id === MCP_AUTH_TOKEN_SETTING)?.set(createMcpAuthToken());
  Blockbench.showQuickMessage(tl("mcp.settings.token_regenerated"), 3000);
}

function ensureInlineTokenAction(): void {
  if (typeof document === "undefined") return;
  const input = document.getElementById(`setting_${MCP_AUTH_TOKEN_SETTING}`);
  const row = input?.closest("li");
  if (!input || !row || row.querySelector(`.${TOKEN_ACTION_CLASS}`)) return;

  const action = document.createElement("div");
  action.className = `password_toggle tool ${TOKEN_ACTION_CLASS}`;
  action.setAttribute("role", "button");
  action.setAttribute("tabindex", "0");
  action.setAttribute("aria-label", tl("mcp.settings.regenerate_token_name"));
  action.title = tl("mcp.settings.regenerate_token_desc");

  const icon = document.createElement("i");
  icon.className = "material-icons";
  icon.textContent = "refresh";
  action.appendChild(icon);

  const activate = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
    regenerateMcpAuthToken();
  };
  action.addEventListener("click", activate);
  action.addEventListener("keydown", (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") activate(event);
  });

  const visibilityAction = row.querySelector(".password_toggle");
  if (visibilityAction) visibilityAction.insertAdjacentElement("afterend", action);
  else row.appendChild(action);
}

function settingsUiSetup(): void {
  scheduleSettingsDialogReconciliation();
  if (typeof document === "undefined") return;

  if (!settingsStyle && typeof Blockbench !== "undefined" && Blockbench.addCSS) {
    settingsStyle = Blockbench.addCSS(settingsCSS);
  }
  reconcileSettingsDialog();
  ensureInlineTokenAction();

  if (!settingsObserver && typeof MutationObserver !== "undefined") {
    settingsObserver = new MutationObserver(repairSettingsUiFromDom);
    settingsObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "open"],
    });
  }
}

function settingsUiTeardown(): void {
  if (settingsReadyTimer) clearInterval(settingsReadyTimer);
  settingsReadyTimer = undefined;
  if (hookedSidebar) hookedSidebar.onPageSwitch = originalPageSwitch;
  hookedSidebar = undefined;
  originalPageSwitch = undefined;
  settingsObserver?.disconnect();
  settingsObserver = undefined;
  settingsStyle?.delete();
  settingsStyle = undefined;
  if (typeof document !== "undefined") {
    document.querySelectorAll(`.${TOKEN_ACTION_CLASS}`).forEach((element) => element.remove());
  }
}

function warnForNonLoopbackHost(value: unknown): void {
  const host = normalizeMcpBindHost(value);
  if (isLoopbackMcpHost(host)) return;
  const hasToken = Boolean(String(Settings.get(MCP_AUTH_TOKEN_SETTING) ?? "").trim());
  Blockbench.showMessageBox({
    title: tl("mcp.settings.bind_host_warning_title"),
    message: tl(
      hasToken
        ? "mcp.settings.bind_host_warning_message"
        : "mcp.settings.bind_host_without_auth_warning_message",
      [host]
    ),
    icon: "warning",
    buttons: ["dialog.ok"],
  });
}

function warnForMissingAuthToken(value: unknown): void {
  if (String(value ?? "").trim()) return;
  const host = normalizeMcpBindHost(Settings.get(MCP_BIND_HOST_SETTING));
  Blockbench.showMessageBox({
    title: tl("mcp.settings.auth_disabled_warning_title"),
    message: tl(
      isLoopbackMcpHost(host)
        ? "mcp.settings.auth_disabled_warning_message"
        : "mcp.settings.auth_disabled_network_warning_message",
      [host]
    ),
    icon: "warning",
    buttons: ["dialog.ok"],
  });
}

export function settingsSetup(): void {
  if (settings.length > 0 || openSettingsAction) return;
  ensureSettingsCategory();

  addSetting(MCP_BIND_HOST_SETTING, {
    name: tl("mcp.settings.bind_host_name"),
    description: tl("mcp.settings.bind_host_desc"),
    type: "text",
    value: DEFAULT_MCP_BIND_HOST,
    icon: "lan",
    onChange: warnForNonLoopbackHost,
  });
  addSetting("codex_mcp_port", {
    name: tl("mcp.settings.port_name"),
    description: tl("mcp.settings.port_desc"),
    type: "number",
    value: DEFAULT_MCP_PORT,
    min: MIN_MCP_PORT,
    max: MAX_MCP_PORT,
    step: 1,
    icon: "numbers",
  });
  addSetting("codex_mcp_endpoint", {
    name: tl("mcp.settings.endpoint_name"),
    description: tl("mcp.settings.endpoint_desc"),
    type: "text",
    value: DEFAULT_MCP_ENDPOINT,
    icon: "webhook",
  });
  addSetting(MCP_AUTH_TOKEN_SETTING, {
    name: tl("mcp.settings.auth_token_name"),
    description: tl("mcp.settings.auth_token_desc"),
    type: "password",
    value: getInitialMcpAuthToken(),
    icon: "key",
    onChange: warnForMissingAuthToken,
  });
  addSetting("codex_mcp_session_timeout", {
    name: tl("mcp.settings.session_timeout_name"),
    description: tl("mcp.settings.session_timeout_desc"),
    type: "number",
    value: DEFAULT_SESSION_TIMEOUT_MINUTES,
    min: 1,
    max: MAX_SESSION_TIMEOUT_MINUTES,
    step: 1,
    icon: "timer",
  });
  addSetting("codex_mcp_sse_heartbeat", {
    name: tl("mcp.settings.sse_heartbeat_name"),
    description: tl("mcp.settings.sse_heartbeat_desc"),
    type: "number",
    value: DEFAULT_SSE_HEARTBEAT_SECONDS,
    min: 0,
    max: MAX_SSE_HEARTBEAT_SECONDS,
    step: 1,
    icon: "favorite",
  });

  addSetting("codex_mcp_audit_retention", {
    name: tl("mcp.settings.audit_retention_name"),
    description: tl("mcp.settings.audit_retention_desc", [MAX_AUDIT_RETENTION]),
    type: "number",
    value: DEFAULT_AUDIT_RETENTION,
    min: MIN_AUDIT_RETENTION,
    max: MAX_AUDIT_RETENTION,
    step: 100,
    icon: "inventory_2",
    onChange: () => auditManager.settingsChanged(),
  });
  addSetting("codex_mcp_audit_page_size", {
    name: tl("mcp.settings.audit_page_size_name"),
    description: tl("mcp.settings.audit_page_size_desc"),
    type: "select",
    value: "25",
    options: {
      "25": tl("mcp.settings.audit_page_size_option", [25]),
      "50": tl("mcp.settings.audit_page_size_option", [50]),
      "100": tl("mcp.settings.audit_page_size_option", [100]),
    },
    icon: "view_list",
    onChange: () => auditManager.settingsChanged(),
  });
  addSetting("codex_mcp_audit_default_scope", {
    name: tl("mcp.settings.audit_scope_name"),
    description: tl("mcp.settings.audit_scope_desc"),
    type: "select",
    value: "current",
    options: {
      current: tl("mcp.settings.audit_scope_current"),
      all: tl("mcp.settings.audit_scope_all"),
    },
    icon: "view_in_ar",
    onChange: () => auditManager.settingsChanged(),
  });
  addSetting("codex_mcp_audit_default_source", {
    name: tl("mcp.settings.audit_source_name"),
    description: tl("mcp.settings.audit_source_desc"),
    type: "select",
    value: "mcp",
    options: {
      mcp: tl("mcp.settings.audit_source_mcp"),
      all: tl("mcp.settings.audit_source_all"),
    },
    icon: "filter_alt",
    onChange: () => auditManager.settingsChanged(),
  });
  addSetting("codex_mcp_audit_record_manual", {
    name: tl("mcp.settings.audit_manual_name"),
    description: tl("mcp.settings.audit_manual_desc"),
    type: "toggle",
    value: true,
    icon: "front_hand",
    onChange: () => auditManager.settingsChanged(),
  });

  refreshSettingsCategory();
  settingsUiSetup();

  openSettingsAction = new Action("codex_blockbench_mcp_open_settings", {
    name: tl("mcp.settings.open_action"),
    description: tl("mcp.settings.open_action_desc"),
    icon: "settings",
    click: () => {
      const category = Settings.structure[CATEGORY_ID];
      if (category) category.open = true;
      Settings.openDialog();
      reconcileSettingsDialog();
      getSettingsSidebar()?.setPage?.(CATEGORY_ID);
    },
  });
  MenuBar.menus.tools.addAction(openSettingsAction);
}

export function settingsTeardown(): void {
  settingsUiTeardown();
  openSettingsAction?.delete();
  openSettingsAction = undefined;
  settings.splice(0).forEach((setting) => setting.delete());
  removeSettingsCategory();
}
