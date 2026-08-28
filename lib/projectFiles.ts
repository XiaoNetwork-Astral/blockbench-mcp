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
  const document = parsed as Record<string, unknown>;
  if (!document.meta || typeof document.meta !== "object") {
    throw new Error(`A .bbmodel document must contain project metadata: ${source}`);
  }
  return document;
}

export function portableBbmodelText(compiled: unknown): string {
  const input = typeof compiled === "string"
    ? compiled
    : compiled && typeof compiled === "object" && !(compiled instanceof ArrayBuffer)
      ? JSON.stringify(compiled)
      : null;
  if (!input) throw new Error("Blockbench returned no portable JSON .bbmodel content.");

  // Parse and clone so callers never mutate a codec-owned object while making
  // its serialized representation portable.
  const document = parseBbmodelText(input, "compiled project");
  const textures = Array.isArray(document.textures)
    ? document.textures as Array<Record<string, unknown>>
    : [];
  const textureUuids = new Set<string>();
  for (const texture of textures) {
    const uuid = typeof texture.uuid === "string" ? texture.uuid : "";
    if (!uuid) throw new Error("Portable .bbmodel texture is missing its UUID.");
    if (textureUuids.has(uuid)) {
      throw new Error(`Portable .bbmodel contains duplicated texture UUID "${uuid}".`);
    }
    textureUuids.add(uuid);

    const sourceEmbedded = typeof texture.source === "string"
      && /^data:image\//i.test(texture.source);
    const layers = Array.isArray(texture.layers)
      ? texture.layers as Array<Record<string, unknown>>
      : [];
    const layersEmbedded = layers.length > 0 && layers.every(
      (layer) => typeof layer.data_url === "string" && /^data:image\//i.test(layer.data_url)
    );
    if (!sourceEmbedded && !layersEmbedded) {
      throw new Error(
        `Texture "${String(texture.name ?? uuid)}" is not embedded; refusing to create a ` +
          "machine-dependent portable .bbmodel."
      );
    }

    texture.internal = true;
    texture.sync_to_project = "";
    delete texture.path;
    delete texture.relative_path;
  }
  return JSON.stringify(document);
}
