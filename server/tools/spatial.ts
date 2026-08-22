/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { findElementOrThrow } from "@/lib/util";
import {
  analyzeBoundsPair,
  type Bounds3,
  type Vector3Tuple,
} from "@/lib/spatialRelations";
import { expandOutlinerGeometryWorldBounds } from "@/lib/sceneBounds";

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
];

type InspectableNode = OutlinerElement | Group;

function tuple(vector: THREE.Vector3): Vector3Tuple {
  return [
    Number(vector.x.toFixed(6)),
    Number(vector.y.toFixed(6)),
    Number(vector.z.toFixed(6)),
  ];
}

function inspectNode(node: InspectableNode) {
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
  createTool(spatialToolDocs[0].name, {
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
}
