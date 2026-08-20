import { describe, expect, test } from "bun:test";
import { geometryCounts, mergeCompiledGeometry, selectGeometry } from "../lib/ysmGeometry";

describe("YSM geometry merge", () => {
  test("preserves private fields and visible bounds while accepting live cubes", () => {
    const source = {
      format_version: "1.12.0",
      "minecraft:geometry": [
        {
          description: {
            identifier: "geometry.alex",
            texture_width: 80,
            texture_height: 80,
            visible_bounds_width: 5,
            visible_bounds_height: 5,
            visible_bounds_offset: [0, 1.5, 0],
            ysm_private: "keep",
          },
          bones: [
            { name: "Root", pivot: [0, 0, 0], binding: "keep-root" },
            {
              name: "Hat",
              parent: "Root",
              pivot: [0, 24, 0],
              cubes: [{ origin: [0, 0, 0], size: [1, 1, 1] }],
              ysm_private: { keep: true },
            },
            { name: "Removed", parent: "Root", pivot: [0, 0, 0] },
          ],
        },
      ],
    };
    const compiled = {
      format_version: "1.12.0",
      "minecraft:geometry": [
        {
          description: {
            identifier: "geometry.alex",
            texture_width: 80,
            texture_height: 80,
          },
          bones: [
            { name: "Root", pivot: [0, 0, 0] },
            {
              name: "Hat",
              parent: "Root",
              pivot: [0, 24, 0],
              rotation: [0, 15, 0],
              cubes: [{ origin: [1, 2, 3], size: [4, 5, 6] }],
            },
            { name: "Added", parent: "Root", pivot: [0, 10, 0] },
          ],
        },
      ],
    };

    const merged = mergeCompiledGeometry(source, compiled, "geometry.alex");
    const geometry = selectGeometry(merged, "geometry.alex").geometry as any;
    expect(geometry.description.visible_bounds_width).toBe(5);
    expect(geometry.description.ysm_private).toBe("keep");
    expect(geometry.bones.map((bone: any) => bone.name)).toEqual(["Root", "Hat", "Added"]);
    expect(geometry.bones[0].binding).toBe("keep-root");
    expect(geometry.bones[1].ysm_private).toEqual({ keep: true });
    expect(geometry.bones[1].rotation).toEqual([0, 15, 0]);
    expect(geometry.bones[1].cubes[0].origin).toEqual([1, 2, 3]);
    expect(geometryCounts(geometry)).toEqual({ bones: 3, cubes: 1 });
  });

  test("rejects ambiguous duplicate source bones", () => {
    const source = {
      "minecraft:geometry": [
        {
          description: { identifier: "geometry.alex" },
          bones: [{ name: "Root" }, { name: "Root" }],
        },
      ],
    };
    const compiled = {
      "minecraft:geometry": [
        {
          description: { identifier: "geometry.alex" },
          bones: [{ name: "Root" }],
        },
      ],
    };
    expect(() => mergeCompiledGeometry(source, compiled, "geometry.alex")).toThrow(
      'duplicate bone name "Root"'
    );
  });
});
