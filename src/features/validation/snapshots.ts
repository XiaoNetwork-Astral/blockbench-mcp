/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { getEffectiveCameraState } from "@/lib/util";
import { ancestorTransformProvenance, geometricDescendants, type InspectableGeometryNode } from "@/lib/sceneGeometry";
import { type UvFaceRecord } from "@/lib/uvIntegrity";
import { bytesSha256, stableSha256 } from "@/lib/stableDigest";
import type { McpCameraState } from "@/src/blockbench/camera";
import { describeProject } from "@/lib/projectAccess";
import { type CubeLike, type MeshLike, type FaceLike, uniqueNodes, resolveNodes, uvRecordsForElements } from "@/src/features/validation/geometry";
import { createValidationSnapshotParameters, authorizedPixelRegionSchema } from "@/src/features/validation/schemas";

const MAX_VALIDATION_SNAPSHOT_PIXEL_BYTES = 64 * 1024 * 1024;

interface TextureSnapshot {
  uuid: string;
  name: string;
  width: number;
  height: number;
  digest: string;
  pixels: string | null;
  pixel_capture_status: "captured" | "size_limit" | "dimension_mismatch" | "unavailable";
  pixel_byte_length: number | null;
  digest_source: "rgba" | "data_url" | "metadata";
}

function texturePixels(texture: Texture, maxBytes: number): {
  pixels: string | null;
  status: TextureSnapshot["pixel_capture_status"];
  byteLength: number | null;
} {
  const surface = (texture as Texture & { canvas?: HTMLCanvasElement }).canvas;
  const context = surface?.getContext("2d", { willReadFrequently: true });
  if (!surface || !context) return { pixels: null, status: "unavailable", byteLength: null };
  // Pixel dimensions are part of the snapshot contract. If Blockbench's backing
  // canvas is temporarily a different size, omit bytes instead of mislabelling them.
  if (surface.width !== texture.width || surface.height !== texture.height) {
    return { pixels: null, status: "dimension_mismatch", byteLength: null };
  }
  const byteLength = surface.width * surface.height * 4;
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) {
    return { pixels: null, status: "size_limit", byteLength };
  }
  try {
    const data = context.getImageData(0, 0, surface.width, surface.height).data;
    return { pixels: Buffer.from(data).toString("base64"), status: "captured", byteLength };
  } catch {
    return { pixels: null, status: "unavailable", byteLength: null };
  }
}

function captureTexture(texture: Texture, maxBytes: number): TextureSnapshot {
  const captured = texturePixels(texture, maxBytes);
  let digest: string;
  let digestSource: TextureSnapshot["digest_source"];
  if (captured.pixels) {
    digest = bytesSha256(Buffer.from(captured.pixels, "base64"));
    digestSource = "rgba";
  } else {
    try {
      digest = bytesSha256(texture.getDataURL());
      digestSource = "data_url";
    } catch {
      digest = stableSha256({
        uuid: texture.uuid,
        name: texture.name,
        width: texture.width,
        height: texture.height,
      });
      digestSource = "metadata";
    }
  }
  return {
    uuid: texture.uuid,
    name: texture.name,
    width: texture.width,
    height: texture.height,
    digest,
    pixels: captured.pixels,
    pixel_capture_status: captured.status,
    pixel_byte_length: captured.byteLength,
    digest_source: digestSource,
  };
}

function nodeSnapshot(node: InspectableGeometryNode) {
  node.scene_object.updateWorldMatrix(true, false);
  const base = {
    uuid: node.uuid,
    name: node.name,
    type: node instanceof Group ? "group" : node.type,
    parent_uuid: node.parent && node.parent !== "root" ? node.parent.uuid : null,
    local_matrix: node.scene_object.matrix.toArray(),
    world_matrix: node.scene_object.matrixWorld.toArray(),
    ancestors: ancestorTransformProvenance(node),
  };
  let geometry: unknown = null;
  if (node instanceof Cube) {
    const cube = node as CubeLike & {
      origin?: number[];
      rotation?: number[];
      inflate?: number;
      box_uv?: boolean;
      uv_offset?: number[];
    };
    geometry = {
      from: cube.from,
      to: cube.to,
      origin: cube.origin,
      rotation: cube.rotation,
      inflate: cube.inflate,
      box_uv: cube.box_uv,
      uv_offset: cube.uv_offset,
      mirror_uv: cube.mirror_uv,
      faces: snapshotFaces(cube.faces),
    };
  } else if (node instanceof Mesh) {
    const mesh = node as MeshLike;
    geometry = {
      vertices: Object.fromEntries(Object.entries(mesh.vertices).map(([key, point]) => [key, [...point]])),
      faces: snapshotFaces(mesh.faces),
    };
  } else if (node instanceof Group) {
    geometry = { children: node.children.map((child) => child.uuid) };
  }
  return {
    ...base,
    geometry,
    transform_digest: stableSha256({
      local_matrix: base.local_matrix,
      world_matrix: base.world_matrix,
      ancestors: base.ancestors,
    }),
    geometry_digest: stableSha256(geometry),
  };
}

function snapshotFaces(faces: Record<string, FaceLike>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(faces).map(([key, face]) => [key, {
    texture: face.texture ?? null,
    uv: Array.isArray(face.uv)
      ? [...face.uv]
      : face.uv
        ? Object.fromEntries(Object.entries(face.uv).map(([vertex, point]) => [vertex, [...point]]))
        : null,
    rotation: Number(face.rotation ?? 0),
    enabled: face.enabled !== false,
    vertices: face.vertices ? [...face.vertices] : null,
  }]));
}

interface ValidationState {
  project: ReturnType<typeof describeProject>;
  target_uuids: string[];
  neighbor_uuids: string[];
  target_scope_uuids: string[];
  neighbor_scope_uuids: string[];
  nodes: ReturnType<typeof nodeSnapshot>[];
  uv: UvFaceRecord[];
  uv_digest: string | null;
  textures: TextureSnapshot[];
  texture_digest: string | null;
  camera: McpCameraState | null;
  visibility: null;
  animation: null;
  pose_digest: string;
  camera_digest: string;
  history_index: number | null;
  root_digest: string;
}

export interface ValidationSnapshotValue {
  input: z.infer<typeof createValidationSnapshotParameters>;
  state: ValidationState;
}

function resolveCurrentSnapshotNodes(
  project: ModelProject,
  uuids: readonly string[]
): InspectableGeometryNode[] {
  const all = [...project.groups, ...project.elements] as InspectableGeometryNode[];
  return uniqueNodes(uuids.flatMap((uuid) => {
    const matches = all.filter((node) => node.uuid === uuid);
    if (matches.length > 1) {
      throw new Error(`Snapshot element UUID '${uuid}' is duplicated in the current project.`);
    }
    return matches;
  }));
}

function currentHistoryIndex(): number | null {
  const runtime = Undo as typeof Undo & { index?: number; history?: unknown[] };
  if (typeof runtime.index === "number") return runtime.index;
  return Array.isArray(runtime.history) ? runtime.history.length : null;
}

export function collectValidationState(
  project: ModelProject,
  input: z.infer<typeof createValidationSnapshotParameters>,
  allowMissingRoots = false
): ValidationState {
  const targets = allowMissingRoots
    ? resolveCurrentSnapshotNodes(project, input.targets)
    : resolveNodes(input.targets);
  const neighbors = allowMissingRoots
    ? resolveCurrentSnapshotNodes(project, input.neighbors)
    : resolveNodes(input.neighbors);
  const targetScope = uniqueNodes(targets.flatMap(geometricDescendants));
  const neighborScope = uniqueNodes(neighbors.flatMap(geometricDescendants));
  const expanded = uniqueNodes([...targetScope, ...neighborScope]);
  const nodes = expanded.map(nodeSnapshot);
  const allUv = input.include_uv || input.include_textures
    ? uvRecordsForElements(project, expanded)
    : [];
  const uv = input.include_uv ? allUv : [];
  const relevantTextureUuids = new Set(
    allUv.flatMap((record) => record.texture_uuid ? [record.texture_uuid] : [])
  );
  let remainingPixelBytes = MAX_VALIDATION_SNAPSHOT_PIXEL_BYTES;
  const textures = input.include_textures
    ? project.textures
      .filter((texture) => relevantTextureUuids.has(texture.uuid))
      .map((texture) => {
        const snapshot = captureTexture(texture, remainingPixelBytes);
        if (snapshot.pixels && snapshot.pixel_byte_length !== null) {
          remainingPixelBytes -= snapshot.pixel_byte_length;
        }
        return snapshot;
      })
    : [];
  const camera = getEffectiveCameraState(project);
  const visibility = null;
  const animation = null;
  const stateWithoutRoot = {
    project: describeProject(project),
    target_uuids: targets.map((node) => node.uuid),
    neighbor_uuids: neighbors.map((node) => node.uuid),
    target_scope_uuids: targetScope.map((node) => node.uuid),
    neighbor_scope_uuids: neighborScope.map((node) => node.uuid),
    nodes,
    uv,
    uv_digest: input.include_uv ? stableSha256(uv) : null,
    textures,
    texture_digest: input.include_textures
      ? stableSha256(textures.map(({ pixels: _pixels, ...texture }) => texture))
      : null,
    camera,
    visibility,
    animation,
    pose_digest: stableSha256({ visibility, animation }),
    camera_digest: stableSha256(camera),
    history_index: currentHistoryIndex(),
  };
  return {
    ...stateWithoutRoot,
    root_digest: stableSha256({
      project_uuid: project.uuid,
      target_uuids: stateWithoutRoot.target_uuids,
      neighbor_uuids: stateWithoutRoot.neighbor_uuids,
      target_scope_uuids: stateWithoutRoot.target_scope_uuids,
      neighbor_scope_uuids: stateWithoutRoot.neighbor_scope_uuids,
      nodes: nodes.map((node) => ({
        uuid: node.uuid,
        transform_digest: node.transform_digest,
        geometry_digest: node.geometry_digest,
      })),
      uv_digest: stateWithoutRoot.uv_digest,
      texture_digest: stateWithoutRoot.texture_digest,
      pose_digest: stateWithoutRoot.pose_digest,
      camera_digest: stateWithoutRoot.camera_digest,
    }),
  };
}

export function publicState(state: ValidationState) {
  return {
    ...state,
    textures: state.textures.map(({ pixels: _pixels, ...texture }) => ({
      ...texture,
      pixel_data_captured: Boolean(_pixels),
    })),
  };
}

function changedPixels(
  before: TextureSnapshot,
  after: TextureSnapshot,
  authorized: z.infer<typeof authorizedPixelRegionSchema>[]
) {
  const regions = authorized.filter((region) => region.texture_uuid === before.uuid);
  const authorizationChecked = regions.length > 0;
  if (!before.pixels || !after.pixels || before.width !== after.width || before.height !== after.height) {
    return {
      available: false,
      authorization_checked: authorizationChecked,
      count: null,
      inside_authorized: null,
      outside_authorized: null,
      bounds: null,
    };
  }
  const first = Buffer.from(before.pixels, "base64");
  const second = Buffer.from(after.pixels, "base64");
  let count = 0;
  let inside = 0;
  let outside = 0;
  let minX = before.width;
  let minY = before.height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < before.width * before.height; pixel++) {
    const offset = pixel * 4;
    if (
      first[offset] === second[offset]
      && first[offset + 1] === second[offset + 1]
      && first[offset + 2] === second[offset + 2]
      && first[offset + 3] === second[offset + 3]
    ) continue;
    count++;
    const x = pixel % before.width;
    const y = Math.floor(pixel / before.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (authorizationChecked) {
      const allowed = regions.some((region) => {
        const [x1, y1, x2, y2] = region.rectangle;
        return x >= Math.min(x1, x2) && x <= Math.max(x1, x2)
          && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
      });
      if (allowed) inside++;
      else outside++;
    }
  }
  return {
    available: true,
    authorization_checked: authorizationChecked,
    count,
    inside_authorized: authorizationChecked ? inside : null,
    outside_authorized: authorizationChecked ? outside : null,
    bounds: count ? [minX, minY, maxX, maxY] : null,
  };
}

export function diffStates(
  before: ValidationState,
  after: ValidationState,
  authorized: z.infer<typeof authorizedPixelRegionSchema>[]
) {
  const beforeNodes = new Map(before.nodes.map((node) => [node.uuid, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.uuid, node]));
  const changedNodes = [...new Set([...beforeNodes.keys(), ...afterNodes.keys()])].flatMap((uuid) => {
    const first = beforeNodes.get(uuid);
    const second = afterNodes.get(uuid);
    if (!first || !second) return [{ uuid, status: first ? "removed" : "added", transform_changed: true, geometry_changed: true }];
    const transformChanged = first.transform_digest !== second.transform_digest;
    const geometryChanged = first.geometry_digest !== second.geometry_digest;
    return transformChanged || geometryChanged
      ? [{ uuid, status: "modified", transform_changed: transformChanged, geometry_changed: geometryChanged }]
      : [];
  });
  const beforeTextures = new Map(before.textures.map((texture) => [texture.uuid, texture]));
  const afterTextures = new Map(after.textures.map((texture) => [texture.uuid, texture]));
  const textureChanges: Array<{
    uuid: string;
    status: string;
    pixels: ReturnType<typeof changedPixels> | null;
  }> = [];
  for (const uuid of new Set([...beforeTextures.keys(), ...afterTextures.keys()])) {
    const first = beforeTextures.get(uuid);
    const second = afterTextures.get(uuid);
    if (!first || !second) {
      textureChanges.push({ uuid, status: first ? "removed" : "added", pixels: null });
    } else if (first.digest !== second.digest) {
      textureChanges.push({ uuid, status: "modified", pixels: changedPixels(first, second, authorized) });
    }
  }
  const targetSet = new Set([...before.target_scope_uuids, ...after.target_scope_uuids]);
  const neighborSet = new Set([...before.neighbor_scope_uuids, ...after.neighbor_scope_uuids]);
  const targetChanged = changedNodes.some((change) => targetSet.has(change.uuid));
  const neighborChanged = changedNodes.some((change) => neighborSet.has(change.uuid));
  const uvChanged = before.uv_digest !== after.uv_digest;
  const texturesChanged = textureChanges.length > 0;
  const poseChanged = before.pose_digest !== after.pose_digest;
  const cameraChanged = before.camera_digest !== after.camera_digest;
  const invalidated = [
    targetChanged || neighborChanged ? "contact_and_clearance_measurements" : null,
    uvChanged || texturesChanged ? "uv_and_texture_integrity_evidence" : null,
    targetChanged || neighborChanged || poseChanged || cameraChanged ? "camera_and_visibility_captures" : null,
    targetChanged || neighborChanged || poseChanged ? "pose_sweep_results" : null,
  ].filter((value): value is string => Boolean(value));
  const valid = [
    !targetChanged && !neighborChanged ? "contact_and_clearance_measurements" : null,
    !uvChanged && !texturesChanged ? "uv_and_texture_integrity_evidence" : null,
    !targetChanged && !neighborChanged && !poseChanged && !cameraChanged ? "camera_and_visibility_captures" : null,
    !targetChanged && !neighborChanged && !poseChanged ? "pose_sweep_results" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    changed: before.root_digest !== after.root_digest,
    project_uuid: before.project.uuid,
    root_digest: { before: before.root_digest, current: after.root_digest },
    history_index: { before: before.history_index, current: after.history_index },
    nodes: changedNodes,
    uv_changed: uvChanged,
    textures: textureChanges,
    pose_changed: poseChanged,
    camera_changed: cameraChanged,
    invalidated_evidence: invalidated,
    still_valid_evidence: valid,
  };
}
