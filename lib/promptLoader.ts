import embeddedManifest from "@/prompts/manifest.json";
import { z } from "zod";

export interface PromptManifest {
  version: string;
  generatedAt: string;
  prompts: Record<string, string>;
}

const promptManifestSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  prompts: z.record(z.string(), z.string()),
});

let manifest: PromptManifest | null = null;

/**
 * Load the prompt manifest bundled with this plugin build.
 *
 * This fork deliberately does not fetch prompt text from the upstream CDN:
 * doing so could silently reintroduce guidance for tools that this fork
 * permanently disables. Bundled content is deterministic and works offline.
 */
export async function initPromptLoader(): Promise<void> {
  const parsed = promptManifestSchema.safeParse(embeddedManifest);
  if (!parsed.success) {
    manifest = null;
    throw new Error(`Bundled prompt manifest is invalid: ${parsed.error.message}`);
  }
  manifest = parsed.data;
}

export function getPromptContent(name: string): string {
  return manifest?.prompts[name] ?? "";
}
