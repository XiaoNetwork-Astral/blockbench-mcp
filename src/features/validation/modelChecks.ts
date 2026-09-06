/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { findElementOrThrow } from "@/lib/util";
import { ancestorTransformProvenance, extractNodeGeometry, geometricDescendants, orientedBoxFromNode, type InspectableGeometryNode } from "@/lib/sceneGeometry";
import { analyzeOrientedBoxContact } from "@/lib/contactAnalysis";
import { closestPointsBetweenTriangleSetsBvh } from "@/lib/triangleBvh";
import { expectedContactSchema, contactPairSchema, sweepAnimationValidationParameters } from "@/src/features/validation/schemas";
import { midpoint, rounded, tuple } from "@/src/features/validation/geometry";

const MAX_DESCENDANT_CONTACT_PAIRS = 10_000;

const MAX_CONTACT_COMPARISON_CEILING = 25_000_000;

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

export function assertContactWorkBounded(
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

export function analyzeContactRequest(pair: ContactPairInput, maxTriangleComparisons: number) {
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

export function geometryBounds(node: InspectableGeometryNode) {
  const points = extractNodeGeometry(node).vertices;
  if (!points.length) return null;
  return {
    min: tuple([0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])))),
    max: tuple([0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])))),
  };
}

export function mergeEnvelope(
  previous: { min: [number, number, number]; max: [number, number, number] } | undefined,
  next: { min: [number, number, number]; max: [number, number, number] }
) {
  if (!previous) return { min: [...next.min] as [number, number, number], max: [...next.max] as [number, number, number] };
  return {
    min: tuple([0, 1, 2].map((axis) => Math.min(previous.min[axis], next.min[axis]))),
    max: tuple([0, 1, 2].map((axis) => Math.max(previous.max[axis], next.max[axis]))),
  };
}

export function validatePoseSample(
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
