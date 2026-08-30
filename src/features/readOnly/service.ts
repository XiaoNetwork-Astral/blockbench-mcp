/// <reference types="blockbench-types" />

const STORAGE_KEY = "blockbench_mcp.read_only_projects";
const LEGACY_STORAGE_KEYS = [
  "blockbench_mcp.project_roles",
  "codex_blockbench_mcp.project_roles",
] as const;

type StoredLocks = Record<string, true>;

const activeLocks = new WeakMap<ModelProject, boolean>();
let cachedStorage: Storage | undefined;
let cachedLocks: StoredLocks | undefined;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export function projectReadOnlyKey(project: ModelProject): string {
  return project.save_path
    ? `path:${normalizePath(project.save_path)}`
    : `uuid:${project.uuid}`;
}

function parseLocks(raw: string | null): StoredLocks {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([, value]) => value === true)
        .map(([key]) => [key, true] as const)
    );
  } catch {
    return {};
  }
}

function migrateLegacyLocks(storage: Storage): StoredLocks {
  const migrated: StoredLocks = {};
  for (const legacyKey of LEGACY_STORAGE_KEYS) {
    const raw = storage.getItem(legacyKey);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (
            value === true ||
            (value && typeof value === "object" && (value as { readOnly?: unknown }).readOnly === true)
          ) {
            migrated[key] = true;
          }
        }
      }
    } catch {
      // A malformed retired record contains no recoverable explicit locks.
    }
  }
  storage.setItem(STORAGE_KEY, JSON.stringify(migrated));
  // Workflow-role metadata still belongs to the role service. It will remove
  // legacy readOnly fields when that metadata is next rewritten.
  return migrated;
}

function loadLocks(): StoredLocks {
  const storage = globalThis.localStorage;
  if (!storage) return {};
  if (cachedStorage === storage && cachedLocks) return cachedLocks;

  cachedStorage = storage;
  const current = storage.getItem(STORAGE_KEY);
  cachedLocks = current === null ? migrateLegacyLocks(storage) : parseLocks(current);
  return cachedLocks;
}

function saveLocks(locks: StoredLocks): void {
  cachedStorage = globalThis.localStorage;
  cachedLocks = locks;
  cachedStorage?.setItem(STORAGE_KEY, JSON.stringify(locks));
}

export function isProjectReadOnly(project: ModelProject | null | undefined): boolean {
  if (!project) return false;
  const active = activeLocks.get(project);
  if (active !== undefined) return active;
  const locked = loadLocks()[projectReadOnlyKey(project)] === true;
  activeLocks.set(project, locked);
  return locked;
}

export function setProjectReadOnly(project: ModelProject, readOnly: boolean): void {
  const locks = { ...loadLocks() };
  const key = projectReadOnlyKey(project);
  if (readOnly) locks[key] = true;
  else delete locks[key];
  activeLocks.set(project, readOnly);
  saveLocks(locks);
}
