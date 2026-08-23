import { describe, expect, test } from "bun:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import { toolManifest } from "@/build/docs-manifest";
import {
  animationPublicToolDocs,
  animationToolDocs,
} from "@/server/tools/animation";
import {
  armaturePublicToolDocs,
  armatureToolDocs,
} from "@/server/tools/armature";
import { cameraToolDocs } from "@/server/tools/camera";
import { codexTextureToolDocs } from "@/server/tools/codex-texture";
import { cubeToolDocs } from "@/server/tools/cubes";
import {
  displayPublicToolDocs,
  displayToolDocs,
} from "@/server/tools/display";
import {
  elementPublicToolDocs,
  elementToolDocs,
} from "@/server/tools/element";
import { exportToolDocs } from "@/server/tools/export";
import {
  historyPublicToolDocs,
  historyToolDocs,
} from "@/server/tools/history";
import {
  hytalePublicToolDocs,
  hytaleToolDocs,
} from "@/server/tools/hytale";
import { importToolDocs } from "@/server/tools/import";
import {
  materialInstancePublicToolDocs,
  materialInstanceToolDocs,
} from "@/server/tools/material-instances";
import { meshPublicToolDocs, meshToolDocs } from "@/server/tools/mesh";
import { paintPublicToolDocs, paintToolDocs } from "@/server/tools/paint";
import { previewToolDocs } from "@/server/tools/preview";
import { projectPublicToolDocs, projectToolDocs } from "@/server/tools/project";
import { spatialPublicToolDocs, spatialToolDocs } from "@/server/tools/spatial";
import { texturePublicToolDocs, textureToolDocs } from "@/server/tools/texture";
import { uvPublicToolDocs, uvToolDocs } from "@/server/tools/uv";
import {
  workflowPublicToolDocs,
  workflowToolDocs,
} from "@/server/tools/workflow";
import { ysmPublicToolDocs, ysmToolDocs } from "@/server/tools/ysm";

const corePublicToolDocs = [
  ...animationPublicToolDocs,
  ...armaturePublicToolDocs,
  ...cameraToolDocs,
  ...codexTextureToolDocs,
  ...cubeToolDocs,
  ...displayPublicToolDocs,
  ...elementPublicToolDocs,
  ...exportToolDocs,
  ...historyPublicToolDocs,
  ...importToolDocs,
  ...materialInstancePublicToolDocs,
  ...meshPublicToolDocs,
  ...paintPublicToolDocs,
  ...previewToolDocs,
  ...projectPublicToolDocs,
  ...spatialPublicToolDocs,
  ...texturePublicToolDocs,
  ...uvPublicToolDocs,
  ...workflowPublicToolDocs,
  ...ysmPublicToolDocs,
];

const groupedLegacyToolDocs = [
  ...animationToolDocs,
  ...armatureToolDocs,
  ...displayToolDocs,
  ...elementToolDocs,
  ...historyToolDocs,
  ...hytaleToolDocs,
  ...materialInstanceToolDocs,
  ...meshToolDocs,
  ...paintToolDocs,
  ...projectToolDocs,
  ...spatialToolDocs,
  ...textureToolDocs,
  ...uvToolDocs,
  ...workflowToolDocs,
  ...ysmToolDocs,
];

const groupedPublicToolDocs = [
  ...animationPublicToolDocs,
  ...armaturePublicToolDocs,
  ...displayPublicToolDocs,
  ...elementPublicToolDocs,
  ...historyPublicToolDocs,
  ...hytalePublicToolDocs,
  ...materialInstancePublicToolDocs,
  ...meshPublicToolDocs,
  ...paintPublicToolDocs,
  ...projectPublicToolDocs,
  ...spatialPublicToolDocs,
  ...texturePublicToolDocs,
  ...uvPublicToolDocs,
  ...workflowPublicToolDocs,
  ...ysmPublicToolDocs,
];

const retiredDuplicateActions = new Set([
  "activate_texture",
  "set_face_material_instance",
  "set_vertex_weight",
]);

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

function findActionLiterals(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(findActionLiterals);

  const object = value as Record<string, unknown>;
  const properties = object.properties as Record<string, unknown> | undefined;
  const action = properties?.action as Record<string, unknown> | undefined;
  const own = typeof action?.const === "string" ? [action.const] : [];
  return own.concat(Object.values(object).flatMap(findActionLiterals));
}

describe("Codex MCP schema compatibility", () => {
  test("all 41 core public tools avoid unsupported draft-07 tuple items", () => {
    const failures = corePublicToolDocs.flatMap((tool) => {
      const schema = zodToJsonSchema(tool.parameters, { $refStrategy: "root" });
      return findTupleItems(schema).map((path) => `${tool.name}: ${path}`);
    });

    expect(corePublicToolDocs).toHaveLength(41);
    expect(failures).toEqual([]);
  });

  test("the compact core metadata stays below the previous catalog cost", () => {
    const metadata = corePublicToolDocs.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.parameters, { $refStrategy: "none" }),
    }));
    const bytes = new TextEncoder().encode(JSON.stringify(metadata)).byteLength;

    expect(bytes).toBeLessThan(130_000);
  });

  test("both optional Hytale public tools use compatible schemas", () => {
    const failures = hytalePublicToolDocs.flatMap((tool) => {
      const schema = zodToJsonSchema(tool.parameters, { $refStrategy: "root" });
      return findTupleItems(schema).map((path) => `${tool.name}: ${path}`);
    });

    expect(hytalePublicToolDocs).toHaveLength(2);
    expect(failures).toEqual([]);
  });

  test("grouped commands cover every operation and retired duplicates are gone", () => {
    const expectedActions = groupedLegacyToolDocs
      .map(({ name }) => name)
      .sort();
    const actualActions = groupedPublicToolDocs
      .flatMap((tool) =>
        findActionLiterals(
          zodToJsonSchema(tool.parameters, { $refStrategy: "root" })
        )
      )
      .sort();

    expect(actualActions).toEqual(expectedActions);
    expect(new Set(actualActions).size).toBe(actualActions.length);
    for (const action of retiredDuplicateActions) {
      expect(expectedActions).not.toContain(action);
      expect(actualActions).not.toContain(action);
    }
  });

  test("grouped commands retain exact per-action argument validation", () => {
    const editElements = elementPublicToolDocs.find(
      ({ name }) => name === "edit_elements"
    );
    expect(editElements).toBeDefined();
    expect(
      editElements?.parameters.safeParse({
        command: {
          action: "add_group",
          input: { name: "body", parent: "root" },
        },
      }).success
    ).toBe(true);
    expect(
      editElements?.parameters.safeParse({
        command: { action: "add_group", input: { name: "body" } },
      }).success
    ).toBe(false);
  });

  test("read and write actions never share an audit or mutation boundary", () => {
    const legacyByName = new Map(
      groupedLegacyToolDocs.map((tool) => [tool.name, tool])
    );
    const mismatches: string[] = [];

    for (const group of groupedPublicToolDocs) {
      const groupIsReadOnly = group.annotations?.readOnlyHint === true;
      const actions = findActionLiterals(
        zodToJsonSchema(group.parameters, { $refStrategy: "root" })
      );
      for (const action of actions) {
        const operation = legacyByName.get(action);
        if (!operation) {
          mismatches.push(`${group.name}: unknown action ${action}`);
          continue;
        }
        const operationIsReadOnly =
          operation.annotations?.readOnlyHint === true;
        if (operationIsReadOnly !== groupIsReadOnly) {
          mismatches.push(
            `${group.name}/${action}: group readOnly=${groupIsReadOnly}, action readOnly=${operationIsReadOnly}`
          );
        }
      }
    }

    expect(mismatches).toEqual([]);
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

    expect(core).toHaveLength(41);
    expect(optional).toHaveLength(2);
    expect(documented).toHaveLength(43);
    expect(new Set(documented.map(({ name }) => name)).size).toBe(43);
    expect(optional.map(({ name }) => name).sort()).toEqual(
      hytalePublicToolDocs.map(({ name }) => name).sort()
    );
  });
});
