import { z } from "zod";
import type { ToolSpec, PromptSpec, ResourceSpec } from "../lib/factories";
import { TOOL_CATEGORIES } from "../src/runtime/toolCatalog";

export interface CategoryGroup {
  category: string;
  tools: ToolSpec[];
}

export const toolManifest: CategoryGroup[] = TOOL_CATEGORIES.map(
  ({ category, tools, optional }) => ({
    category: optional ? `${category} (optional)` : category,
    tools: [...tools],
  })
);

// Prompt specs defined inline — server/prompts.ts uses macros that complicate direct import
export const promptDocs: PromptSpec[] = [
  {
    name: "model_creation_strategy",
    title: "Model Creation Strategy",
    description:
      "A staged Blockbench modeling workflow with explicit hierarchy, multi-view spatial checks, and human review checkpoints.",
    argsSchema: z.object({
      format: z
        .enum(["java_block", "bedrock"])
        .optional()
        .describe("Target model format."),
      approach: z
        .enum(["incremental", "import"])
        .default("incremental")
        .describe("Use direct incremental tools by default; import only when explicitly requested."),
    }),
    status: "stable",
  },
  {
    name: "hytale_model_creation",
    title: "Hytale Model Creation Guide",
    description:
      "Comprehensive guide for creating Hytale character and prop models. Covers format selection, node limits, shading modes, stretch, quads, and best practices.",
    argsSchema: z.object({
      format_type: z
        .enum(["character", "prop", "both"])
        .describe("Which format type to focus on.")
        .optional()
        .default("both"),
    }),
    status: "experimental",
  },
  {
    name: "hytale_animation_workflow",
    title: "Hytale Animation Workflow",
    description:
      "Guide for creating animations for Hytale models. Covers 60 FPS timing, quaternion rotations, visibility keyframes, loop modes, and common animation patterns.",
    argsSchema: z.object({
      animation_type: z
        .enum(["walk", "idle", "attack", "general"])
        .describe("Type of animation to focus on.")
        .optional()
        .default("general"),
    }),
    status: "experimental",
  },
  {
    name: "hytale_attachments",
    title: "Hytale Attachments System",
    description:
      "Guide for creating and managing attachments in Hytale models. Covers attachment collections, piece bones, modular equipment, and best practices.",
    status: "experimental",
  },
];

// Resource specs defined inline — server/resources.ts uses Blockbench globals at module level
export const resourceDocs: ResourceSpec[] = [
  {
    name: "projects",
    uriTemplate: "projects://{id}",
    title: "Blockbench Projects",
    description:
      "Returns information about available projects. List URIs use the slugified project name (e.g. `projects://my-character`) when unique, or `projects://<slug>~<uuid-prefix>` on collision. Reads accept UUID, exact name, or slug.",
  },
  {
    name: "nodes",
    uriTemplate: "nodes://{project}/{id}",
    title: "Blockbench Nodes",
    description:
      "Returns 3D nodes from the visible project. Listed URIs include that project's UUID and can be read only while the same tab remains visible.",
  },
  {
    name: "textures",
    uriTemplate: "textures://{project}/{id}",
    title: "Blockbench Textures",
    description:
      "Returns textures from the visible project. Listed URIs include that project's UUID; texture names must be unique when used instead of UUIDs.",
  },
  {
    name: "reference_models",
    uriTemplate: "reference_models://{project}/{id}",
    title: "Reference Models",
    description:
      "Returns reference models from the visible project. Requires the Reference Models plugin.",
  },
  {
    name: "validator-status",
    uriTemplate: "validator://status",
    title: "Validator Status",
    description:
      "Returns the current validation status including error/warning counts and a summary of all problems.",
  },
  {
    name: "validator-checks",
    uriTemplate: "validator://checks/{id}",
    title: "Validator Checks",
    description:
      "Returns information about registered validator checks. Use without an ID to list all checks, or provide a check ID to get details about a specific check.",
  },
  {
    name: "validator-warnings",
    uriTemplate: "validator://warnings",
    title: "Validator Warnings",
    description:
      "Returns all current validation warnings with element references where available.",
  },
  {
    name: "validator-errors",
    uriTemplate: "validator://errors",
    title: "Validator Errors",
    description:
      "Returns all current validation errors with element references where available.",
  },
  {
    name: "hytale-format",
    uriTemplate: "hytale://format/{project}",
    title: "Hytale Format Information",
    description:
      "Returns format, block-size, node-limit, and feature information for the visible Hytale project.",
  },
  {
    name: "hytale-attachments",
    uriTemplate: "hytale://attachments/{project}/{id}",
    title: "Hytale Attachments",
    description:
      "Returns attachment collections from the visible Hytale project.",
  },
  {
    name: "hytale-pieces",
    uriTemplate: "hytale://pieces/{project}/{id}",
    title: "Hytale Attachment Pieces",
    description:
      "Returns groups marked as attachment pieces in the visible Hytale project.",
  },
  {
    name: "hytale-cubes",
    uriTemplate: "hytale://cubes/{project}/{id}",
    title: "Hytale Cubes",
    description:
      "Returns cubes and their Hytale-specific properties from the visible Hytale project.",
  },
];
