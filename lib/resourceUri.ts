/**
 * Helpers for building and resolving human-readable MCP resource URIs.
 *
 * A resource URI looks like `scope://<id>`. Historically `<id>` was always the
 * element UUID, which is opaque. These helpers prefer a slugified element name
 * when it is unique among its siblings, falling back to a slug~uuid8 suffix on
 * collision, or the raw UUID if the name is missing or unprintable.
 *
 * The resolution side (`findByResourceId`) accepts any of:
 *   - raw UUID
 *   - raw name (exact match)
 *   - slug of the name (case-insensitive)
 *   - slug~uuid8 format emitted on collision
 */

const SLUG_MAX_LENGTH = 40;
const UUID_DISAMBIGUATOR_LENGTH = 8;

/**
 * Normalizes a display name into a URI-safe slug.
 * Returns an empty string when the input has no URI-safe characters.
 */
export function slugify(name: string | null | undefined): string {
  if (!name) return "";
  const normalized = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, SLUG_MAX_LENGTH).replace(/-+$/g, "");
}

export interface INamedItem {
  uuid: string;
  name?: string | null;
}

/** Resolve a required UUID without ever falling back to a display name. */
export function findByExactUuid<T extends INamedItem>(
  items: readonly T[],
  uuid: string,
  kind = "Resource"
): T {
  const matches = items.filter((item) => item.uuid === uuid);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`${kind} UUID "${uuid}" is duplicated (${matches.length} matches).`);
  }
  throw new Error(`${kind} UUID "${uuid}" was not found.`);
}

/**
 * Builds a human-readable ID fragment for a resource item.
 *
 * Preference order:
 *   1. `<slug>` when the slug is non-empty and unique among siblings
 *   2. `<slug>~<uuid8>` when the slug collides with another sibling
 *   3. `<uuid>` when the name is missing or produces an empty slug
 *
 * Use `makeResourceUri` to also prepend a scope; use `makeResourceId`
 * directly when the URI template is path-style (e.g. `hytale://attachments/{id}`).
 */
export function makeResourceId(
  item: INamedItem,
  siblings: readonly INamedItem[]
): string {
  const duplicateUuidCount = siblings.reduce(
    (count, sibling) => (sibling.uuid === item.uuid ? count + 1 : count),
    0
  );
  if (duplicateUuidCount !== 1) {
    throw new Error(
      `Resource UUID "${item.uuid}" is duplicated (${duplicateUuidCount} matches). ` +
        "Repair the project before exposing this resource."
    );
  }
  const slug = slugify(item.name);
  if (!slug) return item.uuid;

  const collisionCount = siblings.reduce(
    (count, sibling) => (slugify(sibling.name) === slug ? count + 1 : count),
    0
  );

  if (collisionCount <= 1) {
    return slug;
  }

  const suffix = item.uuid.slice(0, UUID_DISAMBIGUATOR_LENGTH);
  return `${slug}~${suffix}`;
}

/**
 * Builds a `scope://<id>` URI using `makeResourceId`.
 * For path-style URIs, call `makeResourceId` directly and interpolate the result.
 */
export function makeResourceUri(
  scope: string,
  item: INamedItem,
  siblings: readonly INamedItem[]
): string {
  return `${scope}://${makeResourceId(item, siblings)}`;
}

/**
 * Resolves an ID fragment (from a URI variable) against a list of items.
 * Returns the first match, or undefined if nothing matches.
 */
export function findByResourceId<T extends INamedItem>(
  items: readonly T[],
  id: string | null | undefined
): T | undefined {
  if (!id) return undefined;

  const uuidMatches = items.filter((item) => item.uuid === id);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(`Resource UUID "${id}" is duplicated (${uuidMatches.length} matches).`);
  }

  const nameMatches = items.filter((item) => item.name === id);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Resource name "${id}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((item) => item.uuid).join(", ")}). Use a collision-qualified URI or UUID.`
    );
  }

  const tildeIndex = id.indexOf("~");
  if (tildeIndex > 0) {
    const slugPart = id.slice(0, tildeIndex).toLowerCase();
    const uuidPart = id.slice(tildeIndex + 1);
    const matches = items.filter(
      (item) =>
        slugify(item.name) === slugPart &&
        item.uuid.startsWith(uuidPart)
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Resource ID "${id}" is ambiguous (${matches.length} UUID-prefix matches). Use a full UUID.`
      );
    }
  }

  const slugLower = id.toLowerCase();
  const slugMatches = items.filter(
    (item) => item.name && slugify(item.name) === slugLower
  );
  if (slugMatches.length === 1) return slugMatches[0];
  if (slugMatches.length > 1) {
    throw new Error(
      `Resource slug "${id}" is ambiguous (${slugMatches.length} matches: ` +
        `${slugMatches.map((item) => item.uuid).join(", ")}). Use a collision-qualified URI or UUID.`
    );
  }
  return undefined;
}
