export const SPATIAL_AXES = ["x", "y", "z"] as const;
export type SpatialAxis = (typeof SPATIAL_AXES)[number];
export type Vector3Tuple = [number, number, number];

export interface Bounds3 {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

export interface AxisIntervalRelation {
  gap: number;
  /** Signed shortest separation from the first interval toward the second. */
  signed_gap: number;
  overlap: number;
  /** Alias of overlap, named explicitly for collision/fit measurements. */
  penetration_depth: number;
  touching: boolean;
}

export interface ProjectionDepthWarning {
  view: "front" | "side" | "top";
  projection_axes: [SpatialAxis, SpatialAxis];
  depth_axis: SpatialAxis;
  depth_gap: number;
}

function cleanNumber(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(6));
}

export function intervalRelation(
  aMin: number,
  aMax: number,
  bMin: number,
  bMax: number,
  tolerance: number
): AxisIntervalRelation {
  const rawOverlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
  if (rawOverlap < -tolerance) {
    const signedGap = bMin > aMax
      ? bMin - aMax
      : bMax - aMin;
    return {
      gap: cleanNumber(-rawOverlap),
      signed_gap: cleanNumber(signedGap),
      overlap: 0,
      penetration_depth: 0,
      touching: false,
    };
  }
  const overlap = cleanNumber(Math.max(0, rawOverlap));
  return {
    gap: 0,
    signed_gap: 0,
    overlap,
    penetration_depth: overlap,
    touching: Math.abs(rawOverlap) <= tolerance,
  };
}

export function analyzeBoundsPair(
  first: Bounds3,
  second: Bounds3,
  tolerance = 0.001
): {
  axes: Record<SpatialAxis, AxisIntervalRelation>;
  separated_axes: SpatialAxis[];
  projection_depth_warnings: ProjectionDepthWarning[];
} {
  const axes = Object.fromEntries(
    SPATIAL_AXES.map((axis, index) => [
      axis,
      intervalRelation(
        first.min[index],
        first.max[index],
        second.min[index],
        second.max[index],
        tolerance
      ),
    ])
  ) as Record<SpatialAxis, AxisIntervalRelation>;

  const views: Array<{
    view: ProjectionDepthWarning["view"];
    projection: [SpatialAxis, SpatialAxis];
    depth: SpatialAxis;
  }> = [
    { view: "front", projection: ["x", "y"], depth: "z" },
    { view: "side", projection: ["z", "y"], depth: "x" },
    { view: "top", projection: ["x", "z"], depth: "y" },
  ];

  const projectionDepthWarnings = views
    .filter(
      ({ projection, depth }) =>
        axes[projection[0]].gap === 0 &&
        axes[projection[1]].gap === 0 &&
        axes[depth].gap > tolerance
    )
    .map(({ view, projection, depth }) => ({
      view,
      projection_axes: projection,
      depth_axis: depth,
      depth_gap: axes[depth].gap,
    }));

  return {
    axes,
    separated_axes: SPATIAL_AXES.filter((axis) => axes[axis].gap > tolerance),
    projection_depth_warnings: projectionDepthWarnings,
  };
}
