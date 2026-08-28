/// <reference types="three" />
/// <reference types="blockbench-types" />

export interface McpPreviewVisibilityState {
  hiddenBoneIds: string[];
  shownBoneIds: string[];
  isolatedBoneIds: string[];
}

interface PreviewBoneLike {
  uuid: string;
  parent?: unknown;
  mesh?: unknown;
}

const DEFAULT_SESSION_KEY = "__default_mcp_session__";
const previewVisibilityStates = new Map<
  string,
  Map<string, McpPreviewVisibilityState>
>();

function sessionKey(sessionId?: string): string {
  return sessionId || DEFAULT_SESSION_KEY;
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function cloneState(state: McpPreviewVisibilityState): McpPreviewVisibilityState {
  return {
    hiddenBoneIds: [...state.hiddenBoneIds],
    shownBoneIds: [...state.shownBoneIds],
    isolatedBoneIds: [...state.isolatedBoneIds],
  };
}

function hasVisibilityFilter(state: McpPreviewVisibilityState): boolean {
  return Boolean(
    state.hiddenBoneIds.length ||
      state.shownBoneIds.length ||
      state.isolatedBoneIds.length
  );
}

export function setSessionPreviewVisibilityState(
  sessionId: string | undefined,
  projectId: string,
  state: McpPreviewVisibilityState
): void {
  const normalized: McpPreviewVisibilityState = {
    hiddenBoneIds: uniqueIds(state.hiddenBoneIds),
    shownBoneIds: uniqueIds(state.shownBoneIds),
    isolatedBoneIds: uniqueIds(state.isolatedBoneIds),
  };
  const key = sessionKey(sessionId);

  if (!hasVisibilityFilter(normalized)) {
    const perProject = previewVisibilityStates.get(key);
    perProject?.delete(projectId);
    if (perProject?.size === 0) previewVisibilityStates.delete(key);
    return;
  }

  let perProject = previewVisibilityStates.get(key);
  if (!perProject) {
    perProject = new Map();
    previewVisibilityStates.set(key, perProject);
  }
  perProject.set(projectId, normalized);
}

export function getSessionPreviewVisibilityState(
  sessionId: string | undefined,
  projectId: string
): McpPreviewVisibilityState | null {
  const state = previewVisibilityStates.get(sessionKey(sessionId))?.get(projectId);
  return state ? cloneState(state) : null;
}

export function clearSessionPreviewVisibilityState(sessionId?: string): void {
  previewVisibilityStates.delete(sessionKey(sessionId));
}

export function clearAllPreviewVisibilityStates(): void {
  previewVisibilityStates.clear();
}

export function forgetProjectPreviewVisibilityState(projectId: string): void {
  for (const [key, perProject] of previewVisibilityStates) {
    perProject.delete(projectId);
    if (perProject.size === 0) previewVisibilityStates.delete(key);
  }
}

function isPreviewBone(value: unknown): value is PreviewBoneLike {
  return Boolean(
    value &&
      typeof value === "object" &&
      "uuid" in value &&
      typeof (value as { uuid?: unknown }).uuid === "string"
  );
}

export function resolvePreviewBoneVisibility(
  bones: readonly PreviewBoneLike[],
  state: McpPreviewVisibilityState
): Map<string, boolean> {
  const hidden = new Set(state.hiddenBoneIds);
  const shown = new Set(state.shownBoneIds);
  const isolated = new Set(state.isolatedBoneIds);
  const hierarchy = new Set<string>();
  const byId = new Map(bones.map((bone) => [bone.uuid, bone]));

  for (const id of isolated) {
    let current = byId.get(id);
    while (current) {
      hierarchy.add(current.uuid);
      current = isPreviewBone(current.parent) ? current.parent : undefined;
    }
  }

  for (const bone of bones) {
    let current: PreviewBoneLike | undefined = bone;
    while (current) {
      if (isolated.has(current.uuid)) {
        hierarchy.add(bone.uuid);
        break;
      }
      current = isPreviewBone(current.parent) ? current.parent : undefined;
    }
  }

  const visibility = new Map<string, boolean>();
  for (const bone of bones) {
    let visible = isolated.size === 0 || hierarchy.has(bone.uuid);
    if (hidden.has(bone.uuid)) visible = false;
    if (shown.has(bone.uuid)) visible = true;
    visibility.set(bone.uuid, visible);
  }
  return visibility;
}

export function applySessionPreviewVisibilityToClone(
  project: ModelProject,
  sourceToClone: ReadonlyMap<THREE.Object3D, THREE.Object3D>,
  sessionId?: string
): number {
  const state = getSessionPreviewVisibilityState(sessionId, project.uuid);
  if (!state) return 0;

  const bones = project.groups as PreviewBoneLike[];
  const visibility = resolvePreviewBoneVisibility(bones, state);
  let updated = 0;
  for (const bone of bones) {
    const sourceMesh = bone.mesh as THREE.Object3D | undefined;
    if (!sourceMesh) continue;
    const clone = sourceToClone.get(sourceMesh);
    const visible = visibility.get(bone.uuid);
    if (!clone || visible === undefined || clone.visible === visible) continue;
    clone.visible = visible;
    updated += 1;
  }
  return updated;
}
