/// <reference types="three" />
/// <reference types="blockbench-types" />

export interface McpPreviewVisibilityState {
  hiddenBoneIds: string[];
  shownBoneIds: string[];
  isolatedBoneIds: string[];
}

export interface McpPreviewAnimationState {
  animationId: string | null;
  time: number | null;
}

export interface McpPreviewState {
  animation?: McpPreviewAnimationState;
  visibility?: McpPreviewVisibilityState;
}

interface PreviewBoneLike {
  uuid: string;
  name: string;
  type?: string;
  parent?: unknown;
  mesh?: unknown;
  scene_object?: unknown;
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

/** Project-local nodes accepted by capture preview visibility controls. */
export function previewNodesForProject(project: ModelProject): PreviewBoneLike[] {
  const groups = project.groups as PreviewBoneLike[];
  const rigNodes = (project.elements as PreviewBoneLike[]).filter(
    (node) => node.type === "armature" || node.type === "armature_bone"
  );
  return [...new Map([...groups, ...rigNodes].map((node) => [node.uuid, node])).values()];
}

export function applyPreviewVisibilityToClone(
  project: ModelProject,
  sourceToClone: ReadonlyMap<THREE.Object3D, THREE.Object3D>,
  state?: McpPreviewVisibilityState
): number {
  if (!state) return 0;

  const bones = previewNodesForProject(project);
  const visibility = resolvePreviewBoneVisibility(bones, state);
  let updated = 0;
  for (const bone of bones) {
    const sourceMesh = (bone.scene_object ?? bone.mesh) as THREE.Object3D | undefined;
    if (!sourceMesh) continue;
    const clone = sourceToClone.get(sourceMesh);
    const visible = visibility.get(bone.uuid);
    if (!clone || visible === undefined || clone.visible === visible) continue;
    clone.visible = visible;
    updated += 1;
  }
  return updated;
}
