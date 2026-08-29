import {
  closestPointsBetweenTriangles,
  type ClosestPointsResult,
  type Triangle3,
} from "@/lib/measurements";
import type { Bounds3, Vector3Tuple } from "@/lib/spatialRelations";

interface IndexedTriangle {
  triangle: Triangle3;
  index: number;
  bounds: Bounds3;
  centroid: Vector3Tuple;
}

interface BvhNode {
  bounds: Bounds3;
  items?: IndexedTriangle[];
  left?: BvhNode;
  right?: BvhNode;
}

export interface TriangleBvhDistanceResult extends ClosestPointsResult {
  first_triangle: number;
  second_triangle: number;
  comparisons: number;
  truncated: boolean;
  exact_separation: boolean;
  method: "triangle_bvh";
}

function triangleBounds(triangle: Triangle3): Bounds3 {
  const points = [triangle.a, triangle.b, triangle.c];
  return {
    min: [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))) as Vector3Tuple,
    max: [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))) as Vector3Tuple,
  };
}

function unionBounds(items: readonly IndexedTriangle[]): Bounds3 {
  return {
    min: [0, 1, 2].map((axis) => Math.min(...items.map((item) => item.bounds.min[axis]))) as Vector3Tuple,
    max: [0, 1, 2].map((axis) => Math.max(...items.map((item) => item.bounds.max[axis]))) as Vector3Tuple,
  };
}

function build(items: IndexedTriangle[], leafSize: number): BvhNode {
  const bounds = unionBounds(items);
  if (items.length <= leafSize) return { bounds, items };
  const extents = [0, 1, 2].map((axis) => bounds.max[axis] - bounds.min[axis]);
  const axis = extents.indexOf(Math.max(...extents));
  items.sort((first, second) => first.centroid[axis] - second.centroid[axis]);
  const middle = Math.floor(items.length / 2);
  return {
    bounds,
    left: build(items.slice(0, middle), leafSize),
    right: build(items.slice(middle), leafSize),
  };
}

function indexed(triangles: readonly Triangle3[]): IndexedTriangle[] {
  return triangles.map((triangle, index) => {
    const bounds = triangleBounds(triangle);
    return {
      triangle,
      index,
      bounds,
      centroid: [0, 1, 2].map((axis) =>
        (triangle.a[axis] + triangle.b[axis] + triangle.c[axis]) / 3
      ) as Vector3Tuple,
    };
  });
}

function boundsDistanceSquared(first: Bounds3, second: Bounds3): number {
  let total = 0;
  for (let axis = 0; axis < 3; axis++) {
    const gap = first.max[axis] < second.min[axis]
      ? second.min[axis] - first.max[axis]
      : second.max[axis] < first.min[axis]
        ? first.min[axis] - second.max[axis]
        : 0;
    total += gap * gap;
  }
  return total;
}

function boundsVolume(bounds: Bounds3): number {
  return Math.max(0, bounds.max[0] - bounds.min[0])
    * Math.max(0, bounds.max[1] - bounds.min[1])
    * Math.max(0, bounds.max[2] - bounds.min[2]);
}

export function closestPointsBetweenTriangleSetsBvh(
  firstTriangles: readonly Triangle3[],
  secondTriangles: readonly Triangle3[],
  maxComparisons = 1_000_000,
  leafSize = 8
): TriangleBvhDistanceResult | null {
  if (firstTriangles.length === 0 || secondTriangles.length === 0) return null;
  const firstRoot = build(indexed(firstTriangles), Math.max(1, leafSize));
  const secondRoot = build(indexed(secondTriangles), Math.max(1, leafSize));
  let best: (ClosestPointsResult & { first_triangle: number; second_triangle: number }) | null = null;
  let comparisons = 0;
  let truncated = false;

  const visit = (first: BvhNode, second: BvhNode): void => {
    if (truncated) return;
    const lowerBoundSquared = boundsDistanceSquared(first.bounds, second.bounds);
    if (best && lowerBoundSquared > best.distance * best.distance) return;
    if (first.items && second.items) {
      for (const firstItem of first.items) {
        for (const secondItem of second.items) {
          if (comparisons >= maxComparisons) {
            truncated = true;
            return;
          }
          comparisons++;
          const candidate = closestPointsBetweenTriangles(firstItem.triangle, secondItem.triangle);
          if (!best || candidate.distance < best.distance) {
            best = {
              ...candidate,
              first_triangle: firstItem.index,
              second_triangle: secondItem.index,
            };
          }
        }
      }
      return;
    }
    if (!first.items && (second.items || boundsVolume(first.bounds) >= boundsVolume(second.bounds))) {
      if (first.left) visit(first.left, second);
      if (first.right) visit(first.right, second);
    } else {
      if (second.left) visit(first, second.left);
      if (second.right) visit(first, second.right);
    }
  };

  visit(firstRoot, secondRoot);
  const resolvedBest = best as (ClosestPointsResult & {
    first_triangle: number;
    second_triangle: number;
  }) | null;
  if (!resolvedBest) return null;
  return {
    ...resolvedBest,
    comparisons,
    truncated,
    exact_separation: !truncated && resolvedBest.distance > 1e-10,
    method: "triangle_bvh",
  };
}
