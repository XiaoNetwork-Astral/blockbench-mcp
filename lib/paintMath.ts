export interface PaintPoint {
  x: number;
  y: number;
}

export type SelectionCombineMode = "create" | "add" | "subtract" | "intersect";

function pushPoint(points: PaintPoint[], x: number, y: number): void {
  const last = points[points.length - 1];
  if (!last || last.x !== x || last.y !== y) points.push({ x, y });
}

function rasterLine(start: PaintPoint, end: PaintPoint): PaintPoint[] {
  let x = Math.round(start.x);
  let y = Math.round(start.y);
  const targetX = Math.round(end.x);
  const targetY = Math.round(end.y);
  const dx = Math.abs(targetX - x);
  const dy = Math.abs(targetY - y);
  const stepX = x < targetX ? 1 : -1;
  const stepY = y < targetY ? 1 : -1;
  let error = dx - dy;
  const result: PaintPoint[] = [];

  while (true) {
    result.push({ x, y });
    if (x === targetX && y === targetY) break;
    const doubled = error * 2;
    if (doubled > -dy) {
      error -= dy;
      x += stepX;
    }
    if (doubled < dx) {
      error += dx;
      y += stepY;
    }
  }
  return result;
}

/** Convert caller-supplied stroke anchors into deterministic pixel coordinates. */
export function rasterStroke(
  anchors: PaintPoint[],
  connect: boolean
): PaintPoint[] {
  if (!anchors.length) return [];
  if (!connect) {
    const result: PaintPoint[] = [];
    for (const point of anchors) pushPoint(result, Math.round(point.x), Math.round(point.y));
    return result;
  }

  const result: PaintPoint[] = [];
  for (let index = 1; index < anchors.length; index++) {
    for (const point of rasterLine(anchors[index - 1], anchors[index])) {
      pushPoint(result, point.x, point.y);
    }
  }
  if (anchors.length === 1) {
    pushPoint(result, Math.round(anchors[0].x), Math.round(anchors[0].y));
  }
  return result;
}

function maskBounds(
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): [number, number, number, number] {
  const startX = Math.max(0, Math.floor(Math.min(x1, x2)));
  const startY = Math.max(0, Math.floor(Math.min(y1, y2)));
  const endX = Math.min(width, Math.max(startX + 1, Math.ceil(Math.max(x1, x2))));
  const endY = Math.min(height, Math.max(startY + 1, Math.ceil(Math.max(y1, y2))));
  return [startX, startY, endX, endY];
}

export function rectangleSelectionMask(
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const [startX, startY, endX, endY] = maskBounds(width, height, x1, y1, x2, y2);
  for (let y = startY; y < endY; y++) {
    mask.fill(1, y * width + startX, y * width + endX);
  }
  return mask;
}

export function ellipseSelectionMask(
  width: number,
  height: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): Uint8Array {
  const mask = new Uint8Array(width * height);
  const [startX, startY, endX, endY] = maskBounds(width, height, x1, y1, x2, y2);
  const centerX = (startX + endX) / 2;
  const centerY = (startY + endY) / 2;
  const radiusX = Math.max(0.5, (endX - startX) / 2);
  const radiusY = Math.max(0.5, (endY - startY) / 2);
  for (let y = startY; y < endY; y++) {
    for (let x = startX; x < endX; x++) {
      const dx = (x + 0.5 - centerX) / radiusX;
      const dy = (y + 0.5 - centerY) / radiusY;
      if (dx * dx + dy * dy <= 1) mask[y * width + x] = 1;
    }
  }
  return mask;
}

export function combineSelectionMasks(
  current: Uint8Array,
  incoming: Uint8Array,
  mode: SelectionCombineMode
): Uint8Array {
  if (current.length !== incoming.length) {
    throw new Error("Selection masks must have matching dimensions.");
  }
  if (mode === "create") return incoming.slice();
  const result = new Uint8Array(current.length);
  for (let index = 0; index < result.length; index++) {
    const before = current[index] !== 0;
    const next = incoming[index] !== 0;
    result[index] = Number(
      mode === "add"
        ? before || next
        : mode === "subtract"
          ? before && !next
          : before && next
    );
  }
  return result;
}

export function invertSelectionMask(mask: Uint8Array): Uint8Array {
  return mask.map((value) => Number(!value));
}

/** Expand or contract a binary selection using a round pixel radius. */
export function resizeSelectionMask(
  mask: Uint8Array,
  width: number,
  height: number,
  radius: number,
  expand: boolean
): Uint8Array {
  const result = new Uint8Array(mask.length);
  const radiusSquared = radius * radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const selected = mask[y * width + x] !== 0;
      if (expand ? selected : !selected) {
        result[y * width + x] = Number(selected);
        continue;
      }
      let foundOpposite = false;
      for (let offsetY = -radius; offsetY <= radius && !foundOpposite; offsetY++) {
        for (let offsetX = -radius; offsetX <= radius; offsetX++) {
          if (offsetX * offsetX + offsetY * offsetY > radiusSquared) continue;
          const sampleX = x + offsetX;
          const sampleY = y + offsetY;
          const sampleSelected = sampleX >= 0
            && sampleX < width
            && sampleY >= 0
            && sampleY < height
            && mask[sampleY * width + sampleX] !== 0;
          if (sampleSelected !== selected) {
            foundOpposite = true;
            break;
          }
        }
      }
      result[y * width + x] = Number(expand ? foundOpposite : !foundOpposite);
    }
  }
  return result;
}

export function colorMatchMask(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  tolerancePercent: number,
  connected: boolean,
  allowed: (x: number, y: number) => boolean = () => true
): Uint8Array {
  const result = new Uint8Array(width * height);
  const x = Math.floor(startX);
  const y = Math.floor(startY);
  if (x < 0 || x >= width || y < 0 || y >= height) return result;

  const targetOffset = (y * width + x) * 4;
  const threshold = tolerancePercent * 2.55;
  const matches = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      if (!allowed(px, py)) continue;
      const offset = (py * width + px) * 4;
      let maxDifference = 0;
      for (let channel = 0; channel < 4; channel++) {
        maxDifference = Math.max(
          maxDifference,
          Math.abs(pixels[offset + channel] - pixels[targetOffset + channel])
        );
      }
      if (maxDifference <= threshold) matches[py * width + px] = 1;
    }
  }

  if (!connected) return matches;
  const startIndex = y * width + x;
  if (!matches[startIndex]) return result;
  const stack = [startIndex];
  result[startIndex] = 1;
  while (stack.length) {
    const index = stack.pop()!;
    const px = index % width;
    const neighbors = [index - width, index + width];
    if (px > 0) neighbors.push(index - 1);
    if (px < width - 1) neighbors.push(index + 1);
    for (const neighbor of neighbors) {
      if (neighbor < 0 || neighbor >= result.length) continue;
      if (matches[neighbor] && !result[neighbor]) {
        result[neighbor] = 1;
        stack.push(neighbor);
      }
    }
  }
  return result;
}
