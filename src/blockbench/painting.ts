/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { type PaintPoint } from "@/lib/paintMath";
import { blendModeEnum } from "@/lib/zodObjects";

type PaintColor = { r: number; g: number; b: number; a: number };

type RuntimePainter = {
  current: { texture?: Texture };
  mirror_painting: boolean;
  lock_alpha: boolean;
  erase_mode: boolean;
  mirror_painting_options?: {
    axis: { x: boolean; z: boolean };
    texture?: boolean;
    texture_center?: ArrayVector2 | null;
  };
  getBlendModeCompositeOperation(mode?: string): string;
};

type FaceLike = {
  texture?: string | null;
  uv?: number[] | Record<string, ArrayVector2>;
  getTexture?: () => Texture | null | undefined;
  getSortedVertices?: () => string[];
};

type FaceElement = OutlinerElement & { faces: Record<string, FaceLike> };

export type BrushPreset = {
  name: string;
  size: number | null;
  opacity: number | null;
  softness: number | null;
  shape: "square" | "circle";
  color: string | null;
  blend_mode: z.infer<typeof blendModeEnum>;
  pixel_perfect: boolean;
};

export type LayerUndoAspects = UndoAspects & { layers?: TextureLayer[] };

type RuntimeStateMemory = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  save(key: string): void;
};

export function getRuntimePainter(): RuntimePainter {
  return Painter as unknown as RuntimePainter;
}

export function getRuntimeStateMemory(): RuntimeStateMemory {
  return (globalThis as typeof globalThis & {
    StateMemory: RuntimeStateMemory;
  }).StateMemory;
}

export function setPaintColor(color: string, secondary = false): void {
  (ColorPanel.set as unknown as (
    color: string,
    secondary: boolean,
    silent: boolean
  ) => void)(color, secondary, false);
}

export function setBlockbenchSetting(
  id: string,
  value: string | number | boolean
): void {
  const setting = settings[id];
  if (!setting) throw new Error(`Blockbench setting "${id}" is unavailable.`);
  setting.set(value);
}

export function paintColor(hex: string): PaintColor {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    a: 1,
  };
}

export function colorHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

export function blendPaintPixel(
  base: PaintColor,
  color: PaintColor,
  opacity: number,
  mode: z.infer<typeof blendModeEnum>
): PaintColor {
  if (mode === "set_opacity") {
    return {
      r: color.r,
      g: color.g,
      b: color.b,
      a: getRuntimePainter().lock_alpha ? base.a : opacity * color.a,
    };
  }
  const result = mode === "default"
    ? Painter.combineColors(base, color, opacity)
    : Painter.blendColors(base, color, opacity, mode);
  if (getRuntimePainter().lock_alpha) result.a = base.a;
  return result;
}

export function applyPixelMask(
  ctx: CanvasRenderingContext2D,
  mask: Uint8Array,
  edit: (base: PaintColor, index: number) => PaintColor
): number {
  const image = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  let changed = 0;
  for (let index = 0; index < mask.length; index++) {
    if (!mask[index]) continue;
    const offset = index * 4;
    const base = {
      r: image.data[offset],
      g: image.data[offset + 1],
      b: image.data[offset + 2],
      a: image.data[offset + 3] / 255,
    };
    const result = edit(base, index);
    const nextAlpha = Math.round(result.a * 255);
    if (
      result.r !== base.r
      || result.g !== base.g
      || result.b !== base.b
      || nextAlpha !== image.data[offset + 3]
    ) changed++;
    image.data[offset] = result.r;
    image.data[offset + 1] = result.g;
    image.data[offset + 2] = result.b;
    image.data[offset + 3] = nextAlpha;
  }
  if (changed) ctx.putImageData(image, 0, 0);
  return changed;
}

function withPainterTexture(texture: Texture, callback: () => void): void {
  const painter = getRuntimePainter();
  const previous = painter.current.texture;
  painter.current.texture = texture;
  try {
    callback();
  } finally {
    if (previous) painter.current.texture = previous;
    else delete painter.current.texture;
  }
}

export function paintDabs(
  texture: Texture,
  ctx: CanvasRenderingContext2D,
  points: PaintPoint[],
  size: number,
  softness: number,
  shape: "square" | "circle",
  edit: (base: PaintColor, localOpacity: number, x: number, y: number) => PaintColor
): void {
  withPainterTexture(texture, () => {
    for (const point of points) {
      const method = shape === "circle" ? Painter.editCircle : Painter.editSquare;
      method(ctx, point.x, point.y, size, softness / 100 * 1.8, edit);
    }
  });
}

export function mirrorTransforms(texture: Texture): Array<(point: PaintPoint) => PaintPoint> {
  const painter = getRuntimePainter();
  const options = painter.mirror_painting_options;
  if (!painter.mirror_painting || !options?.texture) return [(point) => point];
  const center = options.texture_center?.some((value) => value !== 0)
    ? options.texture_center
    : [texture.width / 2, texture.display_height / 2] as ArrayVector2;
  const transforms: Array<(point: PaintPoint) => PaintPoint> = [(point) => point];
  if (options.axis.x) {
    transforms.push((point) => ({ x: center[0] * 2 - point.x - 1, y: point.y }));
  }
  if (options.axis.z) {
    transforms.push((point) => ({ x: point.x, y: center[1] * 2 - point.y - 1 }));
  }
  if (options.axis.x && options.axis.z) {
    transforms.push((point) => ({
      x: center[0] * 2 - point.x - 1,
      y: center[1] * 2 - point.y - 1,
    }));
  }
  return transforms;
}

export function mirroredPoints(texture: Texture, points: PaintPoint[]): PaintPoint[] {
  const result = new Map<string, PaintPoint>();
  for (const transform of mirrorTransforms(texture)) {
    for (const point of points) {
      const mirrored = transform(point);
      result.set(`${mirrored.x}:${mirrored.y}`, mirrored);
    }
  }
  return [...result.values()];
}

export function compositeOperation(
  mode: z.infer<typeof blendModeEnum>
): GlobalCompositeOperation {
  const painter = getRuntimePainter();
  if (painter.erase_mode) return "destination-out";
  if (painter.lock_alpha) return "source-atop";
  return painter.getBlendModeCompositeOperation(mode) as GlobalCompositeOperation;
}

export function assertTexturePoint(
  texture: Texture,
  point: PaintPoint,
  label: string,
  combined = false
): void {
  const active = combined ? texture : texture.getActiveCanvas();
  const offset = combined ? [0, 0] : active.offset;
  const x = Math.floor(point.x - offset[0]);
  const y = Math.floor(point.y - offset[1]);
  if (x < 0 || y < 0 || x >= active.canvas.width || y >= active.canvas.height) {
    throw new Error(`${label} (${point.x}, ${point.y}) is outside texture "${texture.name}".`);
  }
}

export function selectedMask(selection: IntMatrix): Uint8Array {
  const length = selection.width * selection.height;
  if (selection.override === true) return new Uint8Array(length).fill(1);
  if (selection.override === false) return new Uint8Array(length);
  return Uint8Array.from(selection.array ?? [], (value) => Number(value !== 0));
}

export function writeSelectedMask(selection: IntMatrix, mask: Uint8Array): void {
  const count = mask.reduce((sum, value) => sum + Number(value !== 0), 0);
  if (count === 0) {
    selection.setOverride(false);
  } else if (count === mask.length) {
    selection.setOverride(true);
  } else {
    selection.setOverride(null);
    selection.array = Int8Array.from(mask);
  }
}

function pointInPolygon(x: number, y: number, vertices: ArrayVector2[]): boolean {
  let inside = false;
  for (let index = 0, previous = vertices.length - 1; index < vertices.length; previous = index++) {
    const [x1, y1] = vertices[index];
    const [x2, y2] = vertices[previous];
    if ((y1 > y) !== (y2 > y)
      && x < (x2 - x1) * (y - y1) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function faceUsesTexture(face: FaceLike, texture: Texture): boolean {
  const resolved = face.getTexture?.();
  return resolved ? resolved.uuid === texture.uuid : face.texture === texture.uuid;
}

function faceSelectionMask(
  texture: Texture,
  canvas: HTMLCanvasElement,
  offset: ArrayVector2,
  face: FaceLike
): Uint8Array {
  const mask = new Uint8Array(canvas.width * canvas.height);
  const uv = face.uv;
  if (!uv || !faceUsesTexture(face, texture)) return mask;
  const factorX = texture.width / texture.getUVWidth();
  const factorY = texture.display_height / texture.getUVHeight();
  const animationOffset = texture.currentFrame * texture.display_height;
  if (Array.isArray(uv)) {
    const [u1, v1, u2, v2] = uv;
    const startX = Math.floor(Math.min(u1, u2) * factorX - offset[0]);
    const endX = Math.ceil(Math.max(u1, u2) * factorX - offset[0]);
    const startY = Math.floor(Math.min(v1, v2) * factorY + animationOffset - offset[1]);
    const endY = Math.ceil(Math.max(v1, v2) * factorY + animationOffset - offset[1]);
    for (let y = Math.max(0, startY); y < Math.min(canvas.height, endY); y++) {
      mask.fill(1, y * canvas.width + Math.max(0, startX), y * canvas.width + Math.min(canvas.width, endX));
    }
    return mask;
  }

  const keys = face.getSortedVertices?.() ?? Object.keys(uv);
  const vertices = keys
    .map((key) => uv[key] as ArrayVector2)
    .filter(Boolean)
    .map(([u, v]) => [
      u * factorX - offset[0],
      v * factorY + animationOffset - offset[1],
    ] as ArrayVector2);
  if (vertices.length < 3) return mask;
  const minX = Math.max(0, Math.floor(Math.min(...vertices.map(([x]) => x))));
  const maxX = Math.min(canvas.width, Math.ceil(Math.max(...vertices.map(([x]) => x))));
  const minY = Math.max(0, Math.floor(Math.min(...vertices.map(([, y]) => y))));
  const maxY = Math.min(canvas.height, Math.ceil(Math.max(...vertices.map(([, y]) => y))));
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, vertices)) mask[y * canvas.width + x] = 1;
    }
  }
  return mask;
}

export function fillGeometryMask(
  texture: Texture,
  canvas: HTMLCanvasElement,
  offset: ArrayVector2,
  mode: "face" | "element" | "selected_elements",
  point: PaintPoint
): Uint8Array {
  const elements = Outliner.selected.filter(
    (element): element is FaceElement => Boolean((element as Partial<FaceElement>).faces)
  );
  if (!elements.length) throw new Error(`${mode} fill requires a selected textured element.`);
  const result = new Uint8Array(canvas.width * canvas.height);
  const pointIndex = Math.floor(point.y - offset[1]) * canvas.width
    + Math.floor(point.x - offset[0]);

  for (const element of mode === "element" ? elements.slice(0, 1) : elements) {
    const selectedFaces = (UVEditor.getSelectedFaces(element) ?? []) as string[];
    const faceEntries = Object.entries(element.faces).filter(([key]) =>
      mode !== "face" || selectedFaces.length === 0 || selectedFaces.includes(key)
    );
    for (const [, face] of faceEntries) {
      const faceMask = faceSelectionMask(texture, canvas, offset, face);
      if (mode === "face" && !faceMask[pointIndex] && faceEntries.length > 1) continue;
      for (let index = 0; index < result.length; index++) {
        if (faceMask[index]) result[index] = 1;
      }
      if (mode === "face" && result[pointIndex]) return result;
    }
    if (mode === "element") break;
  }
  if (mode === "face" && !result[pointIndex]) {
    throw new Error("No selected face using this texture contains the fill coordinate.");
  }
  return result;
}

export function runUndoEdit<T>(
  aspects: UndoAspects,
  label: string,
  callback: () => T
): T {
  Undo.initEdit(aspects);
  try {
    const result = callback();
    Undo.finishEdit(label, aspects);
    return result;
  } catch (error) {
    Undo.cancelEdit();
    throw error;
  }
}

export function runUndoSelection<T>(label: string, callback: () => T): T {
  const aspects = { texture_selection: true };
  Undo.initSelection(aspects);
  try {
    const result = callback();
    Undo.finishSelection(label, aspects);
    return result;
  } catch (error) {
    Undo.cancelSelection(true);
    throw error;
  }
}
