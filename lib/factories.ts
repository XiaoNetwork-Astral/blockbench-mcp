import { z } from "zod";
import type { IMCPTool, IMCPPrompt, IMCPResource, StatusType } from "@/types";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertProjectMayBeMutated } from "@/lib/projectRoles";
import { auditManager } from "@/lib/audit";
import {
  captureUndoEditToken,
  rollbackUndoEditStartedAfter,
} from "@/lib/undoSafety";
import { getVisibleProject } from "@/src/blockbench/projects";
import { runMutation } from "@/src/runtime/mutationQueue";

/**
 * Declarative tool spec for documentation and registration.
 * Contains everything except the `execute` implementation.
 */
export interface ToolSpec {
  name: string;
  description: string;
  /** Whether the tool needs the visible Blockbench project. Defaults to required. */
  project?: "required" | "optional" | "none";
  /** Set false for project navigation or metadata changes that remain available while locked. */
  writableProject?: boolean;
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
  /** Project visible when this invocation began. */
  project: ModelProject | null;
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
  parameters: z.ZodType;
  inputSchema: Record<string, z.ZodType>;
  outputSchema?: Record<string, z.ZodType> | z.ZodType;
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
  project: "required" | "optional" | "none";
  writableProject: boolean;
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

export function parseToolArguments(
  schema: z.ZodType,
  rawArgs: Record<string, unknown>
): Record<string, unknown> {
  return schema.parse(rawArgs) as Record<string, unknown>;
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
  rawArgs: Record<string, unknown>
): Promise<unknown> {
  // registerTool accepts a raw object shape, so schema-level refinements are
  // not preserved by SDK registration. Parse the original schema once here.
  const args = parseToolArguments(toolDef.parameters, rawArgs);
  const readOnly = toolDef.annotations?.readOnlyHint === true;
  const operationName = name;
  const project = toolDef.project === "none" ? null : getVisibleProject();
  if (toolDef.project === "required" && !project) {
    throw new Error(`Tool "${operationName}" requires an open Blockbench project.`);
  }

  const execute = async (): Promise<unknown> => {
    if (project && getVisibleProject() !== project) {
      throw new Error(
        `The visible Blockbench tab changed before tool "${operationName}" could run. ` +
          "No changes were made; call the tool again for the tab that is visible now."
      );
    }

    // Read-only tools cannot open an Undo edit, so rollback bookkeeping would
    // only add work to high-frequency queries.
    let undoEditAtStart: unknown;
    let handle: ReturnType<typeof auditManager.beginMcpOperation> | undefined;
    try {
      undoEditAtStart = readOnly ? undefined : captureUndoEditToken();
      handle = auditManager.beginMcpOperation({
        toolName: operationName,
        title: toolDef.title,
        args,
        readOnly,
      });
      const reportProgress: ToolContext["reportProgress"] = () => {};
      const context: ToolContext = {
        reportProgress,
        project,
      };
      if (!readOnly && toolDef.writableProject && project) {
        assertProjectMayBeMutated(project, operationName);
      }
      const result = await toolDef.execute(args, context);
      if (handle) auditManager.finishMcpOperation(handle, result);
      return normalizeToolResult(result);
    } catch (error) {
      if (!readOnly) rollbackUndoEditStartedAfter(undoEditAtStart);
      if (handle) auditManager.finishMcpOperation(handle, undefined, error);
      throw error;
    }
  };

  return readOnly ? execute() : runMutation(execute);
}

function registerToolDefinition(
  server: unknown,
  name: string,
  toolDef: ToolDefinition
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
    (args) => invokeTool(name, toolDef, args as Record<string, unknown>)
  );
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
 * @param name - The public tool name.
 * @param tool - The tool configuration.
 * @param tool.description - The description of the tool.
 * @param tool.annotations - Annotations for the tool (title, hints).
 * @param tool.parameters - Zod schema for input parameters (supports ZodObject or ZodEffects from .refine()).
 * @param tool.execute - The async function to execute when the tool is called.
 * @param status - The status of the tool (stable, experimental, deprecated).
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
    project?: "required" | "optional" | "none";
    writableProject?: boolean;
    outputSchema?: z.AnyZodObject;
    execute: (args: z.infer<T>, context: ToolContext) => Promise<ToolResult>;
  },
  status: IMCPTool["status"] = "stable"
) {
  if (tools[name] || toolDefinitions[name]) {
    throw new Error(`Tool with name "${name}" already exists.`);
  }

  const inputSchema = extractShape(tool.parameters);

  const toolDef: ToolDefinition = {
    title: tool.annotations?.title ?? tool.description,
    description: tool.description,
    parameters: tool.parameters,
    inputSchema,
    outputSchema: tool.outputSchema,
    execute: tool.execute,
    project: tool.project ?? "required",
    writableProject: tool.writableProject ?? true,
    annotations: tool.annotations,
  };

  toolDefinitions[name] = toolDef;

  tools[name] = {
    name,
    description: toolDef.description,
    enabled: true,
    status,
  };

  return tools[name];
}

/** Domain-module alias; all operations are direct tools. */
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
    project?: "required" | "optional" | "none";
    writableProject?: boolean;
    execute: (args: z.infer<T>, context: ToolContext) => Promise<ToolResult>;
  },
  status: IMCPTool["status"] = "stable"
): void {
  createTool(name, tool, status);
}

/**
 * Registers the declarative tool catalog on one stateless request server.
 */
export function registerToolsOnServer(server: unknown) {
  for (const [name, toolDef] of Object.entries(toolDefinitions)) {
    registerToolDefinition(server, name, toolDef);
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

  resources[name] = {
    name,
    description: config.description,
    uriTemplate: config.uriTemplate,
  };

  return resources[name];
}

/**
 * Registers the declarative resource catalog on one stateless request server.
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
 * Stores a prompt definition for registration on each stateless request server.
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
  status: IMCPPrompt["status"] = "stable"
) {
  if (prompts[name]) {
    throw new Error(`Prompt with name "${name}" already exists.`);
  }

  const argsSchema = prompt.argsSchema.shape;
  const promptDef: PromptDefinition = {
    title: prompt.title ?? prompt.description,
    description: prompt.description,
    argsSchema,
    generate: async (args) => prompt.generate(args as z.infer<z.ZodObject<T>>),
  };
  promptDefinitions[name] = promptDef;

  prompts[name] = {
    name,
    description: prompt.description,
    arguments: argsSchema,
    enabled: true,
    status,
  };
  return prompts[name];
}

/** Register all prompts on a newly-created request server. */
export function registerPromptsOnServer(server: unknown) {
  for (const [name, promptDef] of Object.entries(promptDefinitions)) {
    registerPromptDefinition(server, name, promptDef);
  }
}
