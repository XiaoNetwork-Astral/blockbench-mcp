import { describe, expect, test } from "bun:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import { toolManifest } from "@/build/docs-manifest";
import { animationToolDocs } from "@/server/tools/animation";
import { armatureToolDocs } from "@/server/tools/armature";
import { cameraToolDocs } from "@/server/tools/camera";
import { codexTextureToolDocs } from "@/server/tools/codex-texture";
import { cubeToolDocs } from "@/server/tools/cubes";
import { displayToolDocs } from "@/server/tools/display";
import { elementToolDocs } from "@/server/tools/element";
import { exportToolDocs } from "@/server/tools/export";
import { historyToolDocs } from "@/server/tools/history";
import { hytaleToolDocs } from "@/server/tools/hytale";
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
  ...displayToolDocs,
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
  test("all 108 tools avoid unsupported draft-07 tuple items", () => {
    const failures = toolDocs.flatMap((tool) => {
      const schema = zodToJsonSchema(tool.parameters, { $refStrategy: "root" });
      return findTupleItems(schema).map((path) => `${tool.name}: ${path}`);
    });

    expect(toolDocs).toHaveLength(108);
    expect(failures).toEqual([]);
  });

  test("all 12 optional Hytale tools use compatible schemas", () => {
    const failures = hytaleToolDocs.flatMap((tool) => {
      const schema = zodToJsonSchema(tool.parameters, { $refStrategy: "root" });
      return findTupleItems(schema).map((path) => `${tool.name}: ${path}`);
    });

    expect(hytaleToolDocs).toHaveLength(12);
    expect(failures).toEqual([]);
  });

  test("generated API docs include the complete core and optional catalogs", () => {
    const documented = toolManifest.flatMap(({ category, tools }) =>
      tools.map((tool) => ({ category, name: tool.name }))
    );
    const optional = documented.filter(({ category }) =>
      category.endsWith("(optional)")
    );
    const core = documented.filter(({ category }) =>
      !category.endsWith("(optional)")
    );

    expect(core).toHaveLength(108);
    expect(optional).toHaveLength(12);
    expect(documented).toHaveLength(120);
    expect(new Set(documented.map(({ name }) => name)).size).toBe(120);
    expect(optional.map(({ name }) => name).sort()).toEqual(
      hytaleToolDocs.map(({ name }) => name).sort()
    );
  });
});
