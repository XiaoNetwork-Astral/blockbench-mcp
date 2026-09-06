import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { findElementOrThrow } from "@/lib/util";

const vector = z.array(z.number().finite()).length(3);
const pointSchema = z.object({
  position: vector,
  control_before: vector.optional().describe("Incoming Bezier control point in element-local coordinates; defaults to position."),
  control_after: vector.optional().describe("Outgoing Bezier control point in element-local coordinates; defaults to position."),
  size: z.number().finite().min(0).default(1),
  tilt: z.number().finite().default(0),
}).strict();

interface SplineElement extends OutlinerElement {
  texture: string | false;
  radial_resolution: number;
  tubular_resolution: number;
  vertices: Record<string, number[]>;
  handles: Record<string, unknown>;
  curves: Record<string, unknown>;
  extend(data: Record<string, unknown>): this;
}

export const elementGeometryTools: ToolDefinition[] = [
  defineTool({
    name: "inspect_element",
    description: "Reads one element or group's native saved properties. Geometry is omitted by default; request it to read cube faces, bounding-box extents or spline control points. Large meshes should use the focused mesh resources.",
    annotations: { title: "Inspect Element", readOnlyHint: true },
    parameters: z.object({ id: z.string().min(1), include_geometry: z.boolean().default(false) }).strict(),
    status: "stable",
    async execute({ id, include_geometry }) {
      const node = findElementOrThrow(id);
      const copy = node.getSaveCopy() as Record<string, unknown>;
      const geometryKeys = ["vertices", "faces", "handles", "curves", "vertex_weights"];
      const geometry = Object.fromEntries(geometryKeys.filter(key => copy[key] && typeof copy[key] === "object")
        .map(key => [key, Object.keys(copy[key] as object).length]));
      if (!include_geometry) for (const key of geometryKeys) delete copy[key];
      const result = JSON.stringify({ uuid: node.uuid, type: node.type, parent: node.parent === "root" ? "root" : node.parent.uuid, data: copy, geometry_counts: geometry });
      if (result.length > 1_000_000) throw new Error("Element geometry exceeds the inspection limit. Omit geometry or use the focused mesh resources.");
      return result;
    },
  }),
  defineTool({
    name: "set_bounding_box",
    description: "Sets the from/to extents of an existing bounding_box element in model coordinates. Create the element with create_element first. Each to component must be at least its from component.",
    annotations: { title: "Set Bounding Box", destructiveHint: true },
    parameters: z.object({ id: z.string().min(1), from: vector, to: vector }).strict()
      .refine(data => data.to.every((value, axis) => value >= data.from[axis]), "Each to component must be at least from."),
    status: "stable",
    async execute({ id, from, to }) {
      const node = findElementOrThrow(id);
      if (!(node instanceof BoundingBox)) throw new Error("Expected a bounding_box element.");
      Undo.initEdit({ elements: [node] });
      node.extend({ from: [from[0], from[1], from[2]], to: [to[0], to[1], to[2]] });
      Canvas.updateAll();
      Undo.finishEdit("Set bounding box extents");
      return JSON.stringify({ uuid: node.uuid, from, to });
    },
  }),
  defineTool({
    name: "set_spline_points",
    description: "Replaces a spline's ordered Bezier handles and segments, preserving its texture and other properties. Points and control points use element-local coordinates; cyclic connects the last handle to the first. Returns native keys for readback.",
    annotations: { title: "Set Spline Points", destructiveHint: true },
    parameters: z.object({
      id: z.string().min(1), points: z.array(pointSchema).min(2).max(256), cyclic: z.boolean().default(false),
    }).strict(), status: "stable",
    async execute({ id, points, cyclic }) {
      const node = findElementOrThrow(id);
      if (node.type !== "spline") throw new Error("Expected a spline element.");
      const spline = node as SplineElement;
      if (points.length * spline.radial_resolution * spline.tubular_resolution > 100_000) {
        throw new Error("Spline would exceed 100,000 generated segments. Reduce points or spline resolution first.");
      }
      const vertices: Record<string, number[]> = {};
      const handles: Record<string, unknown> = {};
      const curves: Record<string, unknown> = {};
      points.forEach((point, index) => {
        vertices[`p${index}`] = point.position;
        vertices[`i${index}`] = point.control_before ?? point.position;
        vertices[`o${index}`] = point.control_after ?? point.position;
        handles[`h${index}`] = { joint: `p${index}`, control1: `i${index}`, control2: `o${index}`, size: point.size, tilt: point.tilt };
        if (index) curves[`c${index - 1}`] = { start_handle: `h${index - 1}`, end_handle: `h${index}` };
      });
      Undo.initEdit({ elements: [spline] });
      spline.extend({ vertices, handles, curves, cyclic, texture: spline.texture });
      Canvas.updateAll();
      Undo.finishEdit("Set spline control points");
      return JSON.stringify({ uuid: spline.uuid, handles: Object.keys(spline.handles), curves: Object.keys(spline.curves), cyclic });
    },
  }),
];
