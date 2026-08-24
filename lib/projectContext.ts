/// <reference types="three" />
/// <reference types="blockbench-types" />

export interface McpCameraState {
  position: [number, number, number];
  target?: [number, number, number];
  rotation?: [number, number, number];
  projection: "orthographic" | "perspective";
  zoom?: number;
}

const DEFAULT_SESSION_KEY = "__default_mcp_session__";
const workingProjectIds = new Map<string, string>();
const cameraStates = new Map<string, Map<string, McpCameraState>>();

function sessionKey(sessionId?: string): string {
  return sessionId || DEFAULT_SESSION_KEY;
}

function runtimeProjects(): ModelProject[] {
  const runtime = globalThis as typeof globalThis & {
    ModelProject?: { all?: ModelProject[] };
  };
  return runtime.ModelProject?.all ?? [];
}

function runtimeProject(): ModelProject | null {
  const project = (
    globalThis as typeof globalThis & {
      Blockbench?: { Project?: ModelProject | 0 | null };
    }
  ).Blockbench?.Project;
  return project && typeof project === "object" ? project : null;
}

/** Resolve an open tab by UUID, exact name, or exact save path. */
export function resolveOpenProject(reference: string): ModelProject {
  const projects = runtimeProjects();
  const byUuid = projects.find((project) => project.uuid === reference);
  if (byUuid) return byUuid;

  const matches = projects.filter(
    (project) => project.name === reference || project.save_path === reference
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Project reference "${reference}" is ambiguous (${matches.length} matches: ` +
        `${matches.map((project) => project.uuid).join(", ")}). Use an exact UUID from ` +
        'inspect_projects with command.action "list_projects".'
    );
  }
  throw new Error(
    `Project "${reference}" not found. Use inspect_projects with command.action ` +
      '"list_projects" to inspect open tabs.'
  );
}

/** The tab the user is actually viewing, independent from temporary MCP routing. */
export function getForegroundProject(): ModelProject | null {
  const selected = runtimeProjects().find((project) => project.selected);
  return selected ?? runtimeProject();
}

export function setSessionWorkingProject(
  sessionId: string | undefined,
  project: ModelProject
): void {
  workingProjectIds.set(sessionKey(sessionId), project.uuid);
}

export function getSessionWorkingProjectId(sessionId?: string): string | null {
  return workingProjectIds.get(sessionKey(sessionId)) ?? null;
}

export function peekSessionWorkingProject(sessionId?: string): ModelProject | null {
  const id = getSessionWorkingProjectId(sessionId);
  if (!id) return null;
  return runtimeProjects().find((project) => project.uuid === id) ?? null;
}

/** Resolve the project explicitly owned by one MCP session. */
export function requireSessionWorkingProject(sessionId?: string): ModelProject {
  const key = sessionKey(sessionId);
  const boundId = workingProjectIds.get(key);
  if (boundId) {
    const bound = runtimeProjects().find((project) => project.uuid === boundId);
    if (bound) return bound;
    throw new Error(
      `The MCP working project (${boundId}) is no longer open. Use edit_projects with ` +
        'command.action "set_working_project" before another project-scoped call.'
    );
  }

  throw new Error(
    "This MCP session has no working project. Use inspect_projects with " +
      'command.action "list_projects", then edit_projects with command.action ' +
      '"set_working_project". A new or reloaded session never adopts the foreground tab.'
  );
}

export function clearSessionProjectState(sessionId?: string): void {
  const key = sessionKey(sessionId);
  workingProjectIds.delete(key);
  cameraStates.delete(key);
}

export function clearAllProjectSessionState(): void {
  workingProjectIds.clear();
  cameraStates.clear();
}

export function forgetProjectState(projectId: string): void {
  for (const [key, id] of workingProjectIds) {
    if (id === projectId) workingProjectIds.delete(key);
  }
  for (const perProject of cameraStates.values()) {
    perProject.delete(projectId);
  }
}

export function setSessionCameraState(
  sessionId: string | undefined,
  projectId: string,
  state: McpCameraState
): void {
  const key = sessionKey(sessionId);
  let perProject = cameraStates.get(key);
  if (!perProject) {
    perProject = new Map();
    cameraStates.set(key, perProject);
  }
  perProject.set(projectId, {
    ...state,
    position: [...state.position],
    target: state.target ? [...state.target] : undefined,
    rotation: state.rotation ? [...state.rotation] : undefined,
  });
}

export function getSessionCameraState(
  sessionId: string | undefined,
  projectId: string
): McpCameraState | null {
  const state = cameraStates.get(sessionKey(sessionId))?.get(projectId);
  if (!state) return null;
  return {
    ...state,
    position: [...state.position],
    target: state.target ? [...state.target] : undefined,
    rotation: state.rotation ? [...state.rotation] : undefined,
  };
}

interface CanvasLike {
  updateView?: (options: BackgroundViewOptions) => void;
  updateAll?: () => void;
  updateAllPositions?: (leaveSelection?: boolean) => void;
  updateVisibility?: () => void;
  updateAllBones?: (groups?: Group[]) => void;
  updateAllFaces?: (texture?: Texture) => void;
  updateAllUVs?: () => void;
  updateLayeredTextures?: () => void;
  [key: string]: unknown;
}

interface BackgroundViewOptions {
  elements?: OutlinerElement[];
  groups?: Group[];
  element_aspects?: {
    transform?: boolean;
    geometry?: boolean;
    faces?: boolean;
    uv?: boolean;
    visibility?: boolean;
    painting_grid?: boolean;
  };
  group_aspects?: {
    transform?: boolean;
    visibility?: boolean;
  };
  selection?: boolean;
}

function updateElement(element: OutlinerElement, aspects?: BackgroundViewOptions["element_aspects"]): void {
  const controller = (element.constructor as typeof OutlinerElement & {
    preview_controller?: NodePreviewController;
  }).preview_controller;
  if (!controller) return;
  if (!aspects) {
    controller.updateAll?.(element);
    return;
  }
  if (aspects.transform) controller.updateTransform?.(element);
  if (aspects.geometry) controller.updateGeometry?.(element);
  if (aspects.faces) controller.updateFaces?.(element);
  if (aspects.uv) controller.updateUV?.(element);
  if (aspects.painting_grid) {
    (controller as NodePreviewController & {
      updatePixelGrid?: (node: OutlinerElement) => void;
    }).updatePixelGrid?.(element);
  }
  if (aspects.visibility) controller.updateVisibility?.(element);
}

function updateGroup(group: Group, aspects?: BackgroundViewOptions["group_aspects"]): void {
  const controller = (group.constructor as typeof Group & {
    preview_controller?: NodePreviewController;
  }).preview_controller;
  if (!controller) return;
  if (!aspects) {
    controller.updateAll?.(group);
    return;
  }
  if (aspects.transform) controller.updateTransform?.(group);
  if (aspects.visibility) controller.updateVisibility?.(group);
}

let backgroundCanvasDepth = 0;

function installBackgroundCanvasRouting(): () => void {
  const runtime = globalThis as typeof globalThis & {
    Canvas?: CanvasLike;
    updateSelection?: (...args: unknown[]) => unknown;
    updateNslideValues?: (...args: unknown[]) => unknown;
    UVEditor?: { loadData?: (...args: unknown[]) => unknown };
  };
  const canvas = runtime.Canvas as CanvasLike | undefined;
  if (!canvas || backgroundCanvasDepth > 0) {
    backgroundCanvasDepth += 1;
    return () => {
      backgroundCanvasDepth -= 1;
    };
  }

  backgroundCanvasDepth = 1;
  const methods = {
    updateView: canvas.updateView,
    updateAll: canvas.updateAll,
    updateAllPositions: canvas.updateAllPositions,
    updateVisibility: canvas.updateVisibility,
    updateAllBones: canvas.updateAllBones,
    updateAllFaces: canvas.updateAllFaces,
    updateAllUVs: canvas.updateAllUVs,
    updateLayeredTextures: canvas.updateLayeredTextures,
  };
  const updateSelection = (runtime as { updateSelection?: (...args: unknown[]) => unknown })
    .updateSelection;
  const updateNslideValues = (runtime as { updateNslideValues?: (...args: unknown[]) => unknown })
    .updateNslideValues;
  const loadUvData = runtime.UVEditor?.loadData;

  const safeView = (options: BackgroundViewOptions = {}) => {
    options.elements?.forEach((element) => updateElement(element, options.element_aspects));
    options.groups?.forEach((group) => updateGroup(group, options.group_aspects));
  };
  const safeAll = () => {
    const project = runtimeProject();
    if (!project) return;
    project.groups.forEach((group) => updateGroup(group));
    project.elements.forEach((element) => updateElement(element));
  };

  canvas.updateView = safeView;
  canvas.updateAll = safeAll;
  canvas.updateAllPositions = () => {
    const project = runtimeProject();
    if (!project) return;
    safeView({
      elements: project.elements,
      element_aspects: { transform: true, geometry: true },
    });
  };
  canvas.updateVisibility = () => {
    const project = runtimeProject();
    if (!project) return;
    safeView({
      elements: project.elements,
      element_aspects: { visibility: true },
      groups: project.groups,
      group_aspects: { visibility: true },
    });
  };
  canvas.updateAllBones = (groups: Group[] = []) => {
    groups.forEach((group) => updateGroup(group, { transform: true }));
  };
  canvas.updateAllFaces = () => {
    runtimeProject()?.elements.forEach((element) => {
      updateElement(element, { faces: true, uv: true });
    });
  };
  canvas.updateAllUVs = () => {
    runtimeProject()?.elements.forEach((element) => {
      updateElement(element, { uv: true });
    });
  };
  canvas.updateLayeredTextures = canvas.updateAllFaces;
  if (updateSelection) runtime.updateSelection = () => undefined;
  if (updateNslideValues) runtime.updateNslideValues = () => undefined;
  if (runtime.UVEditor && loadUvData) runtime.UVEditor.loadData = () => undefined;

  return () => {
    backgroundCanvasDepth -= 1;
    if (backgroundCanvasDepth !== 0) return;
    Object.assign(canvas, methods);
    if (updateSelection) runtime.updateSelection = updateSelection;
    if (updateNslideValues) runtime.updateNslideValues = updateNslideValues;
    if (runtime.UVEditor && loadUvData) runtime.UVEditor.loadData = loadUvData;
  };
}

interface RuntimeSnapshot {
  project: unknown;
  format: unknown;
  documentTitle?: string;
  headerTitle?: string;
  propFileName?: string;
  propFileNameAlt?: string;
  outlinerRoot?: OutlinerNode[];
  uuids?: Record<string, OutlinerNode>;
  animationSelected?: unknown;
  controllerSelected?: unknown;
  timelineAnimators?: unknown;
  timelineVueAnimators?: unknown;
  timelineMarkers?: unknown;
  timelineAnimationLength?: unknown;
  timelineTime?: unknown;
}

/**
 * Route one synchronous Blockbench operation to an inactive project without
 * selecting its tab. Never keep this context open across an await.
 */
export function runInProjectContext<T>(project: ModelProject, callback: () => T): T {
  const runtime = globalThis as typeof globalThis & {
    Blockbench?: { Project?: unknown; Format?: unknown };
    Outliner?: { root?: OutlinerNode[] };
    OutlinerNode?: { uuids?: Record<string, OutlinerNode> };
    Animation?: { selected?: unknown };
    AnimationController?: { selected?: unknown };
    Timeline?: {
      time?: unknown;
      animators?: unknown;
      vue?: {
        animators?: unknown;
        _data?: { markers?: unknown; animation_length?: unknown };
      };
    };
    Prop?: { file_name?: string; file_name_alt?: string };
    document?: Document;
  };
  if (!runtime.Blockbench || runtime.Blockbench.Project === project) {
    return callback();
  }

  const runtimeDocument = runtime.document;
  const headerFreeBar = runtimeDocument?.getElementById("header_free_bar");
  const snapshot: RuntimeSnapshot = {
    project: runtime.Blockbench.Project,
    format: runtime.Blockbench.Format,
    documentTitle: runtimeDocument?.title,
    headerTitle: headerFreeBar?.innerText,
    propFileName: runtime.Prop?.file_name,
    propFileNameAlt: runtime.Prop?.file_name_alt,
    outlinerRoot: runtime.Outliner?.root,
    uuids: runtime.OutlinerNode?.uuids,
    animationSelected: runtime.Animation?.selected,
    controllerSelected: runtime.AnimationController?.selected,
    timelineAnimators: runtime.Timeline?.animators,
    timelineVueAnimators: runtime.Timeline?.vue?.animators,
    timelineMarkers: runtime.Timeline?.vue?._data?.markers,
    timelineAnimationLength: runtime.Timeline?.vue?._data?.animation_length,
    timelineTime: runtime.Timeline?.time,
  };
  const uuidIndex: Record<string, OutlinerNode> = {};
  for (const node of [...project.elements, ...project.groups]) {
    uuidIndex[node.uuid] = node;
  }
  const foreground = getForegroundProject();
  const restoreCanvas = foreground !== project
    ? installBackgroundCanvasRouting()
    : () => undefined;

  try {
    runtime.Blockbench.Project = project;
    runtime.Blockbench.Format = project.format;
    if (runtime.Outliner) runtime.Outliner.root = project.outliner;
    if (runtime.OutlinerNode) runtime.OutlinerNode.uuids = uuidIndex;
    if (runtime.Animation) {
      runtime.Animation.selected = project.animations.find((item) => item.selected) ?? null;
    }
    const controllers = (project as ModelProject & {
      animation_controllers?: Array<{ selected?: boolean }>;
    }).animation_controllers ?? [];
    if (runtime.AnimationController) {
      runtime.AnimationController.selected = controllers.find((item) => item.selected) ?? null;
    }
    if (runtime.Timeline) {
      runtime.Timeline.animators = project.timeline_animators;
      if (runtime.Timeline.vue) runtime.Timeline.vue.animators = project.timeline_animators;
    }
    return callback();
  } finally {
    runtime.Blockbench.Project = snapshot.project;
    runtime.Blockbench.Format = snapshot.format;
    if (runtime.Outliner && snapshot.outlinerRoot) {
      runtime.Outliner.root = snapshot.outlinerRoot;
    }
    if (runtime.OutlinerNode && snapshot.uuids) {
      runtime.OutlinerNode.uuids = snapshot.uuids;
    }
    if (runtime.Animation) runtime.Animation.selected = snapshot.animationSelected;
    if (runtime.AnimationController) {
      runtime.AnimationController.selected = snapshot.controllerSelected;
    }
    if (runtime.Timeline) {
      const timeline = runtime.Timeline as {
        time?: unknown;
        animators?: unknown;
        vue?: {
          animators?: unknown;
          _data?: { markers?: unknown; animation_length?: unknown };
        };
      };
      timeline.time = snapshot.timelineTime;
      timeline.animators = snapshot.timelineAnimators;
      if (runtime.Timeline.vue) {
        timeline.vue!.animators = snapshot.timelineVueAnimators;
        if (timeline.vue!._data) {
          timeline.vue!._data.markers = snapshot.timelineMarkers;
          timeline.vue!._data.animation_length = snapshot.timelineAnimationLength;
        }
      }
    }
    restoreCanvas();
    if (runtime.Prop) {
      runtime.Prop.file_name = snapshot.propFileName;
      runtime.Prop.file_name_alt = snapshot.propFileNameAlt;
    }
    if (runtimeDocument && snapshot.documentTitle !== undefined) {
      runtimeDocument.title = snapshot.documentTitle;
    }
    if (headerFreeBar && snapshot.headerTitle !== undefined) {
      headerFreeBar.innerText = snapshot.headerTitle;
    }
  }
}

/** Operations that deliberately manage tabs or global editor state themselves. */
export const PROJECT_CONTEXT_BYPASS_OPERATIONS = new Set([
  "list_projects",
  "set_working_project",
  "show_project",
  "set_project_read_only",
  "create_project",
  "close_projects_without_saving",
  "open_bbmodel",
  "duplicate_project",
  "capture_blockbench_ui",
  "paint_settings",
  "create_brush_preset",
  "load_brush_preset",
  "ysm_set_workspace",
  "ysm_workspace_status",
  "ysm_bind_project",
  "ysm_save_project",
  "ysm_unbind_project",
  "ysm_open_workflow_tabs",
  "ysm_workflow_status",
  "ysm_merge_working_into_baseline",
]);

/** Operations that still require Blockbench's visible paint/display UI. */
export const FOREGROUND_ONLY_OPERATIONS = new Set([
  "create_texture",
  "import_texture_set",
  "edit_texture_pixels",
  "paint_fill_tool",
  "draw_shape_tool",
  "gradient_tool",
  "color_picker_tool",
  "copy_brush_tool",
  "eraser_tool",
  "paint_with_brush",
  "texture_selection",
  "texture_layer_management",
  "enter_display_mode",
]);
