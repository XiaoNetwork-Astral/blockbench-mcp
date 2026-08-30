import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  ALL_TOOL_SPECS,
  CORE_TOOL_SPECS,
  HYTALE_TOOL_SPECS,
  YSM_TOOL_SPECS,
} from "@/src/runtime/toolCatalog";
import { ysmSaveProjectParameters } from "@/server/tools/ysm";

const formerGroups = new Set([
  "inspect_projects",
  "edit_projects",
  "inspect_elements",
  "edit_elements",
  "inspect_textures",
  "edit_textures",
  "inspect_materials",
  "edit_materials",
  "inspect_hytale",
  "edit_hytale",
  "inspect_ysm",
  "edit_ysm_workspace",
]);

function objectShape(schema: z.ZodType): Record<string, z.ZodType> {
  const definition = schema._def as {
    typeName?: string;
    schema?: z.ZodType;
    shape?: () => Record<string, z.ZodType>;
  };
  if (definition.typeName === "ZodEffects" && definition.schema) {
    return objectShape(definition.schema);
  }
  return definition.typeName === "ZodObject" ? definition.shape?.() ?? {} : {};
}

describe("direct tool schemas", () => {
  test("publishes the intended v2 catalog", () => {
    expect(CORE_TOOL_SPECS).toHaveLength(118);
    expect(YSM_TOOL_SPECS).toHaveLength(14);
    expect(HYTALE_TOOL_SPECS).toHaveLength(12);
    expect(ALL_TOOL_SPECS).toHaveLength(144);
    expect(new Set(ALL_TOOL_SPECS.map(({ name }) => name)).size).toBe(144);
  });

  test("uses direct input objects and contains no former grouped tool", () => {
    for (const spec of ALL_TOOL_SPECS) {
      expect(formerGroups.has(spec.name)).toBe(false);
      expect(objectShape(spec.parameters)).not.toHaveProperty("command");
    }
  });

  test("keeps public metadata complete and free of the removed routing contract", () => {
    for (const spec of ALL_TOOL_SPECS) {
      expect(spec.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(spec.description.trim().length).toBeGreaterThan(0);
      expect(spec.description).not.toMatch(/command\.action|MCP working project/i);
      expect(["stable", "experimental", "deprecated"]).toContain(spec.status);
    }
  });

  test("keeps YSM save conflict detection internal", () => {
    expect(objectShape(ysmSaveProjectParameters)).not.toHaveProperty("expected_source_sha256");
    expect(ysmSaveProjectParameters.parse({})).toEqual({
      include_texture: true,
      include_bbmodel: true,
    });
  });
});
