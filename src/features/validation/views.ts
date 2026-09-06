/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { captureOffscreenValidationPass, type OffscreenRenderPass } from "@/lib/util";
import { extractNodeGeometry, geometricDescendants, type InspectableGeometryNode } from "@/lib/sceneGeometry";
import type { McpCameraState } from "@/src/blockbench/camera";
import { fitBoundingSpherePerspectiveDistance } from "@/lib/cameraFraming";
import { validationViewSchema, captureValidationViewsParameters } from "@/src/features/validation/schemas";
import { tuple, uniqueNodes, rounded } from "@/src/features/validation/geometry";

export const MAX_VALIDATION_VIEW_RENDERS = 300;

export const MAX_VALIDATION_RENDER_PIXELS = 150_000_000;

export const MAX_VALIDATION_OUTPUT_PIXELS = 64_000_000;

export function validationViewRenderCount(
  views: readonly { passes: readonly string[] }[],
  hasContext: boolean
): number {
  return views.reduce((total, view) =>
    total
    + view.passes.length
    + (view.passes.includes("element_id") ? 0 : 1)
    + (hasContext ? 1 : 0),
    0);
}

type ValidationView = z.infer<typeof validationViewSchema>;

export function suiteViews(
  suite: z.infer<typeof captureValidationViewsParameters>["suite"],
  custom: ValidationView[]
): ValidationView[] {
  if (suite === "custom") return custom;
  if (suite === "orthographic") {
    return [
      { name: "front", kind: "orthographic", direction: [0, 0, -1], passes: ["color", "element_id", "depth"] },
      { name: "side", kind: "orthographic", direction: [-1, 0, 0], passes: ["color", "element_id", "depth"] },
      { name: "top", kind: "orthographic", direction: [0, 1, 0], passes: ["color", "element_id", "depth"] },
    ];
  }
  return [
    { name: "near", kind: "near", direction: [-1, 0.45, -1], frame_occupancy: 0.88, passes: ["color", "element_id", "depth"] },
    { name: "grazing", kind: "grazing", direction: [1, 0.04, 0], frame_occupancy: 0.82, passes: ["color", "element_id", "face_normal"] },
    { name: "far", kind: "far", direction: [-1, 0.75, -1], frame_occupancy: 0.3, passes: ["color", "element_id", "depth"] },
  ];
}

export function boundsForNodes(nodes: readonly InspectableGeometryNode[]) {
  const points = nodes.flatMap((node) => extractNodeGeometry(node).vertices);
  if (points.length === 0) throw new Error("The requested validation view has no renderable geometry.");
  const min = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis]))) as [number, number, number];
  const max = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis]))) as [number, number, number];
  return {
    min,
    max,
    center: tuple([0, 1, 2].map((axis) => (min[axis] + max[axis]) / 2)),
    size: tuple([0, 1, 2].map((axis) => max[axis] - min[axis])),
  };
}

export function cameraForValidationView(
  view: ValidationView,
  framedBounds: ReturnType<typeof boundsForNodes>,
  viewport: [number, number]
): McpCameraState {
  const THREE_API = (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;
  const center = new THREE_API.Vector3(...framedBounds.center);
  let direction: THREE.Vector3;
  if (view.direction) {
    direction = new THREE_API.Vector3(...view.direction);
  } else {
    const azimuth = (view.azimuth_degrees ?? 225) * Math.PI / 180;
    const elevation = (view.elevation_degrees ?? 25) * Math.PI / 180;
    direction = new THREE_API.Vector3(
      Math.cos(elevation) * Math.sin(azimuth),
      Math.sin(elevation),
      Math.cos(elevation) * Math.cos(azimuth)
    );
  }
  if (direction.lengthSq() <= 1e-12) throw new Error(`Validation view '${view.name}' has a zero direction.`);
  direction.normalize();
  const radius = Math.max(new THREE_API.Vector3(...framedBounds.size).length() / 2, 0.001);
  const occupancy = view.frame_occupancy
    ?? (view.kind === "near" ? 0.88 : view.kind === "far" ? 0.3 : 0.75);
  const projection = view.kind === "orthographic" ? "orthographic" : "perspective";
  const fov = view.fov ?? (view.kind === "grazing" ? 35 : 45);
  const distance = projection === "perspective"
    ? fitBoundingSpherePerspectiveDistance(radius, fov, viewport[0] / viewport[1], occupancy)
    : radius * 3;
  return {
    position: center.clone().addScaledVector(direction, distance).toArray() as [number, number, number],
    target: framedBounds.center,
    projection,
    fov: projection === "perspective" ? fov : undefined,
    zoom: projection === "orthographic"
      ? view.zoom ?? 16 * occupancy / Math.max(...framedBounds.size, 0.001)
      : undefined,
    viewport,
  };
}

function rgbKey(red: number, green: number, blue: number): string {
  return `${red},${green},${blue}`;
}

export async function captureViewEvidence(
  project: ModelProject,
  target: InspectableGeometryNode,
  contexts: InspectableGeometryNode[],
  view: ValidationView,
  camera: McpCameraState,
  width: number,
  height: number
) {
  const targetElements = geometricDescendants(target).filter((node) => node instanceof Cube || node instanceof Mesh);
  const contextElements = contexts.flatMap(geometricDescendants).filter((node) => node instanceof Cube || node instanceof Mesh);
  const includedIds = [target.uuid, ...contexts.map((node) => node.uuid)];
  const idNodeIds = uniqueNodes([...targetElements, ...contextElements]).map((node) => node.uuid);
  const captures = new Map<OffscreenRenderPass, Awaited<ReturnType<typeof captureOffscreenValidationPass>>>();
  for (const pass of view.passes) {
    captures.set(pass, await captureOffscreenValidationPass(
      project,
      camera,
      width,
      height,
      { pass, includedNodeIds: includedIds, idNodeIds }
    ));
  }
  let fullIds = captures.get("element_id");
  if (!fullIds) {
    fullIds = await captureOffscreenValidationPass(
      project,
      camera,
      width,
      height,
      { pass: "element_id", includedNodeIds: includedIds, idNodeIds }
    );
  }
  const targetIds = targetElements.map((node) => node.uuid);
  const targetOnlyIds = contexts.length
    ? await captureOffscreenValidationPass(
      project,
      camera,
      width,
      height,
      { pass: "element_id", includedNodeIds: [target.uuid], idNodeIds: targetIds }
    )
    : fullIds;
  const fullLegend = new Map(fullIds.id_legend.map((entry) => [rgbKey(...entry.rgb), entry]));
  const targetLegend = new Map(targetOnlyIds.id_legend.map((entry) => [rgbKey(...entry.rgb), entry]));
  const fullPixels = fullIds.rgba;
  const targetPixels = targetOnlyIds.rgba;
  const visibility = [];
  for (const element of targetElements) {
    let potential = 0;
    let visible = 0;
    const occluders = new Map<string, number>();
    if (targetPixels && fullPixels) {
      for (let offset = 0; offset < targetPixels.length; offset += 4) {
        const targetEntry = targetLegend.get(rgbKey(
          targetPixels[offset], targetPixels[offset + 1], targetPixels[offset + 2]
        ));
        if (targetEntry?.uuid !== element.uuid) continue;
        potential++;
        const entry = fullLegend.get(rgbKey(fullPixels[offset], fullPixels[offset + 1], fullPixels[offset + 2]));
        if (entry?.uuid === element.uuid) visible++;
        else if (entry) occluders.set(entry.uuid, (occluders.get(entry.uuid) ?? 0) + 1);
      }
    }
    visibility.push({
      element: { uuid: element.uuid, name: element.name },
      visible_pixels: visible,
      potential_pixels: potential,
      visible_fraction: potential ? rounded(visible / potential) : 0,
      occluded_pixels: Math.max(0, potential - visible),
      occluders: [...occluders.entries()].map(([uuid, pixels]) => ({
        uuid,
        name: fullIds!.id_legend.find((entry) => entry.uuid === uuid)?.name ?? null,
        pixels,
      })).sort((first, second) => second.pixels - first.pixels),
    });
  }
  return {
    captures,
    metadata: {
      name: view.name,
      kind: view.kind,
      camera,
      framed_bounds: boundsForNodes([target, ...contexts]),
      passes: view.passes,
      visibility,
      visibility_analysis_truncated: false,
      visibility_analysis_limit: null,
      depth_collision_regions: null,
      limitations: [
        "Depth and color passes are evidence surfaces; geometry collision is reported only by analyze_model_contacts.",
        "Potential pixels are target-only raster coverage; visible pixels include the supplied context. Internal target occlusion is retained in both passes.",
        "Per-element visibility is exact at the requested raster resolution; sub-pixel geometry has zero pixel coverage.",
      ],
    },
  };
}
