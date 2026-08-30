import {
  isProjectProtected,
  subscribeProjectProtection,
} from "@/lib/projectRoles";
import { isolateProjectTextures } from "@/lib/textureSafety";
import { getVisibleProject } from "@/src/blockbench/projects";

type LockableNode = OutlinerElement | Group;
type PrototypeMethod = (this: any, ...args: any[]) => any;
type GroupSelectionMethod = "select" | "clickSelect" | "multiSelect";

const originalLocks = new WeakMap<ModelProject, Map<LockableNode, boolean>>();
const savedBeforeProtectedEdit = new WeakMap<ModelProject, boolean>();
const listeners: Array<{ event: EventName; callback: (data: any) => void }> = [];
const saveActionListeners: Array<{
  action: Action;
  callback: (data: Record<string, any>) => void;
}> = [];
let setupComplete = false;
let reversingProtectedChange = false;
let unsubscribeProtection: (() => void) | undefined;
let originalPreviewClick: PrototypeMethod | undefined;
let originalElementClickSelect: PrototypeMethod | undefined;
let originalTransformerAttach: PrototypeMethod | undefined;
let protectedTransformer: {
  attach: PrototypeMethod;
  detach: () => void;
} | undefined;
const originalGroupSelectionMethods = new Map<
  GroupSelectionMethod,
  PrototypeMethod
>();

const VIEW_ONLY_EDIT_MESSAGES = new Set([
  "Toggle visibility",
  "Toggle visibility property",
  "Toggle visibility on everything except selection",
  "Toggle collection visibility",
  "Toggle layer visibility",
]);
const SAVE_ACTION_IDS = [
  "save_project",
  "save_project_as",
  "save_project_incremental",
  "export_over",
] as const;

function projectNodes(project: ModelProject): LockableNode[] {
  return [...project.groups, ...project.elements];
}

function withNodesUnlocked<T>(nodes: LockableNode[], callback: () => T): T {
  const lockedNodes = nodes.filter((node) => node.locked);
  for (const node of lockedNodes) node.locked = false;
  try {
    return callback();
  } finally {
    for (const node of lockedNodes) node.locked = true;
  }
}

function isProtectedViewportSelection(
  event: MouseEvent,
  project: ModelProject
): boolean {
  const tool = Toolbox.selected as unknown as {
    id: string;
    selectElements?: unknown;
    paintTool?: unknown;
  };
  const mode = Modes.selected as unknown as { selectElements?: unknown };
  return event.type === "pointerdown"
    && event.button === 0
    && isProjectProtected(project)
    && Boolean(tool.selectElements)
    && Boolean(mode.selectElements)
    && !tool.paintTool
    && tool.id !== "knife_tool";
}

function setupProtectedSelection(): void {
  const previewPrototype = Preview.prototype as unknown as {
    click: PrototypeMethod;
  };
  const originalClick = previewPrototype.click;
  originalPreviewClick = originalClick;
  previewPrototype.click = function (event: MouseEvent, ...args: any[]) {
    const project = Project;
    if (!project || !isProtectedViewportSelection(event, project)) {
      return originalClick.call(this, event, ...args);
    }

    const result = withNodesUnlocked(projectNodes(project), () =>
      originalClick.call(this, event, ...args)
    );
    const hit = this.selection?.click_target?.element;
    if (result && hit) {
      hit.showInOutliner();
    }
    return result;
  };

  const elementPrototype = OutlinerElement.prototype as unknown as {
    clickSelect: PrototypeMethod;
  };
  const originalClickSelect = elementPrototype.clickSelect;
  originalElementClickSelect = originalClickSelect;
  elementPrototype.clickSelect = function (...args: any[]) {
    const project = Project;
    if (!project || !isProjectProtected(project)) {
      return originalClickSelect.apply(this, args);
    }
    return withNodesUnlocked(projectNodes(project), () => {
      const result = originalClickSelect.apply(this, args);
      updateSelection();
      if (this.selected) this.showInOutliner();
      return result;
    });
  };

  const groupPrototype = Group.prototype as unknown as Record<
    GroupSelectionMethod,
    PrototypeMethod
  >;
  for (const method of ["select", "clickSelect", "multiSelect"] as const) {
    const original = groupPrototype[method];
    originalGroupSelectionMethods.set(method, original);
    groupPrototype[method] = function (...args: any[]) {
      const project = Project;
      if (!project || !isProjectProtected(project) || !this.locked) {
        return original.apply(this, args);
      }
      return withNodesUnlocked(projectNodes(project), () =>
        original.apply(this, args)
      );
    };
  }

  const transformer = (globalThis as typeof globalThis & {
    Transformer: { attach: PrototypeMethod; detach: () => void };
  }).Transformer;
  const originalAttach = transformer.attach;
  protectedTransformer = transformer;
  originalTransformerAttach = originalAttach;
  transformer.attach = function (...args: any[]) {
    const visibleProject = getVisibleProject();
    if (visibleProject && isProjectProtected(visibleProject)) {
      this.detach();
      return;
    }
    return originalAttach.apply(this, args);
  };
}

function teardownProtectedSelection(): void {
  if (originalPreviewClick) {
    (Preview.prototype as unknown as { click: PrototypeMethod }).click =
      originalPreviewClick;
    originalPreviewClick = undefined;
  }
  if (originalElementClickSelect) {
    (OutlinerElement.prototype as unknown as { clickSelect: PrototypeMethod })
      .clickSelect = originalElementClickSelect;
    originalElementClickSelect = undefined;
  }
  const groupPrototype = Group.prototype as unknown as Record<
    GroupSelectionMethod,
    PrototypeMethod
  >;
  for (const [method, original] of originalGroupSelectionMethods) {
    groupPrototype[method] = original;
  }
  originalGroupSelectionMethods.clear();
  if (protectedTransformer && originalTransformerAttach) {
    protectedTransformer.attach = originalTransformerAttach;
  }
  protectedTransformer = undefined;
  originalTransformerAttach = undefined;
}

function restoreLocks(project: ModelProject): void {
  const snapshot = originalLocks.get(project);
  if (!snapshot) return;
  for (const [node, locked] of snapshot) node.locked = locked;
  originalLocks.delete(project);
}

export function refreshProjectProtection(project: ModelProject): void {
  if (!isProjectProtected(project)) {
    restoreLocks(project);
    return;
  }

  try {
    isolateProjectTextures(project);
  } catch (error) {
    console.error("[MCP] Could not isolate read-only project texture dependencies:", error);
  }

  let snapshot = originalLocks.get(project);
  if (!snapshot) {
    snapshot = new Map();
    originalLocks.set(project, snapshot);
  }
  for (const node of projectNodes(project)) {
    if (!snapshot.has(node)) snapshot.set(node, node.locked);
    node.locked = true;
  }
  if (project === getVisibleProject()) {
    (globalThis as typeof globalThis & {
      Transformer: { detach: () => void };
    }).Transformer.detach();
  }
}

export function isProtectedViewOnlyEdit(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const message = (data as { message?: unknown }).message;
  return typeof message === "string" && VIEW_ONLY_EDIT_MESSAGES.has(message);
}

function reverseProtectedHistory(
  kind: "edit" | "undo" | "redo",
  savedBefore?: boolean
): void {
  const project = Project;
  if (!project || !isProjectProtected(project) || reversingProtectedChange) return;
  reversingProtectedChange = true;
  try {
    if (kind === "undo") project.undo.redo();
    else project.undo.undo();
    if (savedBefore !== undefined) project.saved = savedBefore;
    refreshProjectProtection(project);
    Blockbench.showQuickMessage(tl("mcp.project.read_only"), 2500);
  } finally {
    queueMicrotask(() => { reversingProtectedChange = false; });
  }
}

export function blockProtectedProjectSave(): false | undefined {
  if (!Project || !isProjectProtected(Project)) return;
  Blockbench.showQuickMessage(tl("mcp.project.save_blocked"), 2500);
  return false;
}

function setupSaveActionGuards(): void {
  for (const id of SAVE_ACTION_IDS) {
    const action = BarItems[id] as Action | undefined;
    if (!action) continue;
    const callback = () => blockProtectedProjectSave();
    action.on("use", callback);
    saveActionListeners.push({ action, callback });
  }
}

function listen(event: EventName, callback: (data: any) => void): void {
  Blockbench.on(event, callback);
  listeners.push({ event, callback });
}

export function setupProjectProtection(): void {
  if (setupComplete) return;
  setupComplete = true;
  setupProtectedSelection();
  unsubscribeProtection = subscribeProjectProtection(refreshProjectProtection);
  listen("init_edit", () => {
    if (Project && isProjectProtected(Project)) {
      savedBeforeProtectedEdit.set(Project, Project.saved);
    }
  });
  listen("finished_edit", (data) => {
    const project = Project;
    const savedBefore = project
      ? savedBeforeProtectedEdit.get(project)
      : undefined;
    if (project) savedBeforeProtectedEdit.delete(project);
    if (isProtectedViewOnlyEdit(data)) {
      if (project && savedBefore !== undefined) project.saved = savedBefore;
      return;
    }
    reverseProtectedHistory("edit", savedBefore);
  });
  listen("undo", () => reverseProtectedHistory("undo"));
  listen("redo", () => reverseProtectedHistory("redo"));
  listen("select_project", () => {
    if (Project) refreshProjectProtection(Project);
  });
  listen("load_project", () => {
    const loaded = Project;
    queueMicrotask(() => {
      if (loaded) refreshProjectProtection(loaded);
    });
  });
  setupSaveActionGuards();
  for (const project of ModelProject.all) refreshProjectProtection(project);
}

export function teardownProjectProtection(): void {
  teardownProtectedSelection();
  for (const project of ModelProject.all) restoreLocks(project);
  for (const { event, callback } of listeners.splice(0)) {
    Blockbench.removeListener(event, callback);
  }
  for (const { action, callback } of saveActionListeners.splice(0)) {
    action.removeListener("use", callback);
  }
  unsubscribeProtection?.();
  unsubscribeProtection = undefined;
  reversingProtectedChange = false;
  setupComplete = false;
}
