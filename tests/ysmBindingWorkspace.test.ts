import { describe, expect, test } from "bun:test";
import { getMolangCatalogProvenance } from "@/lib/molang/catalog";
import {
  getYsmBindingPathStates,
  getYsmBindingWorkspaceState,
  type YsmBinding,
} from "@/lib/ysmBindings";

describe("YSM workspace identity", () => {
  test("distinguishes current, stale, legacy, and unconfigured bindings", () => {
    expect(getYsmBindingWorkspaceState(
      { workspaceRoot: "D:\\Models\\Workspace" },
      "d:/models/workspace/"
    )).toBe("current");
    expect(getYsmBindingWorkspaceState(
      { workspaceRoot: "D:/Models/Old" },
      "D:/Models/New"
    )).toBe("stale");
    expect(getYsmBindingWorkspaceState({}, "D:/Models/New")).toBe("legacy");
    expect(getYsmBindingWorkspaceState(
      { workspaceRoot: "D:/Models/Old" },
      ""
    )).toBe("unconfigured");
  });

  test("catalog provenance summaries omit the large source-file inventory", () => {
    const provenance = getMolangCatalogProvenance("stable_2_6_5");
    expect(provenance.file_count).toBeGreaterThan(0);
    expect("files" in provenance).toBe(false);
    expect(provenance.root_digest.length).toBe(64);
  });

  test("does not interpret legacy or stale binding paths in the current workspace", () => {
    const legacy = {
      geometry: "old/models/main.json",
      texture: "old/textures/default.png",
      bbmodel: null,
      manifest: null,
    } as YsmBinding;
    let checks = 0;
    const exists = () => {
      checks++;
      return false;
    };

    expect(getYsmBindingPathStates(legacy, "D:/Current", exists)).toEqual([
      { kind: "geometry", path: "old/models/main.json", state: "unchecked" },
      { kind: "texture", path: "old/textures/default.png", state: "unchecked" },
    ]);
    expect(getYsmBindingPathStates(
      { ...legacy, workspaceRoot: "D:/Previous" },
      "D:/Current",
      exists
    ).every((entry) => entry.state === "unchecked")).toBe(true);
    expect(checks).toBe(0);
  });

  test("checks paths only for a binding owned by the current workspace", () => {
    const binding = {
      workspaceRoot: "D:/Current",
      geometry: "models/main.json",
      texture: null,
      bbmodel: null,
      manifest: null,
    } as YsmBinding;
    expect(getYsmBindingPathStates(
      binding,
      "d:/current/",
      (path) => path === "models/main.json"
    )).toEqual([
      { kind: "geometry", path: "models/main.json", state: "valid" },
    ]);
  });
});
