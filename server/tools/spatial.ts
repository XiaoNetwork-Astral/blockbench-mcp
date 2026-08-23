/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { findElementOrThrow } from "@/lib/util";
import {
  analyzeBoundsPair,
  type Bounds3,
  type Vector3Tuple,
} from "@/lib/spatialRelations";
import { expandOutlinerGeometryWorldBounds } from "@/lib/sceneBounds";
import {
  angleBetweenVectors,
  closestPointOnBounds,
  closestPointOnTriangles,
  closestPointsBetweenBounds,
  closestPointsBetweenTriangleSets,
  distanceBetweenPoints,
  findCoplanarTriangleOverlaps,
  normalizeVector,
  principalAxis,
  type ClosestPointsResult,
  type Triangle3,
} from "@/lib/measurements";
import { vec3 } from "@/lib/zodObjects";

const THREE_API = (
  globalThis as typeof globalThis & { THREE: typeof import("three") }
).THREE;

const spatialPairSchema = z.object({
  first: z.string().describe("UUID or unique name of the first Outliner node."),
  second: z.string().describe("UUID or unique name of the second Outliner node."),
  expected_relation: z
    .enum(["unspecified", "connected", "separate"])
    .optional()
    .default("unspecified")
    .describe(
      "Caller-supplied semantic expectation. The tool never guesses whether two parts should connect."
    ),
  tolerance: z
    .number()
    .min(0)
    .max(16)
    .optional()
    .default(0.001)
    .describe("Distance treated as touching, in model units."),
});

export const inspectSpatialRelationshipsParameters = z
  .object({
    elements: z
      .array(z.string())
      .max(100)
      .optional()
      .default([])
      .describe("UUIDs or unique names whose world bounds should be reported."),
    pairs: z
      .array(spatialPairSchema)
      .max(100)
      .optional()
      .default([])
      .describe("Pairs whose axis gaps and projection/depth relationship should be compared."),
  })
  .refine((value) => value.elements.length > 0 || value.pairs.length > 0, {
    message: "Provide at least one element or comparison pair.",
  });

function measurementEndpointSchema() {
  return z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("point"),
      point: vec3("Explicit world-space point [x, y, z]."),
    }),
    z.object({
      kind: z.literal("pivot"),
      element: z.string().describe("Outliner node UUID or unique name."),
    }),
    z.object({
      kind: z.literal("bounds_center"),
      element: z.string().describe("Outliner node UUID or unique name."),
    }),
    z.object({
      kind: z.literal("surface"),
      element: z.string().describe(
        "Outliner node whose actual rendered geometry surface should be used. Falls back to world bounds only when geometry is unavailable or too large for the bounded exact calculation."
      ),
    }),
  ]);
}

function angleVectorSchema() {
  return z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("vector"),
      vector: vec3("World-space direction vector."),
    }),
    z.object({
      kind: z.literal("points"),
      from: vec3("World-space vector start point."),
      to: vec3("World-space vector end point."),
    }),
    z.object({
      kind: z.literal("long_axis"),
      element: z.string().describe(
        "Outliner node whose principal geometry axis should be measured."
      ),
    }),
  ]);
}

const distanceMeasurementSchema = z.object({
  first: measurementEndpointSchema(),
  second: measurementEndpointSchema(),
  label: z.string().optional(),
});

const angleMeasurementSchema = z.object({
  first: angleVectorSchema(),
  second: angleVectorSchema(),
  orientation: z
    .enum(["undirected", "directed"])
    .optional()
    .default("undirected")
    .describe(
      "Undirected treats opposite axis directions as the same and returns 0-90 degrees; directed returns 0-180 degrees."
    ),
  label: z.string().optional(),
});

export const measureGeometryParameters = z
  .object({
    elements: z
      .array(z.string())
      .max(100)
      .optional()
      .default([])
      .describe(
        "Nodes whose world pivot, bounds, size, and principal long axis should be reported."
      ),
    distances: z
      .array(distanceMeasurementSchema)
      .max(100)
      .optional()
      .default([])
      .describe(
        "Point/pivot/center/surface distance measurements in world coordinates."
      ),
    angles: z
      .array(angleMeasurementSchema)
      .max(100)
      .optional()
      .default([])
      .describe("Vector or geometry-long-axis angle measurements."),
    tolerance: z
      .number()
      .min(0)
      .max(16)
      .optional()
      .default(0.001)
      .describe("Touching tolerance for bounds gap/penetration analysis."),
  })
  .refine(
    ({ elements, distances, angles }) =>
      elements.length > 0 || distances.length > 0 || angles.length > 0,
    { message: "Provide at least one element, distance, or angle measurement." }
  );

const coplanarPairSchema = z.object({
  first: z.string().describe("UUID or unique name of the first Outliner node."),
  second: z.string().describe("UUID or unique name of the second Outliner node."),
  distance_tolerance: z.number().min(0).max(0.1).optional().default(0.0001),
  angle_tolerance_degrees: z.number().positive().max(5).optional().default(0.1),
  minimum_overlap_area: z.number().min(0).max(4096).optional().default(0.000001),
});

export const detectCoplanarFacesParameters = z.object({
  pairs: z.array(coplanarPairSchema).min(1).max(50),
  max_triangle_comparisons: z
    .number()
    .int()
    .min(100)
    .max(1_000_000)
    .optional()
    .default(200_000)
    .describe("Per-pair work limit for old or low-power computers."),
  max_results_per_pair: z.number().int().min(1).max(500).optional().default(100),
});

export const spatialToolDocs: ToolSpec[] = [
  {
    name: "inspect_spatial_relationships",
    description:
      "Reports parentage, world-space centers and bounds for Outliner nodes, then compares requested pairs along all three axes. It flags cases where a front/side/top projection overlaps while the hidden depth axis is separated. Semantic expectations are supplied by the caller; the tool does not guess which parts should connect.",
    annotations: {
      title: "Inspect Spatial Relationships",
      readOnlyHint: true,
    },
    parameters: inspectSpatialRelationshipsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "measure_geometry",
    description:
      "Performs batch world-space measurements without changing the model: object pivots/bounds/sizes, exact closest rendered-surface distances when tractable, point and pivot distances, signed three-axis bounds gaps plus penetration depths, and directed or undirected angles between vectors or principal geometry axes. Every result identifies its coordinate space, unit, endpoints, and whether an exact-geometry or bounds fallback method was used.",
    annotations: {
      title: "Measure Geometry",
      readOnlyHint: true,
    },
    parameters: measureGeometryParameters,
    status: STATUS_STABLE,
  },
  {
    name: "detect_coplanar_faces",
    description:
      "Finds overlapping coplanar rendered triangles that can cause Z-fighting. Ordinary volume intersections without coplanar surface overlap are reported separately and are not mislabeled.",
    annotations: { title: "Detect Coplanar Faces", readOnlyHint: true },
    parameters: detectCoplanarFacesParameters,
    status: STATUS_STABLE,
  },
];

const geometryInspectionOperations = [
  spatialToolDocs[0],
  spatialToolDocs[1],
  spatialToolDocs[2],
];

export const spatialPublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_geometry",
    description:
      "Inspects hierarchy/bounds, performs geometry measurements, or detects coplanar face conflicts through one read-only command.action.",
    annotations: { title: "Inspect Geometry", readOnlyHint: true },
    parameters: createToolGroupParameters(geometryInspectionOperations),
    status: STATUS_STABLE,
  },
];

type InspectableNode = OutlinerElement | Group;

type MeasurementEndpoint = z.infer<ReturnType<typeof measurementEndpointSchema>>;
type AngleVector = z.infer<ReturnType<typeof angleVectorSchema>>;

interface NodeGeometry {
  vertices: Vector3Tuple[];
  triangles: Triangle3[];
}

function tuple(vector: THREE.Vector3): Vector3Tuple {
  return [
    Number(vector.x.toFixed(6)),
    Number(vector.y.toFixed(6)),
    Number(vector.z.toFixed(6)),
  ];
}

function cleanTuple(vector: Vector3Tuple): Vector3Tuple {
  return vector.map((value) =>
    Math.abs(value) < 1e-12 ? 0 : Number(value.toFixed(6))
  ) as Vector3Tuple;
}

function extractNodeGeometry(node: InspectableNode): NodeGeometry {
  const vertices: Vector3Tuple[] = [];
  const triangles: Triangle3[] = [];

  const visit = (current: InspectableNode): void => {
    const sceneObject = current.scene_object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
    };
    sceneObject.updateWorldMatrix(true, false);
    const geometry = sceneObject.geometry;
    const positions = geometry?.attributes?.position;
    if (positions) {
      const transformed: Vector3Tuple[] = [];
      for (let index = 0; index < positions.count; index += 1) {
        const point = new THREE_API.Vector3(
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index)
        ).applyMatrix4(sceneObject.matrixWorld);
        const value: Vector3Tuple = [point.x, point.y, point.z];
        transformed.push(value);
        vertices.push(value);
      }
      const indices = geometry!.index;
      const count = indices?.count ?? positions.count;
      const indexAt = (offset: number): number =>
        indices ? indices.getX(offset) : offset;
      for (let offset = 0; offset + 2 < count; offset += 3) {
        const a = transformed[indexAt(offset)];
        const b = transformed[indexAt(offset + 1)];
        const c = transformed[indexAt(offset + 2)];
        if (a && b && c) triangles.push({ a, b, c });
      }
    }

    const children = (current as InspectableNode & {
      children?: InspectableNode[];
    }).children;
    if (Array.isArray(children)) children.forEach(visit);
  };
  visit(node);
  return { vertices, triangles };
}

function inspectNode(node: InspectableNode, geometry?: NodeGeometry) {
  const sceneObject = node.scene_object;
  sceneObject.updateWorldMatrix(true, true);

  const worldPosition = new THREE_API.Vector3();
  sceneObject.getWorldPosition(worldPosition);
  const box = expandOutlinerGeometryWorldBounds(
    node,
    new THREE_API.Box3()
  );
  const bounds: Bounds3 | null = box.isEmpty()
    ? null
    : { min: tuple(box.min), max: tuple(box.max) };
  const center = bounds
    ? tuple(box.getCenter(new THREE_API.Vector3()))
    : tuple(worldPosition);
  const size = bounds
    ? cleanTuple([
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ])
    : null;
  const axis = geometry ? principalAxis(geometry.vertices) : null;
  const parent = node.parent === "root" || !node.parent
    ? { type: "root" as const, name: "root", uuid: null }
    : {
        type: node.parent.type,
        name: node.parent.name,
        uuid: node.parent.uuid,
      };

  return {
    uuid: node.uuid,
    name: node.name,
    type: node instanceof Group ? "group" : node.type,
    parent,
    world_origin: tuple(worldPosition),
    world_bounds_center: center,
    world_bounds: bounds,
    world_size: size,
    principal_long_axis: axis
      ? {
          direction: cleanTuple(axis.direction),
          extent: Number(axis.extent.toFixed(6)),
          ambiguous: axis.ambiguous,
          eigenvalues: cleanTuple(axis.eigenvalues),
        }
      : null,
  };
}

function isAncestor(ancestor: InspectableNode, child: InspectableNode): boolean {
  let current = child.parent;
  while (current && current !== "root") {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

export function registerSpatialTools(): void {
  createInternalTool(spatialToolDocs[0].name, {
    ...spatialToolDocs[0],
    async execute({ elements, pairs }) {
      const requested = new Map<string, InspectableNode>();
      const add = (reference: string): InspectableNode => {
        const node = findElementOrThrow(reference) as InspectableNode;
        requested.set(node.uuid, node);
        return node;
      };

      for (const reference of elements) add(reference);
      type SpatialPair = z.infer<typeof spatialPairSchema>;
      const resolvedPairs = (pairs as SpatialPair[]).map((pair: SpatialPair) => ({
        ...pair,
        firstNode: add(pair.first),
        secondNode: add(pair.second),
      }));

      const inspected = new Map(
        [...requested.values()].map((node) => [node.uuid, inspectNode(node)])
      );

      const comparisons = resolvedPairs.map(
        ({ firstNode, secondNode, expected_relation, tolerance }) => {
          const first = inspected.get(firstNode.uuid)!;
          const second = inspected.get(secondNode.uuid)!;
          const geometry = first.world_bounds && second.world_bounds
            ? analyzeBoundsPair(first.world_bounds, second.world_bounds, tolerance)
            : null;
          const warnings: string[] = [];

          if (!geometry) {
            warnings.push("One or both nodes have no renderable world-space bounds.");
          } else {
            if (
              expected_relation === "connected" &&
              geometry.separated_axes.length > 0
            ) {
              warnings.push(
                `Expected connected, but world bounds are separated on: ${geometry.separated_axes.join(", ")}.`
              );
            }
            if (
              expected_relation === "separate" &&
              geometry.separated_axes.length === 0
            ) {
              warnings.push(
                "Expected separate, but the world axis-aligned bounds overlap or touch on every axis."
              );
            }
            for (const warning of geometry.projection_depth_warnings) {
              warnings.push(
                `${warning.view} projection overlaps on ${warning.projection_axes.join("/")}, ` +
                  `but depth axis ${warning.depth_axis} has a ${warning.depth_gap} unit gap.`
              );
            }
          }

          return {
            first: { uuid: first.uuid, name: first.name },
            second: { uuid: second.uuid, name: second.name },
            expected_relation,
            tolerance,
            hierarchy: {
              first_is_direct_parent: secondNode.parent === firstNode,
              second_is_direct_parent: firstNode.parent === secondNode,
              first_is_ancestor: isAncestor(firstNode, secondNode),
              second_is_ancestor: isAncestor(secondNode, firstNode),
            },
            geometry,
            warnings,
          };
        }
      );

      return JSON.stringify(
        {
          note:
            "Bounds are world-space axis-aligned boxes. Rotated or concave geometry may require transformed-corner or visual inspection.",
          elements: [...inspected.values()],
          comparisons,
        },
        null,
        2
      );
    },
  }, spatialToolDocs[0].status);

  createInternalTool(spatialToolDocs[1].name, {
    ...spatialToolDocs[1],
    async execute({ elements, distances, angles, tolerance }) {
      const nodes = new Map<string, InspectableNode>();
      const geometries = new Map<string, NodeGeometry>();
      const inspections = new Map<string, ReturnType<typeof inspectNode>>();

      const resolveNode = (reference: string): InspectableNode => {
        const node = findElementOrThrow(reference) as InspectableNode;
        nodes.set(node.uuid, node);
        return node;
      };
      const geometryFor = (node: InspectableNode): NodeGeometry => {
        let geometry = geometries.get(node.uuid);
        if (!geometry) {
          geometry = extractNodeGeometry(node);
          geometries.set(node.uuid, geometry);
        }
        return geometry;
      };
      const inspectionFor = (node: InspectableNode) => {
        let inspection = inspections.get(node.uuid);
        if (!inspection) {
          inspection = inspectNode(node, geometryFor(node));
          inspections.set(node.uuid, inspection);
        }
        return inspection;
      };
      const nodeFromEndpoint = (
        endpoint: MeasurementEndpoint
      ): InspectableNode | null => endpoint.kind === "point"
        ? null
        : resolveNode(endpoint.element);
      const concretePoint = (
        endpoint: MeasurementEndpoint,
        node: InspectableNode | null
      ): Vector3Tuple => {
        if (endpoint.kind === "point") return [...endpoint.point] as Vector3Tuple;
        if (!node) throw new Error("Measurement endpoint could not resolve its element.");
        const inspection = inspectionFor(node);
        if (endpoint.kind === "pivot") return [...inspection.world_origin] as Vector3Tuple;
        if (endpoint.kind === "bounds_center") {
          return [...inspection.world_bounds_center] as Vector3Tuple;
        }
        throw new Error("Surface endpoints require a paired closest-point calculation.");
      };
      const fallbackBounds = (node: InspectableNode): Bounds3 => {
        const bounds = inspectionFor(node).world_bounds;
        if (!bounds) {
          throw new Error(
            `Element "${node.name}" (${node.uuid}) has no renderable geometry or bounds.`
          );
        }
        return bounds;
      };

      const measuredElements = (elements as string[]).map((reference) => {
        const node = resolveNode(reference);
        return inspectionFor(node);
      });

      type DistanceMeasurement = z.infer<typeof distanceMeasurementSchema>;
      const measuredDistances = (distances as DistanceMeasurement[]).map((measurement) => {
        const firstNode = nodeFromEndpoint(measurement.first);
        const secondNode = nodeFromEndpoint(measurement.second);
        let closest: ClosestPointsResult;
        let method = "point_to_point";

        if (measurement.first.kind === "surface" && measurement.second.kind === "surface") {
          const exact = closestPointsBetweenTriangleSets(
            geometryFor(firstNode!).triangles,
            geometryFor(secondNode!).triangles
          );
          if (exact) {
            closest = exact;
            method = "rendered_geometry_surface_to_surface";
          } else {
            closest = closestPointsBetweenBounds(
              fallbackBounds(firstNode!),
              fallbackBounds(secondNode!)
            );
            method = "axis_aligned_bounds_fallback";
          }
        } else if (measurement.first.kind === "surface") {
          const secondPoint = concretePoint(measurement.second, secondNode);
          const exact = closestPointOnTriangles(
            secondPoint,
            geometryFor(firstNode!).triangles
          );
          if (exact) {
            closest = exact;
            method = "rendered_geometry_surface_to_point";
          } else {
            closest = distanceBetweenPoints(
              closestPointOnBounds(secondPoint, fallbackBounds(firstNode!)),
              secondPoint
            );
            method = "axis_aligned_bounds_fallback";
          }
        } else if (measurement.second.kind === "surface") {
          const firstPoint = concretePoint(measurement.first, firstNode);
          const exact = closestPointOnTriangles(
            firstPoint,
            geometryFor(secondNode!).triangles
          );
          if (exact) {
            closest = {
              first: exact.second,
              second: exact.first,
              distance: exact.distance,
            };
            method = "point_to_rendered_geometry_surface";
          } else {
            closest = distanceBetweenPoints(
              firstPoint,
              closestPointOnBounds(firstPoint, fallbackBounds(secondNode!))
            );
            method = "axis_aligned_bounds_fallback";
          }
        } else {
          closest = distanceBetweenPoints(
            concretePoint(measurement.first, firstNode),
            concretePoint(measurement.second, secondNode)
          );
        }

        const delta: Vector3Tuple = [
          closest.second[0] - closest.first[0],
          closest.second[1] - closest.first[1],
          closest.second[2] - closest.first[2],
        ];
        const firstBounds = firstNode ? inspectionFor(firstNode).world_bounds : null;
        const secondBounds = secondNode ? inspectionFor(secondNode).world_bounds : null;
        return {
          label: measurement.label ?? null,
          coordinate_space: "world",
          unit: "Blockbench model unit",
          method,
          first: {
            request: measurement.first,
            resolved_point: cleanTuple(closest.first),
          },
          second: {
            request: measurement.second,
            resolved_point: cleanTuple(closest.second),
          },
          distance: Number(closest.distance.toFixed(6)),
          signed_axis_delta: cleanTuple(delta),
          absolute_axis_delta: cleanTuple(delta.map(Math.abs) as Vector3Tuple),
          bounds_relation: firstBounds && secondBounds
            ? analyzeBoundsPair(firstBounds, secondBounds, tolerance)
            : null,
        };
      });

      const resolveAngleVector = (request: AngleVector) => {
        if (request.kind === "vector") {
          const raw = [...request.vector] as Vector3Tuple;
          return { raw, source: request, ambiguous: false };
        }
        if (request.kind === "points") {
          const raw: Vector3Tuple = [
            request.to[0] - request.from[0],
            request.to[1] - request.from[1],
            request.to[2] - request.from[2],
          ];
          return { raw, source: request, ambiguous: false };
        }
        const node = resolveNode(request.element);
        const axis = principalAxis(geometryFor(node).vertices);
        if (!axis) {
          throw new Error(
            `Element "${node.name}" (${node.uuid}) has no measurable long axis.`
          );
        }
        return {
          raw: axis.direction,
          source: {
            ...request,
            resolved_element: { name: node.name, uuid: node.uuid },
            extent: Number(axis.extent.toFixed(6)),
          },
          ambiguous: axis.ambiguous,
        };
      };

      type AngleMeasurement = z.infer<typeof angleMeasurementSchema>;
      const measuredAngles = (angles as AngleMeasurement[]).map((measurement) => {
        const first = resolveAngleVector(measurement.first);
        const second = resolveAngleVector(measurement.second);
        const value = angleBetweenVectors(
          first.raw,
          second.raw,
          measurement.orientation === "undirected"
        );
        return {
          label: measurement.label ?? null,
          coordinate_space: "world",
          orientation: measurement.orientation,
          first: {
            source: first.source,
            normalized_vector: cleanTuple(normalizeVector(first.raw)),
            long_axis_ambiguous: first.ambiguous,
          },
          second: {
            source: second.source,
            normalized_vector: cleanTuple(normalizeVector(second.raw)),
            long_axis_ambiguous: second.ambiguous,
          },
          angle_degrees: Number(value.degrees.toFixed(6)),
          angle_radians: Number(value.radians.toFixed(9)),
          normalized_dot: Number(value.dot.toFixed(9)),
          warning: first.ambiguous || second.ambiguous
            ? "At least one geometry has no unique principal long axis; interpret this angle cautiously."
            : null,
        };
      });

      return JSON.stringify({
        coordinate_space: "world",
        unit: "Blockbench model unit",
        tolerance,
        elements: measuredElements,
        distances: measuredDistances,
        angles: measuredAngles,
      }, null, 2);
    },
  }, spatialToolDocs[1].status);

  createInternalTool(spatialToolDocs[2].name, {
    ...spatialToolDocs[2],
    async execute({ pairs, max_triangle_comparisons, max_results_per_pair }) {
      type CoplanarPair = z.infer<typeof coplanarPairSchema>;
      const results = (pairs as CoplanarPair[]).map((pair) => {
        const firstNode = findElementOrThrow(pair.first) as InspectableNode;
        const secondNode = findElementOrThrow(pair.second) as InspectableNode;
        const firstGeometry = extractNodeGeometry(firstNode);
        const secondGeometry = extractNodeGeometry(secondNode);
        const analysis = findCoplanarTriangleOverlaps(
          firstGeometry.triangles,
          secondGeometry.triangles,
          {
            distanceTolerance: pair.distance_tolerance,
            angleToleranceDegrees: pair.angle_tolerance_degrees,
            minimumOverlapArea: pair.minimum_overlap_area,
            maxComparisons: max_triangle_comparisons,
            maxResults: max_results_per_pair,
          }
        );
        const firstBounds = inspectNode(firstNode).world_bounds;
        const secondBounds = inspectNode(secondNode).world_bounds;
        const boundsRelation = firstBounds && secondBounds
          ? analyzeBoundsPair(firstBounds, secondBounds, pair.distance_tolerance)
          : null;
        const volumeOverlap = Boolean(
          boundsRelation &&
          Object.values(boundsRelation.axes).every(
            (axis) => axis.penetration_depth > pair.distance_tolerance
          )
        );
        return {
          first: { uuid: firstNode.uuid, name: firstNode.name },
          second: { uuid: secondNode.uuid, name: secondNode.name },
          triangle_counts: {
            first: firstGeometry.triangles.length,
            second: secondGeometry.triangles.length,
          },
          comparisons: analysis.comparisons,
          truncated_by_work_limit: analysis.work_limit_reached,
          truncated_by_result_limit: analysis.result_limit_reached,
          reported_coplanar_overlap_count: analysis.overlaps.length,
          z_fighting_risk: analysis.overlaps.length > 0,
          bounds_volume_overlap: volumeOverlap,
          overlaps: analysis.overlaps.map((overlap) => ({
            ...overlap,
            overlap_area: Number(overlap.overlap_area.toFixed(9)),
            maximum_plane_offset: Number(overlap.maximum_plane_offset.toFixed(9)),
            normal: cleanTuple(overlap.normal),
          })),
        };
      });
      return JSON.stringify({
        coordinate_space: "world",
        unit: "Blockbench model unit",
        note:
          "z_fighting_risk requires overlapping coplanar rendered surfaces. bounds_volume_overlap is separate and may be intentional.",
        results,
      }, null, 2);
    },
  }, spatialToolDocs[2].status);

  createToolGroup(spatialPublicToolDocs[0], geometryInspectionOperations);
}
