/// <reference types="three" />
/// <reference types="blockbench-types" />
import { VERSION } from "@/lib/constants";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const MCP_INSTRUCTIONS =
  "Each project-scoped tool acts on the Blockbench tab visible when that call begins. " +
  "Use list_projects to inspect open tabs and select_project when a different tab should become visible. " +
  "Tools take operation-specific inputs directly; there is no command wrapper or connection-owned project. " +
  "Work incrementally and preserve existing content unless the user explicitly authorizes a " +
  "replacement or deletion. New Outliner nodes default to root and duplicates stay beside the original; " +
  "name a parent when building hierarchy and always name the destination when reparenting. Build " +
  "a semantic group hierarchy before adding geometry, and validate each coherent stage from " +
  "front, side, top, and perspective views. Use inspect_spatial_relationships for important " +
  "contacts. If hierarchy or depth remains " +
  "ambiguous after those checks, stop before further " +
  "mutation and ask the user to inspect the model and state the intended structure or position. " +
  "Do not use import_bedrock_geometry as a shortcut unless the user explicitly asks to import existing " +
  "geometry. Use optional YSM tools when the current model actually uses YSM extension files.";

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
