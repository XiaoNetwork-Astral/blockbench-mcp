import { describe, expect, test } from "bun:test";
import {
  colorMatchMask,
  combineSelectionMasks,
  ellipseSelectionMask,
  invertSelectionMask,
  rasterStroke,
  rectangleSelectionMask,
  resizeSelectionMask,
} from "@/lib/paintMath";
import {
  copyBrushToolParameters,
  createBrushPresetParameters,
  eraserToolParameters,
  paintFillToolParameters,
} from "@/server/tools/paint";

function selectedIndices(mask: Uint8Array): number[] {
  const result: number[] = [];
  mask.forEach((value, index) => {
    if (value) result.push(index);
  });
  return result;
}

describe("paint stroke rasterization", () => {
  test("connects anchors with deterministic integer pixels", () => {
    expect(rasterStroke([{ x: 0, y: 0 }, { x: 3, y: 1 }], true)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
    ]);
  });

  test("keeps disconnected anchors as individual rounded dabs", () => {
    expect(rasterStroke([
      { x: 0.2, y: 0.4 },
      { x: 2.7, y: 1.2 },
      { x: 2.9, y: 1.1 },
    ], false)).toEqual([
      { x: 0, y: 0 },
      { x: 3, y: 1 },
    ]);
  });
});

describe("texture selection masks", () => {
  test("builds bounded rectangle and ellipse masks", () => {
    expect(selectedIndices(rectangleSelectionMask(4, 3, 1, 1, 3, 3))).toEqual([
      5, 6, 9, 10,
    ]);
    expect(selectedIndices(ellipseSelectionMask(4, 4, 0, 0, 4, 4))).toEqual([
      1, 2,
      4, 5, 6, 7,
      8, 9, 10, 11,
      13, 14,
    ]);
  });

  test("combines and inverts masks using the requested selection mode", () => {
    const current = Uint8Array.from([1, 1, 0, 0]);
    const incoming = Uint8Array.from([0, 1, 1, 0]);
    expect([...combineSelectionMasks(current, incoming, "create")]).toEqual([0, 1, 1, 0]);
    expect([...combineSelectionMasks(current, incoming, "add")]).toEqual([1, 1, 1, 0]);
    expect([...combineSelectionMasks(current, incoming, "subtract")]).toEqual([1, 0, 0, 0]);
    expect([...combineSelectionMasks(current, incoming, "intersect")]).toEqual([0, 1, 0, 0]);
    expect([...invertSelectionMask(current)]).toEqual([0, 0, 1, 1]);
  });

  test("expands and contracts with a round one-pixel radius", () => {
    const center = new Uint8Array(9);
    center[4] = 1;
    expect(selectedIndices(resizeSelectionMask(center, 3, 3, 1, true))).toEqual([
      1, 3, 4, 5, 7,
    ]);

    const square = rectangleSelectionMask(5, 5, 1, 1, 4, 4);
    expect(selectedIndices(resizeSelectionMask(square, 5, 5, 1, false))).toEqual([12]);
  });
});

describe("fill color matching", () => {
  const pixels = Uint8ClampedArray.from([
    200, 10, 10, 255,
    200, 10, 10, 255,
    10, 10, 200, 255,
    200, 10, 10, 255,
    204, 10, 10, 255,
  ]);

  test("distinguishes connected fill from global same-color fill", () => {
    expect(selectedIndices(colorMatchMask(pixels, 5, 1, 0, 0, 0, true))).toEqual([0, 1]);
    expect(selectedIndices(colorMatchMask(pixels, 5, 1, 0, 0, 0, false))).toEqual([0, 1, 3]);
  });

  test("applies tolerance and the active-selection predicate", () => {
    expect(selectedIndices(colorMatchMask(pixels, 5, 1, 0, 0, 2, false))).toEqual([
      0, 1, 3, 4,
    ]);
    expect(selectedIndices(colorMatchMask(
      pixels,
      5,
      1,
      0,
      0,
      2,
      false,
      (x) => x !== 1
    ))).toEqual([0, 3, 4]);
  });
});

describe("paint tool defaults", () => {
  test("uses ordinary full-opacity one-pixel defaults", () => {
    expect(paintFillToolParameters.parse({
      x: 1,
      y: 2,
      color: "#112233",
    })).toMatchObject({ opacity: 255, tolerance: 0, fill_mode: "color_connected" });
    expect(copyBrushToolParameters.parse({
      source: { x: 0, y: 0 },
      target: { x: 1, y: 1 },
    })).toMatchObject({ brush_size: 1, opacity: 255, mode: "copy" });
    expect(eraserToolParameters.parse({
      coordinates: [{ x: 0, y: 0 }],
    })).toMatchObject({ brush_size: 1, opacity: 255, softness: 0 });
  });

  test("creates a usable brush preset from a name alone", () => {
    expect(createBrushPresetParameters.parse({ name: "basic" })).toEqual({
      name: "basic",
      size: 1,
      opacity: 255,
      softness: 0,
      shape: "square",
      color: "#000000",
      blend_mode: "default",
      pixel_perfect: false,
    });
  });
});
