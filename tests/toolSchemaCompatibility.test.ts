import { describe, expect, test } from "bun:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import { animationToolDocs } from "@/server/tools/animation";
import { armatureToolDocs } from "@/server/tools/armature";
import { cameraToolDocs } from "@/server/tools/camera";
import { codexTextureToolDocs } from "@/server/tools/codex-texture";
import { cubeToolDocs } from "@/server/tools/cubes";
import { elementToolDocs } from "@/server/tools/element";
import { exportToolDocs } from "@/server/tools/export";
import { historyToolDocs } from "@/server/tools/history";
import { importToolDocs } from "@/server/tools/import";
import { materialInstanceToolDocs } from "@/server/tools/material-instances";
import { meshToolDocs } from "@/server/tools/mesh";
import { paintToolDocs } from "@/server/tools/paint";
import { previewToolDocs } from "@/server/tools/preview";
import { projectToolDocs } from "@/server/tools/project";
import { spatialToolDocs } from "@/server/tools/spatial";
import { textureToolDocs } from "@/server/tools/texture";
import { uvToolDocs } from "@/server/tools/uv";
import { workflowToolDocs } from "@/server/tools/workflow";
import { ysmToolDocs } from "@/server/tools/ysm";

const toolDocs = [
  ...animationToolDocs,
  ...armatureToolDocs,
  ...cameraToolDocs,
  ...codexTextureToolDocs,
  ...cubeToolDocs,
  ...elementToolDocs,
  ...exportToolDocs,
  ...historyToolDocs,
  ...importToolDocs,
  ...materialInstanceToolDocs,
  ...meshToolDocs,
  ...paintToolDocs,
  ...previewToolDocs,
  ...projectToolDocs,
  ...spatialToolDocs,
  ...textureToolDocs,
  ...uvToolDocs,
  ...workflowToolDocs,
  ...ysmToolDocs,
];

function findTupleItems(value: unknown, path = "schema"): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => findTupleItems(child, `${path}[${index}]`));
  }

  const object = value as Record<string, unknown>;
  const own = Array.isArray(object.items) ? [`${path}.items`] : [];
  return own.concat(
    Object.entries(object).flatMap(([key, child]) =>
      findTupleItems(child, `${path}.${key}`)
    )
  );
}

describe("Codex MCP schema compatibility", () => {
  test("all 105 tools avoid unsupported draft-07 tuple items", () => {
    const failures = toolDocs.flatMap((tool) => {
      const schema = zodToJsonSchema(tool.parameters, { $refStrategy: "root" });
      return findTupleItems(schema).map((path) => `${tool.name}: ${path}`);
    });

    expect(toolDocs).toHaveLength(105);
    expect(failures).toEqual([]);
  });
});
