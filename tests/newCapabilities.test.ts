import { describe, expect, test } from "bun:test";
import {
  applyTextureToResolvedFaces,
  type FaceTextureElementTarget,
} from "@/lib/faceTextures";
import {
  angleBetweenVectors,
  closestPointOnBounds,
  closestPointsBetweenTriangleSets,
  principalAxis,
  type Triangle3,
} from "@/lib/measurements";
import {
  normalizeLocalBbmodelPath,
  parseBbmodelText,
  portableBbmodelText,
} from "@/lib/projectFiles";
import { analyzeBoundsPair } from "@/lib/spatialRelations";
import { batchSetCubeUvParameters } from "@/server/tools/cubes";
import { modifyGroupParameters } from "@/server/tools/element";
import {
  duplicateProjectParameters,
  openBbmodelParameters,
} from "@/server/tools/project";
import { measureGeometryParameters } from "@/server/tools/spatial";
import { removeTextureParameters } from "@/server/tools/texture";

function faceElement(
  uuid: string,
  textures: Record<string, string | false>,
  boxUv = false
): FaceTextureElementTarget {
  return {
    uuid,
    name: uuid,
    box_uv: boxUv,
    faces: Object.fromEntries(
      Object.entries(textures).map(([key, texture]) => [key, { texture }])
    ),
  };
}

describe("scoped texture assignment", () => {
  test("writes only resolved target faces and verifies the complete scope", () => {
    const target = faceElement("target", { north: "old", south: false });
    const unrelated = faceElement("unrelated", { north: "keep" });
    const result = applyTextureToResolvedFaces(
      [target, unrelated],
      [target],
      "requested",
      "all",
      new Map(),
      new Set(["old", "keep", "requested"])
    );

    expect(target.faces.north.texture).toBe("requested");
    expect(target.faces.south.texture).toBe("requested");
    expect(unrelated.faces.north.texture).toBe("keep");
    expect(result).toMatchObject({
      target_elements: 1,
      matched_faces: 2,
      changed_faces: 2,
    });
  });

  test("preserves valid textured faces in blank mode and honors selected faces", () => {
    const target = faceElement("target", {
      north: "valid-old",
      south: false,
      east: "missing-texture",
    });
    applyTextureToResolvedFaces(
      [target],
      [target],
      "requested",
      "blank",
      new Map(),
      new Set(["valid-old", "requested"])
    );
    expect(target.faces.north.texture).toBe("valid-old");
    expect(target.faces.south.texture).toBe("requested");
    expect(target.faces.east.texture).toBe("requested");

    applyTextureToResolvedFaces(
      [target],
      [target],
      "selected",
      "none",
      new Map([[target, new Set(["north"])]]),
      new Set(["valid-old", "requested", "selected"])
    );
    expect(target.faces.north.texture).toBe("selected");
    expect(target.faces.south.texture).toBe("requested");
  });

  test("throws before commit when face readback does not match", () => {
    const stubbornFace: { texture?: string | false | null } = {};
    Object.defineProperty(stubbornFace, "texture", {
      configurable: true,
      get: () => "old",
      set: () => {},
    });
    const target: FaceTextureElementTarget = {
      uuid: "target",
      name: "target",
      faces: { north: stubbornFace },
    };
    expect(() => applyTextureToResolvedFaces(
      [target],
      [target],
      "requested",
      "all",
      new Map(),
      new Set(["old", "requested"])
    )).toThrow(/verification failed/i);
  });
});

describe("geometry measurement primitives", () => {
  const lower: Triangle3 = {
    a: [0, 0, 0],
    b: [2, 0, 0],
    c: [0, 2, 0],
  };

  test("finds exact closest points between rendered triangles", () => {
    const upper: Triangle3 = {
      a: [0, 0, 3],
      b: [2, 0, 3],
      c: [0, 2, 3],
    };
    const result = closestPointsBetweenTriangleSets([lower], [upper]);
    expect(result?.distance).toBeCloseTo(3);
    expect(result?.first[2]).toBe(0);
    expect(result?.second[2]).toBe(3);
  });

  test("detects an edge piercing the interior of another triangle", () => {
    const piercing: Triangle3 = {
      a: [0.5, 0.5, -1],
      b: [0.5, 0.5, 1],
      c: [2, 2, 1],
    };
    const result = closestPointsBetweenTriangleSets([lower], [piercing]);
    expect(result?.distance).toBeCloseTo(0);
    expect(result?.first).toEqual(result?.second);
  });

  test("returns a real surface point when the query point is inside bounds", () => {
    expect(closestPointOnBounds([5, 5, 5], {
      min: [0, 0, 0],
      max: [10, 10, 10],
    })).toEqual([0, 5, 5]);
  });

  test("reports signed gaps, penetration, principal axes, and angles", () => {
    const separated = analyzeBoundsPair(
      { min: [0, 0, 0], max: [1, 2, 1] },
      { min: [4, 1, 0], max: [5, 3, 1] }
    );
    expect(separated.axes.x).toMatchObject({
      gap: 3,
      signed_gap: 3,
      penetration_depth: 0,
    });
    expect(separated.axes.y).toMatchObject({
      gap: 0,
      overlap: 1,
      penetration_depth: 1,
    });

    const axis = principalAxis([
      [0, -4, 0],
      [0, -2, 0],
      [0, 2, 0],
      [0, 4, 0],
    ]);
    expect(axis?.ambiguous).toBe(false);
    expect(axis?.direction.map(Math.abs)).toEqual([0, 1, 0]);
    expect(angleBetweenVectors(axis!.direction, [1, 0, 0], true).degrees)
      .toBeCloseTo(90);
  });
});

describe("project file and new tool contracts", () => {
  test("accepts absolute local bbmodel paths and rejects remote or malformed input", () => {
    expect(normalizeLocalBbmodelPath("file:///D:/models/test.bbmodel"))
      .toBe("D:/models/test.bbmodel");
    expect(normalizeLocalBbmodelPath("D:\\models\\test.bbmodel"))
      .toBe("D:\\models\\test.bbmodel");
    expect(() => normalizeLocalBbmodelPath("https://example.com/test.bbmodel"))
      .toThrow(/disabled/i);
    expect(() => parseBbmodelText("[]", "test.bbmodel")).toThrow(/object/i);
    expect(portableBbmodelText({ meta: { format_version: "4.10" } }))
      .toContain("format_version");
  });

  test("requires explicit, internally consistent mutation inputs", () => {
    expect(() => removeTextureParameters.parse({ texture: "old" })).not.toThrow();
    expect(() => removeTextureParameters.parse({
      texture: "old",
      replacement: "new",
      clear_references: true,
    })).toThrow();
    expect(() => batchSetCubeUvParameters.parse({
      updates: [{ id: "cube" }],
    })).toThrow();
    expect(batchSetCubeUvParameters.parse({
      updates: [{ id: "cube", face_uv: { north: [1, 2, 3, 4] } }],
    }).updates).toHaveLength(1);
    expect(() => batchSetCubeUvParameters.parse({
      updates: [{
        id: "cube",
        uv_offset: [0, 0],
        face_uv: { north: [1, 2, 3, 4] },
      }],
    })).toThrow();
    expect(() => modifyGroupParameters.parse({ id: "group" })).toThrow();
    expect(() => modifyGroupParameters.parse({
      id: "group",
      origin: [0, 0, 0],
      position: [1, 1, 1],
    })).toThrow();
    expect(openBbmodelParameters.parse({ path: "D:\\model.bbmodel" }).select)
      .toBe(true);
    expect(duplicateProjectParameters.parse({}).select).toBe(true);
  });

  test("measurement schema supports batched surface distances and long-axis angles", () => {
    const parsed = measureGeometryParameters.parse({
      elements: ["sword"],
      distances: [{
        first: { kind: "surface", element: "sword" },
        second: { kind: "pivot", element: "scabbard" },
      }],
      angles: [{
        first: { kind: "long_axis", element: "sword" },
        second: { kind: "vector", vector: [0, 1, 0] },
      }],
    });
    expect(parsed.distances).toHaveLength(1);
    expect(parsed.angles[0].orientation).toBe("undirected");
  });
});
