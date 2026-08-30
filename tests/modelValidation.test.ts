import { describe, expect, test } from "bun:test";
import { analyzeOrientedBoxContact, type OrientedBox } from "@/lib/contactAnalysis";
import { closestPointsBetweenTriangleSetsBvh } from "@/lib/triangleBvh";
import type { Triangle3 } from "@/lib/measurements";
import { analyzeUvIntegrity, type UvFaceRecord } from "@/lib/uvIntegrity";
import { fitBoundingSpherePerspectiveDistance } from "@/lib/cameraFraming";
import {
  evaluateExpected,
  validationViewRenderCount,
} from "@/server/tools/validation";

function rotatedThinBox(perpendicularOffset: number): [OrientedBox, OrientedBox] {
  const diagonal = Math.SQRT1_2;
  const first: OrientedBox = {
    center: [0, 0, 0],
    axes: [[diagonal, diagonal, 0], [-diagonal, diagonal, 0], [0, 0, 1]],
    half_sizes: [2, 0.2, 0.2],
  };
  const second: OrientedBox = {
    ...first,
    center: [-diagonal * perpendicularOffset, diagonal * perpendicularOffset, 0],
  };
  return [first, second];
}

describe("model validation geometry", () => {
  test("perspective auto-fit contains a sphere on the limiting viewport axis", () => {
    const radius = 2;
    const distance = fitBoundingSpherePerspectiveDistance(radius, 45, 0.5, 0.8);
    const apparentRadius = radius / Math.sqrt(distance * distance - radius * radius);
    const horizontalHalfAngle = Math.atan(Math.tan(45 * Math.PI / 360) * 0.5);
    expect(apparentRadius).toBeCloseTo(Math.tan(horizontalHalfAngle) * 0.8, 10);
  });

  test("distinguishes rotated thin-box AABB overlap from exact OBB separation", () => {
    const [first, second] = rotatedThinBox(0.6);
    const result = analyzeOrientedBoxContact(first, second, 0.0001);
    expect(result.classification).toBe("separate");
    expect(result.separation).toBeCloseTo(0.2, 8);
    expect(result.tested_axes).toBeGreaterThanOrEqual(5);
  });

  test("distinguishes tangency from penetration and reports minimum translation depth", () => {
    const touching = rotatedThinBox(0.4);
    const penetrating = rotatedThinBox(0.3);
    expect(analyzeOrientedBoxContact(...touching, 0.0001).classification).toBe("touching");
    const result = analyzeOrientedBoxContact(...penetrating, 0.0001);
    expect(result.classification).toBe("intersecting");
    expect(result.penetration_depth).toBeCloseTo(0.1, 8);
    expect(result.signed_distance).toBeLessThan(0);
  });

  test("uses a bounded triangle hierarchy while preserving exact positive separation", () => {
    const first: Triangle3[] = [{ a: [0, 0, 0], b: [1, 0, 0], c: [0, 1, 0] }];
    const second: Triangle3[] = [{ a: [0, 0, 2], b: [1, 0, 2], c: [0, 1, 2] }];
    const result = closestPointsBetweenTriangleSetsBvh(first, second, 100);
    expect(result?.distance).toBe(2);
    expect(result?.exact_separation).toBe(true);
    expect(result?.truncated).toBe(false);
  });

  test("applies explicit penetration limits to connected contracts", () => {
    const base = {
      relation: "connected" as const,
      minimum_separation: 0,
      minimum_penetration: 0,
    };
    expect(evaluateExpected("intersecting", 0, 0.5, {
      ...base,
      minimum_penetration: 0.6,
    })).toMatchObject({ status: "fail" });
    expect(evaluateExpected("intersecting", 0, 0.5, {
      ...base,
      maximum_penetration: 0.1,
    })).toMatchObject({ status: "fail" });
    expect(evaluateExpected("touching", 0, 0, {
      ...base,
      maximum_penetration: 0.1,
    })).toMatchObject({ status: "pass" });
  });

  test("validation render work is fixed per view rather than per descendant", () => {
    const views = [
      { passes: ["color", "wireframe"] },
      { passes: ["color", "element_id", "depth"] },
    ];
    expect(validationViewRenderCount(views, false)).toBe(6);
    expect(validationViewRenderCount(views, true)).toBe(8);
  });
});

function face(overrides: Partial<UvFaceRecord>): UvFaceRecord {
  return {
    face_id: "cube/north",
    element_uuid: "cube",
    element_name: "Cube",
    element_type: "cube",
    face_key: "north",
    enabled: true,
    texture_uuid: "texture",
    texture_name: "Texture",
    texture_size: [16, 16],
    uv_size: [16, 16],
    uv_points: [[0, 0], [4, 0], [4, 4], [0, 4]],
    rotation: 0,
    mirrored: false,
    world_area: 4,
    ...overrides,
  };
}

describe("typed UV integrity", () => {
  test("separates intentional sharing from unexpected overlap", () => {
    const result = analyzeUvIntegrity([
      face({ face_id: "a" }),
      face({ face_id: "b" }),
      face({ face_id: "c", uv_points: [[3, 3], [6, 3], [6, 6], [3, 6]] }),
    ], {
      expected_sharing: [{ first_face: "a", second_face: "b", relation: "shared" }],
    });
    expect(result.overlaps.find((item) => item.first_face === "a" && item.second_face === "b")?.relation).toBe("intentional");
    expect(result.summary.unexpected_overlaps.some((item) => item.first_face === "a" && item.second_face === "c")).toBe(true);
  });

  test("reports unmapped, zero-area, out-of-bounds, mirrored, and unauthorized footprints", () => {
    const result = analyzeUvIntegrity([
      face({
        face_id: "problem",
        texture_uuid: null,
        texture_name: null,
        uv_points: [[-1, 0], [17, 0], [17, 0], [-1, 0]],
        mirrored: true,
      }),
      face({ face_id: "outside", uv_points: [[8, 8], [12, 8], [12, 12], [8, 12]] }),
    ], {
      authorized_pixel_regions: [{ texture_uuid: "texture", rectangle: [0, 0, 4, 4] }],
    });
    expect(result.summary.unmapped_faces).toContain("problem");
    expect(result.summary.zero_area_faces).toContain("problem");
    expect(result.summary.out_of_bounds_faces).toContain("problem");
    expect(result.summary.mirrored_faces).toContain("problem");
    expect(result.summary.outside_authorized_regions).toContain("outside");
  });

  test("keeps missing authorization policy and non-convex overlap explicitly unknown", () => {
    const result = analyzeUvIntegrity([
      face({
        face_id: "concave",
        element_type: "mesh",
        mirrored: null,
        uv_points: [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4]],
      }),
      face({
        face_id: "candidate",
        element_type: "mesh",
        mirrored: null,
        uv_points: [[2, 2], [3, 2], [3, 3], [2, 3]],
      }),
    ]);

    expect(result.faces.every((item) => item.outside_authorized_pixel_regions === null)).toBe(true);
    expect(result.summary.outside_authorized_regions).toEqual([]);
    expect(result.summary.mirror_unknown_faces).toEqual(["concave", "candidate"]);
    expect(result.summary.unknown_overlaps).toHaveLength(1);
    expect(result.summary.unknown_overlaps[0]).toMatchObject({
      first_face: "concave",
      second_face: "candidate",
      relation: "unknown",
      exact: false,
      overlap_area: null,
    });
  });

  test("includes missing required sharing in the summary contract failures", () => {
    const result = analyzeUvIntegrity([
      face({ face_id: "a", uv_points: [[0, 0], [2, 0], [2, 2], [0, 2]] }),
      face({ face_id: "b", uv_points: [[8, 8], [10, 8], [10, 10], [8, 10]] }),
    ], {
      expected_sharing: [{ first_face: "a", second_face: "b", relation: "shared" }],
    });
    expect(result.summary.missing_expected_overlaps).toHaveLength(1);
    expect(result.summary.missing_expected_overlaps[0]).toMatchObject({
      first_face: "a",
      second_face: "b",
      relation: "missing_expected_overlap",
    });
    expect(result.summary.contract_failure_count).toBe(1);
  });
});
