import {
  getForegroundProject,
  getSessionCameraState,
  peekSessionWorkingProject,
  resolveOpenProject,
  runInProjectContext,
  type McpCameraState,
} from "@/lib/projectContext";

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

/**
 * Return the routed project's textures without assuming that Blockbench has
 * already synchronized both texture registries. This matters immediately
 * after creating or reopening a texture, when either registry can briefly
 * lag behind the other.
 */
export function getProjectTextures(): Texture[] {
  const textures: Texture[] = [];
  const seen = new Set<Texture>();
  for (const texture of [...(Project?.textures ?? []), ...(Texture.all ?? [])]) {
    if (seen.has(texture)) continue;
    seen.add(texture);
    textures.push(texture);
  }
  return textures;
}

export function getProjectTexture(id: string): Texture | null {
  const texture = getProjectTextures().find(
    ({ id: textureId, name, uuid }) =>
      String(textureId) === id || name === id || uuid === id
  );

  return texture || null;
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
  const uuidMatch = groups.find((group: Group) => group.uuid === name);
  if (uuidMatch) return uuidMatch;
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
  const uuidMatch = Mesh.all.find((mesh: Mesh) => mesh.uuid === id);
  if (uuidMatch) return uuidMatch;
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
  const group = TextureGroup.all.find(
    (g: TextureGroup) => g.uuid === id || g.name === id
  );
  if (!group) {
    throw new Error(
      `Material/texture group "${id}" not found. Use inspect_materials with command.action "list_materials" to see available materials.`
    );
  }
  return group;
}

/**
 * Helper to get texture info for a PBR channel
 */
export function getChannelTextureInfo(textures: Texture[], channel: string) {
  const tex = textures.find((t: Texture) => t.pbr_channel === channel);
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
}

function tuple3(value: number[] | undefined): [number, number, number] | undefined {
  if (!value || value.length < 3) return undefined;
  return [Number(value[0]), Number(value[1]), Number(value[2])];
}

function fittedCameraState(project: ModelProject): McpCameraState {
  const box = new THREE.Box3().setFromObject(project.model_3d);
  const center = new THREE.Vector3(0, project.format?.block_size ? project.format.block_size * 0.75 : 12, 0);
  let extent = project.format?.block_size || 16;
  if (!box.isEmpty()) {
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());
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

function cameraStateForProject(
  project: ModelProject,
  sessionId?: string
): McpCameraState {
  const sessionState = getSessionCameraState(sessionId, project.uuid);
  if (sessionState) return sessionState;

  if (project === getForegroundProject() && Preview.selected) {
    const preview = Preview.selected;
    return {
      position: preview.camera.position.toArray() as [number, number, number],
      target: preview.controls.target.toArray() as [number, number, number],
      projection: preview.isOrtho ? "orthographic" : "perspective",
      zoom: preview.isOrtho ? preview.camOrtho.zoom : undefined,
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
    };
  }
  return fittedCameraState(project);
}

function targetFromCameraState(state: McpCameraState): THREE.Vector3 {
  if (state.target) return new THREE.Vector3().fromArray(state.target);
  const position = new THREE.Vector3().fromArray(state.position);
  if (!state.rotation) return new THREE.Vector3(0, 0, 0);
  const radians = state.rotation.map((degrees) => (degrees * Math.PI) / 180);
  return new THREE.Vector3(0, 0, 16)
    .applyEuler(new THREE.Euler(radians[0], radians[1], radians[2], "ZYX"))
    .add(position);
}

function renderProjectOffscreen(
  project: ModelProject,
  state: McpCameraState,
  width: number,
  height: number
): string {
  const preview = Screencam.NoAAPreview;
  if (!preview?.renderer) {
    throw new Error("Blockbench's offscreen viewport renderer is unavailable.");
  }

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
    preview.camPers.updateProjectionMatrix();
  }
  camera.updateMatrixWorld(true);

  const renderScene = new THREE.Scene();
  renderScene.add(project.model_3d.clone(true));
  let lightCount = 0;
  const canvasScene = (Canvas as typeof Canvas & { scene?: THREE.Scene }).scene;
  canvasScene?.traverse((node) => {
    if ((node as THREE.Light).isLight) {
      renderScene.add(node.clone());
      lightCount += 1;
    }
  });
  if (lightCount === 0) {
    renderScene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(-1, 2, -1);
    renderScene.add(key);
  }
  renderScene.updateMatrixWorld(true);
  preview.renderer.render(renderScene, camera);
  return preview.canvas.toDataURL("image/png");
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

  runInProjectContext(target, () => Canvas.updateAll());
  await waitForRenderFrames(settleFrames);

  return imageContent(
    renderProjectOffscreen(
      target,
      cameraStateForProject(target, sessionId),
      width,
      height
    ),
    "image/png"
  );
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
