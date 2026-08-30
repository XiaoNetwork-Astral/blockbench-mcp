import { describe, expect, test } from "bun:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  ALL_TOOL_SPECS,
  CORE_TOOL_SPECS,
  HYTALE_TOOL_SPECS,
  YSM_TOOL_SPECS,
} from "@/src/runtime/toolCatalog";
import { tools as registeredTools } from "@/server/tools";

function containsTupleStyleItems(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsTupleStyleItems);

  const object = value as Record<string, unknown>;
  if (Array.isArray(object.items)) return true;
  return Object.values(object).some(containsTupleStyleItems);
}

const removedNames = [
  "set_working_project",
  "show_project",
  "set_preview_state",
  "close_projects_without_saving",
  "ysm_edit_molang_expressions",
];

const replacementNames = [
  "select_project",
  "close_project_without_saving",
  "save_project",
  "preview_ysm_molang_edits",
  "edit_ysm_molang",
];

describe("v2 direct tool contract", () => {
  test("contains 144 unique direct operations", () => {
    const names = ALL_TOOL_SPECS.map(({ name }) => name);
    expect(CORE_TOOL_SPECS).toHaveLength(118);
    expect(YSM_TOOL_SPECS).toHaveLength(14);
    expect(HYTALE_TOOL_SPECS).toHaveLength(12);
    expect(names).toHaveLength(144);
    expect(new Set(names).size).toBe(names.length);
  });

  test("registers every non-Hytale catalog entry", () => {
    const expected = [...CORE_TOOL_SPECS, ...YSM_TOOL_SPECS]
      .map(({ name }) => name)
      .sort();
    expect(Object.keys(registeredTools).sort()).toEqual(expected);
  });

  test("emits client-compatible array schemas", () => {
    const incompatible = ALL_TOOL_SPECS.flatMap((tool) => {
      const schema = zodToJsonSchema(tool.parameters, { $refStrategy: "root" });
      return containsTupleStyleItems(schema) ? [tool.name] : [];
    });
    expect(incompatible).toEqual([]);
  });

  test("uses the approved replacements and exposes no grouped catalog", () => {
    const names = new Set(ALL_TOOL_SPECS.map(({ name }) => name));
    for (const name of removedNames) expect(names.has(name)).toBe(false);
    for (const name of replacementNames) expect(names.has(name)).toBe(true);
    for (const grouped of [
      "inspect_projects",
      "edit_projects",
      "inspect_elements",
      "edit_elements",
      "inspect_model_validation",
      "inspect_ysm",
      "edit_ysm_workspace",
      "inspect_hytale",
      "edit_hytale",
    ]) {
      expect(names.has(grouped)).toBe(false);
    }
  });

  test("schemas accept direct inputs without command.action wrappers", () => {
    const wrapped = ALL_TOOL_SPECS.flatMap((tool) => {
      const schema = zodToJsonSchema(tool.parameters, { $refStrategy: "root" }) as {
        properties?: Record<string, unknown>;
      };
      return schema.properties?.command ? [tool.name] : [];
    });
    expect(wrapped).toEqual([]);
  });

  test("does not expose retired routing or ignored graph-axis inputs", () => {
    const properties = (name: string): Record<string, unknown> => {
      const tool = ALL_TOOL_SPECS.find((candidate) => candidate.name === name);
      expect(tool).toBeDefined();
      const schema = zodToJsonSchema(tool!.parameters, { $refStrategy: "root" }) as {
        properties?: Record<string, unknown>;
      };
      return schema.properties ?? {};
    };

    expect(Object.keys(properties("close_project_without_saving"))).toEqual([]);
    expect(properties("animation_graph_editor").axis).toBeUndefined();
  });
});
