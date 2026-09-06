import { describe, expect, test } from "bun:test";
import { meshTools } from "@/server/tools/mesh";
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
  test("writes selection into the arrays created by the new Blockbench selection mode", async () => {
    const calls: string[] = [];
    let vertices: string[] = ["stale"];
    let edges: [string, string][] = [];
    let faces: string[] = [];
    const oldVertices = vertices;
    const mesh = {
      ...source,
      uuid: "mesh-1",
      name: "Mesh",
      select: () => calls.push("select"),
      getSelectedVertices: () => vertices,
      getSelectedEdges: () => edges,
      getSelectedFaces: () => faces,
    };
    const globals = {
      Mesh: { all: [mesh] },
      BarItems: {
        selection_mode: {
          set: (mode: string) => {
            calls.push(mode);
            vertices = [];
            edges = [];
            faces = [];
          }
        }
      },
      Undo: {
        initSelection: () => calls.push("begin"),
        finishSelection: (label: string) => calls.push(label),
        cancelSelection: () => calls.push("cancel"),
      },
      Canvas: { updateView: () => calls.push("update") },
    };
    const saved = new Map(Object.keys(globals).map((key) => [
      key, Object.getOwnPropertyDescriptor(globalThis, key),
    ]));
    try {
      for (const [key, value] of Object.entries(globals)) {
        Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
      }
      const tool = meshTools.find((tool) => tool.name === "select_mesh_elements")!;
      const result = await tool.execute(tool.parameters.parse({
        mesh_id: "mesh-1", mode: "vertex", elements: ["va", "vc"],
      }), { project: null });
      expect(vertices).toEqual(["va", "vc"]);
      expect(oldVertices).toEqual(["stale"]);
      expect(JSON.parse(result as string).selected.vertex_keys).toEqual(vertices);
      expect(calls).toEqual(["begin", "select", "vertex", "update", "Select mesh elements"]);
    } finally {
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
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
