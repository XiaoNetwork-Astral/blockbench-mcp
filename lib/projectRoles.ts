import {
  LEGACY_PROJECT_ROLES_STORAGE_KEY,
  readMigratedStorageItem,
} from "@/lib/brandingMigration";

export const PROJECT_ROLES = [
  "unassigned",
  "legacy_reference",
  "new_baseline",
  "working_copy",
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

const STORAGE_KEY = "blockbench_mcp.project_roles";
const protectedRoles = new Set<ProjectRole>(["legacy_reference", "new_baseline"]);
const protectionListeners = new Set<(project: ModelProject) => void>();
const viewOnlyMutationTools = new Set([
  "edit_camera",
  "set_preview_state",
  "enter_display_mode",
]);

interface StoredProjectRole {
  role?: string;
  readOnly?: boolean;
  updatedAt: string;
}

type StoredProjectRoles = Record<string, StoredProjectRole>;

export interface ProjectProtectionState {
  role: ProjectRole;
  explicitReadOnly: boolean;
  roleProtected: boolean;
  readOnly: boolean;
}

let cachedStorage: Storage | undefined;
let cachedRoles: StoredProjectRoles | undefined;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export function getProjectRoleKey(project: ModelProject): string {
  if (project.save_path) return `path:${normalizePath(project.save_path)}`;
  return `uuid:${project.uuid}`;
}

function loadStoredRoles(): StoredProjectRoles {
  const storage = globalThis.localStorage;
  if (cachedStorage === storage && cachedRoles) return cachedRoles;
  cachedStorage = storage;
  if (!storage) return cachedRoles = {};
  try {
    const raw = readMigratedStorageItem(storage, STORAGE_KEY, [
      LEGACY_PROJECT_ROLES_STORAGE_KEY,
    ]);
    if (!raw) return cachedRoles = {};
    const parsed = JSON.parse(raw) as StoredProjectRoles;
    cachedRoles = parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    cachedRoles = {};
  }
  return cachedRoles;
}

function saveStoredRoles(roles: StoredProjectRoles): void {
  const storage = globalThis.localStorage;
  cachedStorage = storage;
  cachedRoles = roles;
  storage?.setItem(STORAGE_KEY, JSON.stringify(roles));
}

function normalizeRole(role?: string): ProjectRole {
  if (role === "reference") return "legacy_reference";
  if (role === "manual") return "new_baseline";
  if (role === "working" || role === "inspection") return "working_copy";
  return PROJECT_ROLES.includes(role as ProjectRole)
    ? (role as ProjectRole)
    : "unassigned";
}

function notifyProtectionChanged(project: ModelProject): void {
  for (const listener of protectionListeners) listener(project);
}

export function subscribeProjectProtection(
  listener: (project: ModelProject) => void
): () => void {
  protectionListeners.add(listener);
  return () => protectionListeners.delete(listener);
}

export function getProjectRole(project: ModelProject | null | undefined): ProjectRole {
  return getProjectProtectionState(project).role;
}

export function setProjectRole(project: ModelProject, role: ProjectRole): void {
  const roles = loadStoredRoles();
  const key = getProjectRoleKey(project);
  const existing = roles[key];
  if (role === "unassigned") {
    if (existing?.readOnly) {
      roles[key] = { readOnly: true, updatedAt: new Date().toISOString() };
    } else {
      delete roles[key];
    }
  } else {
    roles[key] = {
      ...existing,
      role,
      updatedAt: new Date().toISOString(),
    };
  }
  saveStoredRoles(roles);
  notifyProtectionChanged(project);
}

export function isProjectExplicitlyReadOnly(
  project: ModelProject | null | undefined
): boolean {
  return getProjectProtectionState(project).explicitReadOnly;
}

export function setProjectReadOnly(project: ModelProject, readOnly: boolean): void {
  const roles = loadStoredRoles();
  const key = getProjectRoleKey(project);
  const existing = roles[key];
  if (readOnly) {
    roles[key] = {
      ...existing,
      readOnly: true,
      updatedAt: new Date().toISOString(),
    };
  } else if (existing?.role) {
    roles[key] = {
      role: existing.role,
      updatedAt: new Date().toISOString(),
    };
  } else {
    delete roles[key];
  }
  saveStoredRoles(roles);
  notifyProtectionChanged(project);
}

export function getProjectProtectionState(
  project: ModelProject | null | undefined
): ProjectProtectionState {
  if (!project) {
    return {
      role: "unassigned",
      explicitReadOnly: false,
      roleProtected: false,
      readOnly: false,
    };
  }
  const stored = loadStoredRoles()[getProjectRoleKey(project)];
  const role = normalizeRole(stored?.role);
  const explicitReadOnly = stored?.readOnly === true;
  const roleProtected = protectedRoles.has(role);
  return {
    role,
    explicitReadOnly,
    roleProtected,
    readOnly: explicitReadOnly || roleProtected,
  };
}

export function isProjectProtected(project: ModelProject | null | undefined): boolean {
  return getProjectProtectionState(project).readOnly;
}

/**
 * Central mutation guard for all MCP tools. Both reference tabs reject agent
 * mutations; only the working copy is writable during the three-tab workflow.
 */
export function assertAgentMayMutateProject(toolName: string): void {
  if (viewOnlyMutationTools.has(toolName)) return;
  assertProjectMayBeMutated(Project, toolName);
}

/** Guard an explicitly resolved project when an operation manages its own routing. */
export function assertProjectMayBeMutated(
  project: ModelProject,
  toolName: string
): void {
  const protection = getProjectProtectionState(project);
  if (!protection.readOnly) return;
  const reason = protection.explicitReadOnly
    ? "explicitly read-only"
    : protection.role;
  throw new Error(
    `Tool "${toolName}" cannot modify project "${project.name}" ` +
      `because it is ${reason}. Bind a writable project or turn off its explicit read-only flag first.`
  );
}

export function describeProject(project: ModelProject): Record<string, unknown> {
  const protection = getProjectProtectionState(project);
  return {
    uuid: project.uuid,
    name: project.name,
    selected: project.selected,
    saved: project.saved,
    save_path: project.save_path || null,
    export_path: project.export_path || null,
    format: project.format?.id ?? null,
    role: protection.role,
    read_only: protection.readOnly,
    explicit_read_only: protection.explicitReadOnly,
    agent_writable: !protection.readOnly,
    counts: {
      elements: project.elements.length,
      groups: project.groups.length,
      textures: project.textures.length,
      animations: project.animations.length,
    },
  };
}
