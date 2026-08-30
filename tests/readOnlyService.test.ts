import { describe, expect, test } from "bun:test";
import {
  isProjectReadOnly,
  projectReadOnlyKey,
  setProjectReadOnly,
} from "@/src/features/readOnly/service";

function project(uuid: string, path = ""): ModelProject {
  return { uuid, save_path: path } as ModelProject;
}

function installStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  (globalThis as any).localStorage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
  return values;
}

describe("explicit project read-only service", () => {
  test("persists only explicit locks by normalized path", () => {
    const values = installStorage();
    const first = project("first", "D:\\Models\\Hero.bbmodel");
    setProjectReadOnly(first, true);

    expect(projectReadOnlyKey(first)).toBe("path:d:/models/hero.bbmodel");
    expect(isProjectReadOnly(first)).toBe(true);
    expect(values.get("blockbench_mcp.read_only_projects")).toContain(
      "path:d:/models/hero.bbmodel"
    );

    setProjectReadOnly(first, false);
    expect(isProjectReadOnly(first)).toBe(false);
  });

  test("migrates readOnly flags without taking ownership of workflow roles", () => {
    const values = installStorage({
      "blockbench_mcp.project_roles": JSON.stringify({
        "uuid:locked": { role: "working_copy", readOnly: true },
        "uuid:legacy": { role: "legacy_reference" },
      }),
    });

    expect(isProjectReadOnly(project("locked"))).toBe(true);
    expect(isProjectReadOnly(project("legacy"))).toBe(false);
    expect(values.get("blockbench_mcp.project_roles")).toContain("working_copy");
  });
});
