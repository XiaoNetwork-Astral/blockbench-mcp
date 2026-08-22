/// <reference types="three" />
/// <reference types="blockbench-types" />
import { VERSION } from "@/lib/constants";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

let serverInstance: McpServer | null = null;
const MCP_INSTRUCTIONS =
  "Follow the YSM three-tab workflow: compare legacy and new baselines, edit only working_copy, " +
  "self-check before asking the user, and merge only after explicit approval. Never switch " +
  "animation or pose unless the user asks. When building a new model from scratch, work " +
  "incrementally with add_group, place_cube, and modify_cube, and inspect the result with " +
  "capture_screenshot after each coherent stage. Do not use from_geo_json as a shortcut unless " +
  "the user explicitly asks to import existing geometry.";

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
