import embeddedManifest from "@/prompts/manifest.json";
import { z } from "zod";

export interface PromptManifest {
  version: string;
  generatedAt: string;
  prompts: Record<string, string>;
}

const STORAGE_KEY_OVERRIDES = "bbmcp_prompt_overrides";
const promptManifestSchema = z.object({
  version: z.string(),
  generatedAt: z.string(),
  prompts: z.record(z.string(), z.string()),
});

let manifest: PromptManifest | null = null;
let overrides: Record<string, string> = {};

function hasLocalStorage(): boolean {
  return typeof localStorage !== "undefined";
}

function loadOverrides(): Record<string, string> {
  if (!hasLocalStorage()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_OVERRIDES);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? parsed as Record<string, string>
      : {};
  } catch {
    return {};
  }
}

function persistOverrides(): void {
  if (!hasLocalStorage()) return;
  try {
    if (Object.keys(overrides).length === 0) {
      localStorage.removeItem(STORAGE_KEY_OVERRIDES);
    } else {
      localStorage.setItem(STORAGE_KEY_OVERRIDES, JSON.stringify(overrides));
    }
  } catch (error) {
    console.warn("[MCP] Failed to persist prompt overrides:", error);
  }
}

/**
 * Load the prompt manifest bundled with this plugin build.
 *
 * This fork deliberately does not fetch prompt text from the upstream CDN:
 * doing so could silently reintroduce guidance for tools that this fork
 * permanently disables. Bundled content is deterministic and works offline.
 */
export async function initPromptLoader(): Promise<void> {
  overrides = loadOverrides();
  const parsed = promptManifestSchema.safeParse(embeddedManifest);
  if (!parsed.success) {
    manifest = null;
    throw new Error(`Bundled prompt manifest is invalid: ${parsed.error.message}`);
  }
  manifest = parsed.data;
}

export function getPromptContent(name: string): string {
  const override = overrides[name];
  if (override !== undefined && override !== "") return override;
  return manifest?.prompts[name] ?? "";
}

export function setPromptOverride(name: string, content: string): void {
  overrides = { ...overrides, [name]: content };
  persistOverrides();
}

export function clearPromptOverride(name: string): void {
  const { [name]: _removed, ...rest } = overrides;
  overrides = rest;
  persistOverrides();
}

export function hasPromptOverride(name: string): boolean {
  return name in overrides && overrides[name] !== "";
}

export function getPromptOverrides(): Record<string, string> {
  return { ...overrides };
}

export function getAvailablePromptNames(): string[] {
  return manifest ? Object.keys(manifest.prompts) : [];
}

export function getManifest(): PromptManifest | null {
  return manifest
    ? { ...manifest, prompts: { ...manifest.prompts } }
    : null;
}
