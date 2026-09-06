/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { findElementOrThrow, imageContent, withTemporaryAnimationPose } from "@/lib/util";
import { type InspectableGeometryNode } from "@/lib/sceneGeometry";
import { analyzeUvIntegrity } from "@/lib/uvIntegrity";
import { getValidationSnapshot, MAX_VALIDATION_SNAPSHOTS_PER_PROJECT, storeValidationSnapshot } from "@/lib/validationSnapshots";
import { resolveUniqueReference } from "@/lib/modelSafety";
import { analyzeModelContactsParameters, inspectUvIntegrityParameters, createValidationSnapshotParameters, diffValidationSnapshotParameters, captureValidationViewsParameters, sweepAnimationValidationParameters } from "@/src/features/validation/schemas";
import { assertContactWorkBounded, analyzeContactRequest, validatePoseSample, geometryBounds, mergeEnvelope } from "@/src/features/validation/modelChecks";
import { resolveNodes, uvRecordsForElements } from "@/src/features/validation/geometry";
import { collectValidationState, type ValidationSnapshotValue, publicState, diffStates } from "@/src/features/validation/snapshots";
import { suiteViews, validationViewRenderCount, MAX_VALIDATION_VIEW_RENDERS, MAX_VALIDATION_RENDER_PIXELS, MAX_VALIDATION_OUTPUT_PIXELS, boundsForNodes, cameraForValidationView, captureViewEvidence } from "@/src/features/validation/views";

const MAX_UV_FACE_RECORDS = 2_000;

export const validationTools: ToolDefinition[] = [
  defineTool({
    name: "analyze_model_contacts",
    description: "Performs exact transformed OBB SAT for cube pairs and bounded triangle-BVH analysis for mesh pairs, including descendant pairs and explicit uncertainty.",
    annotations: { title: "Analyze Model Contacts", readOnlyHint: true },
    parameters: analyzeModelContactsParameters,
    status: STATUS_EXPERIMENTAL,
    async execute({ pairs, max_triangle_comparisons }: z.infer<typeof analyzeModelContactsParameters>, context) {
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
    }
  }),
  defineTool({
    name: "inspect_uv_integrity",
    description: "Inventories typed face UVs and detects mapping, bounds, sharing, overlap, mirror, pixel-footprint, and texel-density problems.",
    annotations: { title: "Inspect UV Integrity", readOnlyHint: true },
    parameters: inspectUvIntegrityParameters,
    status: STATUS_EXPERIMENTAL,
    async execute({ elements, expected_sharing, authorized_pixel_regions, texel_density_ratio_warning }, context) {
      const project = context.project!;
      const selected = elements.length
        ? resolveNodes(elements)
        : project.elements as InspectableGeometryNode[];
      const records = uvRecordsForElements(project, selected);
      if (records.length > MAX_UV_FACE_RECORDS) {
        throw new Error(`UV inspection expands to ${records.length} faces; the limit is ${MAX_UV_FACE_RECORDS}. Narrow the elements list.`);
      }
      return JSON.stringify({
        schema_version: "1",
        project: { uuid: project.uuid, name: project.name },
        coordinate_space: "texture_uv",
        ...analyzeUvIntegrity(records, {
          expected_sharing,
          authorized_pixel_regions: authorized_pixel_regions.map(({ texture_uuid, rectangle }) => ({
            texture_uuid,
            rectangle: [rectangle[0], rectangle[1], rectangle[2], rectangle[3]],
          })),
          texel_density_ratio_warning,
        }),
      }, null, 2);
    }
  }),
  defineTool({
    name: "create_validation_snapshot",
    description: "Creates an in-memory read-only evidence snapshot with component digests; it is not a save or model checkpoint, and each project retains its latest eight snapshots.",
    annotations: { title: "Create Validation Snapshot", readOnlyHint: true },
    parameters: createValidationSnapshotParameters,
    status: STATUS_EXPERIMENTAL,
    async execute(input, context) {
      const project = context.project!;
      const state = collectValidationState(project, input);
      const normalizedInput = {
        ...input,
        targets: state.target_uuids,
        neighbors: state.neighbor_uuids,
      };
      const stored = storeValidationSnapshot(project.uuid, state.root_digest, { input: normalizedInput, state } satisfies ValidationSnapshotValue);
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
    }
  }),
  defineTool({
    name: "diff_validation_snapshot",
    description: "Diffs current transforms, geometry, UVs, textures, camera, and pose against a validation snapshot and identifies stale evidence.",
    annotations: { title: "Diff Validation Snapshot", readOnlyHint: true },
    parameters: diffValidationSnapshotParameters,
    status: STATUS_EXPERIMENTAL,
    async execute({ snapshot_id, authorized_pixel_regions }, context) {
      const project = context.project!;
      const stored = getValidationSnapshot<ValidationSnapshotValue>(snapshot_id, project.uuid);
      const current = collectValidationState(project, stored.value.input, true);
      return JSON.stringify({
        schema_version: "1",
        snapshot_id: stored.id,
        created_at: stored.created_at,
        ...diffStates(stored.value.state, current, authorized_pixel_regions),
        current_state: publicState(current),
      }, null, 2);
    }
  }),
  defineTool({
    name: "capture_validation_views",
    description: "Auto-frames repeatable named views and clone-only color/debug passes with exact camera metadata, pixel coverage, and occluder IDs.",
    annotations: { title: "Capture Validation Views", readOnlyHint: true },
    parameters: captureValidationViewsParameters,
    status: STATUS_EXPERIMENTAL,
    async execute({ target: targetReference, context_elements, suite, views, width, height }: z.infer<typeof captureValidationViewsParameters>, context) {
      const project = context.project!;
      const target = findElementOrThrow(targetReference) as InspectableGeometryNode;
      const contexts = resolveNodes(context_elements);
      const configuredViews = suiteViews(suite, views);
      const names = new Set<string>();
      for (const view of configuredViews) {
        if (names.has(view.name))
          throw new Error(`Validation view name '${view.name}' is duplicated.`);
        names.add(view.name);
      }
      const renderCount = validationViewRenderCount(configuredViews, contexts.length > 0);
      const outputPixels = configuredViews.reduce((total, view) => total + view.passes.length, 0)
        * width * height;
      if (renderCount > MAX_VALIDATION_VIEW_RENDERS
        || renderCount * width * height > MAX_VALIDATION_RENDER_PIXELS
        || outputPixels > MAX_VALIDATION_OUTPUT_PIXELS) {
        throw new Error(`The requested validation suite needs ${renderCount} renders and exceeds the bounded render budget. ` +
          "Reduce views, passes, or resolution.");
      }
      const framedBounds = boundsForNodes([target, ...contexts]);
      const imageItems: Array<{
        type: "image";
        data: string;
        mimeType: string;
      }> = [];
      const viewResults = [];
      for (const view of configuredViews) {
        const camera = cameraForValidationView(view, framedBounds, [width, height]);
        const evidence = await captureViewEvidence(project, target, contexts, view, camera, width, height);
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
    }
  }),
  defineTool({
    name: "sweep_animation_validation",
    description: "Samples native animation poses offscreen, runs selected contact/hierarchy/bounds checks, reports first failure and motion envelopes, and restores preview state on every path.",
    annotations: { title: "Sweep Animation Validation", readOnlyHint: true },
    parameters: sweepAnimationValidationParameters,
    status: STATUS_EXPERIMENTAL,
    async execute(input: z.infer<typeof sweepAnimationValidationParameters>, context) {
      const project = context.project!;
      const animation = resolveUniqueReference(input.animation, project.animations, "Animation", "inspect_animation");
      const requestedSamples = [...input.samples];
      if (input.include_loop_boundary) {
        requestedSamples.push(0, animation.length);
      }
      const samples = [...new Set(requestedSamples.map((value) => value === "rest" ? value : Number(value.toFixed(9))))];
      assertContactWorkBounded(input.contacts, input.max_triangle_comparisons, samples.length);
      const envelopeNodes = resolveNodes(input.envelope_elements);
      const envelopes = new Map<string, {
        element: {
          uuid: string;
          name: string;
        };
        min: [
          number,
          number,
          number
        ];
        max: [
          number,
          number,
          number
        ];
      }>();
      const results = [];
      let firstFailure: {
        sample: number | "rest";
        failures: unknown[];
      } | null = null;
      for (const sample of samples) {
        const result = withTemporaryAnimationPose(project, sample === "rest" ? null : animation.uuid, sample === "rest" ? null : sample, () => {
          const checks = validatePoseSample(input, input.max_triangle_comparisons);
          const sampleBounds = envelopeNodes.map((node) => ({ node, bounds: geometryBounds(node) }));
          return { checks, sampleBounds };
        });
        for (const entry of result.sampleBounds) {
          if (!entry.bounds)
            continue;
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
          if (input.stop_on_first_failure)
            break;
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
    }
  })
];
