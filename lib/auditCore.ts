export type AuditSource = "mcp" | "user" | "panel" | "system";
export type AuditStatus = "running" | "success" | "error";

const REDACTED_KEY = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|access[_-]?key)/i;
const BULK_TEXT = /^(?:data:[^,]+,|[A-Za-z0-9+/]{512,}={0,2}$)/;

export interface SanitizeOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectKeys?: number;
  maxStringLength?: number;
}

const DEFAULT_SANITIZE_OPTIONS: Required<SanitizeOptions> = {
  maxDepth: 5,
  maxArrayItems: 40,
  maxObjectKeys: 60,
  maxStringLength: 2000,
};

function clippedText(value: string, maxLength: number): string {
  if (BULK_TEXT.test(value)) {
    return `[omitted binary/base64 payload: ${value.length} characters]`;
  }
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}… [${value.length - maxLength} characters omitted]`;
}

/**
 * Produces a JSON-safe audit representation. It deliberately redacts common
 * credential fields and replaces large binary/base64 payloads before they can
 * reach persistent browser storage.
 */
export function sanitizeForAudit(
  value: unknown,
  options: SanitizeOptions = {},
  depth = 0,
  seen = new WeakSet<object>()
): unknown {
  const config = { ...DEFAULT_SANITIZE_OPTIONS, ...options };

  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return clippedText(value, config.maxStringLength);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function") return `[function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (depth >= config.maxDepth) return "[maximum audit depth reached]";

  if (value instanceof Error) {
    return {
      name: value.name,
      message: clippedText(value.message, config.maxStringLength),
      stack: value.stack ? clippedText(value.stack, config.maxStringLength * 2) : undefined,
    };
  }

  if (ArrayBuffer.isView(value)) {
    return `[omitted binary view: ${value.byteLength} bytes]`;
  }
  if (value instanceof ArrayBuffer) {
    return `[omitted binary buffer: ${value.byteLength} bytes]`;
  }

  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular reference]";
  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, config.maxArrayItems)
      .map((item) => sanitizeForAudit(item, config, depth + 1, seen));
    if (value.length > config.maxArrayItems) {
      items.push(`[${value.length - config.maxArrayItems} items omitted]`);
    }
    return items;
  }

  const result: Record<string, unknown> = {};
  const entries = Object.entries(value as Record<string, unknown>);
  for (const [key, item] of entries.slice(0, config.maxObjectKeys)) {
    result[key] = REDACTED_KEY.test(key)
      ? "[redacted]"
      : sanitizeForAudit(item, config, depth + 1, seen);
  }
  if (entries.length > config.maxObjectKeys) {
    result.__omitted_keys__ = entries.length - config.maxObjectKeys;
  }
  return result;
}

export function stringifyAuditValue(value: unknown, maxLength = 16_384): string {
  let text: string;
  try {
    text = JSON.stringify(sanitizeForAudit(value), null, 2) ?? "null";
  } catch (error) {
    text = JSON.stringify({
      error: "Unable to serialize audit value",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n… [${text.length - maxLength} characters omitted]`;
}

export function summarizeAuditValue(value: unknown, maxLength = 260): string {
  const sanitized = sanitizeForAudit(value, {
    maxDepth: 2,
    maxArrayItems: 8,
    maxObjectKeys: 12,
    maxStringLength: 160,
  });
  let text: string;
  try {
    text = JSON.stringify(sanitized) ?? "";
  } catch {
    text = String(sanitized);
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

/** A compact deterministic hash used only to detect a changed Undo prefix. */
export function hashUndoPrefix(entryIds: readonly string[]): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (const id of entryIds) {
    for (let index = 0; index < id.length; index += 1) {
      const code = id.charCodeAt(index);
      first ^= code;
      first = Math.imul(first, 0x01000193);
      second ^= code + index;
      second = Math.imul(second, 0x85ebca6b);
    }
    first ^= 31;
    second ^= 127;
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

export interface UndoOwnership {
  source: AuditSource | "unknown";
  operationId?: string;
}

export interface TravelCheckInput {
  currentEntryIds: readonly string[];
  currentIndex: number;
  targetIndex: number;
  targetPrefixHash: string;
  ownership: ReadonlyMap<string, UndoOwnership>;
}

export interface TravelCheckResult {
  compatible: boolean;
  direction: "undo" | "redo" | "none";
  steps: number;
  traversedEntryIds: string[];
  unsafeEntryIds: string[];
  reason?: string;
}

/**
 * Validates that the native Undo branch still contains the requested state and
 * reports user/unknown edits that would be crossed while travelling to it.
 */
export function checkUndoTravel(input: TravelCheckInput): TravelCheckResult {
  const {
    currentEntryIds,
    currentIndex,
    targetIndex,
    targetPrefixHash,
    ownership,
  } = input;

  if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex > currentEntryIds.length) {
    return {
      compatible: false,
      direction: "none",
      steps: 0,
      traversedEntryIds: [],
      unsafeEntryIds: [],
      reason: "The requested restore point is no longer available.",
    };
  }

  if (hashUndoPrefix(currentEntryIds.slice(0, targetIndex)) !== targetPrefixHash) {
    return {
      compatible: false,
      direction: "none",
      steps: 0,
      traversedEntryIds: [],
      unsafeEntryIds: [],
      reason: "The model history branch has changed since this operation was recorded.",
    };
  }

  const direction = targetIndex < currentIndex ? "undo" : targetIndex > currentIndex ? "redo" : "none";
  const start = Math.min(currentIndex, targetIndex);
  const end = Math.max(currentIndex, targetIndex);
  const traversedEntryIds = currentEntryIds.slice(start, end);
  const unsafeEntryIds = traversedEntryIds.filter((entryId) => {
    const owner = ownership.get(entryId);
    return !owner || owner.source === "user" || owner.source === "unknown";
  });

  return {
    compatible: true,
    direction,
    steps: Math.abs(targetIndex - currentIndex),
    traversedEntryIds,
    unsafeEntryIds,
  };
}
