import type { Vector3Tuple } from "@/lib/spatialRelations";

export interface OrientedBox {
  center: Vector3Tuple;
  axes: [Vector3Tuple, Vector3Tuple, Vector3Tuple];
  half_sizes: Vector3Tuple;
}
export interface ObbContactResult {
  method: "obb_sat_15_axis";
  classification: "separate" | "touching" | "intersecting";
  signed_distance: number;
  separation: number;
  penetration_depth: number;
  normal: Vector3Tuple;
  tested_axes: number;
  exact_for_oriented_boxes: true;
}

const EPSILON = 1e-10;

function dot(first: Vector3Tuple, second: Vector3Tuple): number {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function subtract(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function cross(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [
    first[1] * second[2] - first[2] * second[1],
    first[2] * second[0] - first[0] * second[2],
    first[0] * second[1] - first[1] * second[0],
  ];
}

function length(vector: Vector3Tuple): number {
  return Math.sqrt(dot(vector, vector));
}

function scale(vector: Vector3Tuple, amount: number): Vector3Tuple {
  return [vector[0] * amount, vector[1] * amount, vector[2] * amount];
}

function unit(vector: Vector3Tuple): Vector3Tuple {
  const magnitude = length(vector);
  if (magnitude <= EPSILON) throw new Error("Oriented-box axes must be non-zero.");
  return scale(vector, 1 / magnitude);
}

function oriented(axis: Vector3Tuple, offset: Vector3Tuple): Vector3Tuple {
  return dot(axis, offset) < 0 ? scale(axis, -1) : axis;
}

/**
 * Exact separating-axis test for two transformed rectangular boxes. The
 * signed distance is the decisive SAT axis gap (positive) or minimum
 * translation depth (negative); it is not mislabeled as Euclidean distance.
 */
export function analyzeOrientedBoxContact(
  firstInput: OrientedBox,
  secondInput: OrientedBox,
  tolerance = 0.001
): ObbContactResult {
  const first: OrientedBox = {
    ...firstInput,
    axes: firstInput.axes.map(unit) as OrientedBox["axes"],
  };
  const second: OrientedBox = {
    ...secondInput,
    axes: secondInput.axes.map(unit) as OrientedBox["axes"],
  };
  const offset = subtract(second.center, first.center);
  const candidates: Array<{ gap: number; axis: Vector3Tuple }> = [];

  const projectRadius = (box: OrientedBox, axis: Vector3Tuple): number =>
    box.half_sizes.reduce((sum, halfSize, index) =>
      sum + halfSize * Math.abs(dot(box.axes[index], axis)), 0
    );

  const consider = (rawAxis: Vector3Tuple): void => {
    const magnitude = length(rawAxis);
    if (magnitude <= EPSILON) return;
    const axis = scale(rawAxis, 1 / magnitude);
    const centerDistance = Math.abs(dot(offset, axis));
    const overlap = projectRadius(first, axis) + projectRadius(second, axis) - centerDistance;
    candidates.push({ gap: -overlap, axis: oriented(axis, offset) });
  };

  first.axes.forEach(consider);
  second.axes.forEach(consider);
  for (const firstAxis of first.axes) {
    for (const secondAxis of second.axes) consider(cross(firstAxis, secondAxis));
  }

  const separating = candidates.filter((candidate) => candidate.gap > tolerance);
  if (separating.length > 0) {
    const decisive = separating.reduce((best, candidate) =>
      candidate.gap > best.gap ? candidate : best
    );
    return {
      method: "obb_sat_15_axis",
      classification: "separate",
      signed_distance: decisive.gap,
      separation: decisive.gap,
      penetration_depth: 0,
      normal: decisive.axis,
      tested_axes: candidates.length,
      exact_for_oriented_boxes: true,
    };
  }

  const decisive = candidates.reduce((best, candidate) =>
    candidate.gap > best.gap ? candidate : best
  );
  const depth = Math.max(0, -decisive.gap);
  const touching = depth <= tolerance;
  return {
    method: "obb_sat_15_axis",
    classification: touching ? "touching" : "intersecting",
    signed_distance: touching ? 0 : -depth,
    separation: 0,
    penetration_depth: touching ? 0 : depth,
    normal: decisive.axis,
    tested_axes: candidates.length,
    exact_for_oriented_boxes: true,
  };
}
