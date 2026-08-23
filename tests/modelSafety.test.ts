import { afterEach, describe, expect, test } from "bun:test";
import { resolveUniqueReference, vectorsNearlyEqual } from "@/lib/modelSafety";
import { rollbackUndoEditStartedAfter } from "@/lib/undoSafety";
import { analyzeBoundsPair } from "@/lib/spatialRelations";
import { expandOutlinerGeometryWorldBounds } from "@/lib/sceneBounds";
import * as THREE from "three";
import {
  MAX_GEOMETRY_JSON_BYTES,
  classifyGeometryJsonSource,
} from "@/lib/importSource";
import { placeCubeParameters } from "@/server/tools/cubes";
import {
  addGroupParameters,
  duplicateElementParameters,
} from "@/server/tools/element";
import {
  createCylinderParameters,
  createPyramidParameters,
  createSphereParameters,
  placeMeshParameters,
} from "@/server/tools/mesh";
import { addArmatureParameters } from "@/server/tools/armature";
import { boneRiggingParameters } from "@/server/tools/animation";
import { reparentElementParameters } from "@/server/tools/element";
import {
  closeProjectParameters,
  setProjectTextureResolutionParameters,
} from "@/server/tools/project";
import { hytaleCreateQuadParametersSchema } from "@/server/tools/hytale";

describe("deterministic model references", () => {
  const candidates = [
    { uuid: "id-a", name: "part" },
    { uuid: "id-b", name: "part" },
    { uuid: "id-c", name: "unique" },
  ];

  test("exact UUID wins while names must be unique", () => {
    expect(resolveUniqueReference("id-a", candidates, "Node", "list_outline").uuid).toBe("id-a");
    expect(resolveUniqueReference("unique", candidates, "Node", "list_outline").uuid).toBe("id-c");
    expect(() => resolveUniqueReference("part", candidates, "Node", "list_outline"))
      .toThrow(/ambiguous.*id-a, id-b/i);
    expect(() => resolveUniqueReference("missing", candidates, "Node", "list_outline"))
      .toThrow(/not found/i);
  });

  test("accepts harmless floating-point readback differences", () => {
    expect(vectorsNearlyEqual(
      [-0.44384999999999986, 1, 2],
      [-0.44385, 1, 2]
    )).toBe(true);
    expect(vectorsNearlyEqual([0, 0, 0], [0, 0.001, 0])).toBe(false);
  });
});

describe("bounded Undo failure cleanup", () => {
  const originalUndo = (globalThis as any).Undo;

  afterEach(() => {
    if (originalUndo === undefined) delete (globalThis as any).Undo;
    else (globalThis as any).Undo = originalUndo;
  });

  test("cancels only an edit opened after the tool started", () => {
    const calls: unknown[] = [];
    const current = { id: "tool-edit" };
    (globalThis as any).Undo = {
      current_save: current,
      cancelEdit(revert: boolean) { calls.push(revert); },
    };
    expect(rollbackUndoEditStartedAfter(undefined)).toBe(true);
    expect(calls).toEqual([true]);

    calls.length = 0;
    expect(rollbackUndoEditStartedAfter(current)).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("world-bounds relationship analysis", () => {
  test("ignores editor-only scene children while retaining Outliner descendants", () => {
    const parentObject = new THREE.Object3D();
    const cubeObject = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    cubeObject.position.set(1, 1, 6);
    parentObject.add(cubeObject);

    const editorHelper = new THREE.LineSegments(new THREE.BoxGeometry(7, 7, 7));
    editorHelper.name = "selection_outline";
    cubeObject.add(editorHelper);

    const siblingObject = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    siblingObject.position.set(10.5, 0.5, 0.5);
    parentObject.add(siblingObject);

    const bounds = expandOutlinerGeometryWorldBounds(
      {
        scene_object: parentObject,
        children: [
          { scene_object: cubeObject },
          { scene_object: siblingObject },
        ],
      },
      new THREE.Box3()
    );

    expect(bounds.min.toArray()).toEqual([0, 0, 0]);
    expect(bounds.max.toArray()).toEqual([11, 2, 7]);
  });

  test("flags front-view overlap that hides a depth gap", () => {
    const result = analyzeBoundsPair(
      { min: [0, 0, 0], max: [2, 2, 1] },
      { min: [1, 1, 4], max: [3, 3, 5] }
    );
    expect(result.separated_axes).toEqual(["z"]);
    expect(result.projection_depth_warnings).toEqual([
      {
        view: "front",
        projection_axes: ["x", "y"],
        depth_axis: "z",
        depth_gap: 3,
      },
    ]);
  });

  test("touching bounds are not reported as separated", () => {
    const result = analyzeBoundsPair(
      { min: [0, 0, 0], max: [1, 1, 1] },
      { min: [1, 0, 0], max: [2, 1, 1] }
    );
    expect(result.separated_axes).toEqual([]);
    expect(result.axes.x.touching).toBe(true);
  });
});

describe("explicit Outliner parent schemas", () => {
  const cube = { name: "cube", from: [0, 0, 0], to: [1, 1, 1] };
  const mesh = { name: "mesh" };

  test("creation and duplication reject omitted parents but accept literal root", () => {
    expect(() => placeCubeParameters.parse({ elements: [cube] })).toThrow();
    expect(placeCubeParameters.parse({ elements: [cube], group: "root" }).group).toBe("root");
    expect(() => addGroupParameters.parse({ name: "group" })).toThrow();
    expect(addGroupParameters.parse({ name: "group", parent: "root" }).parent).toBe("root");
    expect(() => duplicateElementParameters.parse({ id: "cube" })).toThrow();
    expect(duplicateElementParameters.parse({ id: "cube", parent: "root" }).parent).toBe("root");
    expect(() => placeMeshParameters.parse({ elements: [mesh] })).toThrow();
    expect(placeMeshParameters.parse({ elements: [mesh], group: "root" }).group).toBe("root");
  });

  test("generated mesh and armature tools require explicit placement", () => {
    const sphere = { name: "sphere", position: [0, 0, 0] };
    const cylinder = { name: "cylinder", position: [0, 0, 0] };
    expect(() => createSphereParameters.parse({ elements: [sphere] })).toThrow();
    expect(createSphereParameters.parse({ elements: [sphere], group: "root" }).group).toBe("root");
    expect(() => createCylinderParameters.parse({ elements: [cylinder] })).toThrow();
    expect(createCylinderParameters.parse({ elements: [cylinder], group: "root" }).group).toBe("root");
    const pyramid = {
      name: "pyramid",
      base_center: [0, 0, 0],
      apex: [0, 4, 0],
    };
    expect(() => createPyramidParameters.parse({ elements: [pyramid] })).toThrow();
    expect(createPyramidParameters.parse({ elements: [pyramid], group: "root" }))
      .toMatchObject({ group: "root", elements: [{ sides: 4, capped: true }] });
    expect(() => addArmatureParameters.parse({})).toThrow();
    expect(addArmatureParameters.parse({ parent: "root" }).parent).toBe("root");
    expect(() => hytaleCreateQuadParametersSchema.parse({ name: "quad" })).toThrow();
    expect(hytaleCreateQuadParametersSchema.parse({ name: "quad", group: "root" }).group)
      .toBe("root");
  });

  test("reparenting preserves world transforms by default and requires an explicit parent", () => {
    expect(() => reparentElementParameters.parse({ id: "part" })).toThrow();
    expect(reparentElementParameters.parse({ id: "part", parent: "root" }))
      .toMatchObject({ parent: "root", preserve_world_transform: true });
  });

  test("bone rigging makes hierarchy and rename intent explicit", () => {
    expect(() => boneRiggingParameters.parse({
      action: "create",
      bone_data: { name: "bone" },
    })).toThrow(/parent/i);
    expect(() => boneRiggingParameters.parse({
      action: "unparent",
      bone_data: { name: "bone", parent: "other" },
    })).toThrow(/root/i);
    expect(() => boneRiggingParameters.parse({
      action: "rename",
      bone_data: { name: "bone" },
    })).toThrow(/new_name/i);
    expect(boneRiggingParameters.parse({
      action: "create",
      bone_data: { name: "bone", parent: "root" },
    }).bone_data.parent).toBe("root");
  });
});

describe("geometry import source safety", () => {
  test("allows inline, data URL, file URL, and Windows paths", () => {
    expect(classifyGeometryJsonSource('{"minecraft:geometry":[]}').kind).toBe("inline");
    expect(classifyGeometryJsonSource("data:application/json,%7B%7D")).toEqual({
      kind: "inline",
      text: "{}",
    });
    expect(classifyGeometryJsonSource("file:///C:/models/test.geo.json")).toEqual({
      kind: "local_file",
      path: "C:/models/test.geo.json",
    });
    expect(classifyGeometryJsonSource("D:\\models\\test.geo.json")).toEqual({
      kind: "local_file",
      path: "D:\\models\\test.geo.json",
    });
  });

  test("rejects remote URLs, unsupported data media, and oversized inline input", () => {
    expect(() => classifyGeometryJsonSource("http://127.0.0.1/private.geo.json"))
      .toThrow(/disabled/i);
    expect(() => classifyGeometryJsonSource("data:text/plain,%7B%7D"))
      .toThrow(/media type/i);
    expect(() => classifyGeometryJsonSource(`{"data":"${"x".repeat(MAX_GEOMETRY_JSON_BYTES)}"}`))
      .toThrow(/maximum/i);
  });
});

describe("project mutation safety schemas", () => {
  test("close requires an explicit discard decision", () => {
    expect(() => closeProjectParameters.parse({ targets: "active" })).toThrow();
    expect(closeProjectParameters.parse({
      targets: "active",
      discard_unsaved_changes: false,
    }).discard_unsaved_changes).toBe(false);
  });

  test("texture resolution preserves UVs by default", () => {
    expect(setProjectTextureResolutionParameters.parse({ width: 64, height: 32 }))
      .toMatchObject({ width: 64, height: 32, modify_uv: false });
  });
});
