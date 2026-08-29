/// <reference types="three" />
/// <reference types="blockbench-types" />
import type { Triangle3 } from "@/lib/measurements";
import type { Vector3Tuple } from "@/lib/spatialRelations";
import type { OrientedBox } from "@/lib/contactAnalysis";

export type InspectableGeometryNode = OutlinerElement | Group;

export interface NodeGeometry {
  vertices: Vector3Tuple[];
  triangles: Triangle3[];
}

function three(): typeof import("three") {
  return (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;
}

function geometryForNode(node: InspectableGeometryNode): THREE.BufferGeometry | null {
  const sceneObject = node.scene_object as THREE.Object3D & { geometry?: THREE.BufferGeometry };
  return sceneObject.geometry ?? null;
}

export function extractNodeGeometry(
  node: InspectableGeometryNode,
  recursive = true
): NodeGeometry {
  const vertices: Vector3Tuple[] = [];
  const triangles: Triangle3[] = [];
  const THREE_API = three();
  const visit = (current: InspectableGeometryNode): void => {
    const sceneObject = current.scene_object as THREE.Object3D;
    sceneObject.updateWorldMatrix(true, false);
    const geometry = geometryForNode(current);
    const positions = geometry?.attributes?.position;
    if (positions) {
      const transformed: Vector3Tuple[] = [];
      for (let index = 0; index < positions.count; index += 1) {
        const point = new THREE_API.Vector3(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index)
        ).applyMatrix4(sceneObject.matrixWorld);
        const value: Vector3Tuple = [point.x, point.y, point.z];
        transformed.push(value);
        vertices.push(value);
      }
      const indices = geometry!.index;
      const count = indices?.count ?? positions.count;
      const indexAt = (offset: number): number => indices ? indices.getX(offset) : offset;
      for (let offset = 0; offset + 2 < count; offset += 3) {
        const a = transformed[indexAt(offset)];
        const b = transformed[indexAt(offset + 1)];
        const c = transformed[indexAt(offset + 2)];
        if (a && b && c) triangles.push({ a, b, c });
      }
    }
    if (!recursive) return;
    const children = (current as InspectableGeometryNode & {
      children?: InspectableGeometryNode[];
    }).children;
    if (Array.isArray(children)) children.forEach(visit);
  };
  visit(node);
  return { vertices, triangles };
}

export function geometricDescendants(node: InspectableGeometryNode): InspectableGeometryNode[] {
  const values: InspectableGeometryNode[] = [];
  const visit = (current: InspectableGeometryNode): void => {
    if (geometryForNode(current)?.attributes?.position) values.push(current);
    const children = (current as InspectableGeometryNode & {
      children?: InspectableGeometryNode[];
    }).children;
    if (Array.isArray(children)) children.forEach(visit);
  };
  visit(node);
  return values;
}

/** Builds the exact world OBB represented by a transformed box geometry. */
export function orientedBoxFromNode(node: InspectableGeometryNode): OrientedBox | null {
  const THREE_API = three();
  const object = node.scene_object as THREE.Object3D;
  const geometry = geometryForNode(node);
  if (!geometry?.attributes?.position) return null;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return null;
  object.updateWorldMatrix(true, false);

  const localCenter = geometry.boundingBox.getCenter(new THREE_API.Vector3());
  const localSize = geometry.boundingBox.getSize(new THREE_API.Vector3());
  const elements = object.matrixWorld.elements;
  const columns = [
    new THREE_API.Vector3(elements[0], elements[1], elements[2]),
    new THREE_API.Vector3(elements[4], elements[5], elements[6]),
    new THREE_API.Vector3(elements[8], elements[9], elements[10]),
  ];
  const scales = columns.map((column) => column.length());
  if (scales.some((scale) => scale <= 1e-12)) return null;
  const axes = columns.map((column) => column.clone().normalize());
  // Parent non-uniform scale combined with rotation can shear a descendant cube.
  // A sheared parallelepiped is not an OBB, so let the triangle path report its
  // bounded result instead of labelling an inexact SAT result as exact.
  if (
    Math.abs(axes[0].dot(axes[1])) > 1e-6
    || Math.abs(axes[0].dot(axes[2])) > 1e-6
    || Math.abs(axes[1].dot(axes[2])) > 1e-6
  ) return null;
  return {
    center: localCenter.applyMatrix4(object.matrixWorld).toArray() as Vector3Tuple,
    axes: axes.map((axis) => axis.toArray() as Vector3Tuple) as OrientedBox["axes"],
    half_sizes: [
      localSize.x * scales[0] / 2,
      localSize.y * scales[1] / 2,
      localSize.z * scales[2] / 2,
    ],
  };
}

export function ancestorTransformProvenance(node: InspectableGeometryNode) {
  const chain: Array<{
    uuid: string;
    name: string;
    type: string;
    local_matrix: number[];
    world_matrix: number[];
  }> = [];
  let current: InspectableGeometryNode | undefined = node;
  while (current) {
    current.scene_object.updateWorldMatrix(true, false);
    chain.push({
      uuid: current.uuid,
      name: current.name,
      type: current instanceof Group ? "group" : current.type,
      local_matrix: current.scene_object.matrix.toArray(),
      world_matrix: current.scene_object.matrixWorld.toArray(),
    });
    current = current.parent && current.parent !== "root"
      ? current.parent as InspectableGeometryNode
      : undefined;
  }
  return chain;
}
