import {
  LEGACY_YSM_BINDINGS_STORAGE_KEY,
  readMigratedStorageItem,
} from "@/lib/brandingMigration";

const STORAGE_KEY = "blockbench_mcp.ysm_bindings";

export interface YsmBinding {
  geometry: string;
  geometryIdentifier: string | null;
  texture: string | null;
  /** Exact project-local texture identity; absent only on bindings from pre-.36 builds. */
  textureUuid?: string | null;
  bbmodel: string | null;
  bbmodelSha256: string | null;
  sourceSha256: string;
  textureSha256: string | null;
  /** Optional manifest and source hashes added by the blockbench.38 Molang surface. */
  manifest?: string | null;
  manifestSha256?: string | null;
  molangDocuments?: Array<{
    path: string;
    kind: "manifest" | "animation" | "controller" | "function";
    sha256: string;
  }>;
  projectName: string;
  projectUuid: string;
  projectSavePath: string | null;
  updatedAt: string;
}

type StoredBindings = Record<string, YsmBinding>;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function projectKey(project: ModelProject): string {
  return project.save_path
    ? `path:${normalizePath(project.save_path)}`
    : `uuid:${project.uuid}`;
}

function load(): StoredBindings {
  try {
    const raw = readMigratedStorageItem(localStorage, STORAGE_KEY, [
      LEGACY_YSM_BINDINGS_STORAGE_KEY,
    ]);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredBindings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function save(bindings: StoredBindings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
}

export function getYsmBinding(project: ModelProject): YsmBinding | null {
  return load()[projectKey(project)] ?? null;
}

export function setYsmBinding(project: ModelProject, binding: YsmBinding): void {
  const bindings = load();
  bindings[projectKey(project)] = binding;
  save(bindings);
}

export function removeYsmBinding(project: ModelProject): void {
  const bindings = load();
  delete bindings[projectKey(project)];
  save(bindings);
}

export function listYsmBindings(): StoredBindings {
  return load();
}
