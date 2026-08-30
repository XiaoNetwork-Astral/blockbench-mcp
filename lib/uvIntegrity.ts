export type UvPoint = [number, number];

export interface UvFaceRecord {
  face_id: string;
  element_uuid: string;
  element_name: string;
  element_type: "cube" | "mesh";
  face_key: string;
  enabled: boolean;
  texture_uuid: string | null;
  texture_name: string | null;
  texture_size: [number, number] | null;
  uv_size: [number, number] | null;
  uv_points: UvPoint[];
  rotation: number;
  mirrored: boolean | null;
  world_area: number | null;
}

export interface ExpectedUvSharing {
  first_face: string;
  second_face: string;
  relation: "shared" | "separate";
}

export interface AuthorizedPixelRegion {
  texture_uuid: string;
  rectangle: [number, number, number, number];
}

interface Point2 { x: number; y: number }

const EPSILON = 1e-9;

function signedArea(points: readonly UvPoint[]): number {
  let twice = 0;
  for (let index = 0; index < points.length; index++) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    twice += current[0] * next[1] - current[1] * next[0];
  }
  return twice / 2;
}

function bounds(points: readonly UvPoint[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
  ];
}

function isConvex(points: readonly UvPoint[]): boolean {
  if (points.length < 4) return true;
  let direction = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const c = points[(index + 2) % points.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) <= EPSILON) continue;
    const sign = Math.sign(cross);
    if (direction && sign !== direction) return false;
    direction = sign;
  }
  return true;
}

function cross(start: Point2, end: Point2, point: Point2): number {
  return (end.x - start.x) * (point.y - start.y)
    - (end.y - start.y) * (point.x - start.x);
}

function intersection(a: Point2, b: Point2, c: Point2, d: Point2): Point2 {
  const firstX = b.x - a.x;
  const firstY = b.y - a.y;
  const secondX = d.x - c.x;
  const secondY = d.y - c.y;
  const denominator = firstX * secondY - firstY * secondX;
  if (Math.abs(denominator) <= EPSILON) return { ...b };
  const amount = ((c.x - a.x) * secondY - (c.y - a.y) * secondX) / denominator;
  return { x: a.x + amount * firstX, y: a.y + amount * firstY };
}

function convexOverlapArea(first: readonly UvPoint[], second: readonly UvPoint[]): number | null {
  if (!isConvex(first) || !isConvex(second) || first.length < 3 || second.length < 3) return null;
  let polygon = first.map(([x, y]) => ({ x, y }));
  const clip = second.map(([x, y]) => ({ x, y }));
  const orientation = Math.sign(signedArea(second)) || 1;
  for (let edge = 0; edge < clip.length && polygon.length; edge++) {
    const start = clip[edge];
    const end = clip[(edge + 1) % clip.length];
    const input = polygon;
    polygon = [];
    let previous = input[input.length - 1];
    let previousInside = orientation * cross(start, end, previous) >= -EPSILON;
    for (const current of input) {
      const currentInside = orientation * cross(start, end, current) >= -EPSILON;
      if (currentInside !== previousInside) polygon.push(intersection(previous, current, start, end));
      if (currentInside) polygon.push(current);
      previous = current;
      previousInside = currentInside;
    }
  }
  return Math.abs(signedArea(polygon.map(({ x, y }) => [x, y] as UvPoint)));
}

function expectedMap(expected: readonly ExpectedUvSharing[]): Map<string, ExpectedUvSharing["relation"]> {
  return new Map(expected.map((item) => [
    [item.first_face, item.second_face].sort().join("\0"),
    item.relation,
  ]));
}

function rectangleContains(
  outer: [number, number, number, number],
  inner: [number, number, number, number]
): boolean {
  const normalizedOuter = [
    Math.min(outer[0], outer[2]), Math.min(outer[1], outer[3]),
    Math.max(outer[0], outer[2]), Math.max(outer[1], outer[3]),
  ];
  return inner[0] >= normalizedOuter[0] - EPSILON
    && inner[1] >= normalizedOuter[1] - EPSILON
    && inner[2] <= normalizedOuter[2] + EPSILON
    && inner[3] <= normalizedOuter[3] + EPSILON;
}

function rectangleOverlapArea(
  first: [number, number, number, number] | null,
  second: [number, number, number, number] | null
): number {
  if (!first || !second) return 0;
  const width = Math.min(first[2], second[2]) - Math.max(first[0], second[0]);
  const height = Math.min(first[3], second[3]) - Math.max(first[1], second[1]);
  return Math.max(0, width) * Math.max(0, height);
}

export function analyzeUvIntegrity(
  faces: readonly UvFaceRecord[],
  options: {
    expected_sharing?: readonly ExpectedUvSharing[];
    authorized_pixel_regions?: readonly AuthorizedPixelRegion[];
    texel_density_ratio_warning?: number;
  } = {}
) {
  const expected = expectedMap(options.expected_sharing ?? []);
  const densityLimit = options.texel_density_ratio_warning ?? 2;
  const records = faces.map((face) => {
    const uvArea = Math.abs(signedArea(face.uv_points));
    const uvBounds = bounds(face.uv_points);
    const outOfBounds = Boolean(
      uvBounds && face.uv_size && (
        uvBounds[0] < -EPSILON || uvBounds[1] < -EPSILON
        || uvBounds[2] > face.uv_size[0] + EPSILON
        || uvBounds[3] > face.uv_size[1] + EPSILON
      )
    );
    const pixelBounds = uvBounds && face.texture_size && face.uv_size
      ? [
          uvBounds[0] * face.texture_size[0] / face.uv_size[0],
          uvBounds[1] * face.texture_size[1] / face.uv_size[1],
          uvBounds[2] * face.texture_size[0] / face.uv_size[0],
          uvBounds[3] * face.texture_size[1] / face.uv_size[1],
        ] as [number, number, number, number]
      : null;
    const pixelArea = face.texture_size && face.uv_size
      ? uvArea * face.texture_size[0] / face.uv_size[0]
        * face.texture_size[1] / face.uv_size[1]
      : null;
    const density = pixelArea !== null && face.world_area && face.world_area > EPSILON
      ? Math.sqrt(pixelArea / face.world_area)
      : null;
    const authorizedRegions = face.texture_uuid
      ? (options.authorized_pixel_regions ?? [])
          .filter((region) => region.texture_uuid === face.texture_uuid)
      : [];
    const authorized = !pixelBounds || !face.texture_uuid || authorizedRegions.length === 0
      ? null
      : authorizedRegions.some((region) => rectangleContains(region.rectangle, pixelBounds));
    return {
      ...face,
      uv_area: uvArea,
      uv_bounds: uvBounds,
      effective_pixel_bounds: pixelBounds,
      effective_pixel_area: pixelArea,
      texel_density: density,
      zero_area: uvArea <= EPSILON,
      unmapped: face.enabled && !face.texture_uuid,
      out_of_bounds: outOfBounds,
      outside_authorized_pixel_regions: authorized === null ? null : !authorized,
    };
  });

  const overlaps: Array<{
    first_face: string;
    second_face: string;
    texture_uuid: string;
    overlap_area: number | null;
    relation: "intentional" | "unexpected" | "missing_expected_overlap" | "expected_separate" | "unknown";
    exact: boolean;
  }> = [];
  for (let firstIndex = 0; firstIndex < records.length; firstIndex++) {
    const first = records[firstIndex];
    if (!first.texture_uuid || first.uv_points.length < 3) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < records.length; secondIndex++) {
      const second = records[secondIndex];
      if (second.texture_uuid !== first.texture_uuid || second.uv_points.length < 3) continue;
      const area = convexOverlapArea(first.uv_points, second.uv_points);
      const expectedRelation = expected.get([first.face_id, second.face_id].sort().join("\0"));
      if (area === null) {
        if (rectangleOverlapArea(first.uv_bounds, second.uv_bounds) > EPSILON) {
          overlaps.push({
            first_face: first.face_id,
            second_face: second.face_id,
            texture_uuid: first.texture_uuid,
            overlap_area: null,
            relation: "unknown",
            exact: false,
          });
        } else if (expectedRelation === "shared") {
          overlaps.push({
            first_face: first.face_id,
            second_face: second.face_id,
            texture_uuid: first.texture_uuid,
            overlap_area: 0,
            relation: "missing_expected_overlap",
            exact: true,
          });
        }
        continue;
      }
      const overlapsNow = area > EPSILON;
      if (!overlapsNow && expectedRelation !== "shared") continue;
      overlaps.push({
        first_face: first.face_id,
        second_face: second.face_id,
        texture_uuid: first.texture_uuid,
        overlap_area: area,
        relation: expectedRelation === "shared"
          ? overlapsNow ? "intentional" : "missing_expected_overlap"
          : expectedRelation === "separate"
            ? "expected_separate"
            : "unexpected",
        exact: true,
      });
    }
  }

  const densities = records.map((record) => record.texel_density).filter((value): value is number => value !== null && value > 0);
  const medianDensity = densities.length
    ? [...densities].sort((a, b) => a - b)[Math.floor(densities.length / 2)]
    : null;
  const densityOutliers = medianDensity === null ? [] : records.filter((record) =>
    record.texel_density !== null
    && Math.max(record.texel_density / medianDensity, medianDensity / record.texel_density) > densityLimit
  ).map((record) => record.face_id);
  const unexpectedOverlaps = overlaps.filter(
    (overlap) => overlap.relation === "unexpected" || overlap.relation === "expected_separate"
  );
  const missingExpectedOverlaps = overlaps.filter(
    (overlap) => overlap.relation === "missing_expected_overlap"
  );

  return {
    faces: records,
    overlaps,
    summary: {
      face_count: records.length,
      zero_area_faces: records.filter((record) => record.zero_area).map((record) => record.face_id),
      unmapped_faces: records.filter((record) => record.unmapped).map((record) => record.face_id),
      out_of_bounds_faces: records.filter((record) => record.out_of_bounds).map((record) => record.face_id),
      mirrored_faces: records.filter((record) => record.mirrored === true).map((record) => record.face_id),
      mirror_unknown_faces: records.filter((record) => record.mirrored === null).map((record) => record.face_id),
      unexpected_overlaps: unexpectedOverlaps,
      missing_expected_overlaps: missingExpectedOverlaps,
      unknown_overlaps: overlaps.filter((overlap) => overlap.relation === "unknown"),
      contract_failure_count: unexpectedOverlaps.length + missingExpectedOverlaps.length,
      density_median: medianDensity,
      density_outliers: densityOutliers,
      outside_authorized_regions: records.filter((record) => record.outside_authorized_pixel_regions).map((record) => record.face_id),
    },
  };
}
