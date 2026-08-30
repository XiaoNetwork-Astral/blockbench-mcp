import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  applySelectionAction,
  assertMeshVertexKeys,
  listMeshEdges,
  meshEdgeId,
  resolveMeshSelection,
  sameMeshEdge,
} from "@/lib/meshEditing";

const source = {
  vertices: {
    va: [0, 0, 0],
    vb: [1, 0, 0],
    vc: [1, 1, 0],
    vd: [0, 1, 0],
  },
  faces: {
    front: { getEdges: () => [["va", "vb"], ["vb", "vc"], ["vc", "va"]] as [string, string][] },
    back: { getEdges: () => [["va", "vc"], ["vc", "vd"], ["vd", "va"]] as [string, string][] },
  },
};

describe("direct mesh editing contracts", () => {
  test("resolves mutable Blockbench selection arrays after changing selection mode", () => {
    const source = readFileSync("server/tools/mesh.ts", "utf8");
    const handler = source.slice(
      source.indexOf("async execute({ mesh_id, mode, elements, action })"),
      source.indexOf("createInternalTool(meshToolDocs[5].name")
    );
    expect(handler.indexOf("BarItems.selection_mode.set(mode)")).toBeLessThan(
      handler.indexOf("mesh.getSelectedVertices(true)")
    );
    expect(handler).toContain("Undo.initSelection()");
    expect(handler).toContain('Undo.finishSelection("Select mesh elements")');
  });
  test("resolves opaque vertex and face keys from keys or numeric indices", () => {
    expect(resolveMeshSelection(source, "vertex", [0, "vc"]).vertices).toEqual(["va", "vc"]);
    expect(resolveMeshSelection(source, "face", [1]).faces).toEqual(["back"]);
    expect(resolveMeshSelection(source, "vertex").vertices).toEqual(["va", "vb", "vc", "vd"]);
    expect(() => resolveMeshSelection(source, "vertex", ["0"])).toThrow('vertex key "0"');
    expect(() => resolveMeshSelection(source, "face", [8])).toThrow("index 8");
  });

  test("deduplicates undirected edges and validates explicit edge references", () => {
    const edges = listMeshEdges(source);
    expect(edges).toHaveLength(5);
    expect(new Set(edges.map(meshEdgeId)).size).toBe(5);
    expect(sameMeshEdge(resolveMeshSelection(source, "edge", ["vc-va"]).edges[0], ["va", "vc"])).toBe(true);
    expect(() => resolveMeshSelection(source, "edge", ["missing-edge"])).toThrow("does not exist");
  });

  test("applies replace, add, remove, and toggle without duplicate identities", () => {
    expect(applySelectionAction(["a"], ["b"], "select")).toEqual(["b"]);
    expect(applySelectionAction(["a"], ["a", "b"], "add")).toEqual(["a", "b"]);
    expect(applySelectionAction(["a", "b"], ["a"], "remove")).toEqual(["b"]);
    expect(applySelectionAction(["a", "b"], ["b", "c"], "toggle")).toEqual(["a", "c"]);
  });

  test("names the first invalid vertex before a mutation starts", () => {
    expect(() => assertMeshVertexKeys(source.vertices, ["va", "missing"], 2)).toThrow(
      'vertex key "missing"'
    );
    expect(() => assertMeshVertexKeys(source.vertices, [], 1)).toThrow("At least 1");
    expect(() => assertMeshVertexKeys(source.vertices, ["va"], 1)).not.toThrow();
  });
});
