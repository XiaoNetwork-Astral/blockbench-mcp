export const DEFAULT_MCP_PORT = 3000;
export const MIN_MCP_PORT = 1024;
export const MAX_MCP_PORT = 65_535;
export const DEFAULT_MCP_BIND_HOST = "127.0.0.1";
export const MCP_BIND_HOST_SETTING = "codex_mcp_bind_host";
export const DEFAULT_MCP_ENDPOINT = "/bb-mcp";
export const MCP_AUTH_TOKEN_SETTING = "codex_mcp_auth_token";
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 30;
export const MAX_SESSION_TIMEOUT_MINUTES = 1_440;
export const DEFAULT_SSE_HEARTBEAT_SECONDS = 15;
export const MAX_SSE_HEARTBEAT_SECONDS = 600;
export const DEFAULT_AUDIT_RETENTION = 10_000;
export const MIN_AUDIT_RETENTION = 100;
export const MAX_AUDIT_RETENTION = 50_000;

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
  const stored = String(Settings.stored?.[MCP_AUTH_TOKEN_SETTING] || "").trim();
  return isValidMcpAuthToken(stored) ? stored : createMcpAuthToken();
}

export function normalizeMcpAuthToken(value: unknown): string {
  return String(value ?? "").trim();
}

export function getMcpAuthToken(): string {
  // An empty value explicitly disables HTTP authentication. New installs
  // still receive a generated default, but clearing the field is respected
  // instead of silently creating and persisting a replacement token.
  return normalizeMcpAuthToken(Settings.get(MCP_AUTH_TOKEN_SETTING));
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
  return numericSetting("codex_mcp_port", DEFAULT_MCP_PORT, MIN_MCP_PORT, MAX_MCP_PORT);
}

export function getMcpEndpoint(): string {
  const configured = String(Settings.get("codex_mcp_endpoint") || "").trim();
  const endpoint = configured.startsWith("/") ? configured : `/${configured}`;
  return /^\/[^\s?#]*$/.test(endpoint) && endpoint !== "/" ? endpoint : DEFAULT_MCP_ENDPOINT;
}

export function getSessionTimeoutMinutes(): number {
  return numericSetting(
    "codex_mcp_session_timeout",
    DEFAULT_SESSION_TIMEOUT_MINUTES,
    1,
    MAX_SESSION_TIMEOUT_MINUTES
  );
}

export function getSseHeartbeatSeconds(): number {
  return numericSetting(
    "codex_mcp_sse_heartbeat",
    DEFAULT_SSE_HEARTBEAT_SECONDS,
    0,
    MAX_SSE_HEARTBEAT_SECONDS
  );
}

export function getAuditRetention(): number {
  return numericSetting(
    "codex_mcp_audit_retention",
    DEFAULT_AUDIT_RETENTION,
    MIN_AUDIT_RETENTION,
    MAX_AUDIT_RETENTION
  );
}

export function getAuditPageSize(): 25 | 50 | 100 {
  const value = Number(Settings.get("codex_mcp_audit_page_size"));
  return value === 50 || value === 100 ? value : 25;
}

export function getAuditDefaultScope(): "current" | "all" {
  return Settings.get("codex_mcp_audit_default_scope") === "all" ? "all" : "current";
}

export function getAuditDefaultSource(): "mcp" | "all" {
  return Settings.get("codex_mcp_audit_default_source") === "all" ? "all" : "mcp";
}

export function getAuditRecordManual(): boolean {
  return Settings.get("codex_mcp_audit_record_manual") !== false;
}
