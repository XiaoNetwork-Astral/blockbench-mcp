import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";

function formatSummary(format: ModelFormat) {
  const properties = (ModelFormat as unknown as { properties: Record<string, { type: string }> }).properties;
  const record = format as unknown as Record<string, unknown>;
  return {
    id: format.id, name: format.name,
    features: Object.fromEntries(Object.entries(properties).filter(([, property]) => property.type === "boolean").map(([key]) => [key, Boolean(record[key])])),
    model_codec: format.codec?.id ?? null,
    animation_codec: format.animation_codec?.id ?? null,
  };
}

export const capabilityTools: ToolDefinition[] = [defineTool({
  name: "inspect_capabilities",
  description: "Reports the running Blockbench version, installed model formats and their actual feature flags (meshes, splines, armatures, controllers, UV, materials and more), plus available editor modes. With a project open, current_format identifies the visible tab's capabilities.",
  annotations: { title: "Inspect Capabilities", readOnlyHint: true }, project: "none",
  parameters: z.object({ format_id: z.string().min(1).optional() }).strict(), status: "stable",
  async execute({ format_id }) {
    const formats = Object.values(Formats);
    if (format_id && !Formats[format_id]) throw new Error(`Format "${format_id}" is not installed.`);
    return JSON.stringify({
      version: Blockbench.version, current_format: typeof Project === "object" ? Format.id : null,
      formats: (format_id ? [Formats[format_id]] : formats).map(formatSummary),
      modes: Object.keys(Modes.options),
    });
  },
})];
