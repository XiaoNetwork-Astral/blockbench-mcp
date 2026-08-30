import { describe, expect, test } from "bun:test";
import {
  assertMatchingArmature,
  assertMeshWeightVertexKeys,
  setVertexWeightsBatchParameters,
} from "@/server/tools/armature";

describe("armature weight validation", () => {
  test("requires the mesh and bone to belong to the same armature", () => {
    const rig = { uuid: "rig-a", name: "Rig A" };
    expect(() => assertMatchingArmature("Mesh", "Bone", rig, rig)).not.toThrow();
    expect(() => assertMatchingArmature(
      "Mesh",
      "Bone",
      rig,
      { uuid: "rig-b", name: "Rig B" }
    )).toThrow('not mesh "Mesh"\'s armature "Rig A"');
    expect(() => assertMatchingArmature("Mesh", "Bone", undefined, rig)).toThrow(
      'Mesh "Mesh" is not associated with an armature.'
    );
  });

  test("rejects missing mesh vertex keys before mutation", () => {
    expect(() => assertMeshWeightVertexKeys(
      "Mesh",
      { a: [0, 0, 0] },
      ["a", "missing"]
    )).toThrow('Mesh "Mesh" has no vertex key: missing.');
  });

  test("rejects an empty batch", () => {
    expect(setVertexWeightsBatchParameters.safeParse({
      bone_id: "Bone",
      mesh_id: "Mesh",
      weights: {},
    }).success).toBe(false);
  });
});
