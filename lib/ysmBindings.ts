import {
  LEGACY_YSM_BINDINGS_STORAGE_KEY,
  readMigratedStorageItem,
} from "@/lib/brandingMigration";

const STORAGE_KEY = "blockbench_mcp.ysm_bindings";

export interface YsmBinding {
  /** Absolute workspace identity used to interpret every relative path in this binding. */
  workspaceRoot?: string;
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

export type YsmBindingWorkspaceState = "current" | "legacy" | "stale" | "unconfigured";

export interface YsmBindingPathStatus {
  kind: string;
  path: string;
  state: "valid" | "missing" | "outside_scope" | "unchecked";
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export function getYsmBindingWorkspaceState(
  binding: Pick<YsmBinding, "workspaceRoot">,
  currentWorkspaceRoot: string
): YsmBindingWorkspaceState {
  if (!currentWorkspaceRoot) return "unconfigured";
  if (!binding.workspaceRoot) return "legacy";
  return normalizePath(binding.workspaceRoot) === normalizePath(currentWorkspaceRoot)
    ? "current"
    : "stale";
}

export function getYsmBindingPathStates(
  binding: YsmBinding,
  currentWorkspaceRoot: string,
  fileExists: (path: string) => boolean
): YsmBindingPathStatus[] {
  const identity = getYsmBindingWorkspaceState(binding, currentWorkspaceRoot);
  const paths: Array<[string, string | null]> = [
    ["geometry", binding.geometry],
    ["texture", binding.texture],
    ["bbmodel", binding.bbmodel],
    ["manifest", binding.manifest ?? null],
    ...(binding.molangDocuments ?? []).map((document): [string, string] => [
      `molang:${document.kind}`,
      document.path,
    ]),
  ];

  return paths.flatMap<YsmBindingPathStatus>(([kind, path]) => {
    if (!path) return [];
    if (identity !== "current") return [{ kind, path, state: "unchecked" as const }];
    try {
      return [{ kind, path, state: fileExists(path) ? "valid" as const : "missing" as const }];
    } catch {
      return [{ kind, path, state: "outside_scope" as const }];
    }
  });
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
