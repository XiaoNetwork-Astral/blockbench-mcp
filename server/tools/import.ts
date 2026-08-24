/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { captureScreenshot } from "@/lib/util";
import { STATUS_STABLE } from "@/lib/constants";
import { setSessionWorkingProject } from "@/lib/projectContext";
import {
  assertGeometryJsonSize,
  classifyGeometryJsonSource,
} from "@/lib/importSource";

export const fromGeoJsonParameters = z.object({
  geojson: z
    .string()
    .describe(
      "Inline Bedrock geometry JSON, a JSON data URL, or a local JSON file path. HTTP(S) URLs are intentionally rejected."
    ),
});

export const importToolDocs: ToolSpec[] = [
  {
    name: "import_bedrock_geometry",
    description:
      "Imports existing Bedrock geometry from serialized JSON. With no open project it creates a Bedrock Entity project first; otherwise it imports into the MCP working project without changing the foreground tab. Accepts inline JSON, JSON data URLs, and local files only; remote HTTP(S) fetching is disabled.",
    annotations: {
      title: "Import Bedrock Geometry",
      destructiveHint: true,
    },
    parameters: fromGeoJsonParameters,
    status: STATUS_STABLE,
  },
];

interface BedrockGeometryCodec {
  load?: (
    model: unknown,
    file: { path: string; no_file: boolean },
    args?: Record<string, unknown>
  ) => void;
  parse?: (
    model: unknown,
    path: string,
    args?: Record<string, unknown>
  ) => void;
}

/**
 * Blockbench represents its start screen with Project === 0. Codec.parse()
 * assumes a real project already exists, while Codec.load() creates one first.
 */
export function loadBedrockGeometryDocument(
  codec: BedrockGeometryCodec,
  document: unknown,
  path: string,
  activeProject: unknown
): "created_project" | "current_project" {
  if (typeof codec.parse !== "function") {
    throw new Error(
      "The Bedrock geometry codec is unavailable in the current Blockbench session."
    );
  }
  const hasActiveProject =
    activeProject !== null &&
    typeof activeProject === "object";
  if (!hasActiveProject) {
    if (typeof codec.load !== "function") {
      throw new Error(
        "The Bedrock geometry codec cannot create a project in this Blockbench session."
      );
    }
    codec.load(document, { path, no_file: path.length === 0 }, {});
    return "created_project";
  }
  codec.parse(document, path, {});
  return "current_project";
}

function readLocalGeometryJson(path: string): Promise<string> {
  if (!/\.json$/i.test(path)) {
    throw new Error(`Local geometry source must be a .json file: "${path}".`);
  }

  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(
      () => reject(new Error(`Timed out while reading local geometry file "${path}".`)),
      15_000
    );
    const result = Blockbench.read(
      [path],
      { readtype: "text", errorbox: false, extensions: ["json"] },
      (files: Filesystem.FileResult[]) => {
        window.clearTimeout(timeoutId);
        const content = files[0]?.content;
        if (typeof content !== "string") {
          reject(new Error(`Blockbench could not read text from "${path}".`));
          return;
        }
        try {
          assertGeometryJsonSize(content);
          resolve(content);
        } catch (error) {
          reject(error);
        }
      }
    );
    if (result === false) {
      window.clearTimeout(timeoutId);
      reject(new Error(`Blockbench refused to read local geometry file "${path}".`));
    }
  });
}

export function registerImportTools() {
  createTool(importToolDocs[0].name, {
    ...importToolDocs[0],
    async execute({ geojson }, context) {
      const source = classifyGeometryJsonSource(geojson);
      const jsonText = source.kind === "inline"
        ? source.text
        : await readLocalGeometryJson(source.path);

      let document: unknown;
      try {
        document = JSON.parse(jsonText);
      } catch (error) {
        throw new Error(
          `Invalid Bedrock geometry JSON: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      if (!document || typeof document !== "object") {
        throw new Error("Bedrock geometry JSON must contain an object or array document.");
      }
      const path = source.kind === "local_file" ? source.path : "";
      const load = () => {
        const destination = loadBedrockGeometryDocument(
          Codecs.bedrock,
          document,
          path,
          Project
        );
        const importedProject =
          Project && typeof Project === "object"
            ? Project
            : null;
        return { destination, importedProject };
      };
      const { destination, importedProject } = context.project
        ? context.runInProject(load, context.project)
        : load();
      if (!importedProject) {
        throw new Error("Blockbench did not create or select an imported project.");
      }
      setSessionWorkingProject(context.sessionId, importedProject);

      const screenshot = await captureScreenshot(
        undefined,
        2,
        context.sessionId,
        importedProject
      );
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              destination,
              project: {
                name: importedProject.name,
                uuid: importedProject.uuid,
                format: importedProject.format?.id ?? Format.id,
              },
              source: source.kind,
              path: path || null,
            }, null, 2),
          },
          ...screenshot.content,
        ],
      };
    },
  }, importToolDocs[0].status);
}
