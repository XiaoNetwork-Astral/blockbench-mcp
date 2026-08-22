export interface TextureRenderTarget {
  render_mode: string;
  render_sides: string;
  updateMaterial(): void;
}

export function applyTextureRenderSettings(
  texture: TextureRenderTarget,
  renderMode: string,
  renderSides: string
): void {
  texture.render_mode = renderMode;
  texture.render_sides = renderSides;
  texture.updateMaterial();
}

export interface KeyframeValueTarget {
  uniform: boolean;
  set(axis: "x" | "y" | "z", value: number): unknown;
}

/** Apply keyframe values through Blockbench's supported per-axis API. */
export function applyKeyframeValues(
  keyframe: KeyframeValueTarget,
  values: number[] | number
): void {
  const normalized = Array.isArray(values) ? values : [values, values, values];
  if (normalized.length !== 3 || normalized.some((value) => !Number.isFinite(value))) {
    throw new Error("Keyframe values must be one finite number or an [x, y, z] vector.");
  }
  if (keyframe.uniform && new Set(normalized).size > 1) {
    keyframe.uniform = false;
  }
  keyframe.set("x", normalized[0]);
  keyframe.set("y", normalized[1]);
  keyframe.set("z", normalized[2]);
}

export const CUBE_FACE_KEYS = [
  "north",
  "south",
  "east",
  "west",
  "up",
  "down",
] as const;

export type CubeFaceKey = (typeof CUBE_FACE_KEYS)[number];
export type CubeFaceUV = [number, number, number, number];

export interface CubeFaceMappingTarget {
  texture?: string | false;
  extend(data: { texture?: string; uv?: CubeFaceUV }): void;
}

export interface CubeTextureMappingTarget<TTexture extends { uuid: string }> {
  faces: Record<string, CubeFaceMappingTarget>;
  setUVMode(boxUv: boolean): void;
  applyTexture(
    texture: TTexture,
    faces: true | undefined | CubeFaceKey[]
  ): void;
  mapAutoUV(): void;
}

export type CubeTextureFaceSelection =
  | true
  | false
  | CubeFaceKey[]
  | Array<{ face: CubeFaceKey; uv: CubeFaceUV }>
  | undefined;

/**
 * Apply cube UVs and texture references as one operation.
 *
 * Blockbench's Box UV mode owns face rectangles. Explicit face rectangles
 * therefore switch the cube to per-face UV mode before writing them. Texture
 * UUIDs are reasserted after automatic UV mapping because mapping must never
 * silently replace the caller's requested texture.
 */
export function applyCubeTextureMapping<TTexture extends { uuid: string }>(
  cube: CubeTextureMappingTarget<TTexture>,
  texture: TTexture | undefined,
  elementFaceUv: Partial<Record<CubeFaceKey, CubeFaceUV>> | undefined,
  faces: CubeTextureFaceSelection
): void {
  if (elementFaceUv) {
    cube.setUVMode(false);
    if (texture) cube.applyTexture(texture, true);
    for (const [face, uv] of Object.entries(elementFaceUv)) {
      if (!uv) continue;
      cube.faces[face].extend({
        ...(texture ? { texture: texture.uuid } : {}),
        uv,
      });
    }
    return;
  }

  const customFaces = Array.isArray(faces) &&
    faces.every((face) => typeof face !== "string")
    ? faces as Array<{ face: CubeFaceKey; uv: CubeFaceUV }>
    : undefined;

  if (customFaces) {
    cube.setUVMode(false);
    const faceKeys = customFaces.map(({ face }) => face);
    if (texture) cube.applyTexture(texture, faceKeys);
    for (const { face, uv } of customFaces) {
      cube.faces[face].extend({
        ...(texture ? { texture: texture.uuid } : {}),
        uv,
      });
    }
    return;
  }

  if (faces === false) {
    cube.mapAutoUV();
    return;
  }

  const faceKeys = faces === true || faces === undefined
    ? [...CUBE_FACE_KEYS]
    : faces as CubeFaceKey[];
  const applyTo = faces === true || faces === undefined ? true : faceKeys;
  if (texture) cube.applyTexture(texture, applyTo);
  cube.mapAutoUV();

  if (texture) {
    for (const face of faceKeys) {
      cube.faces[face].extend({ texture: texture.uuid });
    }
  }
}

export interface TextureCreationSettingsTarget extends TextureRenderTarget {
  name: string;
  width: number;
  height: number;
  uv_width: number;
  uv_height: number;
  group: string;
  pbr_channel: string;
}

/** Reapply caller-owned metadata after Blockbench imports an image source. */
export function applyTextureCreationSettings(
  texture: TextureCreationSettingsTarget,
  settings: {
    name: string;
    width: number;
    height: number;
    group?: string;
    pbrChannel?: string;
    renderMode: string;
    renderSides: string;
  }
): void {
  texture.name = settings.name;
  texture.width = settings.width;
  texture.height = settings.height;
  texture.uv_width = settings.width;
  texture.uv_height = settings.height;
  if (settings.group !== undefined) texture.group = settings.group;
  if (settings.pbrChannel !== undefined) texture.pbr_channel = settings.pbrChannel;
  applyTextureRenderSettings(texture, settings.renderMode, settings.renderSides);
}

export interface ShapePoint {
  x: number;
  y: number;
}

export type DeterministicShapeGeometry =
  | {
      kind: "rectangle";
      x: number;
      y: number;
      width: number;
      height: number;
    }
  | {
      kind: "ellipse";
      centerX: number;
      centerY: number;
      radiusX: number;
      radiusY: number;
    };

/** Match Blockbench's shape semantics without relying on pointer/UI state. */
export function getDeterministicShapeGeometry(
  shape: "rectangle" | "rectangle_h" | "ellipse" | "ellipse_h",
  start: ShapePoint,
  end: ShapePoint
): DeterministicShapeGeometry {
  if (shape.startsWith("rectangle")) {
    return {
      kind: "rectangle",
      x: Math.min(start.x, end.x),
      y: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x) + 1,
      height: Math.abs(end.y - start.y) + 1,
    };
  }

  return {
    kind: "ellipse",
    centerX: start.x + 0.5,
    centerY: start.y + 0.5,
    radiusX: Math.abs(end.x - start.x) + 0.5,
    radiusY: Math.abs(end.y - start.y) + 0.5,
  };
}

type MutableUvPoint = [number, number] | number[];
type MutableFaceUv = MutableUvPoint | Record<string, MutableUvPoint>;

export interface ProjectUvElementTarget {
  box_uv?: boolean;
  uv_offset?: MutableUvPoint;
  faces?: Record<string, { uv?: MutableFaceUv }>;
}

/**
 * Scale the UV data shapes used by Blockbench elements without depending on
 * its private adjustProjectResolution helper. Box UV cubes store one offset,
 * cube faces store [u1, v1, u2, v2], and mesh faces store a point per vertex.
 */
export function scaleProjectElementUvs(
  elements: ProjectUvElementTarget[],
  scaleX: number,
  scaleY: number
): void {
  if (!(scaleX > 0) || !(scaleY > 0) || !Number.isFinite(scaleX) || !Number.isFinite(scaleY)) {
    throw new Error("UV scale factors must be finite positive numbers.");
  }

  for (const element of elements) {
    if (element.box_uv && element.uv_offset) {
      element.uv_offset[0] = Math.floor(element.uv_offset[0] * scaleX);
      element.uv_offset[1] = Math.floor(element.uv_offset[1] * scaleY);
      continue;
    }

    for (const face of Object.values(element.faces ?? {})) {
      const uv = face.uv;
      if (!uv) continue;

      if (Array.isArray(uv)) {
        if (uv.length >= 4) {
          uv[0] *= scaleX;
          uv[1] *= scaleY;
          uv[2] *= scaleX;
          uv[3] *= scaleY;
        }
        continue;
      }

      for (const point of Object.values(uv)) {
        if (!Array.isArray(point) || point.length < 2) continue;
        point[0] *= scaleX;
        point[1] *= scaleY;
      }
    }
  }
}
