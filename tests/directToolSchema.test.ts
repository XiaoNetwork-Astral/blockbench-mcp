import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  ALL_TOOL_SPECS,
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
  return schema instanceof z.ZodObject ? schema.shape : {};
}

describe("direct tool schemas", () => {
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
