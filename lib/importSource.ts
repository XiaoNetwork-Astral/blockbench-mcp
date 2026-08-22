export const MAX_GEOMETRY_JSON_BYTES = 5 * 1024 * 1024;

export type GeometryJsonSource =
  | { kind: "inline"; text: string }
  | { kind: "local_file"; path: string };

export function assertGeometryJsonSize(text: string): void {
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > MAX_GEOMETRY_JSON_BYTES) {
    throw new Error(
      `Geometry JSON is ${byteLength} bytes; the maximum accepted size is ${MAX_GEOMETRY_JSON_BYTES} bytes.`
    );
  }
}

function decodeJsonDataUrl(source: string): string {
  const commaIndex = source.indexOf(",");
  if (commaIndex < 0) throw new Error("Malformed JSON data URL: missing comma separator.");

  const metadata = source.slice(5, commaIndex).toLowerCase();
  const mimeType = metadata.split(";")[0];
  if (!["application/json", "application/geo+json", "text/json"].includes(mimeType)) {
    throw new Error(
      `Unsupported data URL media type "${mimeType || "(empty)"}". Use application/json, application/geo+json, or text/json.`
    );
  }

  const payload = source.slice(commaIndex + 1);
  let decoded: string;
  try {
    if (metadata.split(";").includes("base64")) {
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      decoded = new TextDecoder().decode(bytes);
    } else {
      decoded = decodeURIComponent(payload);
    }
  } catch (error) {
    throw new Error(
      `Could not decode JSON data URL: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  assertGeometryJsonSize(decoded);
  return decoded;
}

function fileUrlToPath(url: URL): string {
  const decodedPath = decodeURIComponent(url.pathname);
  if (url.hostname) return `//${url.hostname}${decodedPath}`;
  return /^\/[A-Za-z]:\//.test(decodedPath) ? decodedPath.slice(1) : decodedPath;
}

/**
 * Classify a geometry input without making any network or filesystem request.
 * HTTP(S) is deliberately unsupported so this import tool cannot become an
 * SSRF primitive inside the Blockbench desktop process.
 */
export function classifyGeometryJsonSource(input: string): GeometryJsonSource {
  const trimmed = input.trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    assertGeometryJsonSize(input);
    return { kind: "inline", text: input };
  }
  if (trimmed.startsWith("data:")) {
    return { kind: "inline", text: decodeJsonDataUrl(trimmed) };
  }
  if (/^[A-Za-z]:[\\/]/.test(input) || input.startsWith("\\\\")) {
    return { kind: "local_file", path: input };
  }

  let parsedUrl: URL | undefined;
  try {
    parsedUrl = new URL(input);
  } catch {
    // A normal desktop path is not necessarily a URL.
  }
  if (parsedUrl) {
    if (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:") {
      throw new Error(
        "Remote HTTP(S) geometry imports are disabled. Download the file yourself, then provide a local path or inline JSON."
      );
    }
    if (parsedUrl.protocol !== "file:") {
      throw new Error(
        `Unsupported geometry source protocol "${parsedUrl.protocol}". Use inline JSON, a JSON data URL, or a local file path.`
      );
    }
    return { kind: "local_file", path: fileUrlToPath(parsedUrl) };
  }

  if (!input.trim()) throw new Error("Geometry JSON source cannot be empty.");
  return { kind: "local_file", path: input };
}
