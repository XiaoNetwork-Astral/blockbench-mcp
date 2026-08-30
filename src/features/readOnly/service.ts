/// <reference types="blockbench-types" />

const STORAGE_KEY = "blockbench_mcp.read_only_projects";
const RETIRED_ROLE_STORAGE_KEYS = [
  "blockbench_mcp.project_roles",
  "codex_blockbench_mcp.project_roles",
] as const;
const RETIRED_WORKFLOW_STORAGE_KEYS = [
  "blockbench_mcp.ysm_workflow.v1",
  "codex_blockbench_mcp.ysm_workflow.v1",
] as const;
const RETIRED_PROTECTED_ROLES = new Set([
  "legacy_reference",
  "new_baseline",
  "reference",
  "manual",
]);

type StoredLocks = Record<string, true>;

const activeLocks = new WeakMap<ModelProject, boolean>();
const listeners = new Set<(project: ModelProject) => void>();
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

function consumeRetiredWorkflowState(storage: Storage): {
  locks: StoredLocks;
  found: boolean;
} {
  const migrated: StoredLocks = {};
  let found = false;
  for (const legacyKey of RETIRED_ROLE_STORAGE_KEYS) {
    const raw = storage.getItem(legacyKey);
    if (raw === null) continue;
    found = true;
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          const record = value && typeof value === "object"
            ? value as { readOnly?: unknown; role?: unknown }
            : null;
          if (
            value === true ||
            record?.readOnly === true ||
            (typeof record?.role === "string" && RETIRED_PROTECTED_ROLES.has(record.role))
          ) {
            migrated[key] = true;
          }
        }
      }
    } catch {
      // A malformed retired record contains no recoverable lock.
    }
    storage.removeItem(legacyKey);
  }
  for (const legacyKey of RETIRED_WORKFLOW_STORAGE_KEYS) {
    if (storage.getItem(legacyKey) === null) continue;
    found = true;
    storage.removeItem(legacyKey);
  }
  return { locks: migrated, found };
}

function loadLocks(): StoredLocks {
  const storage = globalThis.localStorage;
  if (!storage) return {};
  if (cachedStorage === storage && cachedLocks) return cachedLocks;

  cachedStorage = storage;
  const current = storage.getItem(STORAGE_KEY);
  const retired = consumeRetiredWorkflowState(storage);
  cachedLocks = {
    ...retired.locks,
    ...parseLocks(current),
  };
  if (current === null || retired.found) {
    storage.setItem(STORAGE_KEY, JSON.stringify(cachedLocks));
  }
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
  for (const listener of listeners) listener(project);
}

export function subscribeProjectReadOnly(
  listener: (project: ModelProject) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
