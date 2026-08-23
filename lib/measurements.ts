import type { Bounds3, Vector3Tuple } from "@/lib/spatialRelations";

export interface Triangle3 {
  a: Vector3Tuple;
  b: Vector3Tuple;
  c: Vector3Tuple;
}

export interface ClosestPointsResult {
  first: Vector3Tuple;
  second: Vector3Tuple;
  distance: number;
}

export interface PrincipalAxisResult {
  direction: Vector3Tuple;
  extent: number;
  eigenvalues: Vector3Tuple;
  ambiguous: boolean;
}

const EPSILON = 1e-12;

function add(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subtract(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function multiply(a: Vector3Tuple, scalar: number): Vector3Tuple {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

export function dot(a: Vector3Tuple, b: Vector3Tuple): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lengthSquared(vector: Vector3Tuple): number {
  return dot(vector, vector);
}

export function vectorLength(vector: Vector3Tuple): number {
  return Math.sqrt(lengthSquared(vector));
}

export function normalizeVector(vector: Vector3Tuple): Vector3Tuple {
  const length = vectorLength(vector);
  if (length <= EPSILON) throw new Error("Cannot normalize a zero-length vector.");
  return multiply(vector, 1 / length);
}

function closestPointOnSegment(
  point: Vector3Tuple,
  start: Vector3Tuple,
  end: Vector3Tuple
): Vector3Tuple {
  const segment = subtract(end, start);
  const denominator = lengthSquared(segment);
  if (denominator <= EPSILON) return [...start];
  const amount = Math.max(
    0,
    Math.min(1, dot(subtract(point, start), segment) / denominator)
  );
  return add(start, multiply(segment, amount));
}

/** Closest point on a triangle using the Voronoi-region method. */
export function closestPointOnTriangle(
  point: Vector3Tuple,
  triangle: Triangle3
): Vector3Tuple {
  const { a, b, c } = triangle;
  const ab = subtract(b, a);
  const ac = subtract(c, a);
  const ap = subtract(point, a);
  const d1 = dot(ab, ap);
  const d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return [...a];

  const bp = subtract(point, b);
  const d3 = dot(ab, bp);
  const d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return [...b];

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    return add(a, multiply(ab, d1 / (d1 - d3)));
  }

  const cp = subtract(point, c);
  const d5 = dot(ab, cp);
  const d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return [...c];

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    return add(a, multiply(ac, d2 / (d2 - d6)));
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const edge = subtract(c, b);
    return add(b, multiply(edge, (d4 - d3) / ((d4 - d3) + (d5 - d6))));
  }

  const denominator = 1 / (va + vb + vc);
  const v = vb * denominator;
  const w = vc * denominator;
  return add(a, add(multiply(ab, v), multiply(ac, w)));
}

function closestPointsOnSegments(
  firstStart: Vector3Tuple,
  firstEnd: Vector3Tuple,
  secondStart: Vector3Tuple,
  secondEnd: Vector3Tuple
): ClosestPointsResult {
  const firstDirection = subtract(firstEnd, firstStart);
  const secondDirection = subtract(secondEnd, secondStart);
  const offset = subtract(firstStart, secondStart);
  const a = dot(firstDirection, firstDirection);
  const e = dot(secondDirection, secondDirection);
  const f = dot(secondDirection, offset);
  let firstAmount = 0;
  let secondAmount = 0;

  if (a <= EPSILON && e <= EPSILON) {
    return distanceBetweenPoints(firstStart, secondStart);
  }
  if (a <= EPSILON) {
    secondAmount = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(firstDirection, offset);
    if (e <= EPSILON) {
      firstAmount = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(firstDirection, secondDirection);
      const denominator = a * e - b * b;
      if (Math.abs(denominator) > EPSILON) {
        firstAmount = Math.max(0, Math.min(1, (b * f - c * e) / denominator));
      }
      secondAmount = (b * firstAmount + f) / e;
      if (secondAmount < 0) {
        secondAmount = 0;
        firstAmount = Math.max(0, Math.min(1, -c / a));
      } else if (secondAmount > 1) {
        secondAmount = 1;
        firstAmount = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }

  return distanceBetweenPoints(
    add(firstStart, multiply(firstDirection, firstAmount)),
    add(secondStart, multiply(secondDirection, secondAmount))
  );
}

function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Möller–Trumbore segment/triangle intersection, including both endpoints. */
function segmentTriangleIntersection(
  start: Vector3Tuple,
  end: Vector3Tuple,
  triangle: Triangle3
): Vector3Tuple | null {
  const direction = subtract(end, start);
  const edge1 = subtract(triangle.b, triangle.a);
  const edge2 = subtract(triangle.c, triangle.a);
  const p = cross(direction, edge2);
  const determinant = dot(edge1, p);
  if (Math.abs(determinant) <= EPSILON) return null;
  const inverse = 1 / determinant;
  const offset = subtract(start, triangle.a);
  const u = dot(offset, p) * inverse;
  if (u < -EPSILON || u > 1 + EPSILON) return null;
  const q = cross(offset, edge1);
  const v = dot(direction, q) * inverse;
  if (v < -EPSILON || u + v > 1 + EPSILON) return null;
  const amount = dot(edge2, q) * inverse;
  if (amount < -EPSILON || amount > 1 + EPSILON) return null;
  return add(start, multiply(direction, Math.max(0, Math.min(1, amount))));
}

export function distanceBetweenPoints(
  first: Vector3Tuple,
  second: Vector3Tuple
): ClosestPointsResult {
  return {
    first: [...first],
    second: [...second],
    distance: vectorLength(subtract(second, first)),
  };
}

export function closestPointOnTriangles(
  point: Vector3Tuple,
  triangles: readonly Triangle3[]
): ClosestPointsResult | null {
  let best: ClosestPointsResult | null = null;
  for (const triangle of triangles) {
    const surface = closestPointOnTriangle(point, triangle);
    const candidate = distanceBetweenPoints(surface, point);
    if (!best || candidate.distance < best.distance) best = candidate;
  }
  return best;
}

export function closestPointsBetweenTriangles(
  first: Triangle3,
  second: Triangle3
): ClosestPointsResult {
  let best: ClosestPointsResult | null = null;
  const consider = (candidate: ClosestPointsResult): void => {
    if (!best || candidate.distance < best.distance) best = candidate;
  };

  for (const point of [first.a, first.b, first.c]) {
    const target = closestPointOnTriangle(point, second);
    consider(distanceBetweenPoints(point, target));
  }
  for (const point of [second.a, second.b, second.c]) {
    const target = closestPointOnTriangle(point, first);
    const candidate = distanceBetweenPoints(target, point);
    consider(candidate);
  }

  const firstEdges = [
    [first.a, first.b],
    [first.b, first.c],
    [first.c, first.a],
  ] as const;
  const secondEdges = [
    [second.a, second.b],
    [second.b, second.c],
    [second.c, second.a],
  ] as const;
  for (const edge of firstEdges) {
    const intersection = segmentTriangleIntersection(edge[0], edge[1], second);
    if (intersection) return distanceBetweenPoints(intersection, intersection);
  }
  for (const edge of secondEdges) {
    const intersection = segmentTriangleIntersection(edge[0], edge[1], first);
    if (intersection) return distanceBetweenPoints(intersection, intersection);
  }
  for (const firstEdge of firstEdges) {
    for (const secondEdge of secondEdges) {
      consider(closestPointsOnSegments(
        firstEdge[0],
        firstEdge[1],
        secondEdge[0],
        secondEdge[1]
      ));
    }
  }
  return best!;
}

export function closestPointsBetweenTriangleSets(
  first: readonly Triangle3[],
  second: readonly Triangle3[],
  maxComparisons = 1_000_000
): ClosestPointsResult | null {
  if (first.length === 0 || second.length === 0) return null;
  if (first.length * second.length > maxComparisons) return null;
  let best: ClosestPointsResult | null = null;
  for (const firstTriangle of first) {
    for (const secondTriangle of second) {
      const candidate = closestPointsBetweenTriangles(firstTriangle, secondTriangle);
      if (!best || candidate.distance < best.distance) best = candidate;
      if (best.distance <= EPSILON) return best;
    }
  }
  return best;
}

export function closestPointOnBounds(
  point: Vector3Tuple,
  bounds: Bounds3
): Vector3Tuple {
  const clamped = point.map((value, index) =>
    Math.max(bounds.min[index], Math.min(bounds.max[index], value))
  ) as Vector3Tuple;
  const strictlyInside = point.every(
    (value, index) => value > bounds.min[index] && value < bounds.max[index]
  );
  if (!strictlyInside) return clamped;

  let axis = 0;
  let useMaximum = false;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < 3; index += 1) {
    const toMinimum = point[index] - bounds.min[index];
    const toMaximum = bounds.max[index] - point[index];
    if (toMinimum < nearest) {
      nearest = toMinimum;
      axis = index;
      useMaximum = false;
    }
    if (toMaximum < nearest) {
      nearest = toMaximum;
      axis = index;
      useMaximum = true;
    }
  }
  clamped[axis] = useMaximum ? bounds.max[axis] : bounds.min[axis];
  return clamped;
}

export function closestPointsBetweenBounds(
  first: Bounds3,
  second: Bounds3
): ClosestPointsResult {
  const firstPoint: Vector3Tuple = [0, 0, 0];
  const secondPoint: Vector3Tuple = [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (first.max[index] < second.min[index]) {
      firstPoint[index] = first.max[index];
      secondPoint[index] = second.min[index];
    } else if (second.max[index] < first.min[index]) {
      firstPoint[index] = first.min[index];
      secondPoint[index] = second.max[index];
    } else {
      const overlapStart = Math.max(first.min[index], second.min[index]);
      const overlapEnd = Math.min(first.max[index], second.max[index]);
      firstPoint[index] = secondPoint[index] = (overlapStart + overlapEnd) / 2;
    }
  }
  return distanceBetweenPoints(firstPoint, secondPoint);
}

function rotateJacobi(
  matrix: number[][],
  vectors: number[][],
  p: number,
  q: number
): void {
  if (Math.abs(matrix[p][q]) <= EPSILON) return;
  const angle = 0.5 * Math.atan2(
    2 * matrix[p][q],
    matrix[q][q] - matrix[p][p]
  );
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  const app = matrix[p][p];
  const aqq = matrix[q][q];
  const apq = matrix[p][q];
  matrix[p][p] = cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
  matrix[q][q] = sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
  matrix[p][q] = matrix[q][p] = 0;

  for (let index = 0; index < 3; index += 1) {
    if (index === p || index === q) continue;
    const aip = matrix[index][p];
    const aiq = matrix[index][q];
    matrix[index][p] = matrix[p][index] = cosine * aip - sine * aiq;
    matrix[index][q] = matrix[q][index] = sine * aip + cosine * aiq;
  }
  for (let index = 0; index < 3; index += 1) {
    const vip = vectors[index][p];
    const viq = vectors[index][q];
    vectors[index][p] = cosine * vip - sine * viq;
    vectors[index][q] = sine * vip + cosine * viq;
  }
}

/** Principal world-space geometry axis based on the vertex covariance matrix. */
export function principalAxis(points: readonly Vector3Tuple[]): PrincipalAxisResult | null {
  if (points.length < 2) return null;
  const mean = points.reduce<Vector3Tuple>(
    (sum, point) => add(sum, point),
    [0, 0, 0]
  ).map((value) => value / points.length) as Vector3Tuple;
  const covariance = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const point of points) {
    const centered = subtract(point, mean);
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        covariance[row][column] += centered[row] * centered[column];
      }
    }
  }
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      covariance[row][column] /= points.length;
    }
  }

  const eigenvectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const pairs = [[0, 1], [0, 2], [1, 2]] as const;
    const [p, q] = pairs.reduce((best, pair) =>
      Math.abs(covariance[pair[0]][pair[1]]) >
      Math.abs(covariance[best[0]][best[1]]) ? pair : best
    );
    if (Math.abs(covariance[p][q]) <= EPSILON) break;
    rotateJacobi(covariance, eigenvectors, p, q);
  }

  const ordered = [0, 1, 2]
    .map((index) => ({
      value: covariance[index][index],
      vector: [
        eigenvectors[0][index],
        eigenvectors[1][index],
        eigenvectors[2][index],
      ] as Vector3Tuple,
    }))
    .sort((left, right) => right.value - left.value);
  if (ordered[0].value <= EPSILON) return null;

  let direction = normalizeVector(ordered[0].vector);
  const dominantIndex = [0, 1, 2].reduce((best, index) =>
    Math.abs(direction[index]) > Math.abs(direction[best]) ? index : best
  );
  if (direction[dominantIndex] < 0) direction = multiply(direction, -1);
  const projections = points.map((point) => dot(point, direction));
  const extent = Math.max(...projections) - Math.min(...projections);
  const ambiguous = Math.abs(ordered[0].value - ordered[1].value) <=
    Math.max(1, ordered[0].value) * 1e-6;

  return {
    direction,
    extent,
    eigenvalues: ordered.map(({ value }) => value) as Vector3Tuple,
    ambiguous,
  };
}

export function angleBetweenVectors(
  first: Vector3Tuple,
  second: Vector3Tuple,
  undirected: boolean
): { degrees: number; radians: number; dot: number } {
  const firstUnit = normalizeVector(first);
  const secondUnit = normalizeVector(second);
  let cosine = Math.max(-1, Math.min(1, dot(firstUnit, secondUnit)));
  if (undirected) cosine = Math.abs(cosine);
  const radians = Math.acos(cosine);
  return { radians, degrees: radians * 180 / Math.PI, dot: cosine };
}

export interface CoplanarTriangleOverlap {
  first_triangle: number;
  second_triangle: number;
  overlap_area: number;
  maximum_plane_offset: number;
  normal: Vector3Tuple;
}

interface Point2 {
  x: number;
  y: number;
}

function projectPoint(point: Vector3Tuple, droppedAxis: number): Point2 {
  const axes = [0, 1, 2].filter((axis) => axis !== droppedAxis);
  return { x: point[axes[0]], y: point[axes[1]] };
}

function cross2(start: Point2, end: Point2, point: Point2): number {
  return (end.x - start.x) * (point.y - start.y) -
    (end.y - start.y) * (point.x - start.x);
}

function lineIntersection(
  firstStart: Point2,
  firstEnd: Point2,
  secondStart: Point2,
  secondEnd: Point2
): Point2 {
  const firstX = firstEnd.x - firstStart.x;
  const firstY = firstEnd.y - firstStart.y;
  const secondX = secondEnd.x - secondStart.x;
  const secondY = secondEnd.y - secondStart.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) <= EPSILON) return { ...firstEnd };
  const offsetX = secondStart.x - firstStart.x;
  const offsetY = secondStart.y - firstStart.y;
  const amount = (offsetX * secondY - offsetY * secondX) / denominator;
  return {
    x: firstStart.x + amount * firstX,
    y: firstStart.y + amount * firstY,
  };
}

function clippedTriangleArea(subject: Point2[], clip: Point2[]): number {
  let polygon = subject;
  const orientation = Math.sign(cross2(clip[0], clip[1], clip[2])) || 1;
  for (let edge = 0; edge < 3 && polygon.length > 0; edge++) {
    const clipStart = clip[edge];
    const clipEnd = clip[(edge + 1) % 3];
    const input = polygon;
    polygon = [];
    let previous = input[input.length - 1];
    let previousInside = orientation * cross2(clipStart, clipEnd, previous) >= -EPSILON;
    for (const current of input) {
      const currentInside = orientation * cross2(clipStart, clipEnd, current) >= -EPSILON;
      if (currentInside !== previousInside) {
        polygon.push(lineIntersection(previous, current, clipStart, clipEnd));
      }
      if (currentInside) polygon.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }
  if (polygon.length < 3) return 0;
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index++) {
    const current = polygon[index];
    const next = polygon[(index + 1) % polygon.length];
    twiceArea += current.x * next.y - current.y * next.x;
  }
  return Math.abs(twiceArea) / 2;
}

/**
 * Find actual coplanar surface overlap. Intersecting volumes whose surfaces
 * merely cross are deliberately not reported as Z-fighting candidates.
 */
export function findCoplanarTriangleOverlaps(
  first: readonly Triangle3[],
  second: readonly Triangle3[],
  options: {
    distanceTolerance?: number;
    angleToleranceDegrees?: number;
    minimumOverlapArea?: number;
    maxComparisons?: number;
    maxResults?: number;
  } = {}
): {
  comparisons: number;
  truncated: boolean;
  work_limit_reached: boolean;
  result_limit_reached: boolean;
  overlaps: CoplanarTriangleOverlap[];
} {
  const distanceTolerance = options.distanceTolerance ?? 0.0001;
  const angleTolerance = (options.angleToleranceDegrees ?? 0.1) * Math.PI / 180;
  const minimumOverlapArea = options.minimumOverlapArea ?? 0.000001;
  const maxComparisons = options.maxComparisons ?? 200_000;
  const maxResults = options.maxResults ?? 100;
  const minimumParallelDot = Math.cos(angleTolerance);
  const overlaps: CoplanarTriangleOverlap[] = [];
  let comparisons = 0;

  for (let firstIndex = 0; firstIndex < first.length; firstIndex++) {
    const firstTriangle = first[firstIndex];
    const firstNormalRaw = cross(
      subtract(firstTriangle.b, firstTriangle.a),
      subtract(firstTriangle.c, firstTriangle.a)
    );
    if (vectorLength(firstNormalRaw) <= EPSILON) continue;
    const firstNormal = normalizeVector(firstNormalRaw);
    const droppedAxis = [0, 1, 2].reduce((best, axis) =>
      Math.abs(firstNormal[axis]) > Math.abs(firstNormal[best]) ? axis : best
    );
    const firstProjected = [firstTriangle.a, firstTriangle.b, firstTriangle.c]
      .map((point) => projectPoint(point, droppedAxis));

    for (let secondIndex = 0; secondIndex < second.length; secondIndex++) {
      if (comparisons >= maxComparisons) {
        return {
          comparisons,
          truncated: true,
          work_limit_reached: true,
          result_limit_reached: false,
          overlaps,
        };
      }
      comparisons++;
      const secondTriangle = second[secondIndex];
      const secondNormalRaw = cross(
        subtract(secondTriangle.b, secondTriangle.a),
        subtract(secondTriangle.c, secondTriangle.a)
      );
      if (vectorLength(secondNormalRaw) <= EPSILON) continue;
      const secondNormal = normalizeVector(secondNormalRaw);
      if (Math.abs(dot(firstNormal, secondNormal)) < minimumParallelDot) continue;

      const offsets = [secondTriangle.a, secondTriangle.b, secondTriangle.c]
        .map((point) => Math.abs(dot(subtract(point, firstTriangle.a), firstNormal)));
      const maximumPlaneOffset = Math.max(...offsets);
      if (maximumPlaneOffset > distanceTolerance) continue;
      const projectedArea = clippedTriangleArea(
        firstProjected,
        [secondTriangle.a, secondTriangle.b, secondTriangle.c]
          .map((point) => projectPoint(point, droppedAxis))
      );
      const overlapArea = projectedArea / Math.max(Math.abs(firstNormal[droppedAxis]), EPSILON);
      if (overlapArea <= minimumOverlapArea) continue;
      overlaps.push({
        first_triangle: firstIndex,
        second_triangle: secondIndex,
        overlap_area: overlapArea,
        maximum_plane_offset: maximumPlaneOffset,
        normal: firstNormal,
      });
      if (overlaps.length >= maxResults) {
        return {
          comparisons,
          truncated: true,
          work_limit_reached: false,
          result_limit_reached: true,
          overlaps,
        };
      }
    }
  }
  return {
    comparisons,
    truncated: false,
    work_limit_reached: false,
    result_limit_reached: false,
    overlaps,
  };
}
