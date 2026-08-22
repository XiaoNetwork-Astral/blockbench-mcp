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
