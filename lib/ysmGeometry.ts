type JsonObject = Record<string, unknown>;

const COMPILED_BONE_FIELDS = [
  "parent",
  "pivot",
  "rotation",
  "mirror",
  "inflate",
  "debug",
  "render_group_id",
  "locators",
  "cubes",
  "poly_mesh",
  "texture_meshes",
  "reset",
] as const;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function geometries(document: JsonObject): JsonObject[] {
  const value = document["minecraft:geometry"];
  if (!Array.isArray(value)) {
    throw new Error('Geometry document has no "minecraft:geometry" array.');
  }
  return value.filter(isObject);
}

function identifierOf(geometry: JsonObject): string | null {
  const description = geometry.description;
  return isObject(description) && typeof description.identifier === "string"
    ? description.identifier
    : null;
}

export function selectGeometry(
  document: JsonObject,
  identifier?: string | null
): { geometry: JsonObject; index: number; identifier: string | null } {
  const entries = geometries(document);
  if (!entries.length) throw new Error("Geometry document contains no geometry entries.");
  const index = identifier
    ? entries.findIndex((geometry) => identifierOf(geometry) === identifier)
    : 0;
  if (index < 0) {
    const available = entries.map(identifierOf).filter(Boolean).join(", ");
    throw new Error(
      `Geometry identifier "${identifier}" was not found. Available: ${available || "(unnamed)"}.`
    );
  }
  return { geometry: entries[index], index, identifier: identifierOf(entries[index]) };
}

export function geometryCounts(geometry: JsonObject): {
  bones: number;
  cubes: number;
} {
  const bones = Array.isArray(geometry.bones) ? geometry.bones.filter(isObject) : [];
  return {
    bones: bones.length,
    cubes: bones.reduce(
      (count, bone) => count + (Array.isArray(bone.cubes) ? bone.cubes.length : 0),
      0
    ),
  };
}

function indexedBones(geometry: JsonObject, label: string): Map<string, JsonObject> {
  const result = new Map<string, JsonObject>();
  const bones = Array.isArray(geometry.bones) ? geometry.bones.filter(isObject) : [];
  for (const bone of bones) {
    if (typeof bone.name !== "string" || !bone.name) {
      throw new Error(`${label} contains a bone without a valid name.`);
    }
    if (result.has(bone.name)) {
      throw new Error(`${label} contains duplicate bone name "${bone.name}".`);
    }
    result.set(bone.name, bone);
  }
  return result;
}

/**
 * Use Blockbench's compiled geometry as the authority for editable model data,
 * while preserving description bounds and any YSM/private fields that the
 * Bedrock codec does not understand. Removed bones stay removed; new bones are
 * inserted in Blockbench order.
 */
export function mergeCompiledGeometry(
  sourceDocument: JsonObject,
  compiledDocument: JsonObject,
  identifier?: string | null
): JsonObject {
  const output = clone(sourceDocument);
  const sourceSelection = selectGeometry(output, identifier);
  const compiledSelection = selectGeometry(
    compiledDocument,
    sourceSelection.identifier ?? identifier
  );
  const sourceGeometry = sourceSelection.geometry;
  const compiledGeometry = compiledSelection.geometry;
  const sourceBones = indexedBones(sourceGeometry, "Source geometry");
  indexedBones(compiledGeometry, "Compiled geometry");

  const sourceDescription = isObject(sourceGeometry.description)
    ? sourceGeometry.description
    : {};
  const compiledDescription = isObject(compiledGeometry.description)
    ? compiledGeometry.description
    : {};

  const compiledBones = Array.isArray(compiledGeometry.bones)
    ? compiledGeometry.bones.filter(isObject)
    : [];
  const mergedBones = compiledBones.map((compiledBone) => {
    const name = String(compiledBone.name);
    const merged = clone(sourceBones.get(name) ?? { name });
    merged.name = name;
    for (const field of COMPILED_BONE_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(compiledBone, field)) {
        merged[field] = clone(compiledBone[field]);
      } else {
        delete merged[field];
      }
    }
    return merged;
  });

  const mergedGeometry: JsonObject = {
    ...sourceGeometry,
    description: {
      ...sourceDescription,
      ...clone(compiledDescription),
    },
    bones: mergedBones,
  };
  const outputEntries = output["minecraft:geometry"] as JsonObject[];
  outputEntries[sourceSelection.index] = mergedGeometry;
  return output;
}
