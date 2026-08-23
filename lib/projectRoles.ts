export const PROJECT_ROLES = [
  "unassigned",
  "legacy_reference",
  "new_baseline",
  "working_copy",
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

const STORAGE_KEY = "codex_blockbench_mcp.project_roles";
const protectedRoles = new Set<ProjectRole>(["legacy_reference", "new_baseline"]);
const mutationGuardExemptions = new Set([
  "create_project",
  "open_bbmodel",
  "duplicate_project",
  "select_project",
  "edit_camera",
  "edit_preview",
  "enter_display_mode",
  "ysm_set_workspace",
  "ysm_bind_project",
  "ysm_open_workflow_tabs",
  "ysm_merge_working_into_baseline",
]);

interface StoredProjectRole {
  role: string;
  updatedAt: string;
}

type StoredProjectRoles = Record<string, StoredProjectRole>;

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+$/, "").toLocaleLowerCase();
}

export function getProjectRoleKey(project: ModelProject): string {
  if (project.save_path) return `path:${normalizePath(project.save_path)}`;
  return `uuid:${project.uuid}`;
}

function loadStoredRoles(): StoredProjectRoles {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredProjectRoles;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredRoles(roles: StoredProjectRoles): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
}

export function getProjectRole(project: ModelProject | null | undefined): ProjectRole {
  if (!project) return "unassigned";
  const stored = loadStoredRoles()[getProjectRoleKey(project)]?.role;
  if (stored === "reference") return "legacy_reference";
  if (stored === "manual") return "new_baseline";
  if (stored === "working" || stored === "inspection") return "working_copy";
  return PROJECT_ROLES.includes(stored as ProjectRole)
    ? (stored as ProjectRole)
    : "unassigned";
}

export function setProjectRole(project: ModelProject, role: ProjectRole): void {
  const roles = loadStoredRoles();
  const key = getProjectRoleKey(project);
  if (role === "unassigned") {
    delete roles[key];
  } else {
    roles[key] = { role, updatedAt: new Date().toISOString() };
  }
  saveStoredRoles(roles);
}

export function isProjectProtected(project: ModelProject | null | undefined): boolean {
  return protectedRoles.has(getProjectRole(project));
}

/**
 * Central mutation guard for all MCP tools. Both reference tabs reject agent
 * mutations; only the working copy is writable during the three-tab workflow.
 */
export function assertAgentMayMutateProject(toolName: string): void {
  if (mutationGuardExemptions.has(toolName)) return;
  if (!Project || !isProjectProtected(Project)) return;
  const role = getProjectRole(Project);
  throw new Error(
    `Tool "${toolName}" cannot modify the active ${role} project "${Project.name}". ` +
      "Select the working_copy project instead."
  );
}

export function describeProject(project: ModelProject): Record<string, unknown> {
  return {
    uuid: project.uuid,
    name: project.name,
    selected: project.selected,
    saved: project.saved,
    save_path: project.save_path || null,
    export_path: project.export_path || null,
    format: project.format?.id ?? null,
    role: getProjectRole(project),
    agent_writable: !isProjectProtected(project),
    counts: {
      elements: project.elements?.length ?? 0,
      groups: project.groups?.length ?? 0,
      textures: project.textures?.length ?? 0,
      animations: project.animations?.length ?? 0,
    },
  };
}
