/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { captureAppScreenshot } from "@/lib/util";
import { STATUS_STABLE } from "@/lib/constants";
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
      "Imports existing Bedrock geometry from serialized JSON. Accepts inline JSON, JSON data URLs, and local files only; this is not geographic GeoJSON and remote HTTP(S) fetching is disabled. For new models, use edit_elements actions add_group/modify_group and create_cube instead of this import shortcut.",
    annotations: {
      title: "Import Bedrock Geometry",
      destructiveHint: true,
    },
    parameters: fromGeoJsonParameters,
    status: STATUS_STABLE,
  },
];

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
    async execute({ geojson }) {
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
      if (!Codecs.bedrock?.parse) {
        throw new Error("The Bedrock geometry codec is unavailable in the current Blockbench session.");
      }

      Codecs.bedrock.parse(document, source.kind === "local_file" ? source.path : "");

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          captureAppScreenshot().then(resolve).catch(reject);
        }, 3000);
      });
    },
  }, importToolDocs[0].status);
}
