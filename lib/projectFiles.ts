export const MAX_BBMODEL_BYTES = 50 * 1024 * 1024;

function isAbsoluteLocalPath(path: string): boolean {
  return /^[a-z]:[\\/]/i.test(path) || /^\\\\/.test(path) || path.startsWith("/");
}

/** Normalize a user-supplied local .bbmodel path and reject remote sources. */
export function normalizeLocalBbmodelPath(input: string): string {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    throw new Error("Remote HTTP(S) .bbmodel loading is disabled; provide an absolute local path.");
  }
  let path = trimmed;
  if (/^file:\/\//i.test(path)) {
    try {
      const url = new URL(path);
      if (url.protocol !== "file:") throw new Error("not a file URL");
      path = decodeURIComponent(url.pathname);
      if (/^\/[a-z]:\//i.test(path)) path = path.slice(1);
      if (url.host) path = `//${url.host}${path}`;
    } catch (error) {
      throw new Error(
        `Invalid local file URL: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  if (!isAbsoluteLocalPath(path)) {
    throw new Error("A .bbmodel path must be absolute so the opened source is unambiguous.");
  }
  if (!/\.bbmodel$/i.test(path)) {
    throw new Error(`Project source must end in .bbmodel: "${path}".`);
  }
  return path;
}

export function parseBbmodelText(text: string, source: string): Record<string, unknown> {
  const size = new TextEncoder().encode(text).byteLength;
  if (size > MAX_BBMODEL_BYTES) {
    throw new Error(
      `.bbmodel exceeds the ${MAX_BBMODEL_BYTES} byte limit (${size} bytes): ${source}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid .bbmodel JSON at ${source}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`A .bbmodel document must contain a JSON object: ${source}`);
  }
  return parsed as Record<string, unknown>;
}

export function portableBbmodelText(compiled: unknown): string {
  if (typeof compiled === "string") {
    parseBbmodelText(compiled, "compiled project");
    return compiled;
  }
  if (compiled && typeof compiled === "object" && !(compiled instanceof ArrayBuffer)) {
    const text = JSON.stringify(compiled);
    parseBbmodelText(text, "compiled project");
    return text;
  }
  throw new Error("Blockbench returned no portable JSON .bbmodel content.");
}
