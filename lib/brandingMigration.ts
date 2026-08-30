import {
  MCP_AUDIT_DEFAULT_SCOPE_SETTING,
  MCP_AUDIT_PAGE_SIZE_SETTING,
  MCP_AUDIT_RETENTION_SETTING,
  MCP_AUTH_ENABLED_SETTING,
  MCP_AUTH_TOKEN_SETTING,
  MCP_BIND_HOST_SETTING,
  MCP_ENDPOINT_SETTING,
  MCP_PORT_SETTING,
  PLUGIN_WORKSPACE_SETTING,
} from "@/lib/pluginSettings";

export const LEGACY_PLUGIN_ID = "codex_blockbench_mcp";
export const LEGACY_AUDIT_DATABASE_NAME = "codex_blockbench_mcp_audit";
export const LEGACY_YSM_BINDINGS_STORAGE_KEY = "codex_blockbench_mcp.ysm_bindings";
export const LEGACY_PLUGIN_WORKSPACE_SETTING = "codex_mcp_temporary_directory";
export const LEGACY_PLUGIN_WORKSPACE_STORAGE_KEY = "codex_blockbench_mcp.ysm_workspace";

export const LEGACY_SETTING_ID_MAP: Readonly<Record<string, string>> = {
  codex_mcp_bind_host: MCP_BIND_HOST_SETTING,
  codex_mcp_port: MCP_PORT_SETTING,
  codex_mcp_endpoint: MCP_ENDPOINT_SETTING,
  codex_mcp_auth_enabled: MCP_AUTH_ENABLED_SETTING,
  codex_mcp_auth_token: MCP_AUTH_TOKEN_SETTING,
  codex_mcp_plugin_workspace: PLUGIN_WORKSPACE_SETTING,
  codex_mcp_audit_retention: MCP_AUDIT_RETENTION_SETTING,
  codex_mcp_audit_page_size: MCP_AUDIT_PAGE_SIZE_SETTING,
  codex_mcp_audit_default_scope: MCP_AUDIT_DEFAULT_SCOPE_SETTING,
};

/** Move known legacy keys without replacing an already configured new value. */
export function migrateRecordKeys(
  records: Record<string, unknown>,
  keyMap: Readonly<Record<string, string>> = LEGACY_SETTING_ID_MAP
): boolean {
  let changed = false;
  for (const [legacyKey, currentKey] of Object.entries(keyMap)) {
    if (!(legacyKey in records)) continue;
    if (!(currentKey in records)) records[currentKey] = records[legacyKey];
    delete records[legacyKey];
    changed = true;
  }
  return changed;
}

/** Read a current localStorage item, importing and removing its legacy copy once. */
export function readMigratedStorageItem(
  storage: Storage | undefined,
  currentKey: string,
  legacyKeys: readonly string[]
): string | null {
  if (!storage) return null;
  const current = storage.getItem(currentKey);
  if (current !== null) {
    legacyKeys.forEach((key) => storage.removeItem(key));
    return current;
  }
  for (const legacyKey of legacyKeys) {
    const legacy = storage.getItem(legacyKey);
    if (legacy === null) continue;
    storage.setItem(currentKey, legacy);
    legacyKeys.forEach((key) => storage.removeItem(key));
    return legacy;
  }
  return null;
}
