import { findElementOrThrow } from "@/lib/util";
import { geometricDescendants, type InspectableGeometryNode } from "@/lib/sceneGeometry";
import { type UvFaceRecord, type UvPoint } from "@/lib/uvIntegrity";

export function rounded(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(6));
}

export function tuple(value: readonly number[]): [number, number, number] {
  return [rounded(value[0]), rounded(value[1]), rounded(value[2])];
}

export function midpoint(
  first: readonly number[],
  second: readonly number[]
): [number, number, number] {
  return tuple([
    (first[0] + second[0]) / 2,
    (first[1] + second[1]) / 2,
    (first[2] + second[2]) / 2,
  ]);
}

export interface FaceLike {
  texture?: string | false | null;
  uv?: number[] | Record<string, number[]>;
  rotation?: number;
  enabled?: boolean;
  vertices?: string[];
}

export interface CubeLike extends OutlinerElement {
  faces: Record<string, FaceLike>;
  from: number[];
  to: number[];
  mirror_uv?: boolean;
}

export interface MeshLike extends OutlinerElement {
  faces: Record<string, FaceLike>;
  vertices: Record<string, number[]>;
}

function resolveTexture(project: ModelProject, reference: string | false | null | undefined): Texture | null {
  if (!reference) return null;
  const matches = project.textures.filter((texture) => texture.uuid === reference);
  return matches.length === 1 ? matches[0] : null;
}

export function effectiveUvSize(project: ModelProject, texture: Texture | null): [number, number] {
  return project.format.per_texture_uv_size && texture
    ? [texture.uv_width || project.texture_width, texture.uv_height || project.texture_height]
    : [project.texture_width, project.texture_height];
}

function worldPolygonArea(node: InspectableGeometryNode, points: readonly number[][]): number | null {
  if (points.length < 3) return 0;
  const THREE_API = (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;
  const object = node.scene_object;
  object.updateWorldMatrix(true, false);
  const world = points.map((point) =>
    new THREE_API.Vector3(point[0], point[1], point[2]).applyMatrix4(object.matrixWorld)
  );
  let area = 0;
  for (let index = 1; index + 1 < world.length; index++) {
    const first = world[index].clone().sub(world[0]);
    const second = world[index + 1].clone().sub(world[0]);
    area += first.cross(second).length() / 2;
  }
  return area;
}

function cubeFaceLocalPoints(cube: CubeLike, face: string): number[][] {
  const [x1, y1, z1] = cube.from;
  const [x2, y2, z2] = cube.to;
  switch (face) {
    case "north": return [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]];
    case "south": return [[x2, y1, z2], [x1, y1, z2], [x1, y2, z2], [x2, y2, z2]];
    case "east": return [[x2, y1, z1], [x2, y1, z2], [x2, y2, z2], [x2, y2, z1]];
    case "west": return [[x1, y1, z2], [x1, y1, z1], [x1, y2, z1], [x1, y2, z2]];
    case "up": return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    case "down": return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
    default: return [];
  }
}

export function uvRecordsForElements(
  project: ModelProject,
  elements: readonly InspectableGeometryNode[]
): UvFaceRecord[] {
  const records: UvFaceRecord[] = [];
  const seen = new Set<string>();
  for (const requested of elements) {
    for (const node of geometricDescendants(requested)) {
      if (seen.has(node.uuid)) continue;
      seen.add(node.uuid);
      if (node instanceof Cube) {
        const cube = node as CubeLike;
        for (const [key, face] of Object.entries(cube.faces)) {
          const uv = Array.isArray(face.uv) ? face.uv : [];
          const uvPoints: UvPoint[] = uv.length >= 4
            ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]
            : [];
          const texture = resolveTexture(project, face.texture);
          records.push({
            face_id: `${cube.uuid}/${key}`,
            element_uuid: cube.uuid,
            element_name: cube.name,
            element_type: "cube",
            face_key: key,
            enabled: face.enabled !== false && face.texture !== null,
            texture_uuid: texture?.uuid ?? null,
            texture_name: texture?.name ?? null,
            texture_size: texture ? [texture.width, texture.height] : null,
            uv_size: effectiveUvSize(project, texture),
            uv_points: uvPoints,
            rotation: Number(face.rotation ?? 0),
            mirrored: Boolean(cube.mirror_uv || (uv.length >= 4 && (uv[0] > uv[2] || uv[1] > uv[3]))),
            world_area: worldPolygonArea(cube, cubeFaceLocalPoints(cube, key)),
          });
        }
      } else if (node instanceof Mesh) {
        const mesh = node as MeshLike;
        for (const [key, face] of Object.entries(mesh.faces)) {
          const vertices = face.vertices ?? Object.keys(face.uv ?? {});
          const uvMap = !Array.isArray(face.uv) && face.uv ? face.uv : {};
          const uvPoints = vertices.flatMap((vertex): UvPoint[] => {
            const point = uvMap[vertex];
            return point?.length >= 2 ? [[point[0], point[1]]] : [];
          });
          const texture = resolveTexture(project, face.texture);
          records.push({
            face_id: `${mesh.uuid}/${key}`,
            element_uuid: mesh.uuid,
            element_name: mesh.name,
            element_type: "mesh",
            face_key: key,
            enabled: face.enabled !== false && face.texture !== null,
            texture_uuid: texture?.uuid ?? null,
            texture_name: texture?.name ?? null,
            texture_size: texture ? [texture.width, texture.height] : null,
            uv_size: effectiveUvSize(project, texture),
            uv_points: uvPoints,
            rotation: Number(face.rotation ?? 0),
            mirrored: null,
            world_area: worldPolygonArea(mesh, vertices.map((vertex) => mesh.vertices[vertex]).filter(Boolean)),
          });
        }
      }
    }
  }
  return records;
}

export function uniqueNodes(nodes: readonly InspectableGeometryNode[]): InspectableGeometryNode[] {
  return [...new Map(nodes.map((node) => [node.uuid, node])).values()];
}

export function resolveNodes(references: readonly string[]): InspectableGeometryNode[] {
  return uniqueNodes(references.map((reference) => findElementOrThrow(reference) as InspectableGeometryNode));
}
