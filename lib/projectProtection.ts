import { isProjectProtected } from "@/lib/projectRoles";

type LockableNode = OutlinerElement | Group;

const originalLocks = new WeakMap<ModelProject, Map<LockableNode, boolean>>();
const listeners: Array<{ event: EventName; callback: (data: any) => void }> = [];
let setupComplete = false;
let reversingProtectedChange = false;

function projectNodes(project: ModelProject): LockableNode[] {
  return Array.from(new Set<LockableNode>([
    ...(project.groups ?? []),
    ...(project.elements ?? []),
  ]));
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

  let snapshot = originalLocks.get(project);
  if (!snapshot) {
    snapshot = new Map();
    originalLocks.set(project, snapshot);
  }
  for (const node of projectNodes(project)) {
    if (!snapshot.has(node)) snapshot.set(node, node.locked);
    node.locked = true;
  }
}

function reverseProtectedHistory(kind: "edit" | "undo" | "redo"): void {
  const project = Project;
  if (!project || !isProjectProtected(project) || reversingProtectedChange) return;
  reversingProtectedChange = true;
  try {
    if (kind === "undo") project.undo.redo();
    else project.undo.undo();
    refreshProjectProtection(project);
    Blockbench.showQuickMessage(
      "这个参照标签是只读的；已恢复刚才的模型改动。",
      2500
    );
  } finally {
    queueMicrotask(() => { reversingProtectedChange = false; });
  }
}

function listen(event: EventName, callback: (data: any) => void): void {
  Blockbench.on(event, callback);
  listeners.push({ event, callback });
}

export function setupProjectProtection(): void {
  if (setupComplete) return;
  setupComplete = true;
  listen("finished_edit", () => reverseProtectedHistory("edit"));
  listen("undo", () => reverseProtectedHistory("undo"));
  listen("redo", () => reverseProtectedHistory("redo"));
  listen("select_project", () => {
    for (const project of ModelProject.all) refreshProjectProtection(project);
  });
  listen("load_project", () => {
    queueMicrotask(() => {
      for (const project of ModelProject.all) refreshProjectProtection(project);
    });
  });
  for (const project of ModelProject.all) refreshProjectProtection(project);
}

export function teardownProjectProtection(): void {
  for (const project of ModelProject.all) restoreLocks(project);
  for (const { event, callback } of listeners.splice(0)) {
    Blockbench.removeListener(event, callback);
  }
  reversingProtectedChange = false;
  setupComplete = false;
}
