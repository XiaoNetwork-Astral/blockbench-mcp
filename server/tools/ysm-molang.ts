/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createInternalTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import { discoverYsmDocuments, inventoryYsmMolangExpressions } from "@/lib/ysmMolangDocuments";
import { editYsmMolangExpressions } from "@/lib/ysmMolangEditing";
import { parseMolang } from "@/lib/molang/parser";
import {
  getMolangCatalogProvenance,
  getMolangCatalogSourceFiles,
  listMolangCatalog,
  validateMolangSemantics,
} from "@/lib/molang/catalog";
import {
  evaluateMolang,
  type MolangEvaluationOptions,
  type MolangEvaluatorState,
} from "@/lib/molang/evaluator";
import type { MolangDiagnostic, MolangDialect, MolangValue } from "@/lib/molang/types";
import {
  getYsmBinding,
  getYsmBindingWorkspaceState,
  setYsmBinding,
} from "@/lib/ysmBindings";
import { getPluginWorkspaceRoot } from "@/lib/pluginWorkspace";
import {
  captureOffscreenValidationPass,
  getEffectiveCameraState,
  imageContent,
} from "@/lib/util";

const dialectSchema = z
  .enum(["stable_2_6_5", "dev_3_0_experimental"])
  .optional()
  .default("stable_2_6_5");

const molangValueSchema: z.ZodType<MolangValue> = z.lazy(() =>
  z.union([
    z.number().finite(),
    z.boolean(),
    z.string(),
    z.null(),
    z.array(molangValueSchema),
    z.record(molangValueSchema),
  ])
);

const physicsStateSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("first_order"),
    input: z.number().finite(),
    response: z.number().finite(),
    last_simulation: z.number().finite(),
  }).strict(),
  z.object({
    kind: z.literal("second_order"),
    input: z.number().finite(),
    frequency: z.number().finite(),
    coefficient: z.number().finite(),
    response: z.number().finite(),
    input_function: z.number().finite(),
    last_simulation: z.number().finite(),
    last_simulation_dot: z.number().finite(),
  }).strict(),
]);

const evaluatorStateSchema = z.object({
  variables: z.record(molangValueSchema),
  temp: z.record(molangValueSchema),
  physics: z.record(physicsStateSchema),
  random_state: z.number().int().min(0).max(0xffffffff),
}).strict();

const bindingsSchema = z
  .record(molangValueSchema)
  .optional()
  .default({})
  .describe(
    "Runtime bindings as nested objects or flat dotted paths. A flat dotted entry overrides the equivalent nested value."
  );

const paginationSchema = {
  cursor: z.string().max(64).optional().describe("Opaque cursor returned by the previous page."),
  limit: z.number().int().min(1).max(500).optional().default(100),
};

export const ysmDiscoverDocumentsParameters = z.object({
  manifest: z.string().min(1).optional().default("ysm.json"),
}).strict();

export const ysmListMolangExpressionsParameters = z.object({
  manifest: z.string().min(1).optional().default("ysm.json"),
  file: z.string().min(1).optional(),
  document_kind: z.enum([
    "manifest", "geometry", "animation", "controller", "function", "texture", "other",
  ]).optional(),
  expression_kind: z.enum([
    "animation_transform", "animation_weight", "animation_timing", "timeline",
    "controller_transition", "controller_script", "controller_weight", "function",
  ]).optional(),
  bone: z.string().optional(),
  ...paginationSchema,
}).strict();

export const ysmGetMolangCatalogParameters = z.object({
  dialect: dialectSchema,
  namespace: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  kind: z.enum(["function", "variable", "namespace"]).optional(),
  runtime_availability: z.enum(["all", "standalone", "runtime_only"]).optional().default("all"),
  include_source_files: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include one explicitly paginated page of source-file provenance for the selected dialect."),
  source_cursor: z.string().max(64).optional(),
  source_limit: z.number().int().min(1).max(100).optional().default(50),
  ...paginationSchema,
}).strict();

export const ysmParseMolangParameters = z.object({
  expression: z.string().max(262_144),
  dialect: dialectSchema,
  include_tokens: z.boolean().optional().default(true),
}).strict();

export const ysmValidateMolangParameters = z.object({
  expression: z.string().max(262_144).optional(),
  manifest: z.string().min(1).optional().default("ysm.json"),
  expression_id: z.string().length(64).optional(),
  dialect: dialectSchema,
  bindings: bindingsSchema,
  function_results: z.record(molangValueSchema).optional().default({}),
}).strict().refine(
  ({ expression, expression_id }) => Boolean(expression) !== Boolean(expression_id),
  { message: "Provide exactly one of expression or expression_id." }
);

const simulationStepSchema = z.object({
  delta_seconds: z.number().finite().min(0).max(60),
  bindings: z
    .record(molangValueSchema)
    .optional()
    .describe(
      "Per-step bindings as nested objects or flat dotted paths. A flat dotted entry overrides the equivalent nested value."
    ),
}).strict();

export const ysmSimulateMolangParameters = z.object({
  expression: z.string().max(262_144),
  dialect: dialectSchema,
  seed: z.number().int().min(0).max(0xffffffff).optional().default(0x6d2b79f5),
  bindings: bindingsSchema,
  variables: z.record(molangValueSchema).optional().default({}),
  temp: z.record(molangValueSchema).optional().default({}),
  context: z.record(molangValueSchema).optional().default({}),
  function_results: z.record(molangValueSchema).optional().default({}),
  user_functions: z.record(z.string().max(262_144)).optional().default({}),
  initial_state: evaluatorStateSchema.optional(),
  steps: z.array(simulationStepSchema).min(1).max(4096),
}).strict();

export const ysmPreviewMolangParameters = ysmSimulateMolangParameters.extend({
  sample_stride: z.number().int().min(1).max(256).optional().default(1),
  pose_mapping: z.object({
    bone: z.string().min(1),
    channel: z.enum(["rotation", "position", "scale"]),
    axis: z.enum(["x", "y", "z"]),
    mode: z.enum(["add", "replace"]).optional().default("add"),
    sample_index: z.number().int().min(0).optional(),
  }).strict().optional(),
  width: z.number().int().min(64).max(1600).optional().default(800),
  height: z.number().int().min(64).max(1200).optional().default(600),
}).strict();

const molangEditSchema = z.object({
  operation: z.enum(["create", "replace", "remove"]),
  expression_id: z
    .string()
    .length(64)
    .optional()
    .describe("Current ID from ysm_list_molang_expressions; required for replace and remove."),
  json_pointer: z
    .string()
    .optional()
    .describe("Target JSON pointer. Required when creating a new expression."),
  value: z.union([z.string().max(262_144), z.number().finite()]).optional(),
}).strict().refine(
  ({ operation, expression_id, json_pointer }) =>
    operation === "create" ? json_pointer !== undefined : Boolean(expression_id),
  { message: "Create requires json_pointer; replace and remove require a current expression_id." }
);

const ysmMolangEditParameters = z.object({
  manifest: z.string().min(1).optional().default("ysm.json"),
  file: z.string().min(1),
  dialect: dialectSchema,
  edits: z.array(molangEditSchema).min(1).max(64),
}).strict();

export const previewYsmMolangEditsParameters = ysmMolangEditParameters;
export const editYsmMolangParameters = ysmMolangEditParameters;

export const ysmMolangReadToolDocs: ToolSpec[] = [
  {
    name: "ysm_discover_documents",
    description: "Discovers the manifest and referenced Molang-bearing YSM sidecars without rewriting them.",
    project: "none",
    annotations: { title: "Discover YSM Documents", readOnlyHint: true, openWorldHint: true },
    parameters: ysmDiscoverDocumentsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "ysm_list_molang_expressions",
    description: "Inventories exact Molang locations, owners, source ranges, and hashes in a YSM package.",
    project: "none",
    annotations: { title: "List YSM Molang Expressions", readOnlyHint: true, openWorldHint: true },
    parameters: ysmListMolangExpressionsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "ysm_get_molang_catalog",
    description: "Queries the source-derived OpenYSM Molang symbol catalog and its audited provenance.",
    project: "none",
    annotations: { title: "Get YSM Molang Catalog", readOnlyHint: true },
    parameters: ysmGetMolangCatalogParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "ysm_parse_molang",
    description: "Tokenizes and parses the audited YSM Molang grammar with source ranges and diagnostics.",
    project: "none",
    annotations: { title: "Parse YSM Molang", readOnlyHint: true },
    parameters: ysmParseMolangParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "ysm_validate_molang",
    description: "Validates syntax, source-backed symbols and arity, runtime availability, and inventoried bone ownership.",
    project: "optional",
    annotations: { title: "Validate YSM Molang", readOnlyHint: true, openWorldHint: true },
    parameters: ysmValidateMolangParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "ysm_simulate_molang",
    description: "Evaluates a deterministic sequence with explicit bindings, timestep, and serializable state.",
    project: "none",
    annotations: { title: "Simulate YSM Molang", readOnlyHint: true },
    parameters: ysmSimulateMolangParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "ysm_preview_molang",
    description: "Produces a bounded clone-safe Molang sample trace; it never changes saved model or visible editor state.",
    project: "optional",
    annotations: { title: "Preview YSM Molang", readOnlyHint: true },
    parameters: ysmPreviewMolangParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

export const ysmMolangEditToolDocs: ToolSpec[] = [
  {
    name: "preview_ysm_molang_edits",
    description: "Previews targeted Molang JSONC edits without writing the file.",
    project: "none",
    annotations: { title: "Preview YSM Molang Edits", readOnlyHint: true, openWorldHint: true },
    parameters: previewYsmMolangEditsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "edit_ysm_molang",
    description: "Atomically applies targeted Molang JSONC edits after a successful preview.",
    project: "none",
    annotations: { title: "Edit YSM Molang", destructiveHint: true, openWorldHint: true },
    parameters: editYsmMolangParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

function cursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const match = /^offset:([0-9]+)$/.exec(cursor);
  if (!match) throw new Error("Invalid pagination cursor. Use the exact cursor returned by this action.");
  return Number(match[1]);
}

function page<T>(items: T[], cursor: string | undefined, limit: number) {
  const offset = cursorOffset(cursor);
  if (offset > items.length) throw new Error("Pagination cursor is beyond the current result set.");
  const values = items.slice(offset, offset + limit);
  const next = offset + values.length;
  return {
    items: values,
    cursor: offset,
    next_cursor: next < items.length ? `offset:${next}` : null,
    total: items.length,
  };
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function suppliedBindingPaths(bindings: Record<string, MolangValue>): string[] {
  const paths: string[] = [];
  const visit = (path: string, value: MolangValue): void => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) return;
      entries.forEach(([key, child]) => visit(`${path}.${key.toLowerCase()}`, child));
      return;
    }
    paths.push(path.toLowerCase());
  };
  Object.entries(bindings).forEach(([root, value]) => visit(root.toLowerCase(), value));
  return paths;
}

function resolveValidationExpression(
  expression: string | undefined,
  expressionId: string | undefined,
  manifest: string
) {
  if (expression !== undefined) return { source: expression, inventoried: null };
  const inventory = inventoryYsmMolangExpressions(manifest);
  const matches = inventory.expressions.filter((candidate) => candidate.expression_id === expressionId);
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? `Expression ID '${expressionId}' is not current. Re-inventory the manifest.`
      : `Expression ID '${expressionId}' is ambiguous.`);
  }
  return { source: matches[0].decoded, inventoried: matches[0] };
}

function projectBoneDiagnostics(
  project: ModelProject | null,
  bone: string | null
): MolangDiagnostic[] {
  if (!bone || !project) return [];
  const matches = project.groups.filter((group) => group.name === bone || group.uuid === bone);
  if (matches.length === 1) return [];
  return [{
    code: matches.length === 0 ? "YSM_UNKNOWN_BONE" : "YSM_AMBIGUOUS_BONE",
    severity: "error",
    message: matches.length === 0
      ? `Animation channel references bone '${bone}', which is absent from project '${project.name}'.`
      : `Animation channel bone '${bone}' is ambiguous in project '${project.name}'.`,
    range: { start: 0, end: 0, line: 1, column: 1 },
    source: "workspace",
  }];
}

interface SimulationInput {
  expression: string;
  dialect: MolangDialect;
  seed: number;
  bindings: Record<string, MolangValue>;
  variables: Record<string, MolangValue>;
  temp: Record<string, MolangValue>;
  context: Record<string, MolangValue>;
  function_results: Record<string, MolangValue>;
  user_functions: Record<string, string>;
  initial_state?: MolangEvaluatorState;
  steps: Array<{ delta_seconds: number; bindings?: Record<string, MolangValue> }>;
}

function simulate(input: SimulationInput) {
  let state = input.initial_state;
  const samples = [];
  let stoppedEarly: { reason: "operation_limit"; step_index: number } | null = null;
  for (const [index, step] of input.steps.entries()) {
    const options: MolangEvaluationOptions = {
      dialect: input.dialect,
      seed: input.seed,
      bindings: { ...input.bindings, ...(step.bindings ?? {}) },
      variables: input.variables,
      temp: input.temp,
      context: input.context,
      function_results: input.function_results,
      user_functions: input.user_functions,
      initial_state: state,
      delta_seconds: step.delta_seconds,
    };
    const result = evaluateMolang(input.expression, options);
    state = result.state;
    samples.push({
      index,
      delta_seconds: step.delta_seconds,
      value: result.value,
      diagnostics: result.diagnostics,
      state: result.state,
    });
    if (result.diagnostics.some((item) => item.code === "MOLANG_OPERATION_LIMIT")) {
      stoppedEarly = { reason: "operation_limit", step_index: index };
      break;
    }
  }
  return {
    schema_version: "1",
    dialect: input.dialect,
    expression: input.expression,
    deterministic: true,
    samples,
    requested_step_count: input.steps.length,
    evaluated_step_count: samples.length,
    stopped_early: stoppedEarly,
    final_state: state ?? null,
  };
}

function refreshBindingsAfterMolangEdit(manifest: string): Array<{ project_uuid: string; project_name: string }> {
  const discovery = discoverYsmDocuments(manifest);
  const molangDocuments = discovery.documents.flatMap((document) => {
    if (
      !document.exists
      || !document.sha256
      || !["manifest", "animation", "controller", "function"].includes(document.kind)
    ) return [];
    return [{
      path: document.path,
      kind: document.kind as "manifest" | "animation" | "controller" | "function",
      sha256: document.sha256,
    }];
  });
  const refreshed: Array<{ project_uuid: string; project_name: string }> = [];
  for (const project of ModelProject.all) {
    const binding = getYsmBinding(project);
    if (
      !binding ||
      binding.manifest !== manifest ||
      getYsmBindingWorkspaceState(binding, getPluginWorkspaceRoot()) !== "current"
    ) continue;
    setYsmBinding(project, {
      ...binding,
      manifestSha256: discovery.manifest.sha256,
      molangDocuments,
      updatedAt: new Date().toISOString(),
    });
    refreshed.push({ project_uuid: project.uuid, project_name: project.name });
  }
  return refreshed;
}

export function registerYsmMolangOperations(): void {
  createInternalTool(ysmMolangReadToolDocs[0].name, {
    ...ysmMolangReadToolDocs[0],
    async execute({ manifest }) {
      return json(discoverYsmDocuments(manifest));
    },
  }, ysmMolangReadToolDocs[0].status);

  createInternalTool(ysmMolangReadToolDocs[1].name, {
    ...ysmMolangReadToolDocs[1],
    async execute({ manifest, file, document_kind, expression_kind, bone, cursor, limit }) {
      const inventory = inventoryYsmMolangExpressions(manifest);
      const expressions = inventory.expressions.filter((item) =>
        (!file || item.file === file)
        && (!document_kind || item.document_kind === document_kind)
        && (!expression_kind || item.expression_kind === expression_kind)
        && (!bone || item.owner.bone === bone)
      );
      return json({
        schema_version: "1",
        manifest: inventory.discovery.manifest,
        diagnostics: inventory.diagnostics,
        ...page(expressions, cursor, limit),
      });
    },
  }, ysmMolangReadToolDocs[1].status);

  createInternalTool(ysmMolangReadToolDocs[2].name, {
    ...ysmMolangReadToolDocs[2],
    async execute({
      dialect,
      namespace,
      name,
      kind,
      runtime_availability,
      include_source_files,
      source_cursor,
      source_limit,
      cursor,
      limit,
    }) {
      const loweredName = name?.toLocaleLowerCase();
      const entries = listMolangCatalog(dialect, namespace?.toLocaleLowerCase()).filter((entry) =>
        (!loweredName || entry.name === loweredName)
        && (!kind || entry.kind === kind)
        && (runtime_availability === "all"
          || (runtime_availability === "runtime_only" ? entry.runtime_only : !entry.runtime_only))
      );
      return json({
        schema_version: "1",
        dialect,
        provenance: getMolangCatalogProvenance(dialect),
        source_files: include_source_files
          ? page(getMolangCatalogSourceFiles(dialect), source_cursor, source_limit)
          : undefined,
        ...page(entries, cursor, limit),
      });
    },
  }, ysmMolangReadToolDocs[2].status);

  createInternalTool(ysmMolangReadToolDocs[3].name, {
    ...ysmMolangReadToolDocs[3],
    async execute({ expression, dialect, include_tokens }) {
      const parsed = parseMolang(expression);
      return json({
        schema_version: "1",
        dialect,
        source: expression,
        ast: parsed.ast,
        tokens: include_tokens ? parsed.tokens : undefined,
        diagnostics: validateMolangSemantics(parsed, dialect),
      });
    },
  }, ysmMolangReadToolDocs[3].status);

  createInternalTool(ysmMolangReadToolDocs[4].name, {
    ...ysmMolangReadToolDocs[4],
    async execute({ expression, expression_id, manifest, dialect, bindings, function_results }, context) {
      const resolved = resolveValidationExpression(expression, expression_id, manifest);
      const parsed = parseMolang(resolved.source);
      const diagnostics = validateMolangSemantics(parsed, dialect, {
        report_runtime_availability: true,
        available_binding_paths: suppliedBindingPaths(bindings),
        available_function_results: Object.keys(function_results),
      });
      diagnostics.push(...projectBoneDiagnostics(context.project, resolved.inventoried?.owner.bone ?? null));
      return json({
        schema_version: "1",
        dialect,
        valid: !diagnostics.some((item) => item.severity === "error"),
        source: resolved.source,
        inventory: resolved.inventoried,
        supplied_binding_roots: Object.keys(bindings).sort(),
        supplied_function_results: Object.keys(function_results).sort(),
        diagnostics,
      });
    },
  }, ysmMolangReadToolDocs[4].status);

  createInternalTool(ysmMolangReadToolDocs[5].name, {
    ...ysmMolangReadToolDocs[5],
    async execute(input) {
      return json(simulate(input as SimulationInput));
    },
  }, ysmMolangReadToolDocs[5].status);

  createInternalTool(ysmMolangReadToolDocs[6].name, {
    ...ysmMolangReadToolDocs[6],
    async execute(input, context) {
      const result = simulate(input as SimulationInput);
      const stride = input.sample_stride;
      const preview = {
        ...result,
        samples: result.samples.filter((_, index) => index % stride === 0 || index === result.samples.length - 1),
        preview_scope: {
          clone_only: true,
          visible_editor_state_changed: false,
          saved_model_changed: false,
          visual_pose: input.pose_mapping ? "requested" : null,
          limitation: input.pose_mapping
            ? null
            : "No pose_mapping was supplied, so this preview contains only the deterministic sampled trace.",
        },
      };
      if (!input.pose_mapping) return json(preview);
      const project = context.project;
      if (!project) throw new Error("Visual Molang pose mapping requires a visible project.");
      const matches = project.groups.filter((group) =>
        group.uuid === input.pose_mapping!.bone || group.name === input.pose_mapping!.bone
      );
      if (matches.length !== 1) {
        throw new Error(matches.length === 0
          ? `Visual preview bone '${input.pose_mapping.bone}' was not found.`
          : `Visual preview bone '${input.pose_mapping.bone}' is ambiguous; use an exact UUID.`);
      }
      const sampleIndex = input.pose_mapping.sample_index ?? result.samples.length - 1;
      const sample = result.samples[sampleIndex];
      if (!sample) throw new Error(`pose_mapping.sample_index ${sampleIndex} is outside the simulated sequence.`);
      if (typeof sample.value !== "number" || !Number.isFinite(sample.value)) {
        throw new Error("The selected Molang sample is not a finite number and cannot drive a bone component.");
      }
      const camera = getEffectiveCameraState(project, [input.width, input.height]);
      const capture = await captureOffscreenValidationPass(
        project,
        camera,
        input.width,
        input.height,
        {
          pass: "color",
          cloneTransforms: [{
            nodeId: matches[0].uuid,
            channel: input.pose_mapping.channel,
            axis: input.pose_mapping.axis,
            value: sample.value,
            mode: input.pose_mapping.mode,
          }],
        }
      );
      const structured = {
        ...preview,
        project: { uuid: project.uuid, name: project.name },
        camera,
        pose_mapping: {
          ...input.pose_mapping,
          bone_uuid: matches[0].uuid,
          bone_name: matches[0].name,
          sampled_value: sample.value,
        },
        preview_scope: {
          ...preview.preview_scope,
          visual_pose: "rendered_clone",
        },
      };
      return {
        content: [
          { type: "text" as const, text: json(structured) },
          ...imageContent(capture.data_url, "image/png").content,
        ],
        structuredContent: structured,
      };
    },
  }, ysmMolangReadToolDocs[6].status);

  createInternalTool(ysmMolangEditToolDocs[0].name, {
    ...ysmMolangEditToolDocs[0],
    async execute(input) {
      const result = editYsmMolangExpressions({ ...input, dry_run: true });
      return json({
        ...result,
        refreshed_bindings: [],
      });
    },
  }, ysmMolangEditToolDocs[0].status);

  createInternalTool(ysmMolangEditToolDocs[1].name, {
    ...ysmMolangEditToolDocs[1],
    async execute(input) {
      const result = editYsmMolangExpressions({ ...input, dry_run: false });
      return json({
        ...result,
        refreshed_bindings: refreshBindingsAfterMolangEdit(input.manifest),
      });
    },
  }, ysmMolangEditToolDocs[1].status);
}
