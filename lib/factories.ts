import { z } from "zod";
import type { IMCPTool, IMCPPrompt, IMCPResource, StatusType } from "@/types";
import { ResourceTemplate, type McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { assertProjectMayBeMutated } from "@/lib/projectAccess";
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
export interface ToolSpec<T extends z.ZodObject = z.ZodObject> {
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
  parameters: T;
  outputSchema?: z.ZodObject;
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
  /** Project visible when this invocation began. */
  project: ModelProject | null;
}

type ToolResult = string | CallToolResult;

/** One typed definition drives execution, discovery, and documentation. */
export interface ToolDefinition extends ToolSpec {
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export function defineTool<T extends z.ZodObject>(
  definition: ToolSpec<T> & {
    execute: (args: z.infer<T>, context: ToolContext) => Promise<ToolResult>;
  }
): ToolDefinition {
  return definition;
}

/**
 * Store tool definitions for dynamic server reconstruction
 */
const toolDefinitions: Record<string, ToolDefinition> = {};

function normalizeToolResult(result: ToolResult): CallToolResult {
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
  args: Record<string, unknown>
): Promise<CallToolResult> {
  const readOnly = toolDef.annotations?.readOnlyHint === true;
  const operationName = name;
  const project = toolDef.project === "none" ? null : getVisibleProject();
  if ((toolDef.project ?? "required") === "required" && !project) {
    throw new Error(`Tool "${operationName}" requires an open Blockbench project.`);
  }

  const execute = async (): Promise<CallToolResult> => {
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
        title: toolDef.annotations?.title ?? toolDef.description,
        args,
        readOnly,
      });
      const context: ToolContext = {
        project,
      };
      if (!readOnly && toolDef.writableProject !== false && project) {
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

export function registerToolOnServer(
  server: McpServer,
  toolDef: ToolDefinition
): void {
  const { name } = toolDef;
  server.registerTool(
    name,
    {
      title: toolDef.annotations?.title ?? toolDef.description,
      description: toolDef.description,
      inputSchema: toolDef.parameters,
      outputSchema: toolDef.outputSchema,
      annotations: toolDef.annotations,
    },
    (args) => invokeTool(name, toolDef, args)
  );
}

/** Store one catalog entry for registration on each stateless request server. */
export function createTool(tool: ToolDefinition) {
  const { name } = tool;
  if (tools[name] || toolDefinitions[name]) {
    throw new Error(`Tool with name "${name}" already exists.`);
  }

  toolDefinitions[name] = tool;

  tools[name] = {
    name,
    description: tool.description,
    enabled: true,
    status: tool.status,
  };

  return tools[name];
}

/**
 * Registers the declarative tool catalog on one stateless request server.
 */
export function registerToolsOnServer(server: McpServer) {
  for (const toolDef of Object.values(toolDefinitions)) {
    registerToolOnServer(server, toolDef);
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

function registerResourceDefinition(
  server: McpServer,
  name: string,
  definition: ResourceDefinition
): void {
  server.registerResource(
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
export function registerResourcesOnServer(server: McpServer) {
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
  argsSchema: z.ZodObject;
  generate: (args: Record<string, unknown>) => Promise<{
    messages: PromptMessage[];
  }>;
}

const promptDefinitions: Record<string, PromptDefinition> = {};

function registerPromptDefinition(
  server: McpServer,
  name: string,
  definition: PromptDefinition
): void {
  server.registerPrompt(
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

  const argsSchema = prompt.argsSchema;
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
    arguments: argsSchema.shape,
    enabled: true,
    status,
  };
  return prompts[name];
}

/** Register all prompts on a newly-created request server. */
export function registerPromptsOnServer(server: McpServer) {
  for (const [name, promptDef] of Object.entries(promptDefinitions)) {
    registerPromptDefinition(server, name, promptDef);
  }
}
