import type * as Three from "three";
import {
  getForegroundProject,
  getSessionCameraState,
  peekSessionWorkingProject,
  resolveOpenProject,
  runInProjectContext,
  type McpCameraState,
} from "@/lib/projectContext";
import { resolveUniqueReference } from "@/lib/modelSafety";
import {
  applySessionPreviewVisibilityToClone,
  getSessionPreviewAnimationState,
} from "@/lib/previewState";

type ThreeApi = typeof import("three");

function getThreeApi(): ThreeApi {
  return (globalThis as typeof globalThis & { THREE: ThreeApi }).THREE;
}

/**
 * Helper function to create properly formatted image content for MCP responses.
 * Handles data URLs, base64 strings, and objects with url property.
 *
 * @param dataOrOptions - Image data as base64/data URL string, or object with { url: string }
 * @param mimeType - MIME type of the image (e.g., 'image/png', 'image/jpeg')
 * @returns Formatted MCP tool result with image content
 */
export function imageContent(
  dataOrOptions: string | { url: string },
  mimeType: string = "image/png"
): { content: Array<{ type: "image"; data: string; mimeType: string }> } {
  // Handle object with url property
  const data = typeof dataOrOptions === "string" ? dataOrOptions : dataOrOptions.url;
  let base64Data = data;

  // If it's a data URL, extract the base64 part
  if (data.startsWith("data:")) {
    const matches = data.match(/^data:([^;]+);base64,(.+)$/);
    if (matches) {
      mimeType = matches[1] || mimeType;
      base64Data = matches[2];
    }
  }

  return {
    content: [
      {
        type: "image" as const,
        data: base64Data,
        mimeType,
      },
    ],
  };
}

export function fixCircularReferences<
  T extends Record<string, any>,
  K extends keyof T,
  V extends T[K]
>(o: T): (k: K, v: V) => V | string {
  const weirdTypes = [
    Int8Array,
    Uint8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    BigInt64Array,
    BigUint64Array,
    //Float16Array,
    Float32Array,
    Float64Array,
    ArrayBuffer,
    // SharedArrayBuffer,
    DataView,
  ];

  const defs = new Map();

  return function (k: K, v: V): V | string {
    if (k && (v as unknown) === o)
      return "[" + (k as string) + " is the same as original object]";
    if (v === undefined) return undefined as V;
    if (v === null) return null as V;
    const weirdType = weirdTypes.find((t) => (v as unknown) instanceof t);
    if (weirdType) return weirdType.toString();
    if (typeof v == "function") {
      return v.toString();
    }
    if (v && typeof v == "object") {
      const def = defs.get(v);
      if (def)
        return "[" + (k as string) + " is the same as " + (def as string) + "]";
      defs.set(v, k);
    }
    return v;
  };
}

/** Return only textures owned by the routed project. */
export function getProjectTextures(): Texture[] {
  return Project?.textures ? [...Project.textures] : [];
}

export function getProjectTexture(id: string): Texture | null {
  const textures = getProjectTextures();
  const uuidMatches = textures.filter((texture) => texture.uuid === id);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(
      `Texture UUID "${id}" is duplicated in the current project. ` +
        "Stop editing and repair the project before continuing."
    );
  }

  if (/^\d+$/.test(id)) {
    const numericMatches = textures.filter((texture) => String(texture.id) === id);
    if (numericMatches.length === 1) return numericMatches[0];
    if (numericMatches.length > 1) {
      throw new Error(
        `Texture numeric ID "${id}" is ambiguous (${numericMatches.length} matches: ` +
          `${numericMatches.map((texture) => texture.uuid).join(", ")}). Use an exact UUID.`
      );
    }
  }

  const nameMatches = textures.filter((texture) => texture.name === id);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Texture name "${id}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((texture) => texture.uuid).join(", ")}). Use an exact UUID.`
    );
  }
  return null;
}

/** Reject texture assignments that Blockbench's current format cannot render. */
export function assertFaceTextureAssignmentSupported(texture: Texture): void {
  if (!Format.single_texture) return;
  const defaultTexture = Texture.getDefault();
  if (!defaultTexture || defaultTexture.uuid !== texture.uuid) {
    throw new Error(
      `Format "${Format.id}" uses one project texture, so faces cannot use ` +
        `"${texture.name}" (${texture.uuid}) while another texture is the default. ` +
        "Consolidate the model into one atlas or make this texture the project default first."
    );
  }
}

/**
 * Programmatically sets a BarItems slider/widget's value, tolerating the API
 * drift between Blockbench versions where some items expose `.set(n)`,
 * `.change(n)`, or only allow `.value = n`. Prior to this helper, calls like
 * `BarItems.slider_brush_size.set(n)` crashed hollow-shape drawing with
 * `… .set is not a function` on current Blockbench builds.
 */
export function setBarItemValue(id: string, value: unknown): void {
  // @ts-ignore - BarItems is a Blockbench global
  const item = BarItems?.[id];
  if (!item) return;
  if (typeof item.set === "function") {
    try {
      item.set(value);
      return;
    } catch {
      // Fall through to direct assignment for widgets whose runtime method
      // signatures drifted from the public type surface.
    }
  }
  if ("value" in item) {
    item.value = value;
    if (typeof item.update === "function") item.update();
    return;
  }
  if (typeof item.change === "function") {
    try {
      item.change(value);
    } catch {
      // Best-effort UI setting; callers should not fail because Blockbench
      // changed an optional widget mutator signature.
    }
  }
}

/**
 * Resolves a texture reference and activates it in the panel so that paint
 * tools, which historically act on `Texture.selected` regardless of their
 * `texture_id` argument, target the intended texture.
 *
 * If `id` is omitted, the currently selected texture is used as-is. Throws an
 * actionable error when the reference cannot be resolved.
 */
export function getAndActivateTexture(id?: string): Texture {
  if (!id) {
    const active = Texture.selected ?? Texture.getDefault();
    if (!active) {
      throw new Error(
        "No texture available. Use edit_textures with command.action \"create_texture\" first, or pass texture_id explicitly."
      );
    }
    if (Texture.selected?.uuid !== active.uuid) {
      active.select();
    }
    return active;
  }

  const texture = getProjectTexture(id);
  if (!texture) {
    throw new Error(
      `Texture "${id}" not found. Use inspect_textures with command.action "list_textures" to see available textures.`
    );
  }
  // Blockbench paint tools operate on Texture.selected, so activating the
  // requested texture is the only reliable way to make texture_id behave like
  // a real scope argument.
  if (Texture.selected?.uuid !== texture.uuid) {
    texture.select();
  }
  return texture;
}

// ============================================================================
// Lookup Helpers with Actionable Error Messages
// ============================================================================

/**
 * Finds a group/bone by name and throws an actionable error if not found.
 * @param name - The name of the group/bone to find
 * @returns The found Group
 * @throws Error with suggestion to use inspect_elements/list_outline
 */
function getOutlinerCandidates(): Array<OutlinerElement | Group> {
  const candidates: Array<OutlinerElement | Group> = [];
  const seen = new Set<OutlinerElement | Group>();
  const visit = (node: OutlinerNode): void => {
    const candidate = node as OutlinerElement | Group;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    candidates.push(candidate);
    const children = (node as OutlinerNode & { children?: OutlinerNode[] }).children;
    if (Array.isArray(children)) children.forEach(visit);
  };
  for (const node of Outliner.root ?? []) visit(node);
  for (const node of [...(Outliner.elements ?? []), ...(Group.all ?? [])]) {
    if (!seen.has(node)) {
      seen.add(node);
      candidates.push(node);
    }
  }
  return candidates;
}

export function findGroupOrThrow(name: string): Group {
  const groups = getOutlinerCandidates().filter(
    (candidate): candidate is Group => candidate instanceof Group
  );
  const uuidMatches = groups.filter((group: Group) => group.uuid === name);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(
      `Bone/group UUID "${name}" is duplicated in the current project. ` +
        "Stop editing and repair the project before continuing."
    );
  }
  const nameMatches = groups.filter((group: Group) => group.name === name);
  if (nameMatches.length > 1) {
    throw new Error(
      `Bone/group name "${name}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((group: Group) => group.uuid).join(", ")}). Use an exact UUID.`
    );
  }
  if (nameMatches.length === 0) {
    throw new Error(
      `Bone/group "${name}" not found. Use inspect_elements with command.action "list_outline" to see available groups and bones.`
    );
  }
  return nameMatches[0];
}

/**
 * Finds a mesh by ID or name and throws an actionable error if not found.
 * @param id - The UUID or name of the mesh to find
 * @returns The found Mesh
 * @throws Error with suggestion to use inspect_elements/list_outline
 */
export function findMeshOrThrow(id: string): Mesh {
  const uuidMatches = Mesh.all.filter((mesh: Mesh) => mesh.uuid === id);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(
      `Mesh UUID "${id}" is duplicated in the current project. ` +
        "Stop editing and repair the project before continuing."
    );
  }
  const nameMatches = Mesh.all.filter((mesh: Mesh) => mesh.name === id);
  if (nameMatches.length > 1) {
    throw new Error(
      `Mesh name "${id}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((mesh: Mesh) => mesh.uuid).join(", ")}). Use an exact UUID.`
    );
  }
  if (nameMatches.length === 0) {
    throw new Error(
      `Mesh "${id}" not found. Use inspect_elements with command.action "list_outline" to see available meshes.`
    );
  }
  return nameMatches[0];
}

/**
 * Finds an element (cube, mesh, group) by ID or name and throws an actionable error if not found.
 * @param id - The UUID or name of the element to find
 * @returns The found OutlinerElement
 * @throws Error with suggestion to use inspect_elements/list_outline
 */
export function findElementOrThrow(id: string): OutlinerElement | Group {
  const candidates = getOutlinerCandidates();
  const uuidMatches = candidates.filter((element) => element.uuid === id);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(
      `Element UUID "${id}" is duplicated in the current project. Stop editing and repair the project before continuing.`
    );
  }
  const nameMatches = candidates.filter((element) => element.name === id);
  if (nameMatches.length > 1) {
    throw new Error(
      `Element name "${id}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((element) => element.uuid).join(", ")}). Use an exact UUID.`
    );
  }
  if (nameMatches.length === 0) {
    throw new Error(
      `Element "${id}" not found. Use inspect_elements with command.action "list_outline" to see available elements.`
    );
  }
  return nameMatches[0];
}

/**
 * Finds a texture by ID, name, or UUID and throws an actionable error if not found.
 * @param id - The ID, name, or UUID of the texture to find
 * @returns The found Texture
 * @throws Error with suggestion to use inspect_textures/list_textures
 */
export function findTextureOrThrow(id: string): Texture {
  const texture = getProjectTexture(id);
  if (!texture) {
    throw new Error(
      `Texture "${id}" not found. Use inspect_textures with command.action "list_textures" to see available textures.`
    );
  }
  return texture;
}

/**
 * Helper to find a TextureGroup by name or UUID
 */
export function findTextureGroupOrThrow(id: string): TextureGroup {
  // @ts-ignore - TextureGroup is globally available in Blockbench
  return resolveUniqueReference(
    id,
    TextureGroup.all,
    "Material/texture group",
    'inspect_materials with command.action "list_materials"'
  );
}

/**
 * Helper to get texture info for a PBR channel
 */
export function getChannelTextureInfo(textures: Texture[], channel: string) {
  const matches = textures.filter((texture: Texture) => texture.pbr_channel === channel);
  if (matches.length > 1) {
    throw new Error(
      `PBR channel "${channel}" is ambiguous (${matches.length} textures: ` +
        `${matches.map((texture) => texture.uuid).join(", ")}). Repair the material group first.`
    );
  }
  const tex = matches[0];
  return tex
    ? { name: tex.name, uuid: tex.uuid, hasTexture: true }
    : { hasTexture: false };
}

/**
 * Gets a mesh by ID or returns the selected mesh if no ID provided.
 * Throws an actionable error if no mesh is found.
 * @param meshId - Optional mesh UUID or name
 * @returns The found or selected Mesh
 * @throws Error with suggestion to use inspect_elements/list_outline
 */
export function getMeshOrSelected(meshId?: string): Mesh {
  if (meshId) {
    return findMeshOrThrow(meshId);
  }
  // @ts-ignore - Mesh is globally available in Blockbench
  const selected = Mesh.selected[0];
  if (!selected) {
    throw new Error(
      "No mesh selected and no mesh_id provided. Select a mesh or provide a mesh_id. Use inspect_elements with command.action \"list_outline\" to see available meshes."
    );
  }
  return selected;
}

/**
 * Captures a screenshot of the 3D preview canvas.
 * Renders the requested project's own scene graph into Blockbench's offscreen
 * renderer, so neither project selection nor the visible viewport is changed.
 */
async function waitForRenderFrames(frameCount: number): Promise<void> {
  for (let frame = 0; frame < frameCount; frame++) {
    await new Promise<void>((resolve) => {
      if (typeof requestAnimationFrame === "function") {
        let settled = false;
        const fallback = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve();
        }, 250);
        requestAnimationFrame(() => {
          if (settled) return;
          settled = true;
          clearTimeout(fallback);
          resolve();
        });
      } else {
        setTimeout(resolve, 0);
      }
    });
  }
}

function resolveScreenshotProject(
  reference: string | undefined,
  sessionId: string | undefined,
  workingProject?: ModelProject | null
): ModelProject {
  if (reference) return resolveOpenProject(reference);
  const target = workingProject ?? peekSessionWorkingProject(sessionId) ?? getForegroundProject();
  if (!target) {
    throw new Error("No project found in the Blockbench editor.");
  }
  return target;
}

interface StoredPreviewState {
  position?: number[];
  target?: number[];
  orthographic?: boolean;
  zoom?: number;
  fov?: number;
}

function tuple3(value: number[] | undefined): [number, number, number] | undefined {
  if (!value || value.length < 3) return undefined;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function fittedCameraState(project: ModelProject): McpCameraState {
  const THREE_API = getThreeApi();
  const box = new THREE_API.Box3().setFromObject(project.model_3d);
  const center = new THREE_API.Vector3(0, project.format?.block_size ? project.format.block_size * 0.75 : 12, 0);
  let extent = project.format?.block_size || 16;
  if (!box.isEmpty()) {
    box.getCenter(center);
    const size = box.getSize(new THREE_API.Vector3());
    extent = Math.max(size.x, size.y, size.z, 1);
  }
  return {
    position: [
      center.x - extent * 2.2,
      center.y + extent * 1.6,
      center.z - extent * 2.2,
    ],
    target: [center.x, center.y, center.z],
    projection: "perspective",
  };
}

export function getEffectiveCameraState(
  project: ModelProject,
  sessionId?: string,
  viewport?: [number, number]
): McpCameraState {
  const sessionState = getSessionCameraState(sessionId, project.uuid);
  if (sessionState) return {
    ...sessionState,
    viewport: viewport ?? sessionState.viewport ?? [800, 600],
  };

  if (project === getForegroundProject() && Preview.selected) {
    const preview = Preview.selected;
    return {
      position: preview.camera.position.toArray() as [number, number, number],
      target: preview.controls.target.toArray() as [number, number, number],
      projection: preview.isOrtho ? "orthographic" : "perspective",
      zoom: preview.isOrtho ? preview.camOrtho.zoom : undefined,
      fov: preview.isOrtho ? undefined : preview.camPers.fov,
      viewport: viewport ?? [800, 600],
    };
  }

  const stored = (project.previews?.main ?? Object.values(project.previews ?? {})[0]) as
    | StoredPreviewState
    | undefined;
  const position = tuple3(stored?.position);
  if (position) {
    return {
      position,
      target: tuple3(stored?.target),
      projection: stored?.orthographic ? "orthographic" : "perspective",
      zoom: stored?.zoom,
      fov: stored?.fov,
      viewport: viewport ?? [800, 600],
    };
  }
  return { ...fittedCameraState(project), viewport: viewport ?? [800, 600] };
}

function targetFromCameraState(state: McpCameraState): Three.Vector3 {
  const THREE_API = getThreeApi();
  if (state.target) return new THREE_API.Vector3().fromArray(state.target);
  const position = new THREE_API.Vector3().fromArray(state.position);
  if (!state.rotation) return new THREE_API.Vector3(0, 0, 0);
  const radians = state.rotation.map((degrees) => (degrees * Math.PI) / 180);
  return new THREE_API.Vector3(0, 0, 16)
    .applyEuler(new THREE_API.Euler(radians[0], radians[1], radians[2], "ZYX"))
    .add(position);
}

interface ObjectTransformSnapshot {
  node: Three.Object3D;
  position: Three.Vector3;
  quaternion: Three.Quaternion;
  scale: Three.Vector3;
  visible: boolean;
  matrixAutoUpdate: boolean;
}

export function withTemporaryAnimationPose<T>(
  project: ModelProject,
  animationId: string | null,
  time: number | null,
  callback: () => T
): T {
  return runInProjectContext(project, () => {
    const transforms: ObjectTransformSnapshot[] = [];
    project.model_3d.traverse((node) => transforms.push({
      node,
      position: node.position.clone(),
      quaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
      visible: node.visible,
      matrixAutoUpdate: node.matrixAutoUpdate,
    }));
    const selectedFlags = project.animations.map((animation) => animation.selected);
    const animationGlobal = (globalThis as typeof globalThis & {
      Animation: { selected: _Animation | null };
    }).Animation;
    const selectedAnimation = animationGlobal.selected;
    const timelineTime = Timeline.time;
    try {
      Animator.showDefaultPose?.();
      if (animationId) {
        const matches = project.animations.filter((animation) => animation.uuid === animationId);
        if (matches.length !== 1) {
          throw new Error(
            `Preview animation '${animationId}' is no longer present exactly once.`
          );
        }
        animationGlobal.selected = matches[0];
        Timeline.setTime(time ?? 0);
        Animator.preview();
      }
      project.model_3d.updateMatrixWorld(true);
      return callback();
    } finally {
      project.animations.forEach((animation, index) => {
        animation.selected = selectedFlags[index] ?? false;
      });
      animationGlobal.selected = selectedAnimation;
      Timeline.time = timelineTime;
      for (const snapshot of transforms) {
        snapshot.node.position.copy(snapshot.position);
        snapshot.node.quaternion.copy(snapshot.quaternion);
        snapshot.node.scale.copy(snapshot.scale);
        snapshot.node.visible = snapshot.visible;
        snapshot.node.matrixAutoUpdate = snapshot.matrixAutoUpdate;
        snapshot.node.updateMatrix();
      }
      project.model_3d.updateMatrixWorld(true);
    }
  });
}

function cloneProjectModelForSession(
  project: ModelProject,
  sessionId?: string
): Three.Object3D {
  const previewState = getSessionPreviewAnimationState(sessionId, project.uuid);
  if (!previewState) return project.model_3d.clone(true);
  return withTemporaryAnimationPose(
    project,
    previewState.animationId,
    previewState.time,
    () => project.model_3d.clone(true)
  );
}

export type OffscreenRenderPass =
  | "color"
  | "depth"
  | "element_id"
  | "face_normal"
  | "wireframe"
  | "xray"
  | "backface"
  | "unlit";

export interface OffscreenRenderOptions {
  pass?: OffscreenRenderPass;
  includedNodeIds?: string[];
  idNodeIds?: string[];
  cloneTransforms?: Array<{
    nodeId: string;
    channel: "rotation" | "position" | "scale";
    axis: "x" | "y" | "z";
    value: number;
    mode?: "add" | "replace";
  }>;
}

export interface OffscreenRenderResult {
  data_url: string;
  rgba: Uint8Array | null;
  id_legend: Array<{ uuid: string; name: string; rgb: [number, number, number] }>;
}

function renderProjectOffscreenDetailed(
  project: ModelProject,
  state: McpCameraState,
  width: number,
  height: number,
  sessionId?: string,
  options: OffscreenRenderOptions = {}
): OffscreenRenderResult {
  const preview = Screencam.NoAAPreview as Preview & {
    resize(width: number, height: number): void;
  };
  if (!preview?.renderer) {
    throw new Error("Blockbench's offscreen viewport renderer is unavailable.");
  }
  const previous = {
    isOrtho: preview.isOrtho,
    width: preview.canvas.width,
    height: preview.canvas.height,
    target: preview.controls.target.clone(),
    orthoPosition: preview.camOrtho.position.clone(),
    orthoQuaternion: preview.camOrtho.quaternion.clone(),
    orthoZoom: preview.camOrtho.zoom,
    perspectivePosition: preview.camPers.position.clone(),
    perspectiveQuaternion: preview.camPers.quaternion.clone(),
    perspectiveAspect: preview.camPers.aspect,
    perspectiveFov: preview.camPers.fov,
    outputEncoding: preview.renderer.outputEncoding,
  };
  const THREE_API = getThreeApi();
  const createdMaterials: Three.Material[] = [];
  try {
    preview.isOrtho = state.projection === "orthographic";
    preview.resize(width, height);
    const camera = preview.camera;
    camera.position.fromArray(state.position);
    const target = targetFromCameraState(state);
    preview.controls.target.copy(target);
    preview.controls.object = camera;
    camera.lookAt(target);
    if (preview.isOrtho) {
      preview.camOrtho.zoom = state.zoom ?? 0.5;
      preview.camOrtho.updateProjectionMatrix();
    } else {
      preview.camPers.aspect = width / height;
      preview.camPers.fov = state.fov ?? preview.camPers.fov;
      preview.camPers.updateProjectionMatrix();
    }
    camera.updateMatrixWorld(true);

    const renderScene = new THREE_API.Scene();
    const modelClone = cloneProjectModelForSession(project, sessionId);
    const sourceNodes: Three.Object3D[] = [];
    const clonedNodes: Three.Object3D[] = [];
    project.model_3d.traverse((node) => sourceNodes.push(node));
    modelClone.traverse((node) => clonedNodes.push(node));
    const sourceToClone = new Map<Three.Object3D, Three.Object3D>();
    for (let index = 0; index < Math.min(sourceNodes.length, clonedNodes.length); index += 1) {
      sourceToClone.set(sourceNodes[index], clonedNodes[index]);
    }
    if (options.includedNodeIds) {
      const included = new Set(options.includedNodeIds);
      const allNodes = [...project.groups, ...project.elements] as Array<Group | OutlinerElement>;
      const byId = new Map(allNodes.map((node) => [node.uuid, node]));
      const includeWithRelations = new Set<string>();
      const includeDescendants = (node: Group | OutlinerElement): void => {
        includeWithRelations.add(node.uuid);
        const children = (node as Group & { children?: Array<Group | OutlinerElement> }).children;
        if (Array.isArray(children)) children.forEach(includeDescendants);
      };
      for (const id of included) {
        const node = byId.get(id);
        if (!node) continue;
        includeDescendants(node);
        let parent = node.parent;
        while (parent && parent !== "root") {
          includeWithRelations.add(parent.uuid);
          parent = parent.parent;
        }
      }
      for (const node of allNodes) {
        const clone = sourceToClone.get(node.scene_object);
        if (clone && !includeWithRelations.has(node.uuid)) clone.visible = false;
      }
    } else {
      applySessionPreviewVisibilityToClone(project, sourceToClone, sessionId);
    }

    for (const transform of options.cloneTransforms ?? []) {
      const sourceNode = [...project.groups, ...project.elements]
        .find((node) => node.uuid === transform.nodeId);
      const clone = sourceNode ? sourceToClone.get(sourceNode.scene_object) : undefined;
      if (!sourceNode || !clone) {
        throw new Error(`Clone transform target '${transform.nodeId}' is no longer present.`);
      }
      const axis = transform.axis;
      const value = transform.channel === "rotation"
        ? transform.value * Math.PI / 180
        : transform.value;
      const vector = transform.channel === "rotation"
        ? clone.rotation
        : transform.channel === "position"
          ? clone.position
          : clone.scale;
      if (transform.mode === "replace") vector[axis] = value;
      else vector[axis] += value;
      clone.updateMatrix();
      clone.updateMatrixWorld(true);
    }

    const pass = options.pass ?? "color";
    if (pass === "element_id") preview.renderer.outputEncoding = THREE_API.LinearEncoding;
    const replaceMaterial = (object: Three.Object3D, material: Three.Material): void => {
      object.traverse((child) => {
        const mesh = child as Three.Mesh;
        if (mesh.isMesh) mesh.material = material;
      });
    };
    const newMaterial = (material: Three.Material): Three.Material => {
      createdMaterials.push(material);
      return material;
    };
    if (pass !== "color" && pass !== "element_id") {
      modelClone.traverse((node) => {
        const mesh = node as Three.Mesh;
        if (!mesh.isMesh) return;
        let material: Three.Material;
        if (pass === "depth") {
          material = newMaterial(new THREE_API.MeshDepthMaterial());
        } else if (pass === "face_normal" || pass === "backface") {
          material = newMaterial(new THREE_API.MeshNormalMaterial({
            side: pass === "backface" ? THREE_API.BackSide : THREE_API.DoubleSide,
          }));
        } else {
          const original = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
          const map = (original as Three.MeshBasicMaterial | undefined)?.map ?? null;
          material = newMaterial(new THREE_API.MeshBasicMaterial({
            color: pass === "xray" ? 0x55ccff : 0xffffff,
            map: pass === "unlit" ? map : null,
            wireframe: pass === "wireframe",
            transparent: pass === "xray",
            opacity: pass === "xray" ? 0.35 : 1,
            depthTest: pass !== "xray",
            side: THREE_API.DoubleSide,
            toneMapped: false,
          }));
        }
        mesh.material = material;
      });
    }

    const idLegend: OffscreenRenderResult["id_legend"] = [];
    if (pass === "element_id") {
      renderScene.background = new THREE_API.Color(0x000000);
      const black = newMaterial(new THREE_API.MeshBasicMaterial({ color: 0x000000, toneMapped: false }));
      replaceMaterial(modelClone, black);
      const requested = new Set(options.idNodeIds ?? options.includedNodeIds ?? project.elements.map((node) => node.uuid));
      let colorIndex = 1;
      for (const node of project.elements) {
        if (!requested.has(node.uuid)) continue;
        const clone = sourceToClone.get(node.scene_object);
        if (!clone) continue;
        const red = colorIndex & 0xff;
        const green = (colorIndex >> 8) & 0xff;
        const blue = (colorIndex >> 16) & 0xff;
        const color = (red << 16) | (green << 8) | blue;
        const material = newMaterial(new THREE_API.MeshBasicMaterial({
          color,
          side: THREE_API.DoubleSide,
          toneMapped: false,
          fog: false,
        }));
        replaceMaterial(clone, material);
        idLegend.push({ uuid: node.uuid, name: node.name, rgb: [red, green, blue] });
        colorIndex++;
      }
    }
    renderScene.add(modelClone);
    let lightCount = 0;
    const canvasScene = (Canvas as typeof Canvas & { scene?: Three.Scene }).scene;
    canvasScene?.traverse((node) => {
      if ((node as Three.Light).isLight) {
        renderScene.add(node.clone());
        lightCount += 1;
      }
    });
    if (pass === "element_id" || pass === "depth" || pass === "face_normal" || pass === "wireframe" || pass === "xray" || pass === "backface" || pass === "unlit") {
      for (const child of [...renderScene.children]) {
        if ((child as Three.Light).isLight) renderScene.remove(child);
      }
    } else if (lightCount === 0) {
      renderScene.add(new THREE_API.AmbientLight(0xffffff, 1.5));
      const key = new THREE_API.DirectionalLight(0xffffff, 2);
      key.position.set(-1, 2, -1);
      renderScene.add(key);
    }
    renderScene.updateMatrixWorld(true);
    preview.renderer.render(renderScene, camera);
    let rgba: Uint8Array | null = null;
    if (pass === "element_id") {
      const context = preview.renderer.getContext();
      rgba = new Uint8Array(width * height * 4);
      context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, rgba);
    }
    return {
      data_url: preview.canvas.toDataURL("image/png"),
      rgba,
      id_legend: idLegend,
    };
  } finally {
    createdMaterials.forEach((material) => material.dispose());
    preview.isOrtho = previous.isOrtho;
    preview.resize(previous.width, previous.height);
    preview.controls.target.copy(previous.target);
    preview.camOrtho.position.copy(previous.orthoPosition);
    preview.camOrtho.quaternion.copy(previous.orthoQuaternion);
    preview.camOrtho.zoom = previous.orthoZoom;
    preview.camOrtho.updateProjectionMatrix();
    preview.camPers.position.copy(previous.perspectivePosition);
    preview.camPers.quaternion.copy(previous.perspectiveQuaternion);
    preview.camPers.aspect = previous.perspectiveAspect;
    preview.camPers.fov = previous.perspectiveFov;
    preview.camPers.updateProjectionMatrix();
    preview.renderer.outputEncoding = previous.outputEncoding;
    preview.controls.object = preview.camera;
  }
}

function renderProjectOffscreen(
  project: ModelProject,
  state: McpCameraState,
  width: number,
  height: number,
  sessionId?: string
): string {
  return renderProjectOffscreenDetailed(project, state, width, height, sessionId).data_url;
}

export async function captureOffscreenValidationPass(
  project: ModelProject,
  camera: McpCameraState,
  width: number,
  height: number,
  sessionId: string | undefined,
  options: OffscreenRenderOptions
): Promise<OffscreenRenderResult> {
  await waitForRenderFrames(1);
  return renderProjectOffscreenDetailed(project, camera, width, height, sessionId, options);
}

export async function captureScreenshot(
  project?: string,
  settleFrames = 2,
  sessionId?: string,
  workingProject?: ModelProject | null,
  width = 800,
  height = 600
) {
  const target = resolveScreenshotProject(project, sessionId, workingProject);

  await waitForRenderFrames(settleFrames);
  const camera = getEffectiveCameraState(target, sessionId, [width, height]);
  return {
    ...imageContent(
      renderProjectOffscreen(target, camera, width, height, sessionId),
      "image/png"
    ),
    structuredContent: {
      schema_version: "1",
      project: { uuid: target.uuid, name: target.name },
      camera,
      settle_frames: settleFrames,
    },
  };
}

/**
 * Captures a screenshot of the entire Blockbench application window.
 * Uses Electron's native capturePage API through Blockbench's Screencam.
 * Only available when running as a desktop application.
 */
export async function captureAppScreenshot(): Promise<ReturnType<typeof imageContent>> {
  return new Promise((resolve, reject) => {
    let resolved = false;

    // Add a timeout in case the callback is never called
    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("App screenshot timed out after 5 seconds."));
      }
    }, 5000);

    // Use Blockbench's native Screencam.fullScreen which uses Electron's capturePage
    // @ts-ignore - Screencam is globally available in Blockbench
    Screencam.fullScreen({}, (dataUrl: string) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        if (dataUrl) {
          resolve(imageContent(dataUrl, "image/png"));
        } else {
          reject(
            new Error("Failed to capture app screenshot - no data returned.")
          );
        }
      }
    });
  });
}
