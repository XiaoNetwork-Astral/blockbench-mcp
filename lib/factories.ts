import { z } from "zod";
import type { IMCPTool, IMCPResource, StatusType } from "@/types";
import { getServer } from "@/server/server";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertAgentMayMutateProject } from "@/lib/projectRoles";
import { auditManager } from "@/lib/audit";
import { assertToolRegistrationAllowed } from "@/lib/security";

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
 * User-visible list of resource details.
 */
export const resources: Record<string, IMCPResource> = {};

export interface ToolContext {
  reportProgress: (progress: { progress: number; total: number }) => void;
  sessionId?: string;
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
  execute: (args: Record<string, unknown>, context?: ToolContext) => Promise<ToolResult>;
  annotations?: {
    title?: string;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    readOnlyHint?: boolean;
  };
}

/**
 * Store tool definitions for dynamic server reconstruction
 */
const toolDefinitions: Record<string, ToolDefinition> = {};

interface ToolRequestExtra {
  sessionId?: string;
}

function normalizeToolResult(result: ToolResult): unknown {
  if (typeof result === "string") {
    return {
      content: [{ type: "text", text: result }],
    };
  }

  if (result && typeof result === "object" && "content" in result) {
    return result;
  }

  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

async function invokeTool(
  name: string,
  toolDef: ToolDefinition,
  args: Record<string, unknown>,
  extra: ToolRequestExtra
): Promise<unknown> {
  const handle = auditManager.beginMcpOperation({
    toolName: name,
    title: toolDef.title,
    args,
    sessionId: extra.sessionId,
    readOnly: toolDef.annotations?.readOnlyHint === true,
  });

  try {
    const reportProgress: ToolContext["reportProgress"] = () => {};
    const context: ToolContext = { reportProgress, sessionId: extra.sessionId };
    // A reference tab is writable only through the small explicit exemption
    // list. Tools must opt into read-only status; missing metadata never grants
    // mutation access by accident.
    if (toolDef.annotations?.readOnlyHint !== true) {
      assertAgentMayMutateProject(name);
    }
    const result = await toolDef.execute(args, context);
    auditManager.finishMcpOperation(handle, result);
    return normalizeToolResult(result);
  } catch (error) {
    auditManager.finishMcpOperation(handle, undefined, error);
    throw error;
  }
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
      openWorldHint?: boolean;
      readOnlyHint?: boolean;
    };
    parameters: T;
    execute: (args: z.infer<T>, context?: ToolContext) => Promise<ToolResult>;
  },
  status: IMCPTool["status"] = "stable",
  enabled: boolean = true
) {
  assertToolRegistrationAllowed(name);
  if (tools[name]) {
    throw new Error(`Tool with name "${name}" already exists.`);
  }

  const inputSchema = extractShape(tool.parameters);

  const toolDef: ToolDefinition = {
    title: tool.annotations?.title ?? tool.description,
    description: tool.description,
    inputSchema,
    execute: tool.execute,
    annotations: tool.annotations,
  };

  // Store tool definition
  toolDefinitions[name] = toolDef;

  // Register with server if enabled
  if (enabled) {
    type ToolArgs = z.infer<T>;

    const server = getServer();

    const registerTool = server.registerTool.bind(server) as unknown as (
      toolName: string,
      definition: {
        title: string;
        description: string;
        inputSchema: Record<string, z.ZodType>;
      },
      callback: (args: unknown, extra: unknown) => Promise<unknown>
    ) => void;

    registerTool(
      name,
      {
        title: toolDef.title,
        description: toolDef.description,
        inputSchema,
      },
      async (args: unknown, extra: unknown) => {
        return invokeTool(
          name,
          toolDef,
          args as ToolArgs & Record<string, unknown>,
          (extra ?? {}) as ToolRequestExtra
        );
      }
    );
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
 * Gets all tool definitions for server reconstruction
 */
export function getAllToolDefinitions() {
  return toolDefinitions;
}

/**
 * Gets enabled tool definitions for server reconstruction
 */
export function getEnabledToolDefinitions() {
  return Object.fromEntries(
    Object.entries(toolDefinitions).filter(([name]) => tools[name]?.enabled)
  );
}

/**
 * Registers all enabled tools on a server instance
 * Used to set up new session servers with the same tools
 */
export function registerToolsOnServer(server: unknown) {
  const enabledDefs = getEnabledToolDefinitions();

  const typedServer = server as {
    registerTool: (
      toolName: string,
      definition: {
        title: string;
        description: string;
        inputSchema: Record<string, z.ZodType>;
      },
      callback: (args: unknown, extra: unknown) => Promise<unknown>
    ) => void;
  };

  for (const [name, toolDef] of Object.entries(enabledDefs)) {
    typedServer.registerTool(
      name,
      {
        title: toolDef.title,
        description: toolDef.description,
        inputSchema: toolDef.inputSchema,
      },
      async (args: unknown, extra: unknown) => {
        return invokeTool(
          name,
          toolDef,
          args as Record<string, unknown>,
          (extra ?? {}) as ToolRequestExtra
        );
      }
    );
  }
}

/**
 * Resource definition storage for dynamic server reconstruction
 */
interface ResourceDefinition {
  name: string;
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
    name,
    uriTemplate: config.uriTemplate,
    metadata: {
      title: config.title,
      description: config.description,
    },
    listCallback: config.listCallback,
    readCallback: config.readCallback,
  };

  // Store resource definition for session reconstruction
  resourceDefinitions[name] = resourceDef;

  // Register with the current server instance
  // Use ResourceTemplate to enable dynamic resource listing via listCallback
  const server = getServer();

  const registerResource = (
    server as unknown as {
      registerResource: (
        resourceName: string,
        uriOrTemplate: ResourceTemplate,
        metadata: {
          title?: string;
          description?: string;
        },
        readCallback: (
          uri: URL,
          variables: Record<string, string | string[]>
        ) => Promise<{
          contents: Array<{ uri: string; text: string; mimeType?: string } | { uri: string; blob: string; mimeType?: string }>;
        }>
      ) => void;
    }
  ).registerResource.bind(server);

  registerResource(
    name,
    new ResourceTemplate(config.uriTemplate, { list: config.listCallback }),
    {
      title: config.title,
      description: config.description,
    },
    async (uri: URL, variables: Record<string, string | string[]>) => {
      const normalizedVariables = Object.fromEntries(
        Object.entries(variables).map(([key, value]) => {
          if (Array.isArray(value)) {
            return [key, value[0] ?? ""];
          }
          return [key, value];
        })
      ) as Record<string, string>;

      return config.readCallback(uri, normalizedVariables);
    }
  );

  resources[name] = {
    name,
    description: config.description,
    uriTemplate: config.uriTemplate,
  };

  return resources[name];
}

/**
 * Gets all resource definitions for server reconstruction
 */
export function getAllResourceDefinitions() {
  return resourceDefinitions;
}

/**
 * Registers all resources on a server instance
 * Used to set up new session servers with the same resources
 */
export function registerResourcesOnServer(server: unknown) {
  const typedServer = server as {
    registerResource: (
      resourceName: string,
      uriOrTemplate: ResourceTemplate,
      metadata: {
        title?: string;
        description?: string;
      },
      readCallback: (
        uri: URL,
        variables: Record<string, string | string[]>
      ) => Promise<{
        contents: Array<{ uri: string; text: string; mimeType?: string } | { uri: string; blob: string; mimeType?: string }>;
      }>
    ) => void;
  };

  for (const [name, resourceDef] of Object.entries(resourceDefinitions)) {
    typedServer.registerResource(
      name,
      new ResourceTemplate(resourceDef.uriTemplate, { list: resourceDef.listCallback }),
      resourceDef.metadata,
      async (uri: URL, variables: Record<string, string | string[]>) => {
        const normalizedVariables = Object.fromEntries(
          Object.entries(variables).map(([key, value]) => {
            if (Array.isArray(value)) {
              return [key, value[0] ?? ""];
            }
            return [key, value];
          })
        ) as Record<string, string>;

        return resourceDef.readCallback(uri, normalizedVariables);
      }
    );
  }
}
