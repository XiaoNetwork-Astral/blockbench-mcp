export const DEFAULT_MCP_PORT = 3000;
export const MIN_MCP_PORT = 1024;
export const MAX_MCP_PORT = 65_535;
export const DEFAULT_MCP_BIND_HOST = "127.0.0.1";
export const MCP_BIND_HOST_SETTING = "blockbench_mcp_bind_host";
export const DEFAULT_MCP_ENDPOINT = "/bb-mcp";
export const MCP_PORT_SETTING = "blockbench_mcp_port";
export const MCP_ENDPOINT_SETTING = "blockbench_mcp_endpoint";
export const MCP_AUTH_ENABLED_SETTING = "blockbench_mcp_auth_enabled";
export const MCP_AUTH_TOKEN_SETTING = "blockbench_mcp_auth_token";
export const PLUGIN_WORKSPACE_SETTING = "blockbench_mcp_plugin_workspace";
export const MCP_SESSION_TIMEOUT_SETTING = "blockbench_mcp_session_timeout";
export const MCP_SSE_HEARTBEAT_SETTING = "blockbench_mcp_sse_heartbeat";
export const MCP_AUDIT_RETENTION_SETTING = "blockbench_mcp_audit_retention";
export const MCP_AUDIT_PAGE_SIZE_SETTING = "blockbench_mcp_audit_page_size";
export const MCP_AUDIT_DEFAULT_SCOPE_SETTING = "blockbench_mcp_audit_default_scope";
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
export const MAX_SESSION_TIMEOUT_MINUTES = 1_440;
export const DEFAULT_SSE_HEARTBEAT_SECONDS = 15;
export const MAX_SSE_HEARTBEAT_SECONDS = 600;
export const DEFAULT_AUDIT_RETENTION = 10_000;
export const MIN_AUDIT_RETENTION = 100;
export const MAX_AUDIT_RETENTION = 50_000;

/**
 * Blockbench persists each setting as `{ value: ... }`, while older test
 * doubles and a few historical builds exposed the raw value directly.
 * Accept both shapes so startup helpers never turn a stored object into the
 * literal string "[object Object]".
 */
export function getStoredSettingValue(id: string): unknown {
  const stored = (
    Settings as unknown as { stored?: Record<string, unknown> }
  ).stored?.[id];
  if (stored && typeof stored === "object" && "value" in stored) {
    return (stored as { value: unknown }).value;
  }
  return stored;
}

function numericSetting(id: string, fallback: number, minimum: number, maximum: number): number {
  const configured = Number(Settings.get(id));
  if (!Number.isFinite(configured)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(configured)));
}

export function isValidMcpAuthToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

export function createMcpAuthToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function getInitialMcpAuthToken(): string {
  const stored = String(getStoredSettingValue(MCP_AUTH_TOKEN_SETTING) ?? "").trim();
  return isValidMcpAuthToken(stored) ? stored : createMcpAuthToken();
}

export function normalizeMcpAuthToken(value: unknown): string {
  return String(value ?? "").trim();
}

export function getMcpAuthEnabled(): boolean {
  return Settings.get(MCP_AUTH_ENABLED_SETTING) !== false;
}

export function getMcpAuthToken(): string {
  // Keep the token stored while authentication is disabled so switching it
  // back on does not unexpectedly invalidate the client's configuration.
  return getMcpAuthEnabled()
    ? normalizeMcpAuthToken(Settings.get(MCP_AUTH_TOKEN_SETTING))
    : "";
}

export function normalizeMcpBindHost(value: unknown): string {
  let host = String(value ?? "").trim();
  if (host === "*") return "0.0.0.0";
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);

  // The setting accepts a host/address only, not a URL or host:port pair.
  // Node's net.Server handles DNS names and IPv4/IPv6 literals for us.
  const colonCount = (host.match(/:/g) ?? []).length;
  if (
    !host ||
    host.length > 253 ||
    /[\s/?#@]/.test(host) ||
    (colonCount === 1 && /:\d+$/.test(host))
  ) {
    return DEFAULT_MCP_BIND_HOST;
  }
  return host;
}

export function getMcpBindHost(): string {
  return normalizeMcpBindHost(Settings.get(MCP_BIND_HOST_SETTING));
}

export function formatMcpHostForUrl(host: string): string {
  const normalized = normalizeMcpBindHost(host);
  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

export function getMcpPort(): number {
  return numericSetting(MCP_PORT_SETTING, DEFAULT_MCP_PORT, MIN_MCP_PORT, MAX_MCP_PORT);
}

export function getMcpEndpoint(): string {
  const configured = String(Settings.get(MCP_ENDPOINT_SETTING) || "").trim();
  const endpoint = configured.startsWith("/") ? configured : `/${configured}`;
  return /^\/[^\s?#]*$/.test(endpoint) && endpoint !== "/" ? endpoint : DEFAULT_MCP_ENDPOINT;
}

export function getSessionTimeoutMinutes(): number {
  return numericSetting(
    MCP_SESSION_TIMEOUT_SETTING,
    DEFAULT_SESSION_TIMEOUT_MINUTES,
    1,
    MAX_SESSION_TIMEOUT_MINUTES
  );
}

export function getSseHeartbeatSeconds(): number {
  return numericSetting(
    MCP_SSE_HEARTBEAT_SETTING,
    DEFAULT_SSE_HEARTBEAT_SECONDS,
    0,
    MAX_SSE_HEARTBEAT_SECONDS
  );
}

export function getAuditRetention(): number {
  return numericSetting(
    MCP_AUDIT_RETENTION_SETTING,
    DEFAULT_AUDIT_RETENTION,
    MIN_AUDIT_RETENTION,
    MAX_AUDIT_RETENTION
  );
}

export function getAuditPageSize(): 25 | 50 | 100 {
  const value = Number(Settings.get(MCP_AUDIT_PAGE_SIZE_SETTING));
  return value === 50 || value === 100 ? value : 25;
}

export function getAuditDefaultScope(): "current" | "all" {
  return Settings.get(MCP_AUDIT_DEFAULT_SCOPE_SETTING) === "all" ? "all" : "current";
}
