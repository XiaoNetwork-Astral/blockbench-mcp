export const MCP_LOOPBACK_HOST = "127.0.0.1";

const blockedToolNames = new Set([
  "risky_eval",
  "trigger_action",
  "emulate_clicks",
  "fill_dialog",
]);

/**
 * Reject tools that deliberately expose arbitrary code execution. Keeping the
 * check at the shared registration boundary prevents an upstream merge from
 * accidentally making the tool reachable again.
 */
export function assertToolRegistrationAllowed(name: string): void {
  if (blockedToolNames.has(name)) {
    throw new Error(`MCP tool "${name}" is permanently disabled by the local security policy.`);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/** Accept exactly one standard Bearer credential for every local HTTP request. */
export function isAuthorizedMcpRequest(
  headers: Readonly<Record<string, string>>,
  expectedToken: string
): boolean {
  if (!expectedToken) return false;
  const authorization = headers.authorization?.trim() ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return Boolean(match && constantTimeEqual(match[1], expectedToken));
}
