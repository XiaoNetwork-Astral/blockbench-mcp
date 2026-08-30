/** Whether a configured bind host is unambiguously local-only. */
export function isLoopbackMcpHost(host: string): boolean {
  const normalized = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (normalized === "localhost" || normalized === "localhost.localdomain") return true;
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  if (/^127(?:\.\d{1,3}){3}$/.test(normalized)) return true;
  return /^::ffff:127(?:\.\d{1,3}){3}$/.test(normalized);
}

function constantTimeEqual(left: string, right: string): boolean {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

/**
 * Accept exactly one standard Bearer credential when authentication is
 * configured. An intentionally empty token leaves the local server open;
 * callers surface a warning before starting it in that mode.
 */
export function isAuthorizedMcpRequest(
  headers: Readonly<Record<string, string>>,
  expectedToken: string
): boolean {
  if (!expectedToken) return true;
  const authorization = headers.authorization?.trim() ?? "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
  return Boolean(match && constantTimeEqual(match[1], expectedToken));
}
