import {
  atomicWriteWorkspaceText,
  readWorkspaceText,
  resolvePluginWorkspacePath,
  sha256WorkspaceFile,
  workspaceFileExists,
} from "@/lib/pluginWorkspace";
import {
  describeProject,
  getProjectRole,
  setProjectRole,
  type ProjectRole,
} from "@/lib/projectRoles";
import { getVisibleProject } from "@/src/blockbench/projects";
import { portableBbmodelText } from "@/lib/projectFiles";
import { isolateProjectTextures } from "@/lib/textureSafety";
import {
  LEGACY_YSM_WORKFLOW_STORAGE_KEY,
  readMigratedStorageItem,
} from "@/lib/brandingMigration";

const STORAGE_KEY = "blockbench_mcp.ysm_workflow.v1";

export interface YsmWorkflowState {
  version: 1;
  skinName: string;
  legacyBbmodel: string;
  baselineBbmodel: string;
  workingBbmodel: string;
  baselineSha256: string;
  workingSha256: string;
  updatedAt: string;
}

interface OpenWorkflowOptions {
  skinName: string;
  legacyBbmodel: string;
  baselineBbmodel: string;
  workingBbmodel: string;
  discardUnsavedTabs: boolean;
}

const roleTitles: Record<Exclude<ProjectRole, "unassigned">, string> = {
  legacy_reference: "Legacy Reference",
  new_baseline: "New Baseline",
  working_copy: "Working Copy",
};

function loadState(): YsmWorkflowState | null {
  try {
    const raw = readMigratedStorageItem(localStorage, STORAGE_KEY, [
      LEGACY_YSM_WORKFLOW_STORAGE_KEY,
    ]);
    const parsed = JSON.parse(raw || "null") as YsmWorkflowState | null;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function saveState(state: YsmWorkflowState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function validateBbmodel(relativePath: string): void {
  if (!/\.bbmodel$/i.test(relativePath) || !workspaceFileExists(relativePath)) {
    throw new Error(`Workflow project must be an existing .bbmodel inside the plugin workspace: ${relativePath}`);
  }
  try {
    const parsed = JSON.parse(readWorkspaceText(relativePath));
    if (!parsed || typeof parsed !== "object") throw new Error("root value is not an object");
  } catch (error) {
    throw new Error(
      `Invalid .bbmodel JSON at ${relativePath}: ${error instanceof Error ? error.message : error}`
    );
  }
}

function openBbmodel(relativePath: string): ModelProject {
  const absolutePath = resolvePluginWorkspacePath(relativePath);
  const before = new Set(ModelProject.all);
  loadModelFile({
    name: PathModule.basename(absolutePath),
    path: absolutePath,
    content: readWorkspaceText(relativePath),
  }, {});
  const created = ModelProject.all.filter((project) => !before.has(project));
  if (created.length === 1) return created[0];
  if (created.length > 1) {
    throw new Error(
      `Opening ${relativePath} unexpectedly created ${created.length} project tabs. ` +
        "Close the extra tabs before continuing."
    );
  }
  const pathMatches = ModelProject.all.filter((project) => project.save_path === absolutePath);
  if (pathMatches.length === 1) return pathMatches[0];
  if (pathMatches.length > 1) {
    throw new Error(`Multiple open project tabs point to ${relativePath}.`);
  }
  throw new Error(`Blockbench did not open ${relativePath}.`);
}

function assignRole(project: ModelProject, role: Exclude<ProjectRole, "unassigned">, skinName: string): void {
  isolateProjectTextures(project);
  setProjectRole(project, role);
  project.name = `${roleTitles[role]}｜${skinName}`;
  project.saved = true;
}

async function closeProjects(projects: ModelProject[], discardUnsaved: boolean): Promise<void> {
  const unsaved = projects.filter((project) => !project.saved);
  if (unsaved.length > 0 && !discardUnsaved) {
    throw new Error(
      `Refusing to close unsaved tabs: ${unsaved.map((project) => project.name).join(", ")}. ` +
        "Save them first or explicitly set discard_unsaved_tabs=true."
    );
  }
  for (const project of projects) {
    const closed = await project.close(true);
    if (!closed) throw new Error(`Blockbench refused to close project "${project.name}".`);
  }
}

function projectsByRole(): Partial<Record<ProjectRole, ModelProject[]>> {
  const result: Partial<Record<ProjectRole, ModelProject[]>> = {};
  for (const project of ModelProject.all) {
    const role = getProjectRole(project);
    (result[role] ??= []).push(project);
  }
  return result;
}

function exactRoleProject(
  byRole: Partial<Record<ProjectRole, ModelProject[]>>,
  role: Exclude<ProjectRole, "unassigned">
): ModelProject {
  const projects = byRole[role] ?? [];
  if (projects.length !== 1) {
    throw new Error(`Expected exactly one open ${role} project, found ${projects.length}.`);
  }
  return projects[0];
}

function assertProjectPath(project: ModelProject, relativePath: string, role: string): void {
  const expected = resolvePluginWorkspacePath(relativePath);
  if (project.save_path !== expected) {
    throw new Error(
      `The open ${role} tab points to ${project.save_path || "an unsaved path"}, expected ${expected}.`
    );
  }
}

export async function openYsmWorkflowTabs(options: OpenWorkflowOptions): Promise<Record<string, unknown>> {
  const paths = [options.legacyBbmodel, options.baselineBbmodel, options.workingBbmodel];
  if (new Set(paths.map((path) => path.replace(/\\/g, "/").toLocaleLowerCase())).size !== 3) {
    throw new Error("The legacy, baseline, and working .bbmodel paths must be three different files.");
  }
  paths.forEach(validateBbmodel);

  await closeProjects([...ModelProject.all], options.discardUnsavedTabs);
  const legacy = openBbmodel(options.legacyBbmodel);
  assignRole(legacy, "legacy_reference", options.skinName);
  const baseline = openBbmodel(options.baselineBbmodel);
  assignRole(baseline, "new_baseline", options.skinName);
  const working = openBbmodel(options.workingBbmodel);
  assignRole(working, "working_copy", options.skinName);
  working.select();

  if (ModelProject.all.length !== 3) {
    throw new Error(`Workflow setup must leave exactly three tabs; Blockbench has ${ModelProject.all.length}.`);
  }

  const state: YsmWorkflowState = {
    version: 1,
    skinName: options.skinName,
    legacyBbmodel: options.legacyBbmodel,
    baselineBbmodel: options.baselineBbmodel,
    workingBbmodel: options.workingBbmodel,
    baselineSha256: sha256WorkspaceFile(options.baselineBbmodel),
    workingSha256: sha256WorkspaceFile(options.workingBbmodel),
    updatedAt: new Date().toISOString(),
  };
  saveState(state);
  return workflowStatus();
}

export function workflowStatus(): Record<string, unknown> {
  const state = loadState();
  const byRole = projectsByRole();
  const visible = getVisibleProject();
  return {
    state,
    exact_three_tabs: ModelProject.all.length === 3,
    visible_role: getProjectRole(visible),
    visible_project: visible?.uuid ?? null,
    projects: ModelProject.all.map(describeProject),
    role_counts: {
      legacy_reference: byRole.legacy_reference?.length ?? 0,
      new_baseline: byRole.new_baseline?.length ?? 0,
      working_copy: byRole.working_copy?.length ?? 0,
      unassigned: byRole.unassigned?.length ?? 0,
    },
  };
}

function compileProject(project: ModelProject): string {
  if (!Codecs.project || typeof Codecs.project.compile !== "function") {
    throw new Error("Blockbench's project codec is unavailable.");
  }
  if (getVisibleProject() !== project) {
    throw new Error("The YSM working-copy tab must remain visible while it is compiled.");
  }
  const compiled = Codecs.project.compile({ bitmaps: true, absolute_paths: false });
  return portableBbmodelText(compiled);
}

export async function mergeWorkingIntoBaseline(
  visibleProject: ModelProject
): Promise<Record<string, unknown>> {
  const state = loadState();
  if (!state) throw new Error("No active YSM three-tab workflow. Open the workflow tabs first.");
  if (ModelProject.all.length !== 3) {
    throw new Error(`Merge requires exactly three open tabs; found ${ModelProject.all.length}.`);
  }
  const byRole = projectsByRole();
  const legacy = exactRoleProject(byRole, "legacy_reference");
  const baseline = exactRoleProject(byRole, "new_baseline");
  const working = exactRoleProject(byRole, "working_copy");
  if (visibleProject !== working || getVisibleProject() !== working) {
    throw new Error("Select the YSM working-copy tab before merging it into the baseline.");
  }
  assertProjectPath(legacy, state.legacyBbmodel, "legacy reference");
  assertProjectPath(baseline, state.baselineBbmodel, "new baseline");
  assertProjectPath(working, state.workingBbmodel, "working copy");

  const currentBaselineHash = sha256WorkspaceFile(state.baselineBbmodel);
  if (currentBaselineHash !== state.baselineSha256) {
    throw new Error(
      "The baseline .bbmodel changed outside this workflow. Reopen the three tabs before merging."
    );
  }

  const compiled = compileProject(working);
  const closed = await baseline.close(true);
  if (!closed) throw new Error("Blockbench refused to close the current baseline tab.");

  atomicWriteWorkspaceText(state.workingBbmodel, compiled);
  atomicWriteWorkspaceText(state.baselineBbmodel, compiled);
  working.save_path = resolvePluginWorkspacePath(state.workingBbmodel);
  working.saved = true;

  const reopenedBaseline = openBbmodel(state.baselineBbmodel);
  assignRole(reopenedBaseline, "new_baseline", state.skinName);

  // Opening appends the new tab. Move it back in front of the working copy so
  // the visible order remains legacy → baseline → working after every merge.
  const appendedIndex = ModelProject.all.indexOf(reopenedBaseline);
  if (appendedIndex >= 0) ModelProject.all.splice(appendedIndex, 1);
  const workingIndex = ModelProject.all.indexOf(working);
  ModelProject.all.splice(Math.max(0, workingIndex), 0, reopenedBaseline);
  working.select();

  state.baselineSha256 = sha256WorkspaceFile(state.baselineBbmodel);
  state.workingSha256 = sha256WorkspaceFile(state.workingBbmodel);
  state.updatedAt = new Date().toISOString();
  saveState(state);
  return workflowStatus();
}
