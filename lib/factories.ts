import { z } from "zod";
import type { IMCPTool, IMCPPrompt, IMCPResource, StatusType } from "@/types";
import { getServer } from "@/server/server";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertAgentMayMutateProject } from "@/lib/projectRoles";
import { auditManager } from "@/lib/audit";
import { assertToolRegistrationAllowed } from "@/lib/security";
import {
  captureUndoEditToken,
  rollbackUndoEditStartedAfter,
} from "@/lib/undoSafety";
import {
  FOREGROUND_ONLY_OPERATIONS,
  PROJECT_CONTEXT_BYPASS_OPERATIONS,
  getForegroundProject,
  getSessionWorkingProjectId,
  requireSessionWorkingProject,
  runInProjectContext,
} from "@/lib/projectContext";

/**
 * Declarative tool spec for documentation and registration.
 * Contains everything except the `execute` implementation.
 */
export interface ToolSpec {
  name: string;
  description: string;
  annotations?: {
    title?: string;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    readOnlyHint?: boolean;
    openWorldHint?: boolean;
  };
  parameters: z.ZodType;
  outputSchema?: z.AnyZodObject;
  status: StatusType;
}

/**
 * Declarative prompt spec for documentation and registration.
 */
export interface PromptSpec {
  name: string;
  description: string;
  title?: string;
  argsSchema?: z.ZodObject<z.ZodRawShape>;
  status: StatusType;
}

/**
 * Declarative resource spec for documentation and registration.
 */
export interface ResourceSpec {
  name: string;
  description: string;
  uriTemplate: string;
  title?: string;
}

/**
 * User-visible list of tool details.
 */
export const tools: Record<string, IMCPTool> = {};

/**
 * User-visible list of prompt details.
 */
export const prompts: Record<string, IMCPPrompt> = {};

/**
 * User-visible list of resource details.
 */
export const resources: Record<string, IMCPResource> = {};

export interface ToolContext {
  reportProgress: (progress: { progress: number; total: number }) => void;
  sessionId?: string;
  /** Project owned by this MCP session for the current invocation. */
  project: ModelProject | null;
  /** Tab the user was viewing when the invocation began. */
  foregroundProject: ModelProject | null;
  /** Whether project and foregroundProject are different tabs. */
  background: boolean;
  /** Re-enter a project only for one synchronous callback after an await. */
  runInProject: <T>(callback: () => T, project?: ModelProject) => T;
}

interface TextContent {
  type: "text";
  text: string;
}

interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

type ToolContentItem = TextContent | ImageContent;

type ToolResult = string | { content: ToolContentItem[]; structuredContent?: unknown };

interface ToolDefinition {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodType>;
  outputSchema?: Record<string, z.ZodType> | z.ZodType;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  resolveMutationToolName?: (args: Record<string, unknown>) => string;
  annotations?: {
    title?: string;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
  };
}

interface ToolRegistrar {
  registerTool: (
    toolName: string,
    definition: {
      title: string;
      description: string;
      inputSchema: Record<string, z.ZodType>;
      outputSchema?: Record<string, z.ZodType>;
      annotations?: ToolDefinition["annotations"];
    },
    callback: (args: unknown, extra: unknown) => Promise<unknown>
  ) => void;
}

/**
 * Store tool definitions for dynamic server reconstruction
 */
const toolDefinitions: Record<string, ToolDefinition> = {};

interface ToolRequestExtra {
  sessionId?: string;
}

export type SessionIdProvider = () => string | undefined;

/** Attach the transport-owned MCP session id to one SDK tool callback. */
export function toolRequestExtraForSession(
  extra: unknown,
  getSessionId?: SessionIdProvider
): ToolRequestExtra {
  const requestExtra = (extra && typeof extra === "object"
    ? extra
    : {}) as ToolRequestExtra;
  const sessionId = getSessionId?.();
  return sessionId ? { ...requestExtra, sessionId } : requestExtra;
}

function normalizeToolResult(result: ToolResult): unknown {
  if (typeof result === "string") {
    return {
      content: [{ type: "text", text: result }],
    };
  }
  return result;
}

async function invokeTool(
  name: string,
  toolDef: ToolDefinition,
  args: Record<string, unknown>,
  extra: ToolRequestExtra
): Promise<unknown> {
  const readOnly = toolDef.annotations?.readOnlyHint === true;
  const operationName = toolDef.resolveMutationToolName?.(args) ?? name;
  const bypassProjectContext = PROJECT_CONTEXT_BYPASS_OPERATIONS.has(operationName);
  const foregroundProject = getForegroundProject();
  let project: ModelProject | null = foregroundProject;

  if (!bypassProjectContext) {
    // Import is also valid on Blockbench's empty start screen. Every other
    // project-scoped operation needs a real session binding.
    const emptyImport =
      operationName === "import_bedrock_geometry" &&
      !getSessionWorkingProjectId(extra.sessionId) &&
      !foregroundProject;
    project = emptyImport ? null : requireSessionWorkingProject(extra.sessionId);
  }

  if (
    project &&
    foregroundProject &&
    project !== foregroundProject &&
    FOREGROUND_ONLY_OPERATIONS.has(operationName)
  ) {
    throw new Error(
      `Action "${operationName}" still depends on Blockbench's visible paint/display UI. ` +
        `The MCP working project is "${project.name}" while the foreground tab is ` +
        `"${foregroundProject.name}". Show the working project explicitly before using this action; ` +
        "geometry, hierarchy, UV, animation-data, inspection, Undo, and viewport capture remain background-safe."
    );
  }

  const route = <T>(callback: () => T): T =>
    project && !bypassProjectContext
      ? runInProjectContext(project, callback)
      : callback();
  // Read-only tools cannot open an Undo edit, so sampling the edit token and
  // attempting rollback on failure only adds work to high-frequency queries.
  let undoEditAtStart: unknown;
  let handle: ReturnType<typeof auditManager.beginMcpOperation> | undefined;

  try {
    const execution = route(() => {
      undoEditAtStart = readOnly ? undefined : captureUndoEditToken();
      handle = auditManager.beginMcpOperation({
        toolName: operationName,
        title: toolDef.title,
        args,
        sessionId: extra.sessionId,
        readOnly,
      });
      const reportProgress: ToolContext["reportProgress"] = () => {};
      const context: ToolContext = {
        reportProgress,
        sessionId: extra.sessionId,
        project,
        foregroundProject,
        background: Boolean(project && foregroundProject && project !== foregroundProject),
        runInProject: <T>(callback: () => T, target = project ?? undefined): T => {
          if (!target) return callback();
          return runInProjectContext(target, callback);
        },
      };
      // A reference tab is writable only through the small explicit exemption
      // list. Tools must opt into read-only status; missing metadata never grants
      // mutation access by accident.
      if (!readOnly && !bypassProjectContext) {
        assertAgentMayMutateProject(operationName);
      }
      return toolDef.execute(args, context);
    });
    const result = await execution;
    if (handle) route(() => auditManager.finishMcpOperation(handle!, result));
    return normalizeToolResult(result);
  } catch (error) {
    route(() => {
      if (!readOnly) rollbackUndoEditStartedAfter(undoEditAtStart);
      if (handle) auditManager.finishMcpOperation(handle, undefined, error);
    });
    throw error;
  }
}

function registerToolDefinition(
  server: unknown,
  name: string,
  toolDef: ToolDefinition,
  getSessionId?: SessionIdProvider
): void {
  (server as ToolRegistrar).registerTool(
    name,
    {
      title: toolDef.title,
      description: toolDef.description,
      inputSchema: toolDef.inputSchema,
      outputSchema: toolDef.outputSchema
        ? extractShape(toolDef.outputSchema as z.ZodType)
        : undefined,
      annotations: toolDef.annotations,
    },
    (args, extra) =>
      invokeTool(
        name,
        toolDef,
        args as Record<string, unknown>,
        toolRequestExtraForSession(extra, getSessionId)
      )
  );
}

type ToolGroupOption = z.ZodObject<{
  action: z.ZodLiteral<string>;
  input: z.ZodTypeAny;
}>;

/** Versioned structured-output envelope used by grouped public tools. */
export const groupedToolOutputSchema = z
  .object({
    schema_version: z.literal("1"),
    action: z.string().min(1),
    result: z.unknown(),
  })
  .strict();

/**
 * Builds a compact command envelope from existing precise operation schemas.
 * A discriminated union validates only the selected action instead of walking
 * every branch, which keeps grouped tools inexpensive on slower machines.
 */
export function createToolGroupParameters(
  operations: readonly ToolSpec[]
): z.ZodObject<{ command: z.ZodTypeAny }> {
  if (operations.length === 0) {
    throw new Error("A tool group must contain at least one operation.");
  }
  const options = operations.map((operation) =>
    z.object({
      action: z.literal(operation.name),
      input: operation.parameters,
    })
  ) as ToolGroupOption[];
  const command = options.length === 1
    ? options[0]
    : z.discriminatedUnion(
        "action",
        options as [ToolGroupOption, ToolGroupOption, ...ToolGroupOption[]]
      );
  return z.object({
    command: command.describe(
      `Select one action and provide only that action's input object. Supported actions: ${operations
        .map((operation) => operation.name)
        .join(", ")}.`
    ),
  });
}

/**
 * Extracts the shape from a Zod schema, unwrapping ZodEffects if necessary.
 * Uses _def.typeName for reliable type checking across different Zod instances.
 */
function extractShape(schema: z.ZodType): Record<string, z.ZodType> {
  const def = schema._def as { typeName?: string; schema?: z.ZodType; shape?: () => Record<string, z.ZodType> };

  if (def.typeName === "ZodObject") {
    return def.shape?.() ?? {};
  }

  if (def.typeName === "ZodEffects" && def.schema) {
    return extractShape(def.schema);
  }

  return {};
}

/**
 * Creates a new MCP tool and registers it with the server using the official SDK.
 * @param name - The tool name suffix (will be prefixed with "blockbench_").
 * @param tool - The tool configuration.
 * @param tool.description - The description of the tool.
 * @param tool.annotations - Annotations for the tool (title, hints).
 * @param tool.parameters - Zod schema for input parameters (supports ZodObject or ZodEffects from .refine()).
 * @param tool.execute - The async function to execute when the tool is called.
 * @param status - The status of the tool (stable, experimental, deprecated).
 * @param enabled - Whether the tool is enabled.
 * @returns - The created tool metadata.
 * @throws - If a tool with the same name already exists.
 */
export function createTool<T extends z.ZodType>(
  name: string,
  tool: {
    description: string;
    annotations?: {
      title?: string;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
      readOnlyHint?: boolean;
    };
    parameters: T;
    outputSchema?: z.AnyZodObject;
    execute: (args: z.infer<T>, context: ToolContext) => Promise<ToolResult>;
    resolveMutationToolName?: (args: z.infer<T>) => string;
  },
  status: IMCPTool["status"] = "stable",
  enabled: boolean = true
) {
  assertToolRegistrationAllowed(name);
  if (tools[name] || toolDefinitions[name]) {
    throw new Error(`Tool with name "${name}" already exists.`);
  }

  const inputSchema = extractShape(tool.parameters);

  const toolDef: ToolDefinition = {
    title: tool.annotations?.title ?? tool.description,
    description: tool.description,
    inputSchema,
    outputSchema: tool.outputSchema,
    execute: tool.execute,
    resolveMutationToolName: tool.resolveMutationToolName as
      | ((args: Record<string, unknown>) => string)
      | undefined,
    annotations: tool.annotations,
  };

  // Store tool definition
  toolDefinitions[name] = toolDef;

  // Register with server if enabled
  if (enabled) {
    registerToolDefinition(getServer(), name, toolDef);
  }

  tools[name] = {
    name,
    description: toolDef.title,
    enabled,
    status,
  };

  return tools[name];
}

/**
 * Stores an operation for dispatch by a compact public tool without exposing
 * another MCP tool name. The operation keeps its original schema and handler,
 * while the outer grouped tool owns audit, project-role, and rollback checks.
 */
export function createInternalTool<T extends z.ZodType>(
  name: string,
  tool: {
    description: string;
    annotations?: {
      title?: string;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
      readOnlyHint?: boolean;
    };
    parameters: T;
    execute: (args: z.infer<T>, context: ToolContext) => Promise<ToolResult>;
  },
  _status: IMCPTool["status"] = "stable"
): void {
  assertToolRegistrationAllowed(name);
  if (tools[name] || toolDefinitions[name]) {
    throw new Error(`Tool operation with name "${name}" already exists.`);
  }
  toolDefinitions[name] = {
    title: tool.annotations?.title ?? tool.description,
    description: tool.description,
    inputSchema: extractShape(tool.parameters),
    execute: tool.execute as ToolDefinition["execute"],
    annotations: tool.annotations,
  };
}

/** Registers one public domain tool that dispatches to internal operations. */
export function createToolGroup(
  spec: ToolSpec,
  operations: readonly ToolSpec[]
) {
  return createTool(
    spec.name,
    {
      description: spec.description,
      annotations: spec.annotations,
      parameters: spec.parameters,
      outputSchema: spec.outputSchema,
      async execute(args, context) {
        const command = (args as {
          command: { action: string; input: Record<string, unknown> };
        }).command;
        const result = await toolDefinitions[command.action].execute(command.input, context);
        if (!spec.outputSchema) return result;

        let structuredResult: unknown = null;
        if (typeof result === "string") {
          try {
            structuredResult = JSON.parse(result);
          } catch {
            structuredResult = { text: result };
          }
          return {
            content: [{ type: "text", text: result }],
            structuredContent: {
              schema_version: "1",
              action: command.action,
              result: structuredResult,
            },
          };
        }

        structuredResult = result.structuredContent ?? null;
        return {
          ...result,
          structuredContent: {
            schema_version: "1",
            action: command.action,
            result: structuredResult,
          },
        };
      },
      resolveMutationToolName(args) {
        return (args as { command: { action: string } }).command.action;
      },
    },
    spec.status
  );
}

/**
 * Registers all enabled tools on a server instance
 * Used to set up new session servers with the same tools
 */
export function registerToolsOnServer(
  server: unknown,
  getSessionId?: SessionIdProvider
) {
  for (const [name, toolDef] of Object.entries(toolDefinitions)) {
    if (!tools[name]?.enabled) continue;
    registerToolDefinition(server, name, toolDef, getSessionId);
  }
}

/**
 * Resource definition storage for dynamic server reconstruction
 */
interface ResourceDefinition {
  uriTemplate: string;
  metadata: {
    title?: string;
    description?: string;
  };
  listCallback?: () => Promise<{
    resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
  }>;
  readCallback: (
    uri: URL,
    variables: Record<string, string>
  ) => Promise<{
    contents: Array<{ uri: string; text: string; mimeType?: string } | { uri: string; blob: string; mimeType?: string }>;
  }>;
}

const resourceDefinitions: Record<string, ResourceDefinition> = {};

interface ResourceRegistrar {
  registerResource: (
    resourceName: string,
    uriOrTemplate: ResourceTemplate,
    metadata: ResourceDefinition["metadata"],
    readCallback: (
      uri: URL,
      variables: Record<string, string | string[]>
    ) => ReturnType<ResourceDefinition["readCallback"]>
  ) => void;
}

function registerResourceDefinition(
  server: unknown,
  name: string,
  definition: ResourceDefinition
): void {
  (server as ResourceRegistrar).registerResource(
    name,
    new ResourceTemplate(definition.uriTemplate, { list: definition.listCallback }),
    definition.metadata,
    (uri, variables) => definition.readCallback(
      uri,
      Object.fromEntries(
        Object.entries(variables).map(([key, value]) => [
          key,
          Array.isArray(value) ? value[0] ?? "" : value,
        ])
      )
    )
  );
}

/**
 * Creates a new MCP resource and registers it with the server using the official SDK.
 * @param name - The resource name.
 * @param config - The resource configuration.
 * @param config.uriTemplate - The URI template pattern (e.g., "nodes://{id}").
 * @param config.title - Optional title for the resource.
 * @param config.description - The description of the resource.
 * @param config.listCallback - Optional async function to list available resources.
 * @param config.readCallback - Async function to read the resource.
 * @returns - The created resource metadata.
 */
export function createResource(
  name: string,
  config: {
    uriTemplate: string;
    title?: string;
    description: string;
    listCallback?: () => Promise<{
      resources: Array<{ uri: string; name: string; description?: string; mimeType?: string }>;
    }>;
    readCallback: (
      uri: URL,
      variables: Record<string, string>
    ) => Promise<{
      contents: Array<{ uri: string; text: string; mimeType?: string } | { uri: string; blob: string; mimeType?: string }>;
    }>;
  }
) {
  if (resources[name]) {
    throw new Error(`Resource with name "${name}" already exists.`);
  }

  const resourceDef: ResourceDefinition = {
    uriTemplate: config.uriTemplate,
    metadata: {
      title: config.title,
      description: config.description,
    },
    listCallback: config.listCallback,
    readCallback: config.readCallback,
  };

  resourceDefinitions[name] = resourceDef;
  registerResourceDefinition(getServer(), name, resourceDef);

  resources[name] = {
    name,
    description: config.description,
    uriTemplate: config.uriTemplate,
  };

  return resources[name];
}

/**
 * Registers all resources on a server instance
 * Used to set up new session servers with the same resources
 */
export function registerResourcesOnServer(server: unknown) {
  for (const [name, resourceDef] of Object.entries(resourceDefinitions)) {
    registerResourceDefinition(server, name, resourceDef);
  }
}

interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

interface PromptDefinition {
  title: string;
  description: string;
  argsSchema: Record<string, z.ZodType>;
  generate: (args: Record<string, unknown>) => Promise<{
    messages: PromptMessage[];
  }>;
}

const promptDefinitions: Record<string, PromptDefinition> = {};

interface PromptRegistrar {
  registerPrompt: (
    promptName: string,
    definition: Pick<PromptDefinition, "title" | "description" | "argsSchema">,
    callback: PromptDefinition["generate"]
  ) => void;
}

function registerPromptDefinition(
  server: unknown,
  name: string,
  definition: PromptDefinition
): void {
  (server as PromptRegistrar).registerPrompt(
    name,
    {
      title: definition.title,
      description: definition.description,
      argsSchema: definition.argsSchema,
    },
    definition.generate
  );
}

/**
 * Creates a prompt definition and registers it on the reference server.
 * Session servers are reconstructed from the stored definition below.
 */
export function createPrompt<T extends z.ZodRawShape>(
  name: string,
  prompt: {
    title?: string;
    description: string;
    argsSchema: z.ZodObject<T>;
    generate: (
      args: z.infer<z.ZodObject<T>>
    ) => { messages: PromptMessage[] } | Promise<{ messages: PromptMessage[] }>;
  },
  status: IMCPPrompt["status"] = "stable",
  enabled: boolean = true
) {
  if (prompts[name]) {
    throw new Error(`Prompt with name "${name}" already exists.`);
  }

  const argsSchema = prompt.argsSchema.shape;
  if (enabled) {
    const promptDef: PromptDefinition = {
      title: prompt.title ?? prompt.description,
      description: prompt.description,
      argsSchema,
      generate: async (args) => prompt.generate(args as z.infer<z.ZodObject<T>>),
    };
    promptDefinitions[name] = promptDef;
    registerPromptDefinition(getServer(), name, promptDef);
  }

  prompts[name] = {
    name,
    description: prompt.description,
    arguments: argsSchema,
    enabled,
    status,
  };
  return prompts[name];
}

/** Register all enabled prompts on a newly-created MCP session server. */
export function registerPromptsOnServer(server: unknown) {
  for (const [name, promptDef] of Object.entries(promptDefinitions)) {
    registerPromptDefinition(server, name, promptDef);
  }
}
