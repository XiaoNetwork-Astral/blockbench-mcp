/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";

export const expectedContactSchema = z.object({
  relation: z.enum(["unspecified", "connected", "separate", "intentionally_embedded"]).optional().default("unspecified"),
  minimum_separation: z.number().finite().min(0).max(1024).optional().default(0),
  maximum_separation: z.number().finite().min(0).max(1024).optional(),
  minimum_penetration: z.number().finite().min(0).max(1024).optional().default(0),
  maximum_penetration: z.number().finite().min(0).max(1024).optional(),
}).strict();

export const contactPairSchema = z.object({
  first: z.string().min(1),
  second: z.string().min(1),
  expected: expectedContactSchema.prefault({}),
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

export const authorizedPixelRegionSchema = z.object({
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

export const validationViewSchema = z.object({
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
