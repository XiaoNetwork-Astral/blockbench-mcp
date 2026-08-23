/// <reference types="three" />
/// <reference types="blockbench-types" />
import { VERSION } from "@/lib/constants";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

let serverInstance: McpServer | null = null;
const MCP_INSTRUCTIONS =
  "Public tools use predictable intent_domain names: inspect_* reads, edit_* changes model or " +
  "editor state, create_* creates focused geometry, and import_*/export_* cross file boundaries. " +
  "Grouped tools expose exact operations through command.action. " +
  "Work incrementally and preserve existing content unless the user explicitly authorizes a " +
  "replacement or deletion. Every Outliner create, duplicate, parent, or mirror operation must " +
  "name an explicit parent; use the literal root only when root placement is intentional. Build " +
  "a semantic group hierarchy before adding geometry, and validate each coherent stage from " +
  "front, side, top, and perspective views. Use inspect_geometry with command.action " +
  "inspect_spatial_relationships for important contacts. If hierarchy or depth remains " +
  "ambiguous after those checks, stop before further " +
  "mutation and ask the user to inspect the model and state the intended structure or position. " +
  "Do not use import_bedrock_geometry as a shortcut unless the user explicitly asks to import existing " +
  "geometry. Use YSM workspace tools only for an explicitly selected YSM workflow.";

/**
 * Creates a new MCP server instance using the official SDK
 */
export function createServer() {
  return new McpServer(
    {
      name: "Blockbench MCP",
      version: VERSION,
    },
    { instructions: MCP_INSTRUCTIONS }
  );
}

/**
 * Gets the current server instance
 */
export function getServer() {
  if (!serverInstance) {
    serverInstance = createServer();
  }
  return serverInstance;
}

/**
 * Replaces the current server instance with a new one
 * @param newServer - The new server instance
 */
export function setServer(newServer: McpServer) {
  serverInstance = newServer;
}

// Export the default server instance
const server = getServer();
export default server;
