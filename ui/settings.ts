import { auditManager } from "@/lib/audit";
import { PLUGIN_ID } from "@/lib/constants";
import {
  DEFAULT_AUDIT_RETENTION,
  DEFAULT_MCP_ENDPOINT,
  DEFAULT_MCP_PORT,
  DEFAULT_SESSION_TIMEOUT_MINUTES,
  DEFAULT_SSE_HEARTBEAT_SECONDS,
  MAX_AUDIT_RETENTION,
  MAX_MCP_PORT,
  MAX_SESSION_TIMEOUT_MINUTES,
  MAX_SSE_HEARTBEAT_SECONDS,
  MIN_AUDIT_RETENTION,
  MIN_MCP_PORT,
  MCP_AUTH_TOKEN_SETTING,
  createMcpAuthToken,
  getInitialMcpAuthToken,
  getMcpAuthToken,
  getMcpEndpoint,
  getMcpPort,
} from "@/lib/pluginSettings";

const CATEGORY_ID = PLUGIN_ID;
const settings: Setting[] = [];
let openSettingsAction: Action | undefined;

type SettingsSidebar = {
  pages: Record<string, string>;
  build?: () => void;
};

function getSettingsSidebar(): SettingsSidebar | undefined {
  return (
    Settings as unknown as {
      dialog?: { sidebar?: SettingsSidebar };
    }
  ).dialog?.sidebar;
}

/**
 * Reconcile both halves of Blockbench's settings category state.
 *
 * Settings.addCategory() writes to Settings.structure and to the dialog
 * sidebar. Older plugin builds only removed the structure entry on unload,
 * which could leave behind a selectable but empty sidebar page. Reusing or
 * recreating the category through this helper repairs that stale state.
 */
function ensureSettingsCategory(): void {
  const name = tl("mcp.settings.category_name");
  const category = Settings.structure[CATEGORY_ID];

  if (!category) {
    // Installed plugins are loaded before Blockbench's onVueSetup phase on a
    // cold start. Settings.addCategory() unconditionally dereferences
    // Settings.dialog.sidebar, but Settings.dialog is still null at that
    // point. Populate the structure directly during early startup; the
    // settings window will build its sidebar from this structure later.
    if (getSettingsSidebar()) {
      Settings.addCategory(CATEGORY_ID, { name, open: false });
    } else {
      Settings.structure[CATEGORY_ID] = { name, open: false, items: {} };
    }
    return;
  }

  category.name = name;
  if (!category.items) category.items = {};

  const sidebar = getSettingsSidebar();
  if (sidebar) {
    sidebar.pages[CATEGORY_ID] = name;
    sidebar.build?.();
  }
}

function removeSettingsCategory(): void {
  delete Settings.structure[CATEGORY_ID];

  const sidebar = getSettingsSidebar();
  if (sidebar?.pages[CATEGORY_ID]) {
    delete sidebar.pages[CATEGORY_ID];
    sidebar.build?.();
  }
}

function addSetting(id: string, options: SettingOptions): void {
  settings.push(
    new Setting(id, {
      ...options,
      category: CATEGORY_ID,
    })
  );
}

export function settingsSetup(): void {
  if (settings.length > 0 || openSettingsAction) return;
  ensureSettingsCategory();

  addSetting("codex_mcp_instructions", {
    name: tl("mcp.settings.instructions_name"),
    description: tl("mcp.settings.instructions_desc"),
    type: "text",
    value:
      "Follow the YSM three-tab workflow: compare legacy and new baselines, edit only working_copy, self-check before asking the user, and merge only after explicit approval. Never switch animation or pose unless the user asks.",
    icon: "psychology",
    requires_restart: true,
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
    requires_restart: true,
  });
  addSetting("codex_mcp_endpoint", {
    name: tl("mcp.settings.endpoint_name"),
    description: tl("mcp.settings.endpoint_desc"),
    type: "text",
    value: DEFAULT_MCP_ENDPOINT,
    icon: "webhook",
    requires_restart: true,
  });
  addSetting(MCP_AUTH_TOKEN_SETTING, {
    name: tl("mcp.settings.auth_token_name"),
    description: tl("mcp.settings.auth_token_desc"),
    type: "password",
    value: getInitialMcpAuthToken(),
    icon: "key",
    requires_restart: true,
  });
  addSetting("codex_mcp_copy_connection", {
    name: tl("mcp.settings.copy_connection_name"),
    description: tl("mcp.settings.copy_connection_desc"),
    type: "click",
    icon: "content_copy",
    click: () => {
      const connection = [
        "[mcp_servers.blockbench]",
        `url = \"http://127.0.0.1:${getMcpPort()}${getMcpEndpoint()}\"`,
        `http_headers = { Authorization = \"Bearer ${getMcpAuthToken()}\" }`,
      ].join("\n");
      void navigator.clipboard.writeText(connection).then(
        () => Blockbench.showQuickMessage(tl("mcp.settings.connection_copied"), 2500),
        () => Blockbench.showQuickMessage(tl("mcp.dialog.copy_failed"), 2500)
      );
    },
  });
  addSetting("codex_mcp_regenerate_auth_token", {
    name: tl("mcp.settings.regenerate_token_name"),
    description: tl("mcp.settings.regenerate_token_desc"),
    type: "click",
    icon: "refresh",
    click: () => {
      settings.find((setting) => setting.id === MCP_AUTH_TOKEN_SETTING)?.set(createMcpAuthToken());
      Blockbench.showQuickMessage(tl("mcp.settings.token_regenerated"), 3000);
    },
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
    requires_restart: true,
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
    requires_restart: true,
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

  openSettingsAction = new Action("codex_blockbench_mcp_open_settings", {
    name: tl("mcp.settings.open_action"),
    description: tl("mcp.settings.open_action_desc"),
    icon: "settings",
    click: () => {
      const category = Settings.structure[CATEGORY_ID];
      if (category) category.open = true;
      Settings.openDialog();
    },
  });
  MenuBar.menus.tools.addAction(openSettingsAction);
}

export function settingsTeardown(): void {
  openSettingsAction?.delete();
  openSettingsAction = undefined;
  settings.splice(0).forEach((setting) => setting.delete());
  removeSettingsCategory();
}
