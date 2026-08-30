/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import {
  captureOffscreenValidationPass,
  findElementOrThrow,
  getEffectiveCameraState,
  imageContent,
  withTemporaryAnimationPose,
  type OffscreenRenderPass,
} from "@/lib/util";
import {
  ancestorTransformProvenance,
  extractNodeGeometry,
  geometricDescendants,
  orientedBoxFromNode,
  type InspectableGeometryNode,
} from "@/lib/sceneGeometry";
import { analyzeOrientedBoxContact } from "@/lib/contactAnalysis";
import { closestPointsBetweenTriangleSetsBvh } from "@/lib/triangleBvh";
import { analyzeUvIntegrity, type UvFaceRecord, type UvPoint } from "@/lib/uvIntegrity";
import { bytesSha256, stableSha256 } from "@/lib/stableDigest";
import {
  getValidationSnapshot,
  MAX_VALIDATION_SNAPSHOTS_PER_PROJECT,
  storeValidationSnapshot,
} from "@/lib/validationSnapshots";
import type { McpCameraState } from "@/src/blockbench/camera";
import { describeProject } from "@/lib/projectAccess";
import { resolveUniqueReference } from "@/lib/modelSafety";
import { fitBoundingSpherePerspectiveDistance } from "@/lib/cameraFraming";

const expectedContactSchema = z.object({
  relation: z.enum(["unspecified", "connected", "separate", "intentionally_embedded"]).optional().default("unspecified"),
  minimum_separation: z.number().finite().min(0).max(1024).optional().default(0),
  maximum_separation: z.number().finite().min(0).max(1024).optional(),
  minimum_penetration: z.number().finite().min(0).max(1024).optional().default(0),
  maximum_penetration: z.number().finite().min(0).max(1024).optional(),
}).strict();

const MAX_DESCENDANT_CONTACT_PAIRS = 10_000;
const MAX_CONTACT_COMPARISON_CEILING = 25_000_000;
const MAX_UV_FACE_RECORDS = 2_000;
const MAX_VALIDATION_SNAPSHOT_PIXEL_BYTES = 64 * 1024 * 1024;
const MAX_VALIDATION_VIEW_RENDERS = 300;
const MAX_VALIDATION_RENDER_PIXELS = 150_000_000;
const MAX_VALIDATION_OUTPUT_PIXELS = 64_000_000;

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

const contactPairSchema = z.object({
  first: z.string().min(1),
  second: z.string().min(1),
  expected: expectedContactSchema.optional().default({}),
  tolerance: z.number().finite().min(0).max(16).optional().default(0.001),
}).strict();

export const analyzeModelContactsParameters = z.object({
  pairs: z.array(contactPairSchema).min(1).max(100),
  max_triangle_comparisons: z.number().int().min(100).max(2_000_000).optional().default(500_000),
}).strict();

const expectedUvSharingSchema = z.object({
  first_face: z.string().min(1),
  second_face: z.string().min(1),
  relation: z.enum(["shared", "separate"]),
}).strict();

const authorizedPixelRegionSchema = z.object({
  texture_uuid: z.string().min(1),
  rectangle: z.array(z.number().finite()).length(4),
}).strict();

export const inspectUvIntegrityParameters = z.object({
  elements: z.array(z.string().min(1)).max(200).optional().default([]),
  expected_sharing: z.array(expectedUvSharingSchema).max(500).optional().default([]),
  authorized_pixel_regions: z.array(authorizedPixelRegionSchema).max(100).optional().default([]),
  texel_density_ratio_warning: z.number().finite().min(1).max(100).optional().default(2),
}).strict();

export const createValidationSnapshotParameters = z.object({
  targets: z.array(z.string().min(1)).min(1).max(200),
  neighbors: z.array(z.string().min(1)).max(200).optional().default([]),
  include_uv: z.boolean().optional().default(true),
  include_textures: z.boolean().optional().default(true),
  evidence_labels: z.array(z.string().min(1).max(100)).max(100).optional().default([]),
}).strict();

export const diffValidationSnapshotParameters = z.object({
  snapshot_id: z.string().min(1),
  authorized_pixel_regions: z.array(authorizedPixelRegionSchema).max(100).optional().default([]),
}).strict();

const validationViewSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(["near", "medium", "far", "grazing", "orthographic", "perspective", "orbit"]),
  direction: z.array(z.number().finite()).length(3).optional(),
  azimuth_degrees: z.number().finite().optional(),
  elevation_degrees: z.number().finite().min(-89).max(89).optional(),
  frame_occupancy: z.number().finite().min(0.1).max(0.95).optional(),
  fov: z.number().finite().min(1).max(179).optional(),
  zoom: z.number().finite().positive().max(100).optional(),
  passes: z.array(z.enum([
    "color", "depth", "element_id", "face_normal", "wireframe", "xray", "backface", "unlit",
  ])).min(1).max(8).optional().default(["color", "element_id", "depth"]),
}).strict().refine((value) => new Set(value.passes).size === value.passes.length, {
  message: "A validation view cannot request the same render pass more than once.",
  path: ["passes"],
});

export const captureValidationViewsParameters = z.object({
  target: z.string().min(1),
  context_elements: z.array(z.string().min(1)).max(100).optional().default([]),
  suite: z.enum(["near_grazing_far", "orthographic", "custom"]).optional().default("near_grazing_far"),
  views: z.array(validationViewSchema).max(24).optional().default([]),
  width: z.number().int().min(64).max(1600).optional().default(800),
  height: z.number().int().min(64).max(1200).optional().default(600),
}).strict().refine((value) => value.suite !== "custom" || value.views.length > 0, {
  message: "A custom validation suite requires at least one view.",
});

const hierarchyCheckSchema = z.object({
  element: z.string().min(1),
  expected_parent: z.string().min(1).nullable(),
}).strict();

const boundsCheckSchema = z.object({
  element: z.string().min(1),
  minimum: z.array(z.number().finite()).length(3).optional(),
  maximum: z.array(z.number().finite()).length(3).optional(),
}).strict();

export const sweepAnimationValidationParameters = z.object({
  animation: z.string().min(1),
  samples: z.array(z.union([z.literal("rest"), z.number().finite().min(0)])).min(1).max(256),
  include_loop_boundary: z.boolean().optional().default(true),
  contacts: z.array(contactPairSchema).max(50).optional().default([]),
  hierarchy: z.array(hierarchyCheckSchema).max(100).optional().default([]),
  bounds: z.array(boundsCheckSchema).max(100).optional().default([]),
  envelope_elements: z.array(z.string().min(1)).max(100).optional().default([]),
  stop_on_first_failure: z.boolean().optional().default(false),
  max_triangle_comparisons: z.number().int().min(100).max(1_000_000).optional().default(200_000),
}).strict().refine((value) =>
  value.contacts.length > 0 || value.hierarchy.length > 0
  || value.bounds.length > 0 || value.envelope_elements.length > 0,
  { message: "Select at least one contact, hierarchy, bounds, or motion-envelope check." }
);

export const validationOperationDocs: ToolSpec[] = [
  {
    name: "analyze_model_contacts",
    description: "Performs exact transformed OBB SAT for cube pairs and bounded triangle-BVH analysis for mesh pairs, including descendant pairs and explicit uncertainty.",
    annotations: { title: "Analyze Model Contacts", readOnlyHint: true },
    parameters: analyzeModelContactsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "inspect_uv_integrity",
    description: "Inventories typed face UVs and detects mapping, bounds, sharing, overlap, mirror, pixel-footprint, and texel-density problems.",
    annotations: { title: "Inspect UV Integrity", readOnlyHint: true },
    parameters: inspectUvIntegrityParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "create_validation_snapshot",
    description: "Creates an in-memory read-only evidence snapshot with component digests; it is not a save or model checkpoint, and each project retains its latest eight snapshots.",
    annotations: { title: "Create Validation Snapshot", readOnlyHint: true },
    parameters: createValidationSnapshotParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "diff_validation_snapshot",
    description: "Diffs current transforms, geometry, UVs, textures, camera, and pose against a validation snapshot and identifies stale evidence.",
    annotations: { title: "Diff Validation Snapshot", readOnlyHint: true },
    parameters: diffValidationSnapshotParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "capture_validation_views",
    description: "Auto-frames repeatable named views and clone-only color/debug passes with exact camera metadata, pixel coverage, and occluder IDs.",
    annotations: { title: "Capture Validation Views", readOnlyHint: true },
    parameters: captureValidationViewsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "sweep_animation_validation",
    description: "Samples native animation poses offscreen, runs selected contact/hierarchy/bounds checks, reports first failure and motion envelopes, and restores preview state on every path.",
    annotations: { title: "Sweep Animation Validation", readOnlyHint: true },
    parameters: sweepAnimationValidationParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

function rounded(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(6));
}

function tuple(value: readonly number[]): [number, number, number] {
  return [rounded(value[0]), rounded(value[1]), rounded(value[2])];
}

function midpoint(
  first: readonly number[],
  second: readonly number[]
): [number, number, number] {
  return tuple([
    (first[0] + second[0]) / 2,
    (first[1] + second[1]) / 2,
    (first[2] + second[2]) / 2,
  ]);
}

type ContactExpected = z.infer<typeof expectedContactSchema>;

export function evaluateExpected(
  classification: string,
  separation: number | null,
  penetration: number | null,
  expected: ContactExpected
) {
  if (expected.relation === "unspecified") {
    return { status: "not_requested", messages: [] as string[] };
  }
  if (classification === "unknown" || classification === "touching_or_intersecting") {
    return {
      status: "unknown",
      messages: ["The bounded mesh narrow phase cannot prove touching versus volume penetration."],
    };
  }
  const messages: string[] = [];
  let passed = true;
  if (expected.relation === "connected") {
    const maximum = expected.maximum_separation ?? 0;
    if (classification === "separate" && (separation ?? Number.POSITIVE_INFINITY) > maximum) {
      passed = false;
      messages.push(`Separation exceeds the allowed ${maximum} model units.`);
    }
    const connectedPenetration = classification === "intersecting" ? penetration : 0;
    if (
      expected.minimum_penetration > 0
      && (connectedPenetration ?? 0) < expected.minimum_penetration
    ) {
      passed = false;
      messages.push(`Penetration is below ${expected.minimum_penetration} model units.`);
    }
    if (
      expected.maximum_penetration !== undefined
      && (connectedPenetration ?? 0) > expected.maximum_penetration
    ) {
      passed = false;
      messages.push(`Penetration exceeds ${expected.maximum_penetration} model units.`);
    }
  } else if (expected.relation === "separate") {
    if (classification === "intersecting") {
      passed = false;
      messages.push("The parts penetrate although separation was expected.");
    } else if (classification !== "separate") {
      passed = false;
      messages.push("The parts touch within tolerance although separation was expected.");
    } else {
      if ((separation ?? 0) < expected.minimum_separation) {
        passed = false;
        messages.push(`Separation is below the required ${expected.minimum_separation} model units.`);
      }
      if (expected.maximum_separation !== undefined && (separation ?? 0) > expected.maximum_separation) {
        passed = false;
        messages.push(`Separation exceeds the allowed ${expected.maximum_separation} model units.`);
      }
    }
  } else {
    if (classification !== "intersecting" || penetration === null) {
      passed = false;
      messages.push("A proven embedded intersection was expected.");
    } else {
      if (penetration < expected.minimum_penetration) {
        passed = false;
        messages.push(`Penetration is below ${expected.minimum_penetration} model units.`);
      }
      if (expected.maximum_penetration !== undefined && penetration > expected.maximum_penetration) {
        passed = false;
        messages.push(`Penetration exceeds ${expected.maximum_penetration} model units.`);
      }
    }
  }
  return { status: passed ? "pass" : "fail", messages };
}

function analyzeDescendantContact(
  first: InspectableGeometryNode,
  second: InspectableGeometryNode,
  tolerance: number,
  expected: ContactExpected,
  maxComparisons: number
) {
  const firstGeometry = extractNodeGeometry(first, false);
  const secondGeometry = extractNodeGeometry(second, false);
  const bothCubes = first instanceof Cube && second instanceof Cube;
  const closest = closestPointsBetweenTriangleSetsBvh(
    firstGeometry.triangles,
    secondGeometry.triangles,
    bothCubes ? Number.MAX_SAFE_INTEGER : maxComparisons
  );
  const firstObb = bothCubes ? orientedBoxFromNode(first) : null;
  const secondObb = bothCubes ? orientedBoxFromNode(second) : null;
  if (firstObb && secondObb) {
    const sat = analyzeOrientedBoxContact(firstObb, secondObb, tolerance);
    const surfaceSeparation = sat.classification === "separate"
      ? closest && !closest.truncated ? closest.distance : null
      : 0;
    const contactPoint = closest && closest.distance <= tolerance
      ? midpoint(closest.first, closest.second)
      : null;
    return {
      first: { uuid: first.uuid, name: first.name, type: "cube" },
      second: { uuid: second.uuid, name: second.name, type: "cube" },
      classification: sat.classification,
      certainty: "exact",
      method: sat.method,
      signed_sat_axis_distance: rounded(sat.signed_distance),
      euclidean_surface_distance: closest ? rounded(closest.distance) : null,
      separation: surfaceSeparation === null ? null : rounded(surfaceSeparation),
      penetration_depth: rounded(sat.penetration_depth),
      closest_points: closest ? { first: tuple(closest.first), second: tuple(closest.second) } : null,
      contact_points: contactPoint ? [contactPoint] : [],
      normal: tuple(sat.normal),
      overlap_area: null,
      overlap_volume: null,
      comparison_count: closest?.comparisons ?? 0,
      expected: evaluateExpected(
        sat.classification,
        surfaceSeparation,
        sat.penetration_depth,
        expected
      ),
      provenance: {
        coordinate_space: "world",
        unit: "Blockbench model unit",
        first_ancestors: ancestorTransformProvenance(first),
        second_ancestors: ancestorTransformProvenance(second),
      },
      limitations: [
        "The signed SAT axis distance is not Euclidean. Separated cube surface distance comes from exhaustive triangle geometry; SAT penetration is the exact minimum translation depth for these OBBs. Overlap volume is not derived.",
      ],
    };
  }

  const classification = !closest || closest.truncated
    ? "unknown"
    : closest.distance > tolerance
      ? "separate"
      : "touching_or_intersecting";
  const separation = classification === "separate" && closest ? closest.distance : null;
  const exactSurfaceDistance = closest && !closest.truncated ? closest.distance : null;
  return {
    first: { uuid: first.uuid, name: first.name, type: first.type },
    second: { uuid: second.uuid, name: second.name, type: second.type },
    classification,
    certainty: classification === "separate" ? "exact_surface_separation" : "bounded_unknown",
    method: "triangle_bvh",
    signed_sat_axis_distance: null,
    euclidean_surface_distance: exactSurfaceDistance === null ? null : rounded(exactSurfaceDistance),
    surface_distance_upper_bound: closest ? rounded(closest.distance) : null,
    separation: separation === null ? null : rounded(separation),
    penetration_depth: null,
    closest_points: closest ? {
      first: tuple(closest.first),
      second: tuple(closest.second),
      exact: !closest.truncated,
    } : null,
    contact_points: closest && closest.distance <= tolerance
      ? [midpoint(closest.first, closest.second)]
      : [],
    normal: closest && closest.distance > tolerance
      ? tuple([
          (closest.second[0] - closest.first[0]) / closest.distance,
          (closest.second[1] - closest.first[1]) / closest.distance,
          (closest.second[2] - closest.first[2]) / closest.distance,
        ])
      : null,
    overlap_area: null,
    overlap_volume: null,
    comparison_count: closest?.comparisons ?? 0,
    work_limit_reached: closest?.truncated ?? false,
    expected: evaluateExpected(classification, separation, null, expected),
    provenance: {
      coordinate_space: "world",
      unit: "Blockbench model unit",
      first_ancestors: ancestorTransformProvenance(first),
      second_ancestors: ancestorTransformProvenance(second),
    },
    limitations: [
      "Triangle BVH proves positive surface separation when exhaustive. Surface distance within the requested tolerance cannot distinguish near-separation, tangency, or closed-volume penetration, so that case is explicitly unknown.",
      "When the comparison limit is reached, surface_distance_upper_bound is the best tested candidate; euclidean_surface_distance remains null rather than presenting that bound as exact.",
    ],
  };
}

interface FaceLike {
  texture?: string | false | null;
  uv?: number[] | Record<string, number[]>;
  rotation?: number;
  enabled?: boolean;
  vertices?: string[];
}

interface CubeLike extends OutlinerElement {
  faces: Record<string, FaceLike>;
  from: number[];
  to: number[];
  mirror_uv?: boolean;
}

interface MeshLike extends OutlinerElement {
  faces: Record<string, FaceLike>;
  vertices: Record<string, number[]>;
}

function resolveTexture(project: ModelProject, reference: string | false | null | undefined): Texture | null {
  if (!reference) return null;
  const matches = project.textures.filter((texture) => texture.uuid === reference);
  return matches.length === 1 ? matches[0] : null;
}

function worldPolygonArea(node: InspectableGeometryNode, points: readonly number[][]): number | null {
  if (points.length < 3) return 0;
  const THREE_API = (globalThis as typeof globalThis & { THREE: typeof import("three") }).THREE;
  const object = node.scene_object;
  object.updateWorldMatrix(true, false);
  const world = points.map((point) =>
    new THREE_API.Vector3(point[0], point[1], point[2]).applyMatrix4(object.matrixWorld)
  );
  let area = 0;
  for (let index = 1; index + 1 < world.length; index++) {
    const first = world[index].clone().sub(world[0]);
    const second = world[index + 1].clone().sub(world[0]);
    area += first.cross(second).length() / 2;
  }
  return area;
}

function cubeFaceLocalPoints(cube: CubeLike, face: string): number[][] {
  const [x1, y1, z1] = cube.from;
  const [x2, y2, z2] = cube.to;
  switch (face) {
    case "north": return [[x1, y1, z1], [x2, y1, z1], [x2, y2, z1], [x1, y2, z1]];
    case "south": return [[x2, y1, z2], [x1, y1, z2], [x1, y2, z2], [x2, y2, z2]];
    case "east": return [[x2, y1, z1], [x2, y1, z2], [x2, y2, z2], [x2, y2, z1]];
    case "west": return [[x1, y1, z2], [x1, y1, z1], [x1, y2, z1], [x1, y2, z2]];
    case "up": return [[x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
    case "down": return [[x1, y1, z2], [x2, y1, z2], [x2, y1, z1], [x1, y1, z1]];
    default: return [];
  }
}

function uvRecordsForElements(
  project: ModelProject,
  elements: readonly InspectableGeometryNode[]
): UvFaceRecord[] {
  const records: UvFaceRecord[] = [];
  const seen = new Set<string>();
  for (const requested of elements) {
    for (const node of geometricDescendants(requested)) {
      if (seen.has(node.uuid)) continue;
      seen.add(node.uuid);
      if (node instanceof Cube) {
        const cube = node as CubeLike;
        for (const [key, face] of Object.entries(cube.faces)) {
          const uv = Array.isArray(face.uv) ? face.uv : [];
          const uvPoints: UvPoint[] = uv.length >= 4
            ? [[uv[0], uv[1]], [uv[2], uv[1]], [uv[2], uv[3]], [uv[0], uv[3]]]
            : [];
          const texture = resolveTexture(project, face.texture);
          records.push({
            face_id: `${cube.uuid}/${key}`,
            element_uuid: cube.uuid,
            element_name: cube.name,
            element_type: "cube",
            face_key: key,
            enabled: face.enabled !== false && face.texture !== null,
            texture_uuid: texture?.uuid ?? null,
            texture_name: texture?.name ?? null,
            texture_size: texture ? [texture.width, texture.height] : null,
            uv_size: texture
              ? [texture.uv_width || project.texture_width, texture.uv_height || project.texture_height]
              : [project.texture_width, project.texture_height],
            uv_points: uvPoints,
            rotation: Number(face.rotation ?? 0),
            mirrored: Boolean(cube.mirror_uv || (uv.length >= 4 && (uv[0] > uv[2] || uv[1] > uv[3]))),
            world_area: worldPolygonArea(cube, cubeFaceLocalPoints(cube, key)),
          });
        }
      } else if (node instanceof Mesh) {
        const mesh = node as MeshLike;
        for (const [key, face] of Object.entries(mesh.faces)) {
          const vertices = face.vertices ?? Object.keys(face.uv ?? {});
          const uvMap = !Array.isArray(face.uv) && face.uv ? face.uv : {};
          const uvPoints = vertices.flatMap((vertex): UvPoint[] => {
            const point = uvMap[vertex];
            return point?.length >= 2 ? [[point[0], point[1]]] : [];
          });
          const texture = resolveTexture(project, face.texture);
          records.push({
            face_id: `${mesh.uuid}/${key}`,
            element_uuid: mesh.uuid,
            element_name: mesh.name,
            element_type: "mesh",
            face_key: key,
            enabled: face.enabled !== false && face.texture !== null,
            texture_uuid: texture?.uuid ?? null,
            texture_name: texture?.name ?? null,
            texture_size: texture ? [texture.width, texture.height] : null,
            uv_size: texture
              ? [texture.uv_width || project.texture_width, texture.uv_height || project.texture_height]
              : [project.texture_width, project.texture_height],
            uv_points: uvPoints,
            rotation: Number(face.rotation ?? 0),
            mirrored: null,
            world_area: worldPolygonArea(mesh, vertices.map((vertex) => mesh.vertices[vertex]).filter(Boolean)),
          });
        }
      }
    }
  }
  return records;
}

interface TextureSnapshot {
  uuid: string;
  name: string;
  width: number;
  height: number;
  digest: string;
  pixels: string | null;
  pixel_capture_status: "captured" | "size_limit" | "dimension_mismatch" | "unavailable";
  pixel_byte_length: number | null;
  digest_source: "rgba" | "data_url" | "metadata";
}

function texturePixels(texture: Texture, maxBytes: number): {
  pixels: string | null;
  status: TextureSnapshot["pixel_capture_status"];
  byteLength: number | null;
} {
  const surface = (texture as Texture & { canvas?: HTMLCanvasElement }).canvas;
  const context = surface?.getContext("2d", { willReadFrequently: true });
  if (!surface || !context) return { pixels: null, status: "unavailable", byteLength: null };
  // Pixel dimensions are part of the snapshot contract. If Blockbench's backing
  // canvas is temporarily a different size, omit bytes instead of mislabelling them.
  if (surface.width !== texture.width || surface.height !== texture.height) {
    return { pixels: null, status: "dimension_mismatch", byteLength: null };
  }
  const byteLength = surface.width * surface.height * 4;
  if (!Number.isSafeInteger(byteLength) || byteLength > maxBytes) {
    return { pixels: null, status: "size_limit", byteLength };
  }
  try {
    const data = context.getImageData(0, 0, surface.width, surface.height).data;
    return { pixels: Buffer.from(data).toString("base64"), status: "captured", byteLength };
  } catch {
    return { pixels: null, status: "unavailable", byteLength: null };
  }
}

function captureTexture(texture: Texture, maxBytes: number): TextureSnapshot {
  const captured = texturePixels(texture, maxBytes);
  let digest: string;
  let digestSource: TextureSnapshot["digest_source"];
  if (captured.pixels) {
    digest = bytesSha256(Buffer.from(captured.pixels, "base64"));
    digestSource = "rgba";
  } else {
    try {
      digest = bytesSha256(texture.getDataURL());
      digestSource = "data_url";
    } catch {
      digest = stableSha256({
        uuid: texture.uuid,
        name: texture.name,
        width: texture.width,
        height: texture.height,
      });
      digestSource = "metadata";
    }
  }
  return {
    uuid: texture.uuid,
    name: texture.name,
    width: texture.width,
    height: texture.height,
    digest,
    pixels: captured.pixels,
    pixel_capture_status: captured.status,
    pixel_byte_length: captured.byteLength,
    digest_source: digestSource,
  };
}

function nodeSnapshot(node: InspectableGeometryNode) {
  node.scene_object.updateWorldMatrix(true, false);
  const base = {
    uuid: node.uuid,
    name: node.name,
    type: node instanceof Group ? "group" : node.type,
    parent_uuid: node.parent && node.parent !== "root" ? node.parent.uuid : null,
    local_matrix: node.scene_object.matrix.toArray(),
    world_matrix: node.scene_object.matrixWorld.toArray(),
    ancestors: ancestorTransformProvenance(node),
  };
  let geometry: unknown = null;
  if (node instanceof Cube) {
    const cube = node as CubeLike & {
      origin?: number[];
      rotation?: number[];
      inflate?: number;
      box_uv?: boolean;
      uv_offset?: number[];
    };
    geometry = {
      from: cube.from,
      to: cube.to,
      origin: cube.origin,
      rotation: cube.rotation,
      inflate: cube.inflate,
      box_uv: cube.box_uv,
      uv_offset: cube.uv_offset,
      mirror_uv: cube.mirror_uv,
      faces: snapshotFaces(cube.faces),
    };
  } else if (node instanceof Mesh) {
    const mesh = node as MeshLike;
    geometry = {
      vertices: Object.fromEntries(Object.entries(mesh.vertices).map(([key, point]) => [key, [...point]])),
      faces: snapshotFaces(mesh.faces),
    };
  } else if (node instanceof Group) {
    geometry = { children: node.children.map((child) => child.uuid) };
  }
  return {
    ...base,
    geometry,
    transform_digest: stableSha256({
      local_matrix: base.local_matrix,
      world_matrix: base.world_matrix,
      ancestors: base.ancestors,
    }),
    geometry_digest: stableSha256(geometry),
  };
}

function snapshotFaces(faces: Record<string, FaceLike>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(faces).map(([key, face]) => [key, {
    texture: face.texture ?? null,
    uv: Array.isArray(face.uv)
      ? [...face.uv]
      : face.uv
        ? Object.fromEntries(Object.entries(face.uv).map(([vertex, point]) => [vertex, [...point]]))
        : null,
    rotation: Number(face.rotation ?? 0),
    enabled: face.enabled !== false,
    vertices: face.vertices ? [...face.vertices] : null,
  }]));
}

interface ValidationState {
  project: ReturnType<typeof describeProject>;
  target_uuids: string[];
  neighbor_uuids: string[];
  target_scope_uuids: string[];
  neighbor_scope_uuids: string[];
  nodes: ReturnType<typeof nodeSnapshot>[];
  uv: UvFaceRecord[];
  uv_digest: string | null;
  textures: TextureSnapshot[];
  texture_digest: string | null;
  camera: McpCameraState | null;
  visibility: null;
  animation: null;
  pose_digest: string;
  camera_digest: string;
  history_index: number | null;
  root_digest: string;
}

interface ValidationSnapshotValue {
  input: z.infer<typeof createValidationSnapshotParameters>;
  state: ValidationState;
}

function uniqueNodes(nodes: readonly InspectableGeometryNode[]): InspectableGeometryNode[] {
  return [...new Map(nodes.map((node) => [node.uuid, node])).values()];
}

function resolveNodes(references: readonly string[]): InspectableGeometryNode[] {
  return uniqueNodes(references.map((reference) => findElementOrThrow(reference) as InspectableGeometryNode));
}

function resolveCurrentSnapshotNodes(
  project: ModelProject,
  uuids: readonly string[]
): InspectableGeometryNode[] {
  const all = [...project.groups, ...project.elements] as InspectableGeometryNode[];
  return uniqueNodes(uuids.flatMap((uuid) => {
    const matches = all.filter((node) => node.uuid === uuid);
    if (matches.length > 1) {
      throw new Error(`Snapshot element UUID '${uuid}' is duplicated in the current project.`);
    }
    return matches;
  }));
}

function currentHistoryIndex(): number | null {
  const runtime = Undo as typeof Undo & { index?: number; history?: unknown[] };
  if (typeof runtime.index === "number") return runtime.index;
  return Array.isArray(runtime.history) ? runtime.history.length : null;
}

function collectValidationState(
  project: ModelProject,
  input: z.infer<typeof createValidationSnapshotParameters>,
  allowMissingRoots = false
): ValidationState {
  const targets = allowMissingRoots
    ? resolveCurrentSnapshotNodes(project, input.targets)
    : resolveNodes(input.targets);
  const neighbors = allowMissingRoots
    ? resolveCurrentSnapshotNodes(project, input.neighbors)
    : resolveNodes(input.neighbors);
  const targetScope = uniqueNodes(targets.flatMap(geometricDescendants));
  const neighborScope = uniqueNodes(neighbors.flatMap(geometricDescendants));
  const expanded = uniqueNodes([...targetScope, ...neighborScope]);
  const nodes = expanded.map(nodeSnapshot);
  const allUv = input.include_uv || input.include_textures
    ? uvRecordsForElements(project, expanded)
    : [];
  const uv = input.include_uv ? allUv : [];
  const relevantTextureUuids = new Set(
    allUv.flatMap((record) => record.texture_uuid ? [record.texture_uuid] : [])
  );
  let remainingPixelBytes = MAX_VALIDATION_SNAPSHOT_PIXEL_BYTES;
  const textures = input.include_textures
    ? project.textures
        .filter((texture) => relevantTextureUuids.has(texture.uuid))
        .map((texture) => {
          const snapshot = captureTexture(texture, remainingPixelBytes);
          if (snapshot.pixels && snapshot.pixel_byte_length !== null) {
            remainingPixelBytes -= snapshot.pixel_byte_length;
          }
          return snapshot;
        })
    : [];
  const camera = getEffectiveCameraState(project);
  const visibility = null;
  const animation = null;
  const stateWithoutRoot = {
    project: describeProject(project),
    target_uuids: targets.map((node) => node.uuid),
    neighbor_uuids: neighbors.map((node) => node.uuid),
    target_scope_uuids: targetScope.map((node) => node.uuid),
    neighbor_scope_uuids: neighborScope.map((node) => node.uuid),
    nodes,
    uv,
    uv_digest: input.include_uv ? stableSha256(uv) : null,
    textures,
    texture_digest: input.include_textures
      ? stableSha256(textures.map(({ pixels: _pixels, ...texture }) => texture))
      : null,
    camera,
    visibility,
    animation,
    pose_digest: stableSha256({ visibility, animation }),
    camera_digest: stableSha256(camera),
    history_index: currentHistoryIndex(),
  };
  return {
    ...stateWithoutRoot,
    root_digest: stableSha256({
      project_uuid: project.uuid,
      target_uuids: stateWithoutRoot.target_uuids,
      neighbor_uuids: stateWithoutRoot.neighbor_uuids,
      target_scope_uuids: stateWithoutRoot.target_scope_uuids,
      neighbor_scope_uuids: stateWithoutRoot.neighbor_scope_uuids,
      nodes: nodes.map((node) => ({
        uuid: node.uuid,
        transform_digest: node.transform_digest,
        geometry_digest: node.geometry_digest,
      })),
      uv_digest: stateWithoutRoot.uv_digest,
      texture_digest: stateWithoutRoot.texture_digest,
      pose_digest: stateWithoutRoot.pose_digest,
      camera_digest: stateWithoutRoot.camera_digest,
    }),
  };
}

function publicState(state: ValidationState) {
  return {
    ...state,
    textures: state.textures.map(({ pixels: _pixels, ...texture }) => ({
      ...texture,
      pixel_data_captured: Boolean(_pixels),
    })),
  };
}

function changedPixels(
  before: TextureSnapshot,
  after: TextureSnapshot,
  authorized: z.infer<typeof authorizedPixelRegionSchema>[]
) {
  const regions = authorized.filter((region) => region.texture_uuid === before.uuid);
  const authorizationChecked = regions.length > 0;
  if (!before.pixels || !after.pixels || before.width !== after.width || before.height !== after.height) {
    return {
      available: false,
      authorization_checked: authorizationChecked,
      count: null,
      inside_authorized: null,
      outside_authorized: null,
      bounds: null,
    };
  }
  const first = Buffer.from(before.pixels, "base64");
  const second = Buffer.from(after.pixels, "base64");
  let count = 0;
  let inside = 0;
  let outside = 0;
  let minX = before.width;
  let minY = before.height;
  let maxX = -1;
  let maxY = -1;
  for (let pixel = 0; pixel < before.width * before.height; pixel++) {
    const offset = pixel * 4;
    if (
      first[offset] === second[offset]
      && first[offset + 1] === second[offset + 1]
      && first[offset + 2] === second[offset + 2]
      && first[offset + 3] === second[offset + 3]
    ) continue;
    count++;
    const x = pixel % before.width;
    const y = Math.floor(pixel / before.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (authorizationChecked) {
      const allowed = regions.some((region) => {
        const [x1, y1, x2, y2] = region.rectangle;
        return x >= Math.min(x1, x2) && x <= Math.max(x1, x2)
          && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
      });
      if (allowed) inside++;
      else outside++;
    }
  }
  return {
    available: true,
    authorization_checked: authorizationChecked,
    count,
    inside_authorized: authorizationChecked ? inside : null,
    outside_authorized: authorizationChecked ? outside : null,
    bounds: count ? [minX, minY, maxX, maxY] : null,
  };
}

function diffStates(
  before: ValidationState,
  after: ValidationState,
  authorized: z.infer<typeof authorizedPixelRegionSchema>[]
) {
  const beforeNodes = new Map(before.nodes.map((node) => [node.uuid, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.uuid, node]));
  const changedNodes = [...new Set([...beforeNodes.keys(), ...afterNodes.keys()])].flatMap((uuid) => {
    const first = beforeNodes.get(uuid);
    const second = afterNodes.get(uuid);
    if (!first || !second) return [{ uuid, status: first ? "removed" : "added", transform_changed: true, geometry_changed: true }];
    const transformChanged = first.transform_digest !== second.transform_digest;
    const geometryChanged = first.geometry_digest !== second.geometry_digest;
    return transformChanged || geometryChanged
      ? [{ uuid, status: "modified", transform_changed: transformChanged, geometry_changed: geometryChanged }]
      : [];
  });
  const beforeTextures = new Map(before.textures.map((texture) => [texture.uuid, texture]));
  const afterTextures = new Map(after.textures.map((texture) => [texture.uuid, texture]));
  const textureChanges: Array<{
    uuid: string;
    status: string;
    pixels: ReturnType<typeof changedPixels> | null;
  }> = [];
  for (const uuid of new Set([...beforeTextures.keys(), ...afterTextures.keys()])) {
    const first = beforeTextures.get(uuid);
    const second = afterTextures.get(uuid);
    if (!first || !second) {
      textureChanges.push({ uuid, status: first ? "removed" : "added", pixels: null });
    } else if (first.digest !== second.digest) {
      textureChanges.push({ uuid, status: "modified", pixels: changedPixels(first, second, authorized) });
    }
  }
  const targetSet = new Set([...before.target_scope_uuids, ...after.target_scope_uuids]);
  const neighborSet = new Set([...before.neighbor_scope_uuids, ...after.neighbor_scope_uuids]);
  const targetChanged = changedNodes.some((change) => targetSet.has(change.uuid));
  const neighborChanged = changedNodes.some((change) => neighborSet.has(change.uuid));
  const uvChanged = before.uv_digest !== after.uv_digest;
  const texturesChanged = textureChanges.length > 0;
  const poseChanged = before.pose_digest !== after.pose_digest;
  const cameraChanged = before.camera_digest !== after.camera_digest;
  const invalidated = [
    targetChanged || neighborChanged ? "contact_and_clearance_measurements" : null,
    uvChanged || texturesChanged ? "uv_and_texture_integrity_evidence" : null,
    targetChanged || neighborChanged || poseChanged || cameraChanged ? "camera_and_visibility_captures" : null,
    targetChanged || neighborChanged || poseChanged ? "pose_sweep_results" : null,
  ].filter((value): value is string => Boolean(value));
  const valid = [
    !targetChanged && !neighborChanged ? "contact_and_clearance_measurements" : null,
    !uvChanged && !texturesChanged ? "uv_and_texture_integrity_evidence" : null,
    !targetChanged && !neighborChanged && !poseChanged && !cameraChanged ? "camera_and_visibility_captures" : null,
    !targetChanged && !neighborChanged && !poseChanged ? "pose_sweep_results" : null,
  ].filter((value): value is string => Boolean(value));
  return {
    changed: before.root_digest !== after.root_digest,
    project_uuid: before.project.uuid,
    root_digest: { before: before.root_digest, current: after.root_digest },
    history_index: { before: before.history_index, current: after.history_index },
    nodes: changedNodes,
    uv_changed: uvChanged,
    textures: textureChanges,
    pose_changed: poseChanged,
    camera_changed: cameraChanged,
    invalidated_evidence: invalidated,
    still_valid_evidence: valid,
  };
}

type ContactPairInput = z.infer<typeof contactPairSchema>;

function contactComparisonCeiling(pair: ContactPairInput, maxTriangleComparisons: number): number {
  const first = findElementOrThrow(pair.first) as InspectableGeometryNode;
  const second = findElementOrThrow(pair.second) as InspectableGeometryNode;
  if (first.uuid === second.uuid) throw new Error("Contact analysis requires two distinct elements.");
  const firstDescendants = geometricDescendants(first);
  const secondDescendants = geometricDescendants(second);
  if (!firstDescendants.length || !secondDescendants.length) {
    throw new Error("Each contact-analysis side must contain renderable cube or mesh geometry.");
  }
  if (firstDescendants.length * secondDescendants.length > MAX_DESCENDANT_CONTACT_PAIRS) {
    return Number.POSITIVE_INFINITY;
  }
  const triangleCounts = new Map<InspectableGeometryNode, number>();
  const triangleCount = (node: InspectableGeometryNode): number => {
    const existing = triangleCounts.get(node);
    if (existing !== undefined) return existing;
    const count = extractNodeGeometry(node, false).triangles.length;
    triangleCounts.set(node, count);
    return count;
  };
  let comparisons = 0;
  for (const firstNode of firstDescendants) {
    const firstTriangles = triangleCount(firstNode);
    for (const secondNode of secondDescendants) {
      if (firstNode.uuid === secondNode.uuid) continue;
      const secondTriangles = triangleCount(secondNode);
      const product = firstTriangles * secondTriangles;
      comparisons += firstNode instanceof Cube && secondNode instanceof Cube
        ? product
        : Math.min(product, maxTriangleComparisons);
      if (comparisons > MAX_CONTACT_COMPARISON_CEILING) return comparisons;
    }
  }
  return comparisons;
}

function assertContactWorkBounded(
  pairs: readonly ContactPairInput[],
  maxTriangleComparisons: number,
  sampleCount = 1
): void {
  let ceiling = 0;
  for (const pair of pairs) {
    ceiling += contactComparisonCeiling(pair, maxTriangleComparisons) * sampleCount;
    if (ceiling > MAX_CONTACT_COMPARISON_CEILING) {
      throw new Error(
        `The requested contact work can require more than ${MAX_CONTACT_COMPARISON_CEILING.toLocaleString()} triangle comparisons. Narrow the pairs, descendants, samples, or comparison limit.`
      );
    }
  }
}

function analyzeContactRequest(pair: ContactPairInput, maxTriangleComparisons: number) {
  const first = findElementOrThrow(pair.first) as InspectableGeometryNode;
  const second = findElementOrThrow(pair.second) as InspectableGeometryNode;
  if (first.uuid === second.uuid) throw new Error("Contact analysis requires two distinct elements.");
  const firstDescendants = geometricDescendants(first);
  const secondDescendants = geometricDescendants(second);
  if (!firstDescendants.length || !secondDescendants.length) {
    throw new Error("Each contact-analysis side must contain renderable cube or mesh geometry.");
  }
  if (firstDescendants.length * secondDescendants.length > MAX_DESCENDANT_CONTACT_PAIRS) {
    throw new Error(
      `Contact request expands to more than ${MAX_DESCENDANT_CONTACT_PAIRS} descendant pairs. Narrow the requested elements.`
    );
  }
  const descendantPairs = firstDescendants.flatMap((firstNode) =>
    secondDescendants
      .filter((secondNode) => secondNode.uuid !== firstNode.uuid)
      .map((secondNode) => analyzeDescendantContact(
        firstNode,
        secondNode,
        pair.tolerance,
        pair.expected,
        maxTriangleComparisons
      ))
  );
  const statuses = descendantPairs.map((result) => result.expected.status);
  const expectedStatus = pair.expected.relation === "unspecified"
    ? "not_requested"
    : statuses.includes("fail")
      ? "fail"
      : statuses.includes("unknown")
        ? "unknown"
        : pair.expected.relation === "connected" || pair.expected.relation === "intentionally_embedded"
          ? statuses.includes("pass") ? "pass" : "fail"
          : "pass";
  return {
    request: pair,
    first: { uuid: first.uuid, name: first.name },
    second: { uuid: second.uuid, name: second.name },
    expected_status: expectedStatus,
    descendant_pairs: descendantPairs,
  };
}

type ValidationView = z.infer<typeof validationViewSchema>;

function suiteViews(
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

function boundsForNodes(nodes: readonly InspectableGeometryNode[]) {
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

function cameraForValidationView(
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

async function captureViewEvidence(
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

function geometryBounds(node: InspectableGeometryNode) {
  const points = extractNodeGeometry(node).vertices;
  if (!points.length) return null;
  return {
    min: tuple([0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])))),
    max: tuple([0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])))),
  };
}

function mergeEnvelope(
  previous: { min: [number, number, number]; max: [number, number, number] } | undefined,
  next: { min: [number, number, number]; max: [number, number, number] }
) {
  if (!previous) return { min: [...next.min] as [number, number, number], max: [...next.max] as [number, number, number] };
  return {
    min: tuple([0, 1, 2].map((axis) => Math.min(previous.min[axis], next.min[axis]))),
    max: tuple([0, 1, 2].map((axis) => Math.max(previous.max[axis], next.max[axis]))),
  };
}

function validatePoseSample(
  input: z.infer<typeof sweepAnimationValidationParameters>,
  maxComparisons: number
) {
  const contacts = input.contacts.map((pair) => analyzeContactRequest(pair, maxComparisons));
  const hierarchy = input.hierarchy.map((check) => {
    const node = findElementOrThrow(check.element) as InspectableGeometryNode;
    const expected = check.expected_parent === null
      ? null
      : (findElementOrThrow(check.expected_parent) as InspectableGeometryNode).uuid;
    const actual = node.parent && node.parent !== "root" ? node.parent.uuid : null;
    return {
      element: { uuid: node.uuid, name: node.name },
      expected_parent_uuid: expected,
      actual_parent_uuid: actual,
      status: expected === actual ? "pass" : "fail",
    };
  });
  const bounds = input.bounds.map((check) => {
    const node = findElementOrThrow(check.element) as InspectableGeometryNode;
    const actual = geometryBounds(node);
    const passed = Boolean(actual)
      && (!check.minimum || check.minimum.every((value, axis) => actual!.min[axis] >= value))
      && (!check.maximum || check.maximum.every((value, axis) => actual!.max[axis] <= value));
    return {
      element: { uuid: node.uuid, name: node.name },
      actual,
      minimum: check.minimum ?? null,
      maximum: check.maximum ?? null,
      status: passed ? "pass" : "fail",
    };
  });
  const failures = [
    ...contacts.filter((result) => result.expected_status === "fail").map((result) => ({ kind: "contact", first: result.first, second: result.second })),
    ...hierarchy.filter((result) => result.status === "fail").map((result) => ({ kind: "hierarchy", element: result.element })),
    ...bounds.filter((result) => result.status === "fail").map((result) => ({ kind: "bounds", element: result.element })),
  ];
  return { contacts, hierarchy, bounds, failures };
}

export function registerValidationTools(): void {
  createInternalTool(validationOperationDocs[0].name, {
    ...validationOperationDocs[0],
    async execute(
      { pairs, max_triangle_comparisons }: z.infer<typeof analyzeModelContactsParameters>,
      context
    ) {
      const project = context.project!;
      assertContactWorkBounded(pairs, max_triangle_comparisons);
      const results = pairs.map((pair) => analyzeContactRequest(pair, max_triangle_comparisons));
      return JSON.stringify({
        schema_version: "1",
        project: { uuid: project.uuid, name: project.name },
        coordinate_space: "world",
        unit: "Blockbench model unit",
        results,
      }, null, 2);
    },
  }, validationOperationDocs[0].status);

  createInternalTool(validationOperationDocs[1].name, {
    ...validationOperationDocs[1],
    async execute({ elements, expected_sharing, authorized_pixel_regions, texel_density_ratio_warning }, context) {
      const project = context.project!;
      const selected = elements.length
        ? resolveNodes(elements)
        : project.elements as InspectableGeometryNode[];
      const records = uvRecordsForElements(project, selected);
      if (records.length > MAX_UV_FACE_RECORDS) {
        throw new Error(
          `UV inspection expands to ${records.length} faces; the limit is ${MAX_UV_FACE_RECORDS}. Narrow the elements list.`
        );
      }
      return JSON.stringify({
        schema_version: "1",
        project: { uuid: project.uuid, name: project.name },
        coordinate_space: "texture_uv",
        ...analyzeUvIntegrity(records, {
          expected_sharing,
          authorized_pixel_regions,
          texel_density_ratio_warning,
        }),
      }, null, 2);
    },
  }, validationOperationDocs[1].status);

  createInternalTool(validationOperationDocs[2].name, {
    ...validationOperationDocs[2],
    async execute(input, context) {
      const project = context.project!;
      const state = collectValidationState(project, input);
      const normalizedInput = {
        ...input,
        targets: state.target_uuids,
        neighbors: state.neighbor_uuids,
      };
      const stored = storeValidationSnapshot(
        project.uuid,
        state.root_digest,
        { input: normalizedInput, state } satisfies ValidationSnapshotValue
      );
      return JSON.stringify({
        schema_version: "1",
        snapshot_id: stored.id,
        created_at: stored.created_at,
        retention: {
          maximum_snapshots_per_project: MAX_VALIDATION_SNAPSHOTS_PER_PROJECT,
          evicted_snapshot_ids: stored.evicted_snapshot_ids,
        },
        evidence_labels: input.evidence_labels,
        state: publicState(state),
        mutates_model: false,
      }, null, 2);
    },
  }, validationOperationDocs[2].status);

  createInternalTool(validationOperationDocs[3].name, {
    ...validationOperationDocs[3],
    async execute({ snapshot_id, authorized_pixel_regions }, context) {
      const project = context.project!;
      const stored = getValidationSnapshot<ValidationSnapshotValue>(
        snapshot_id,
        project.uuid
      );
      const current = collectValidationState(project, stored.value.input, true);
      return JSON.stringify({
        schema_version: "1",
        snapshot_id: stored.id,
        created_at: stored.created_at,
        ...diffStates(stored.value.state, current, authorized_pixel_regions),
        current_state: publicState(current),
      }, null, 2);
    },
  }, validationOperationDocs[3].status);

  createInternalTool(validationOperationDocs[4].name, {
    ...validationOperationDocs[4],
    async execute(
      { target: targetReference, context_elements, suite, views, width, height }:
        z.infer<typeof captureValidationViewsParameters>,
      context
    ) {
      const project = context.project!;
      const target = findElementOrThrow(targetReference) as InspectableGeometryNode;
      const contexts = resolveNodes(context_elements);
      const configuredViews = suiteViews(suite, views);
      const names = new Set<string>();
      for (const view of configuredViews) {
        if (names.has(view.name)) throw new Error(`Validation view name '${view.name}' is duplicated.`);
        names.add(view.name);
      }
      const renderCount = validationViewRenderCount(configuredViews, contexts.length > 0);
      const outputPixels = configuredViews.reduce((total, view) => total + view.passes.length, 0)
        * width * height;
      if (
        renderCount > MAX_VALIDATION_VIEW_RENDERS
        || renderCount * width * height > MAX_VALIDATION_RENDER_PIXELS
        || outputPixels > MAX_VALIDATION_OUTPUT_PIXELS
      ) {
        throw new Error(
          `The requested validation suite needs ${renderCount} renders and exceeds the bounded render budget. ` +
            "Reduce views, passes, or resolution."
        );
      }
      const framedBounds = boundsForNodes([target, ...contexts]);
      const imageItems: Array<{ type: "image"; data: string; mimeType: string }> = [];
      const viewResults = [];
      for (const view of configuredViews) {
        const camera = cameraForValidationView(view, framedBounds, [width, height]);
        const evidence = await captureViewEvidence(
          project,
          target,
          contexts,
          view,
          camera,
          width,
          height
        );
        const passes = [];
        for (const pass of view.passes) {
          const capture = evidence.captures.get(pass)!;
          const image = imageContent(capture.data_url, "image/png").content[0];
          const imageIndex = imageItems.length;
          imageItems.push(image);
          // Content item 0 is the JSON result; rendered images begin at item 1.
          passes.push({
            pass,
            image_content_index: imageIndex + 1,
            id_legend: capture.id_legend,
          });
        }
        viewResults.push({ ...evidence.metadata, passes });
      }
      const result = {
        schema_version: "1",
        project: { uuid: project.uuid, name: project.name },
        target: { uuid: target.uuid, name: target.name },
        context: contexts.map((node) => ({ uuid: node.uuid, name: node.name })),
        viewport: { width, height },
        views: viewResults,
        state_restored: {
          camera: true,
          visibility: true,
          animation_preview: true,
          render_state: true,
        },
      };
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ...imageItems,
        ],
        structuredContent: result,
      };
    },
  }, validationOperationDocs[4].status);

  createInternalTool(validationOperationDocs[5].name, {
    ...validationOperationDocs[5],
    async execute(input: z.infer<typeof sweepAnimationValidationParameters>, context) {
      const project = context.project!;
      const animation = resolveUniqueReference(
        input.animation,
        project.animations,
        "Animation",
        "inspect_animation"
      );
      const requestedSamples = [...input.samples];
      if (input.include_loop_boundary) {
        requestedSamples.push(0, animation.length);
      }
      const samples = [...new Set(requestedSamples.map((value) =>
        value === "rest" ? value : Number(value.toFixed(9))
      ))];
      assertContactWorkBounded(input.contacts, input.max_triangle_comparisons, samples.length);
      const envelopeNodes = resolveNodes(input.envelope_elements);
      const envelopes = new Map<string, {
        element: { uuid: string; name: string };
        min: [number, number, number];
        max: [number, number, number];
      }>();
      const results = [];
      let firstFailure: { sample: number | "rest"; failures: unknown[] } | null = null;
      for (const sample of samples) {
        const result = withTemporaryAnimationPose(
          project,
          sample === "rest" ? null : animation.uuid,
          sample === "rest" ? null : sample,
          () => {
            const checks = validatePoseSample(input, input.max_triangle_comparisons);
            const sampleBounds = envelopeNodes.map((node) => ({ node, bounds: geometryBounds(node) }));
            return { checks, sampleBounds };
          }
        );
        for (const entry of result.sampleBounds) {
          if (!entry.bounds) continue;
          const merged = mergeEnvelope(envelopes.get(entry.node.uuid), entry.bounds);
          envelopes.set(entry.node.uuid, {
            element: { uuid: entry.node.uuid, name: entry.node.name },
            ...merged,
          });
        }
        const sampleResult = {
          sample,
          time_seconds: sample === "rest" ? null : sample,
          ...result.checks,
          status: result.checks.failures.length ? "fail" : "pass",
        };
        results.push(sampleResult);
        if (!firstFailure && result.checks.failures.length) {
          firstFailure = { sample, failures: result.checks.failures };
          if (input.stop_on_first_failure) break;
        }
      }
      return JSON.stringify({
        schema_version: "1",
        project: { uuid: project.uuid, name: project.name },
        animation: { uuid: animation.uuid, name: animation.name, length: animation.length },
        samples: results,
        first_failure: firstFailure,
        motion_envelopes: [...envelopes.values()],
        state_restored: {
          animation_selection: true,
          timeline_time: true,
          model_transforms: true,
          visibility: true,
        },
        limitations: [
          "This sweep validates Blockbench-native animations. YSM Molang sequences use ysm_simulate_molang/ysm_preview_molang.",
          "Visibility raster checks are provided by capture_validation_views and are not repeated at every sweep sample.",
        ],
      }, null, 2);
    },
  }, validationOperationDocs[5].status);

}
