/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { getAndActivateTexture, setBarItemValue } from "@/lib/util";
import {
  editTextureWithUndo,
  prepareTextureForMutation,
} from "@/lib/textureSafety";
import { getDeterministicShapeGeometry } from "@/lib/toolFixes";
import {
  colorMatchMask,
  combineSelectionMasks,
  ellipseSelectionMask,
  invertSelectionMask,
  rasterStroke,
  rectangleSelectionMask,
  resizeSelectionMask,
  type PaintPoint,
} from "@/lib/paintMath";
import {
  textureIdOptionalSchema,
  hexColorSchema,
  opacitySchema,
  brushSizeSchema,
  brushSoftnessSchema,
  brushShapeEnum,
  blendModeEnum,
  layerBlendModeEnum,
  fillModeEnum,
  drawShapeEnum,
  copyBrushModeEnum,
  brushModifierEnum,
  coordinateSchema,
  brushSettingsSchema,
} from "@/lib/zodObjects";

export const paintFillToolParameters = z.object({
  texture_id: textureIdOptionalSchema,
  x: z.number().describe("X coordinate to start fill."),
  y: z.number().describe("Y coordinate to start fill."),
  color: hexColorSchema.describe("Fill color as hex string."),
  opacity: opacitySchema.optional().default(255).describe("Fill opacity (0-255)."),
  tolerance: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .default(0)
    .describe("Color tolerance for fill."),
  fill_mode: fillModeEnum
    .optional()
    .default("color_connected")
    .describe("Fill mode."),
  blend_mode: blendModeEnum.optional().default("default").describe("Fill blend mode."),
});

export const drawShapeToolParameters = z.object({
  texture_id: textureIdOptionalSchema,
  shape: drawShapeEnum.describe("Shape to draw. '_h' suffix means hollow."),
  start: coordinateSchema.extend({
    x: z.number().describe("Start X coordinate."),
    y: z.number().describe("Start Y coordinate."),
  }),
  end: coordinateSchema.extend({
    x: z.number().describe("End X coordinate."),
    y: z.number().describe("End Y coordinate."),
  }),
  color: hexColorSchema.describe("Shape color as hex string."),
  line_width: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(1)
    .describe("Line width for hollow shapes."),
  opacity: opacitySchema.optional().default(255).describe("Shape opacity (0-255)."),
  blend_mode: blendModeEnum.optional().default("default").describe("Shape blend mode."),
});

export const gradientToolParameters = z.object({
  texture_id: textureIdOptionalSchema,
  start: coordinateSchema.extend({
    x: z.number().describe("Gradient start X coordinate."),
    y: z.number().describe("Gradient start Y coordinate."),
  }),
  end: coordinateSchema.extend({
    x: z.number().describe("Gradient end X coordinate."),
    y: z.number().describe("Gradient end Y coordinate."),
  }),
  start_color: hexColorSchema.describe("Start color as hex string."),
  end_color: hexColorSchema.describe("End color as hex string."),
  opacity: opacitySchema.optional().default(255).describe("Gradient opacity (0-255)."),
  blend_mode: blendModeEnum.optional().default("default").describe("Gradient blend mode."),
});

export const colorPickerToolParameters = z.object({
  texture_id: textureIdOptionalSchema,
  x: z.number().describe("X coordinate to pick color from."),
  y: z.number().describe("Y coordinate to pick color from."),
  set_as_secondary: z
    .boolean()
    .optional()
    .default(false)
    .describe("Set as secondary color instead of primary."),
  pick_opacity: z
    .boolean()
    .optional()
    .default(false)
    .describe("Also pick and apply the pixel's opacity."),
});

export const copyBrushToolParameters = z.object({
  texture_id: textureIdOptionalSchema,
  source: coordinateSchema.extend({
    x: z.number().describe("Source X coordinate to copy from."),
    y: z.number().describe("Source Y coordinate to copy from."),
  }),
  target: coordinateSchema.extend({
    x: z.number().describe("Target X coordinate to paste to."),
    y: z.number().describe("Target Y coordinate to paste to."),
  }),
  brush_size: brushSizeSchema.optional().default(1).describe("Copy brush size."),
  opacity: opacitySchema.optional().default(255).describe("Copy opacity (0-255)."),
  mode: copyBrushModeEnum.optional().default("copy").describe("Copy brush mode."),
});

export const eraserToolParameters = z.object({
  texture_id: textureIdOptionalSchema,
  coordinates: z
    .array(
      coordinateSchema.extend({
        x: z.number().describe("X coordinate to erase at."),
        y: z.number().describe("Y coordinate to erase at."),
      })
    )
    .min(1)
    .describe("Array of coordinates to erase at."),
  brush_size: brushSizeSchema.optional().default(1).describe("Eraser brush size."),
  opacity: opacitySchema.optional().default(255).describe("Eraser opacity (0-255)."),
  softness: brushSoftnessSchema.optional().default(0).describe("Eraser softness percentage."),
  shape: brushShapeEnum.optional().default("square").describe("Eraser shape."),
  connect_strokes: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to connect erase strokes with lines."),
});

export const paintSettingsParameters = z.object({
  mirror_painting: z
    .object({
      enabled: z.boolean().describe("Enable mirror painting."),
      axis: z
        .array(z.enum(["x", "z"]))
        .min(1)
        .optional()
        .describe("Blockbench mirror axes (X and/or Z)."),
      texture: z.boolean().optional().describe("Enable texture mirroring."),
      texture_center: coordinateSchema
        .extend({
          x: z.number().describe("X coordinate of texture mirror center."),
          y: z.number().describe("Y coordinate of texture mirror center."),
        })
        .optional()
        .describe("Texture mirror center."),
    })
    .optional()
    .describe("Mirror painting settings."),
  lock_alpha: z
    .boolean()
    .optional()
    .describe("Lock alpha channel while painting."),
  pixel_perfect: z
    .boolean()
    .optional()
    .describe("Enable pixel perfect drawing."),
  paint_side_restrict: z
    .boolean()
    .optional()
    .describe("Restrict painting to current face side."),
  color_erase_mode: z
    .boolean()
    .optional()
    .describe("Enable color erase mode."),
  brush_opacity_modifier: brushModifierEnum
    .optional()
    .describe("Brush opacity modifier for stylus."),
  brush_size_modifier: brushModifierEnum
    .optional()
    .describe("Brush size modifier for stylus."),
  paint_with_stylus_only: z
    .boolean()
    .optional()
    .describe("Only allow painting with stylus input."),
  pick_color_opacity: z
    .boolean()
    .optional()
    .describe("Pick opacity when using color picker."),
  pick_combined_color: z
    .boolean()
    .optional()
    .describe("Pick combined layer colors."),
});

export const paintWithBrushParameters = z.object({
  texture_id: textureIdOptionalSchema,
  coordinates: z
    .array(
      coordinateSchema.extend({
        x: z.number().describe("X coordinate on texture."),
        y: z.number().describe("Y coordinate on texture."),
      })
    )
    .min(1)
    .describe("Array of coordinates to paint at."),
  brush_settings: brushSettingsSchema,
  connect_strokes: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to connect paint strokes with lines."),
});

export const createBrushPresetParameters = z.object({
  name: z.string().describe("Name of the brush preset."),
  size: brushSizeSchema.optional().default(1),
  opacity: opacitySchema.optional().default(255),
  softness: brushSoftnessSchema.optional().default(0),
  shape: brushShapeEnum.optional().default("square").describe("Brush shape."),
  color: hexColorSchema.optional().default("#000000").describe("Brush color as hex string."),
  blend_mode: blendModeEnum.optional().default("default").describe("Brush blend mode."),
  pixel_perfect: z
    .boolean()
    .optional()
    .default(false)
    .describe("Enable pixel perfect drawing."),
});

export const loadBrushPresetParameters = z.object({
  preset_name: z.string().describe("Name of the brush preset to load."),
});

export const textureSelectionParameters = z.object({
  action: z
    .enum([
      "select_rectangle",
      "select_ellipse",
      "select_all",
      "clear_selection",
      "invert_selection",
      "expand_selection",
      "contract_selection",
    ])
    .describe("Selection action to perform."),
  texture_id: textureIdOptionalSchema,
  coordinates: z
    .object({
      x1: z.number().describe("Start X coordinate."),
      y1: z.number().describe("Start Y coordinate."),
      x2: z.number().describe("End X coordinate."),
      y2: z.number().describe("End Y coordinate."),
    })
    .optional()
    .describe("Selection area coordinates."),
  radius: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Radius for expand or contract operations."),
  mode: z
    .enum(["create", "add", "subtract", "intersect"])
    .optional()
    .default("create")
    .describe("Selection mode."),
});

export const textureLayerManagementParameters = z.object({
  action: z
    .enum([
      "create_layer",
      "delete_layer",
      "duplicate_layer",
      "merge_down",
      "set_opacity",
      "set_blend_mode",
      "move_layer",
      "rename_layer",
      "flatten_layers",
    ])
    .describe("Layer management action."),
  texture_id: textureIdOptionalSchema,
  layer_name: z.string().optional().describe("Name of the layer."),
  opacity: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Layer opacity percentage."),
  blend_mode: layerBlendModeEnum.optional().describe("Layer blend mode."),
  target_index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Target position for moving layers."),
});

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

type BrushPreset = {
  name: string;
  size: number | null;
  opacity: number | null;
  softness: number | null;
  shape: "square" | "circle";
  color: string | null;
  blend_mode: z.infer<typeof blendModeEnum>;
  pixel_perfect: boolean;
};

type LayerUndoAspects = UndoAspects & { layers?: TextureLayer[] };

type RuntimeStateMemory = {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  save(key: string): void;
};

function getRuntimePainter(): RuntimePainter {
  return Painter as unknown as RuntimePainter;
}

function getRuntimeStateMemory(): RuntimeStateMemory {
  return (globalThis as typeof globalThis & {
    StateMemory: RuntimeStateMemory;
  }).StateMemory;
}

function setPaintColor(color: string, secondary = false): void {
  (ColorPanel.set as unknown as (
    color: string,
    secondary: boolean,
    silent: boolean
  ) => void)(color, secondary, false);
}

function setBlockbenchSetting(
  id: string,
  value: string | number | boolean
): void {
  const setting = settings[id];
  if (!setting) throw new Error(`Blockbench setting "${id}" is unavailable.`);
  setting.set(value);
}

function paintColor(hex: string): PaintColor {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    a: 1,
  };
}

function colorHex(red: number, green: number, blue: number): string {
  return `#${[red, green, blue]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function blendPaintPixel(
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

function applyPixelMask(
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

function paintDabs(
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

function mirrorTransforms(texture: Texture): Array<(point: PaintPoint) => PaintPoint> {
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

function mirroredPoints(texture: Texture, points: PaintPoint[]): PaintPoint[] {
  const result = new Map<string, PaintPoint>();
  for (const transform of mirrorTransforms(texture)) {
    for (const point of points) {
      const mirrored = transform(point);
      result.set(`${mirrored.x}:${mirrored.y}`, mirrored);
    }
  }
  return [...result.values()];
}

function compositeOperation(
  mode: z.infer<typeof blendModeEnum>
): GlobalCompositeOperation {
  const painter = getRuntimePainter();
  if (painter.erase_mode) return "destination-out";
  if (painter.lock_alpha) return "source-atop";
  return painter.getBlendModeCompositeOperation(mode) as GlobalCompositeOperation;
}

function assertTexturePoint(
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

function selectedMask(selection: IntMatrix): Uint8Array {
  const length = selection.width * selection.height;
  if (selection.override === true) return new Uint8Array(length).fill(1);
  if (selection.override === false) return new Uint8Array(length);
  return Uint8Array.from(selection.array ?? [], (value) => Number(value !== 0));
}

function writeSelectedMask(selection: IntMatrix, mask: Uint8Array): void {
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

function fillGeometryMask(
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

function runUndoEdit<T>(
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

function runUndoSelection<T>(label: string, callback: () => T): T {
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

export const paintToolDocs: ToolSpec[] = [
  {
    name: "paint_fill_tool",
    description: "Uses the fill/bucket tool to fill areas with color.",
    annotations: {
      title: "Paint Fill Tool",
      destructiveHint: true,
    },
    parameters: paintFillToolParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "draw_shape_tool",
    description: "Draws geometric shapes on textures.",
    annotations: {
      title: "Draw Shape Tool",
      destructiveHint: true,
    },
    parameters: drawShapeToolParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "gradient_tool",
    description: "Applies gradients to textures.",
    annotations: {
      title: "Gradient Tool",
      destructiveHint: true,
    },
    parameters: gradientToolParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "color_picker_tool",
    description:
      "Picks colors from textures and sets them as the active color.",
    annotations: {
      title: "Color Picker Tool",
      readOnlyHint: true,
    },
    writableProject: false,
    parameters: colorPickerToolParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "copy_brush_tool",
    description: "Uses the copy/clone brush to copy texture areas.",
    annotations: {
      title: "Copy Brush Tool",
      destructiveHint: true,
    },
    parameters: copyBrushToolParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "eraser_tool",
    description: "Erases parts of textures with customizable settings.",
    annotations: {
      title: "Eraser Tool",
      destructiveHint: true,
    },
    parameters: eraserToolParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "paint_settings",
    description: "Configures paint mode settings and preferences.",
    project: "none",
    annotations: {
      title: "Paint Settings",
      destructiveHint: true,
    },
    parameters: paintSettingsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "paint_with_brush",
    description:
      "Paints on textures using the brush tool with customizable settings.",
    annotations: {
      title: "Paint with Brush",
      destructiveHint: true,
    },
    parameters: paintWithBrushParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "create_brush_preset",
    description: "Creates a custom brush preset with specified settings.",
    project: "none",
    annotations: {
      title: "Create Brush Preset",
      destructiveHint: true,
    },
    parameters: createBrushPresetParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "load_brush_preset",
    description: "Loads and applies a brush preset by name.",
    project: "none",
    annotations: {
      title: "Load Brush Preset",
      destructiveHint: true,
    },
    parameters: loadBrushPresetParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "texture_selection",
    description:
      "Creates, modifies, or manipulates texture selections for painting.",
    annotations: {
      title: "Texture Selection",
      destructiveHint: true,
    },
    parameters: textureSelectionParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "texture_layer_management",
    description: "Creates, manages, and manipulates texture layers.",
    annotations: {
      title: "Texture Layer Management",
      destructiveHint: true,
    },
    parameters: textureLayerManagementParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerPaintTools() {
  createInternalTool(
    paintToolDocs[0].name,
    {
      ...paintToolDocs[0],
      async execute({
        texture_id,
        x,
        y,
        color,
        opacity,
        tolerance,
        fill_mode,
        blend_mode,
      }, context) {
        const texture = getAndActivateTexture(texture_id);
        assertTexturePoint(texture, { x, y }, "Fill coordinate");
        setPaintColor(color);
        setBarItemValue("slider_brush_opacity", opacity);
        setBarItemValue("fill_mode", fill_mode);
        setBarItemValue("blend_mode", blend_mode);

        let changedPixels = 0;
        editTextureWithUndo(context.project!, texture, "Fill texture", (canvas) => {
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Blockbench could not open the texture canvas.");
          const { offset } = texture.getActiveCanvas();
          const localX = Math.floor(x - offset[0]);
          const localY = Math.floor(y - offset[1]);
          let mask: Uint8Array;

          if (fill_mode === "color" || fill_mode === "color_connected") {
            const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
            mask = colorMatchMask(
              image.data,
              canvas.width,
              canvas.height,
              localX,
              localY,
              tolerance,
              fill_mode === "color_connected",
              (sampleX, sampleY) =>
                Boolean(texture.selection.allow(sampleX + offset[0], sampleY + offset[1]))
            );
          } else if (fill_mode === "selection") {
            mask = new Uint8Array(canvas.width * canvas.height);
            for (let sampleY = 0; sampleY < canvas.height; sampleY++) {
              for (let sampleX = 0; sampleX < canvas.width; sampleX++) {
                mask[sampleY * canvas.width + sampleX] = Number(Boolean(
                  texture.selection.allow(sampleX + offset[0], sampleY + offset[1])
                ));
              }
            }
          } else {
            mask = fillGeometryMask(
              texture,
              canvas,
              offset,
              fill_mode,
              { x, y }
            );
            for (let index = 0; index < mask.length; index++) {
              if (!mask[index]) continue;
              const sampleX = index % canvas.width;
              const sampleY = Math.floor(index / canvas.width);
              if (!texture.selection.allow(sampleX + offset[0], sampleY + offset[1])) {
                mask[index] = 0;
              }
            }
          }

          const fillColor = paintColor(color);
          const fillOpacity = opacity / 255;
          changedPixels = applyPixelMask(ctx, mask, (base) => {
            const painter = getRuntimePainter();
            if (painter.erase_mode) {
              return painter.lock_alpha
                ? base
                : { ...base, a: base.a * (1 - fillOpacity) };
            }
            return blendPaintPixel(base, fillColor, fillOpacity, blend_mode);
          });
        });
        Canvas.updateAll();

        return "Filled " + changedPixels + " pixel"
          + (changedPixels === 1 ? "" : "s")
          + " at (" + x + ", " + y + ") on texture \"" + texture.name + "\".";
      },
    },
    paintToolDocs[0].status
  );

  createInternalTool(
    paintToolDocs[1].name,
    {
      ...paintToolDocs[1],
      async execute({
        texture_id,
        shape,
        start,
        end,
        color,
        line_width,
        opacity,
        blend_mode,
      }, context) {
        const texture = getAndActivateTexture(texture_id);
        assertTexturePoint(texture, start, "Shape start");
        assertTexturePoint(texture, end, "Shape end");
        setPaintColor(color);
        setBarItemValue("slider_brush_opacity", opacity);
        setBarItemValue("slider_brush_size", line_width);
        setBarItemValue("blend_mode", blend_mode);
        setBarItemValue("draw_shape_type", shape);

        const pairs = mirrorTransforms(texture).map((transform) => ({
          start: transform(start),
          end: transform(end),
        }));
        const hollow = shape.endsWith("_h");

        editTextureWithUndo(context.project!, texture, "Draw shape", (canvas) => {
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Blockbench could not open the texture canvas.");
          const { offset } = texture.getActiveCanvas();
          texture.selection.maskCanvas(ctx, offset);
          try {
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = line_width;
            ctx.globalAlpha = opacity / 255;
            ctx.globalCompositeOperation = compositeOperation(blend_mode);

            for (const pair of pairs) {
              const geometry = getDeterministicShapeGeometry(shape, pair.start, pair.end);
              if (geometry.kind === "rectangle") {
                const drawX = geometry.x - offset[0];
                const drawY = geometry.y - offset[1];
                if (hollow && geometry.width > line_width && geometry.height > line_width) {
                  const inset = line_width / 2;
                  ctx.strokeRect(
                    drawX + inset,
                    drawY + inset,
                    geometry.width - line_width,
                    geometry.height - line_width
                  );
                } else {
                  ctx.fillRect(drawX, drawY, geometry.width, geometry.height);
                }
              } else {
                ctx.beginPath();
                ctx.ellipse(
                  geometry.centerX - offset[0],
                  geometry.centerY - offset[1],
                  geometry.radiusX,
                  geometry.radiusY,
                  0,
                  0,
                  Math.PI * 2
                );
                if (hollow) ctx.stroke();
                else ctx.fill();
              }
            }
          } finally {
            ctx.restore();
          }
        });
        Canvas.updateAll();

        return "Drew " + shape + " from (" + start.x + ", " + start.y + ") to ("
          + end.x + ", " + end.y + ") on texture \"" + texture.name + "\".";
      },
    },
    paintToolDocs[1].status
  );

  createInternalTool(
    paintToolDocs[2].name,
    {
      ...paintToolDocs[2],
      async execute({
        texture_id,
        start,
        end,
        start_color,
        end_color,
        opacity,
        blend_mode,
      }, context) {
        const texture = getAndActivateTexture(texture_id);
        assertTexturePoint(texture, start, "Gradient start");
        assertTexturePoint(texture, end, "Gradient end");
        setPaintColor(start_color);
        setPaintColor(end_color, true);
        setBarItemValue("slider_brush_opacity", opacity);
        setBarItemValue("blend_mode", blend_mode);

        const pairs = mirrorTransforms(texture).map((transform) => ({
          start: transform(start),
          end: transform(end),
        }));
        editTextureWithUndo(context.project!, texture, "Apply gradient", (canvas) => {
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Blockbench could not open the texture canvas.");
          const { offset } = texture.getActiveCanvas();
          texture.selection.maskCanvas(ctx, offset);
          try {
            ctx.globalAlpha = opacity / 255;
            ctx.globalCompositeOperation = compositeOperation(blend_mode);
            for (const pair of pairs) {
              const gradient = ctx.createLinearGradient(
                pair.start.x - offset[0],
                pair.start.y - offset[1],
                pair.end.x - offset[0],
                pair.end.y - offset[1]
              );
              gradient.addColorStop(0, start_color);
              gradient.addColorStop(1, end_color);
              ctx.fillStyle = gradient;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
          } finally {
            ctx.restore();
          }
        });
        Canvas.updateAll();

        return "Applied a gradient from (" + start.x + ", " + start.y + ") to ("
          + end.x + ", " + end.y + ") on texture \"" + texture.name + "\".";
      },
    },
    paintToolDocs[2].status
  );

  createInternalTool(
    paintToolDocs[3].name,
    {
      ...paintToolDocs[3],
      async execute({ texture_id, x, y, set_as_secondary, pick_opacity }) {
        const texture = getAndActivateTexture(texture_id);
        assertTexturePoint(texture, { x, y }, "Picker coordinate", true);
        const pixel = texture.ctx.getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
        const color = colorHex(pixel[0], pixel[1], pixel[2]);
        setPaintColor(color, set_as_secondary);
        if (pick_opacity) setBarItemValue("slider_brush_opacity", pixel[3]);

        return "Picked color " + color
          + (pick_opacity ? " with opacity " + pixel[3] : "")
          + " from (" + x + ", " + y + ") on texture \"" + texture.name + "\".";
      },
    },
    paintToolDocs[3].status
  );

  createInternalTool(
    paintToolDocs[4].name,
    {
      ...paintToolDocs[4],
      async execute({ texture_id, source, target, brush_size, opacity, mode }, context) {
        const texture = getAndActivateTexture(texture_id);
        assertTexturePoint(texture, source, "Copy source");
        assertTexturePoint(texture, target, "Copy target");
        setBarItemValue("slider_brush_size", brush_size);
        setBarItemValue("slider_brush_opacity", opacity);
        setBarItemValue("copy_brush_mode", mode);

        editTextureWithUndo(context.project!, texture, "Copy brush", (canvas) => {
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Blockbench could not open the texture canvas.");
          const { offset } = texture.getActiveCanvas();
          const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const targets = mirroredPoints(texture, [target]);

          for (const brushTarget of targets) {
            paintDabs(
              texture,
              ctx,
              [brushTarget],
              brush_size,
              0,
              "circle",
              (base, localOpacity, pixelX, pixelY) => {
                let sourceX: number;
                let sourceY: number;
                if (mode === "pattern") {
                  const gridStartX = source.x - brush_size / 2;
                  const gridStartY = source.y - brush_size / 2;
                  sourceX = Math.floor(
                    gridStartX
                    + ((pixelX + brush_size * 200 - (gridStartX % brush_size)) % brush_size)
                  );
                  sourceY = Math.floor(
                    gridStartY
                    + ((pixelY + brush_size * 200 - (gridStartY % brush_size)) % brush_size)
                  );
                } else {
                  sourceX = Math.round(source.x + pixelX - brushTarget.x);
                  sourceY = Math.round(source.y + pixelY - brushTarget.y);
                }

                const localX = sourceX - offset[0];
                const localY = sourceY - offset[1];
                if (
                  localX < 0
                  || localY < 0
                  || localX >= snapshot.width
                  || localY >= snapshot.height
                ) return base;
                const index = (localY * snapshot.width + localX) * 4;
                const sampled = {
                  r: snapshot.data[index],
                  g: snapshot.data[index + 1],
                  b: snapshot.data[index + 2],
                  a: snapshot.data[index + 3] / 255,
                };
                const result = Painter.combineColors(
                  base,
                  sampled,
                  opacity / 255 * localOpacity
                );
                if (getRuntimePainter().lock_alpha) result.a = base.a;
                return result;
              }
            );
          }
        }, true);
        Canvas.updateAll();

        return "Applied " + mode + " brush from (" + source.x + ", " + source.y
          + ") to (" + target.x + ", " + target.y + ") on texture \""
          + texture.name + "\".";
      },
    },
    paintToolDocs[4].status
  );

  createInternalTool(
    paintToolDocs[5].name,
    {
      ...paintToolDocs[5],
      async execute({
        texture_id,
        coordinates,
        brush_size,
        opacity,
        softness,
        shape,
        connect_strokes,
      }, context) {
        const texture = getAndActivateTexture(texture_id);
        for (const coordinate of coordinates) {
          assertTexturePoint(texture, coordinate, "Eraser coordinate");
        }
        setBarItemValue("slider_brush_size", brush_size);
        setBarItemValue("slider_brush_opacity", opacity);
        setBarItemValue("slider_brush_softness", softness);
        setBarItemValue("brush_shape", shape);

        if (getRuntimePainter().lock_alpha) {
          return "Alpha is locked, so the eraser left texture \"" + texture.name + "\" unchanged.";
        }

        const points = mirroredPoints(texture, rasterStroke(coordinates, connect_strokes));
        editTextureWithUndo(context.project!, texture, "Erase texture", (canvas) => {
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Blockbench could not open the texture canvas.");
          paintDabs(
            texture,
            ctx,
            points,
            brush_size,
            softness,
            shape,
            (base, localOpacity) => ({
              ...base,
              a: base.a * (1 - opacity / 255 * localOpacity),
            })
          );
        }, true);
        Canvas.updateAll();

        return "Erased along " + coordinates.length + " stroke point"
          + (coordinates.length === 1 ? "" : "s")
          + " on texture \"" + texture.name + "\".";
      },
    },
    paintToolDocs[5].status
  );

  createInternalTool(
    paintToolDocs[6].name,
    {
      ...paintToolDocs[6],
      async execute({
        mirror_painting,
        lock_alpha,
        pixel_perfect,
        paint_side_restrict,
        color_erase_mode,
        brush_opacity_modifier,
        brush_size_modifier,
        paint_with_stylus_only,
        pick_color_opacity,
        pick_combined_color,
      }) {
        const updates: string[] = [];

        if (mirror_painting !== undefined) {
          setBarItemValue("mirror_painting", mirror_painting.enabled);
          const painter = getRuntimePainter();
          painter.mirror_painting = mirror_painting.enabled;
          const options = painter.mirror_painting_options;
          if (!options) throw new Error("This Blockbench build does not expose mirror-painting options.");
          if (mirror_painting.axis !== undefined) {
            const axes = new Set(mirror_painting.axis);
            options.axis.x = axes.has("x");
            options.axis.z = axes.has("z");
          }
          if (mirror_painting.texture !== undefined) {
            options.texture = mirror_painting.texture;
          }
          if (mirror_painting.texture_center !== undefined) {
            options.texture_center = [
              mirror_painting.texture_center.x,
              mirror_painting.texture_center.y,
            ];
          }
          updates.push("mirror painting");
        }

        if (lock_alpha !== undefined) {
          setBarItemValue("lock_alpha", lock_alpha);
          getRuntimePainter().lock_alpha = lock_alpha;
          updates.push("alpha lock");
        }
        if (pixel_perfect !== undefined) {
          setBarItemValue("pixel_perfect_drawing", pixel_perfect);
          updates.push("pixel-perfect drawing");
        }
        if (color_erase_mode !== undefined) {
          setBarItemValue("color_erase_mode", color_erase_mode);
          getRuntimePainter().erase_mode = color_erase_mode;
          updates.push("color erase mode");
        }
        if (paint_side_restrict !== undefined) {
          setBlockbenchSetting("paint_side_restrict", paint_side_restrict);
          updates.push("paint-side restriction");
        }
        if (brush_opacity_modifier !== undefined) {
          setBlockbenchSetting("brush_opacity_modifier", brush_opacity_modifier);
          updates.push("brush opacity modifier");
        }
        if (brush_size_modifier !== undefined) {
          setBlockbenchSetting("brush_size_modifier", brush_size_modifier);
          updates.push("brush size modifier");
        }
        if (paint_with_stylus_only !== undefined) {
          setBlockbenchSetting("paint_with_stylus_only", paint_with_stylus_only);
          updates.push("stylus-only painting");
        }
        if (pick_color_opacity !== undefined) {
          setBlockbenchSetting("pick_color_opacity", pick_color_opacity);
          updates.push("color-picker opacity");
        }
        if (pick_combined_color !== undefined) {
          setBlockbenchSetting("pick_combined_color", pick_combined_color);
          updates.push("combined color picking");
        }

        return updates.length
          ? "Updated " + updates.join(", ") + "."
          : "No paint settings were supplied.";
      },
    },
    paintToolDocs[6].status
  );

  createInternalTool(
    paintToolDocs[7].name,
    {
      ...paintToolDocs[7],
      async execute({
        texture_id,
        coordinates,
        brush_settings,
        connect_strokes,
      }, context) {
        const texture = getAndActivateTexture(texture_id);
        for (const coordinate of coordinates) {
          assertTexturePoint(texture, coordinate, "Brush coordinate");
        }

        const size = brush_settings?.size ?? 1;
        const opacity = brush_settings?.opacity ?? 255;
        const softness = brush_settings?.softness ?? 0;
        const shape = brush_settings?.shape ?? "square";
        const color = brush_settings?.color ?? "#000000";
        const blendMode = brush_settings?.blend_mode ?? "default";
        setBarItemValue("slider_brush_size", size);
        setBarItemValue("slider_brush_opacity", opacity);
        setBarItemValue("slider_brush_softness", softness);
        setBarItemValue("brush_shape", shape);
        setBarItemValue("blend_mode", blendMode);
        setPaintColor(color);

        const points = mirroredPoints(texture, rasterStroke(coordinates, connect_strokes));
        const brushColor = paintColor(color);
        editTextureWithUndo(context.project!, texture, "Paint with brush", (canvas) => {
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Blockbench could not open the texture canvas.");
          paintDabs(
            texture,
            ctx,
            points,
            size,
            softness,
            shape,
            (base, localOpacity) =>
              blendPaintPixel(base, brushColor, opacity / 255 * localOpacity, blendMode)
          );
        }, true);
        Canvas.updateAll();

        return "Painted along " + coordinates.length + " stroke point"
          + (coordinates.length === 1 ? "" : "s")
          + " on texture \"" + texture.name + "\".";
      },
    },
    paintToolDocs[7].status
  );

  createInternalTool(
    paintToolDocs[8].name,
    {
      ...paintToolDocs[8],
      async execute({
        name,
        size,
        opacity,
        softness,
        shape,
        color,
        blend_mode,
        pixel_perfect,
      }) {
        const memory = getRuntimeStateMemory();
        const stored = memory.get("brush_presets");
        const presets = Array.isArray(stored) ? [...stored] as BrushPreset[] : [];
        if (presets.some((preset) => preset.name === name)) {
          throw new Error("A brush preset named \"" + name + "\" already exists.");
        }
        const preset: BrushPreset = {
          name,
          size,
          opacity,
          softness,
          shape,
          color,
          blend_mode,
          pixel_perfect,
        };
        presets.push(preset);
        memory.set("brush_presets", presets);
        memory.save("brush_presets");

        return "Created brush preset \"" + name + "\".";
      },
    },
    paintToolDocs[8].status
  );

  createInternalTool(
    paintToolDocs[9].name,
    {
      ...paintToolDocs[9],
      async execute({ preset_name }) {
        const stored = getRuntimeStateMemory().get("brush_presets");
        const presets = Array.isArray(stored)
          ? (stored as BrushPreset[]).filter((preset) => preset.name === preset_name)
          : [];
        if (presets.length > 1) {
          throw new Error(
            "Brush preset name \"" + preset_name + "\" is ambiguous ("
            + presets.length + " matches). Rename or remove duplicate presets first."
          );
        }
        const preset = presets[0];
        if (!preset) throw new Error("Brush preset \"" + preset_name + "\" was not found.");
        Painter.loadBrushPreset(preset);

        return "Loaded brush preset \"" + preset_name + "\".";
      },
    },
    paintToolDocs[9].status
  );

  createInternalTool(
    paintToolDocs[10].name,
    {
      ...paintToolDocs[10],
      async execute({ action, texture_id, coordinates, radius, mode }) {
        const texture = getAndActivateTexture(texture_id);
        const selection = texture.selection;

        runUndoSelection("Texture selection", () => {
          selection.changeSize(texture.width, texture.height);
          const current = selectedMask(selection);
          let next = current;

          switch (action) {
            case "select_rectangle":
              if (!coordinates) {
                throw new Error("Rectangle selection requires coordinates.");
              }
              next = combineSelectionMasks(
                current,
                rectangleSelectionMask(
                  texture.width,
                  texture.height,
                  coordinates.x1,
                  coordinates.y1,
                  coordinates.x2,
                  coordinates.y2
                ),
                mode
              );
              break;
            case "select_ellipse":
              if (!coordinates) {
                throw new Error("Ellipse selection requires coordinates.");
              }
              next = combineSelectionMasks(
                current,
                ellipseSelectionMask(
                  texture.width,
                  texture.height,
                  coordinates.x1,
                  coordinates.y1,
                  coordinates.x2,
                  coordinates.y2
                ),
                mode
              );
              break;
            case "select_all":
              next = new Uint8Array(texture.width * texture.height).fill(1);
              break;
            case "clear_selection":
              next = new Uint8Array(texture.width * texture.height);
              break;
            case "invert_selection":
              next = invertSelectionMask(current);
              break;
            case "expand_selection":
              if (radius === undefined) {
                throw new Error("Expand selection requires a radius.");
              }
              next = resizeSelectionMask(
                current,
                texture.width,
                texture.height,
                radius,
                true
              );
              break;
            case "contract_selection":
              if (radius === undefined) {
                throw new Error("Contract selection requires a radius.");
              }
              next = resizeSelectionMask(
                current,
                texture.width,
                texture.height,
                radius,
                false
              );
              break;
          }
          writeSelectedMask(selection, next);
        });

        UVEditor.updateSelectionOutline();
        UVEditor.vue.updateTexture();
        return "Applied " + action + " to texture \"" + texture.name + "\".";
      },
    },
    paintToolDocs[10].status
  );

  createInternalTool(
    paintToolDocs[11].name,
    {
      ...paintToolDocs[11],
      async execute({
        action,
        texture_id,
        layer_name,
        opacity,
        blend_mode,
        target_index,
      }, context) {
        const texture = getAndActivateTexture(texture_id);
        prepareTextureForMutation(context.project!, texture);
        let result = "";

        switch (action) {
          case "create_layer": {
            result = runUndoEdit(
              { textures: [texture], bitmap: true },
              "Create texture layer",
              () => {
                if (!texture.layers_enabled) texture.activateLayers(false);
                const layer = new TextureLayer(
                  { name: layer_name ?? "Layer " + (texture.layers.length + 1) },
                  texture
                );
                layer.setSize(texture.width, texture.height);
                layer.addForEditing();
                return "Created layer \"" + layer.name + "\".";
              }
            );
            break;
          }
          case "delete_layer": {
            const layer = texture.selected_layer;
            if (!layer) throw new Error("No layer is selected on this texture.");
            if (texture.layers.length < 2) {
              throw new Error("The only remaining layer cannot be deleted.");
            }
            result = runUndoEdit(
              { textures: [texture], bitmap: true },
              "Delete texture layer",
              () => {
                layer.remove(false);
                texture.updateChangesAfterEdit();
                return "Deleted layer \"" + layer.name + "\".";
              }
            );
            break;
          }
          case "duplicate_layer": {
            const layer = texture.selected_layer;
            if (!layer) throw new Error("No layer is selected on this texture.");
            result = runUndoEdit(
              { textures: [texture], bitmap: true },
              "Duplicate texture layer",
              () => {
                const data = layer.getUndoCopy(true) as TextureLayerData;
                data.name = layer.name + " copy";
                const duplicate = new TextureLayer(data, texture);
                duplicate.addForEditing();
                texture.updateLayerChanges(true);
                return "Duplicated layer as \"" + duplicate.name + "\".";
              }
            );
            break;
          }
          case "merge_down": {
            const layer = texture.selected_layer;
            if (!layer) throw new Error("No layer is selected on this texture.");
            if (texture.layers.indexOf(layer) <= 0) {
              throw new Error("The bottom layer cannot be merged down.");
            }
            result = runUndoEdit(
              { textures: [texture], bitmap: true },
              "Merge texture layer down",
              () => {
                layer.mergeDown(false);
                texture.updateChangesAfterEdit();
                return "Merged layer \"" + layer.name + "\" down.";
              }
            );
            break;
          }
          case "set_opacity": {
            const layer = texture.selected_layer;
            if (!layer) throw new Error("No layer is selected on this texture.");
            if (opacity === undefined) throw new Error("Layer opacity is required.");
            result = runUndoEdit(
              { layers: [layer] } as LayerUndoAspects,
              "Set texture layer opacity",
              () => {
                layer.opacity = opacity;
                texture.updateChangesAfterEdit();
                return "Set layer \"" + layer.name + "\" opacity to " + opacity + "%.";
              }
            );
            break;
          }
          case "set_blend_mode": {
            const layer = texture.selected_layer;
            if (!layer) throw new Error("No layer is selected on this texture.");
            if (blend_mode === undefined) throw new Error("Layer blend mode is required.");
            result = runUndoEdit(
              { layers: [layer] } as LayerUndoAspects,
              "Set texture layer blend mode",
              () => {
                layer.blend_mode = blend_mode;
                texture.updateChangesAfterEdit();
                return "Set layer \"" + layer.name + "\" blend mode to " + blend_mode + ".";
              }
            );
            break;
          }
          case "move_layer": {
            const layer = texture.selected_layer;
            if (!layer) throw new Error("No layer is selected on this texture.");
            if (target_index === undefined) throw new Error("A target layer index is required.");
            if (target_index >= texture.layers.length) {
              throw new Error(
                "Target layer index " + target_index + " is outside the 0-"
                + (texture.layers.length - 1) + " range."
              );
            }
            result = runUndoEdit(
              { textures: [texture] },
              "Move texture layer",
              () => {
                const currentIndex = texture.layers.indexOf(layer);
                texture.layers.splice(currentIndex, 1);
                texture.layers.splice(target_index, 0, layer);
                texture.updateChangesAfterEdit();
                return "Moved layer \"" + layer.name + "\" to index " + target_index + ".";
              }
            );
            break;
          }
          case "rename_layer": {
            const layer = texture.selected_layer;
            if (!layer) throw new Error("No layer is selected on this texture.");
            if (layer_name === undefined) throw new Error("A new layer name is required.");
            result = runUndoEdit(
              { layers: [layer] } as LayerUndoAspects,
              "Rename texture layer",
              () => {
                const previousName = layer.name;
                layer.name = layer_name;
                texture.updateChangesAfterEdit();
                return "Renamed layer \"" + previousName + "\" to \"" + layer_name + "\".";
              }
            );
            break;
          }
          case "flatten_layers": {
            if (!texture.layers_enabled) {
              throw new Error("Texture \"" + texture.name + "\" does not have layers enabled.");
            }
            result = runUndoEdit(
              { textures: [texture], bitmap: true },
              "Flatten texture layers",
              () => {
                texture.updateLayerChanges(true);
                texture.layers_enabled = false;
                texture.selected_layer = null;
                texture.layers.splice(0, texture.layers.length);
                UVEditor.vue.layer = null;
                return "Flattened all layers on texture \"" + texture.name + "\".";
              }
            );
            break;
          }
        }

        updateInterfacePanels();
        BARS.updateConditions();
        return result;
      },
    },
    paintToolDocs[11].status
  );
}
