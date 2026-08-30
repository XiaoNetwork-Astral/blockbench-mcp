/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import {
  elementIdSchema,
  vec3,
  meshIdOptionalSchema,
} from "@/lib/zodObjects";
import {
  collectOutlinerSubtree,
  finishCreatedOutlinerEdit,
  resolveUniqueReference,
  rollbackCreatedOutlinerEdit,
} from "@/lib/modelSafety";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find an armature by UUID or name
 */
function findArmature(id: string): Armature | undefined {
  const uuidMatches = Armature.all.filter((armature) => armature.uuid === id);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(`Armature UUID "${id}" is duplicated in the current project.`);
  }
  const nameMatches = Armature.all.filter((armature) => armature.name === id);
  if (nameMatches.length > 1) {
    throw new Error(
      `Armature name "${id}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((armature) => armature.uuid).join(", ")}). Use an exact UUID.`
    );
  }
  return nameMatches[0];
}

/**
 * Find an armature or throw an error
 */
function findArmatureOrThrow(id: string): Armature {
  const armature = findArmature(id);
  if (!armature) {
    throw new Error(`Armature not found: ${id}`);
  }
  return armature;
}

/**
 * Find an armature bone by UUID or name
 */
function findArmatureBone(id: string): ArmatureBone | undefined {
  const uuidMatches = ArmatureBone.all.filter((bone) => bone.uuid === id);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(`Armature bone UUID "${id}" is duplicated in the current project.`);
  }
  const nameMatches = ArmatureBone.all.filter((bone) => bone.name === id);
  if (nameMatches.length > 1) {
    throw new Error(
      `Armature bone name "${id}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((bone) => bone.uuid).join(", ")}). Use an exact UUID.`
    );
  }
  return nameMatches[0];
}

/**
 * Find an armature bone or throw an error
 */
function findArmatureBoneOrThrow(id: string): ArmatureBone {
  const bone = findArmatureBone(id);
  if (!bone) {
    throw new Error(`Armature bone not found: ${id}`);
  }
  return bone;
}

/**
 * Find a mesh by UUID or name
 */
function findMesh(id: string): Mesh | undefined {
  const exactUuid = Mesh.all.filter((mesh) => mesh.uuid === id);
  if (exactUuid.length === 1) return exactUuid[0];
  if (exactUuid.length > 1) throw new Error(`Mesh UUID "${id}" is duplicated.`);

  const names = Mesh.all.filter((mesh) => mesh.name === id);
  if (names.length === 1) return names[0];
  if (names.length > 1) {
    throw new Error(
      `Mesh name "${id}" is ambiguous (${names.length} matches: ` +
        `${names.map((mesh) => mesh.uuid).join(", ")}). Use an exact UUID.`
    );
  }

  const prefixes = Mesh.all.filter((mesh) => mesh.uuid.startsWith(id));
  if (prefixes.length === 1) return prefixes[0];
  if (prefixes.length > 1) {
    throw new Error(
      `Mesh UUID prefix "${id}" is ambiguous (${prefixes.length} matches). Use a full UUID.`
    );
  }
  return undefined;
}

interface ArmatureIdentity {
  uuid: string;
  name: string;
}

export function assertMatchingArmature(
  meshName: string,
  boneName: string,
  meshArmature: ArmatureIdentity | undefined,
  boneArmature: ArmatureIdentity | undefined
): asserts meshArmature is ArmatureIdentity {
  if (!meshArmature) {
    throw new Error(`Mesh "${meshName}" is not associated with an armature.`);
  }
  if (!boneArmature || boneArmature.uuid !== meshArmature.uuid) {
    const boneArmatureName = boneArmature?.name ?? "no armature";
    throw new Error(
      `Bone "${boneName}" belongs to ${boneArmatureName === "no armature" ? boneArmatureName : `armature "${boneArmatureName}"`}, ` +
        `not mesh "${meshName}"'s armature "${meshArmature.name}".`
    );
  }
}

export function assertMeshWeightVertexKeys(
  meshName: string,
  vertices: Record<string, unknown>,
  keys: readonly string[]
): void {
  const missing = keys.filter((key) => !Object.hasOwn(vertices, key));
  if (missing.length > 0) {
    throw new Error(
      `Mesh "${meshName}" has no vertex key${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`
    );
  }
}

function resolveWeightMesh(meshId?: string): Mesh {
  const mesh = meshId ? findMesh(meshId) : Mesh.selected[0];
  if (!mesh) throw new Error("No mesh found. Provide mesh_id or select a mesh.");
  return mesh;
}

function resolveWeightTarget(meshId: string | undefined, boneId: string) {
  const mesh = resolveWeightMesh(meshId);
  const bone = findArmatureBoneOrThrow(boneId);
  const meshArmature = (mesh as Mesh & { getArmature?: () => Armature | undefined }).getArmature?.();
  const boneArmature = bone.getArmature();
  assertMatchingArmature(mesh.name, bone.name, meshArmature, boneArmature);
  return { mesh, bone, armature: meshArmature };
}

/**
 * Serialize an armature to a plain object
 */
function serializeArmature(armature: Armature) {
  return {
    uuid: armature.uuid,
    name: armature.name,
    type: armature.type,
    visibility: armature.visibility,
    locked: armature.locked,
    export: armature.export,
    isOpen: armature.isOpen,
    origin: armature.origin,
    childCount: armature.children.length,
    boneCount: armature.getAllBones().length,
  };
}

/**
 * Serialize an armature bone to a plain object
 */
function serializeArmatureBone(bone: ArmatureBone) {
  const armature = bone.getArmature();
  return {
    uuid: bone.uuid,
    name: bone.name,
    type: bone.type,
    armature: armature ? { uuid: armature.uuid, name: armature.name } : null,
    origin: bone.origin,
    rotation: bone.rotation,
    length: bone.length,
    width: bone.width,
    connected: bone.connected,
    color: bone.color,
    visibility: bone.visibility,
    locked: bone.locked,
    property_persistence: {
      visibility: "editor_session_only",
      locked: "project_file",
    },
    export: bone.export,
    parentBone: bone.parent instanceof ArmatureBone
      ? { uuid: bone.parent.uuid, name: bone.parent.name }
      : null,
    childCount: bone.children.length,
    vertexWeightCount: Object.keys(bone.vertex_weights).length,
  };
}

// ============================================================================
// Armature Tool Parameter Schemas
// ============================================================================

export const listArmaturesParameters = z.object({});

export const getArmatureParameters = z.object({
  id: elementIdSchema.describe("UUID or name of the armature."),
  include_bones: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to include bone hierarchy in response."),
});

export const addArmatureParameters = z.object({
  parent: z
    .literal("root")
    .optional()
    .default("root")
    .describe("Armatures are always created at the Outliner root."),
  name: z.string().optional().default("armature").describe("Name for the new armature."),
  visibility: z.boolean().optional().default(true),
  locked: z.boolean().optional().default(false),
  add_initial_bone: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to add an initial bone to the armature."),
});

export const removeArmatureParameters = z.object({
  id: elementIdSchema.describe("UUID or name of the armature to remove."),
});

export const updateArmatureParameters = z.object({
  id: elementIdSchema.describe("UUID or name of the armature."),
  name: z.string().optional().describe("New name for the armature."),
  visibility: z.boolean().optional(),
  locked: z.boolean().optional(),
  export: z.boolean().optional().describe("Whether to export this armature."),
});

export const listArmatureBonesParameters = z.object({
  armature_id: z
    .string()
    .optional()
    .describe("Filter bones by armature UUID or name. If not provided, lists all bones."),
});

export const getArmatureBoneParameters = z.object({
  id: elementIdSchema.describe("UUID or name of the bone."),
  include_weights: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to include all vertex weights in response."),
});

export const addArmatureBoneParameters = z.object({
  parent_id: elementIdSchema.describe(
    "UUID or name of parent armature or bone."
  ),
  name: z.string().optional().default("bone").describe("Name for the new bone."),
  origin: vec3()
    .optional()
    .describe("Position of the bone. Defaults to [0, parent.length, 0] for child bones."),
  rotation: vec3().optional().default([0, 0, 0]),
  length: z.number().optional().default(8).describe("Length of the bone."),
  width: z.number().optional().default(2).describe("Width of the bone."),
  connected: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether bone is connected to parent."),
  color: z
    .number()
    .int()
    .min(0)
    .max(7)
    .optional()
    .describe("Marker color index (0-7)."),
});

export const removeArmatureBoneParameters = z.object({
  id: elementIdSchema.describe("UUID or name of the bone to remove."),
  remove_children: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether to also remove child bones."),
});

export const updateArmatureBoneParameters = z.object({
  id: elementIdSchema.describe("UUID or name of the bone."),
  name: z.string().optional(),
  origin: vec3("New position of the bone.").optional(),
  rotation: vec3("New rotation [x, y, z] in degrees.").optional(),
  length: z.number().optional(),
  width: z.number().optional(),
  connected: z.boolean().optional(),
  color: z.number().int().min(0).max(7).optional(),
  visibility: z
    .boolean()
    .optional()
    .describe("Editor-session visibility. Blockbench does not store this ArmatureBone property in project files."),
  locked: z.boolean().optional(),
});

export const updateArmatureBonesBatchParameters = z.object({
  ids: z.array(elementIdSchema).describe("Array of bone UUIDs or names to update."),
  visibility: z
    .boolean()
    .optional()
    .describe("Editor-session visibility. Blockbench does not store this ArmatureBone property in project files."),
  locked: z.boolean().optional(),
  color: z.number().int().min(0).max(7).optional(),
});

export const selectArmatureBonesParameters = z.object({
  ids: z
    .array(elementIdSchema)
    .optional()
    .describe("Array of bone UUIDs or names to select."),
  armature_id: z
    .string()
    .optional()
    .describe("Select all bones in this armature."),
  include_descendants: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include all descendant bones in selection."),
  clear_selection: z
    .boolean()
    .optional()
    .default(true)
    .describe("Clear existing selection before selecting."),
});

export const getVertexWeightsParameters = z.object({
  mesh_id: meshIdOptionalSchema,
  bone_id: z
    .string()
    .optional()
    .describe("Filter weights by specific bone."),
});

export const setVertexWeightsBatchParameters = z.object({
  bone_id: elementIdSchema.describe("UUID or name of the bone."),
  mesh_id: meshIdOptionalSchema,
  weights: z
    .record(z.string(), z.number().min(0).max(1))
    .refine((weights) => Object.keys(weights).length > 0, "Provide at least one vertex weight.")
    .describe("Map of vertex_key -> weight value."),
});

export const clearVertexWeightsParameters = z.object({
  bone_id: elementIdSchema.describe("UUID or name of the bone."),
  mesh_id: meshIdOptionalSchema,
});

// ============================================================================
// Armature Tool Docs
// ============================================================================

export const armatureToolDocs: ToolSpec[] = [
  {
    name: "list_armatures",
    description:
      "Lists all armatures in the current project with their basic info.",
    annotations: {
      title: "List Armatures",
      readOnlyHint: true,
    },
    parameters: listArmaturesParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_armature",
    description:
      "Gets detailed information about a specific armature including its bones.",
    annotations: {
      title: "Get Armature",
      readOnlyHint: true,
    },
    parameters: getArmatureParameters,
    status: STATUS_STABLE,
  },
  {
    name: "add_armature",
    description:
      "Creates a new root-level armature. An armature is a skeletal rig used for mesh deformation.",
    annotations: {
      title: "Add Armature",
      destructiveHint: true,
    },
    parameters: addArmatureParameters,
    status: STATUS_STABLE,
  },
  {
    name: "remove_armature",
    description: "Removes an armature and all its bones from the project.",
    annotations: {
      title: "Remove Armature",
      destructiveHint: true,
    },
    parameters: removeArmatureParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "update_armature",
    description: "Updates properties of an existing armature.",
    annotations: {
      title: "Update Armature",
      destructiveHint: true,
    },
    parameters: updateArmatureParameters,
    status: STATUS_STABLE,
  },
  {
    name: "list_armature_bones",
    description:
      "Lists all armature bones, optionally filtered by a specific armature.",
    annotations: {
      title: "List Armature Bones",
      readOnlyHint: true,
    },
    parameters: listArmatureBonesParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_armature_bone",
    description: "Gets detailed information about a specific armature bone.",
    annotations: {
      title: "Get Armature Bone",
      readOnlyHint: true,
    },
    parameters: getArmatureBoneParameters,
    status: STATUS_STABLE,
  },
  {
    name: "add_armature_bone",
    description:
      "Creates a new bone and adds it to an armature or parent bone.",
    annotations: {
      title: "Add Armature Bone",
      destructiveHint: true,
    },
    parameters: addArmatureBoneParameters,
    status: STATUS_STABLE,
  },
  {
    name: "remove_armature_bone",
    description: "Removes an armature bone from the project.",
    annotations: {
      title: "Remove Armature Bone",
      destructiveHint: true,
    },
    parameters: removeArmatureBoneParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "update_armature_bone",
    description:
      "Updates an armature bone. Visibility is editor-session-only in Blockbench; the other supported properties are project data.",
    annotations: {
      title: "Update Armature Bone",
      destructiveHint: true,
    },
    parameters: updateArmatureBoneParameters,
    status: STATUS_STABLE,
  },
  {
    name: "update_armature_bones_batch",
    description:
      "Updates multiple armature bones. Visibility is editor-session-only in Blockbench; locked and color are project data.",
    annotations: {
      title: "Update Armature Bones (Batch)",
      destructiveHint: true,
    },
    parameters: updateArmatureBonesBatchParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "select_armature_bones",
    description:
      "Selects armature bones by ID. Can select single bone, multiple bones, or bone hierarchy.",
    annotations: {
      title: "Select Armature Bones",
      destructiveHint: false,
    },
    parameters: selectArmatureBonesParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_vertex_weights",
    description:
      "Gets vertex weights for a mesh from all bones affecting it.",
    annotations: {
      title: "Get Vertex Weights",
      readOnlyHint: true,
    },
    parameters: getVertexWeightsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "set_vertex_weights_batch",
    description: "Sets multiple vertex weights at once on a bone.",
    annotations: {
      title: "Set Vertex Weights (Batch)",
      destructiveHint: true,
    },
    parameters: setVertexWeightsBatchParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "clear_vertex_weights",
    description: "Clears all vertex weights from a bone for a specific mesh.",
    annotations: {
      title: "Clear Vertex Weights",
      destructiveHint: true,
    },
    parameters: clearVertexWeightsParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

// ============================================================================
// Armature Tools
// ============================================================================

export function registerArmatureTools() {
  // ---------------------------------------------------------------------------
  // List Armatures
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[0].name, {
    ...armatureToolDocs[0],
    async execute() {
      const armatures = Armature.all.map(serializeArmature);
      return JSON.stringify(
        {
          count: armatures.length,
          armatures,
        },
        null,
        2
      );
    },
  }, armatureToolDocs[0].status);

  // ---------------------------------------------------------------------------
  // Get Armature
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[1].name, {
    ...armatureToolDocs[1],
    async execute({ id, include_bones }) {
      const armature = findArmatureOrThrow(id);
      const result = serializeArmature(armature);

      if (include_bones) {
        const bones = armature.getAllBones().map(serializeArmatureBone);
        return JSON.stringify({ ...result, bones }, null, 2);
      }

      return JSON.stringify(result, null, 2);
    },
  }, armatureToolDocs[1].status);

  // ---------------------------------------------------------------------------
  // Add Armature
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[2].name, {
    ...armatureToolDocs[2],
    async execute({ name, visibility, locked, add_initial_bone }) {
      // Check if format supports armatures
      if (!Format.armature_rig) {
        throw new Error(
          "Current format does not support armatures. Switch to a format that supports armature rigs."
        );
      }

      Undo.initEdit({ outliner: true, elements: [] });

      let armature: Armature | undefined;
      try {
        armature = new Armature({
          name,
          visibility,
          locked,
        });
        armature.addTo("root");
        armature.isOpen = true;
        armature.createUniqueName();
        armature.init();

        if (add_initial_bone) {
          const bone = new ArmatureBone({ name: "bone" });
          bone.addTo(armature);
          bone.init();
        }
      } catch (error) {
        if (armature) rollbackCreatedOutlinerEdit([armature]);
        else Undo.cancelEdit();
        throw error;
      }

      finishCreatedOutlinerEdit("Agent added armature", [armature]);
      Canvas.updateAll();

      return JSON.stringify(
        {
          message: `Created armature "${armature.name}"`,
          armature: serializeArmature(armature),
        },
        null,
        2
      );
    },
  }, armatureToolDocs[2].status);

  // ---------------------------------------------------------------------------
  // Remove Armature
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[3].name, {
    ...armatureToolDocs[3],
    async execute({ id }) {
      const armature = findArmatureOrThrow(id);
      const name = armature.name;
      const deleted = collectOutlinerSubtree([armature]);
      Undo.initEdit({
        outliner: true,
        elements: deleted.elements,
        groups: deleted.groups,
      });
      armature.remove(false);
      deleted.elements.length = 0;
      deleted.groups.length = 0;
      Undo.finishEdit("Agent removed armature", {
        outliner: true,
        elements: deleted.elements,
        groups: deleted.groups,
      });
      Canvas.updateAll();

      return `Removed armature "${name}"`;
    },
  }, armatureToolDocs[3].status);

  // ---------------------------------------------------------------------------
  // Update Armature
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[4].name, {
    ...armatureToolDocs[4],
    async execute({ id, name, visibility, locked, export: shouldExport }) {
      const armature = findArmatureOrThrow(id);

      Undo.initEdit({ outliner: true, elements: [armature] });

      if (name !== undefined) armature.name = name;
      if (visibility !== undefined) armature.visibility = visibility;
      if (locked !== undefined) armature.locked = locked;
      if (shouldExport !== undefined) armature.export = shouldExport;

      armature.updateElement();
      Undo.finishEdit("Agent updated armature");
      Canvas.updateAll();

      return JSON.stringify(
        {
          message: `Updated armature "${armature.name}"`,
          armature: serializeArmature(armature),
        },
        null,
        2
      );
    },
  }, armatureToolDocs[4].status);

  // ---------------------------------------------------------------------------
  // List Armature Bones
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[5].name, {
    ...armatureToolDocs[5],
    async execute({ armature_id }) {
      let bones: ArmatureBone[];

      if (armature_id) {
        const armature = findArmatureOrThrow(armature_id);
        bones = armature.getAllBones();
      } else {
        bones = ArmatureBone.all;
      }

      const serialized = bones.map(serializeArmatureBone);
      return JSON.stringify(
        {
          count: serialized.length,
          bones: serialized,
        },
        null,
        2
      );
    },
  }, armatureToolDocs[5].status);

  // ---------------------------------------------------------------------------
  // Get Armature Bone
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[6].name, {
    ...armatureToolDocs[6],
    async execute({ id, include_weights }) {
      const bone = findArmatureBoneOrThrow(id);
      const result = serializeArmatureBone(bone);

      if (include_weights) {
        return JSON.stringify(
          { ...result, vertex_weights: bone.vertex_weights },
          null,
          2
        );
      }

      return JSON.stringify(result, null, 2);
    },
  }, armatureToolDocs[6].status);

  // ---------------------------------------------------------------------------
  // Add Armature Bone
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[7].name, {
    ...armatureToolDocs[7],
    async execute({
      parent_id,
      name,
      origin,
      rotation,
      length,
      width,
      connected,
      color,
    }) {
      const parent = resolveUniqueReference<Armature | ArmatureBone>(
        parent_id,
        [...Armature.all, ...ArmatureBone.all],
        "Armature parent",
        "list_armatures or list_armature_bones"
      );

      // Calculate default origin if not provided
      const defaultOrigin: [number, number, number] =
        parent instanceof ArmatureBone ? [0, parent.length ?? 8, 0] : [0, 0, 0];

      Undo.initEdit({ outliner: true, elements: [], groups: [] });
      let bone: ArmatureBone | undefined;
      try {
        bone = new ArmatureBone({
          name,
          origin: (origin ?? defaultOrigin) as [number, number, number],
          rotation: rotation as [number, number, number],
          length,
          width,
          connected,
          color,
        });
        bone.addTo(parent);
        bone.isOpen = true;

        if (Format.bone_rig) {
          bone.createUniqueName();
        }

        bone.init();
      } catch (error) {
        if (bone) rollbackCreatedOutlinerEdit([bone]);
        else Undo.cancelEdit();
        throw error;
      }

      finishCreatedOutlinerEdit("Agent added armature bone", [bone]);
      Canvas.updateAll();

      return JSON.stringify(
        {
          message: `Created bone "${bone.name}"`,
          bone: serializeArmatureBone(bone),
        },
        null,
        2
      );
    },
  }, armatureToolDocs[7].status);

  // ---------------------------------------------------------------------------
  // Remove Armature Bone
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[8].name, {
    ...armatureToolDocs[8],
    async execute({ id, remove_children }) {
      const bone = findArmatureBoneOrThrow(id);
      const name = bone.name;
      const deleted = remove_children
        ? collectOutlinerSubtree([bone])
        : { elements: [bone] as OutlinerElement[], groups: [] as Group[] };

      Undo.initEdit({
        outliner: true,
        elements: deleted.elements,
        groups: deleted.groups,
      });

      if (!remove_children && bone.children.length > 0) {
        // Re-parent children to bone's parent
        const parent = bone.parent;
        for (const child of [...bone.children]) {
          child.addTo(parent);
        }
      }

      bone.remove(false);
      deleted.elements.length = 0;
      deleted.groups.length = 0;
      Undo.finishEdit("Agent removed armature bone", {
        outliner: true,
        elements: deleted.elements,
        groups: deleted.groups,
      });
      Canvas.updateAll();

      return `Removed bone "${name}"`;
    },
  }, armatureToolDocs[8].status);

  // ---------------------------------------------------------------------------
  // Update Armature Bone
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[9].name, {
    ...armatureToolDocs[9],
    async execute({
      id,
      name,
      origin,
      rotation,
      length,
      width,
      connected,
      color,
      visibility,
      locked,
    }) {
      const bone = findArmatureBoneOrThrow(id);

      Undo.initEdit({ outliner: true, elements: [bone] });

      if (name !== undefined) bone.name = name;
      if (origin !== undefined) bone.origin.V3_set(origin as [number, number, number]);
      if (rotation !== undefined) bone.rotation.V3_set(rotation as [number, number, number]);
      if (length !== undefined) bone.length = length;
      if (width !== undefined) bone.width = width;
      if (connected !== undefined) bone.connected = connected;
      if (color !== undefined) bone.setColor(color);
      if (visibility !== undefined) bone.visibility = visibility;
      if (locked !== undefined) bone.locked = locked;

      bone.preview_controller.updateTransform(bone);
      bone.updateElement();
      Undo.finishEdit("Agent updated armature bone");
      Canvas.updateAll();

      return JSON.stringify(
        {
          message: `Updated bone "${bone.name}"`,
          bone: serializeArmatureBone(bone),
        },
        null,
        2
      );
    },
  }, armatureToolDocs[9].status);

  // ---------------------------------------------------------------------------
  // Update Armature Bones (Batch)
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[10].name, {
    ...armatureToolDocs[10],
    async execute({ ids, visibility, locked, color }) {
      const bones = ids.map(findArmatureBoneOrThrow);

      Undo.initEdit({ outliner: true, elements: bones });

      for (const bone of bones) {
        if (visibility !== undefined) bone.visibility = visibility;
        if (locked !== undefined) bone.locked = locked;
        if (color !== undefined) bone.setColor(color);
        bone.updateElement();
      }

      Undo.finishEdit("Agent updated armature bones (batch)");
      Canvas.updateAll();

      return JSON.stringify(
        {
          message: `Updated ${bones.length} bones`,
          bones: bones.map(serializeArmatureBone),
        },
        null,
        2
      );
    },
  }, armatureToolDocs[10].status);

  // ---------------------------------------------------------------------------
  // Select Armature Bones
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[11].name, {
    ...armatureToolDocs[11],
    async execute({ ids, armature_id, include_descendants, clear_selection }) {
      if (clear_selection) {
        unselectAllElements();
      }

      let selectedBones: ArmatureBone[] = [];

      if (armature_id) {
        const armature = findArmatureOrThrow(armature_id);
        selectedBones = armature.getAllBones();
      } else if (ids && ids.length > 0) {
        for (const id of ids) {
          const bone = findArmatureBoneOrThrow(id);
          selectedBones.push(bone);

          if (include_descendants) {
            bone.forEachChild((child) => {
              if (child instanceof ArmatureBone) {
                selectedBones.push(child);
              }
            });
          }
        }
      }

      for (const bone of selectedBones) {
        bone.select();
      }

      updateSelection();

      return JSON.stringify(
        {
          message: `Selected ${selectedBones.length} bone(s)`,
          bones: selectedBones.map((b) => ({ uuid: b.uuid, name: b.name })),
        },
        null,
        2
      );
    },
  }, armatureToolDocs[11].status);

  // ---------------------------------------------------------------------------
  // Get Vertex Weights
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[12].name, {
    ...armatureToolDocs[12],
    async execute({ mesh_id, bone_id }) {
      const mesh = resolveWeightMesh(mesh_id);
      const armature = (mesh as Mesh & { getArmature?: () => Armature | undefined }).getArmature?.();
      if (!armature) {
        throw new Error(`Mesh "${mesh.name}" is not associated with an armature.`);
      }

      const bones = bone_id ? [findArmatureBoneOrThrow(bone_id)] : armature.getAllBones();
      if (bone_id) {
        assertMatchingArmature(mesh.name, bones[0].name, armature, bones[0].getArmature());
      }

      const weights: Record<string, Record<string, number>> = {};

      for (const bone of bones) {
        const boneWeights: Record<string, number> = {};
        for (const vkey in mesh.vertices) {
          const weight = bone.getVertexWeight(mesh, vkey);
          if (weight > 0) {
            boneWeights[vkey] = weight;
          }
        }
        if (Object.keys(boneWeights).length > 0) {
          weights[bone.name] = boneWeights;
        }
      }

      return JSON.stringify(
        {
          mesh: { uuid: mesh.uuid, name: mesh.name },
          armature: { uuid: armature.uuid, name: armature.name },
          weights,
        },
        null,
        2
      );
    },
  }, armatureToolDocs[12].status);

  // ---------------------------------------------------------------------------
  // Set Vertex Weights (Batch)
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[13].name, {
    ...armatureToolDocs[13],
    parameters: setVertexWeightsBatchParameters,
    async execute({ bone_id, mesh_id, weights }) {
      const { mesh, bone } = resolveWeightTarget(mesh_id, bone_id);
      const entries = Object.entries(weights);
      assertMeshWeightVertexKeys(mesh.name, mesh.vertices, entries.map(([key]) => key));

      Undo.initEdit({ elements: [bone] });

      for (const [vertex_key, weight] of entries) {
        bone.setVertexWeight(mesh, vertex_key, weight);
      }

      Undo.finishEdit("Agent set vertex weights (batch)");

      Canvas.updateView({
        elements: [mesh],
        element_aspects: { geometry: true },
      });

      return JSON.stringify(
        {
          message: `Set ${entries.length} vertex weights on bone "${bone.name}"`,
          bone: { uuid: bone.uuid, name: bone.name },
          mesh: { uuid: mesh.uuid, name: mesh.name },
          weightsSet: entries.length,
        },
        null,
        2
      );
    },
  }, armatureToolDocs[13].status);

  // ---------------------------------------------------------------------------
  // Clear Vertex Weights
  // ---------------------------------------------------------------------------
  createInternalTool(armatureToolDocs[14].name, {
    ...armatureToolDocs[14],
    async execute({ bone_id, mesh_id }) {
      const { mesh, bone } = resolveWeightTarget(mesh_id, bone_id);

      Undo.initEdit({ elements: [bone] });

      let count = 0;
      const meshPrefix = mesh.uuid.substring(0, 6) + ":";

      for (const key in bone.vertex_weights) {
        if (key.startsWith(meshPrefix)) {
          delete bone.vertex_weights[key];
          count++;
        }
      }

      Undo.finishEdit("Agent cleared vertex weights");

      Canvas.updateView({
        elements: [mesh],
        element_aspects: { geometry: true },
      });

      return JSON.stringify(
        {
          message: `Cleared ${count} vertex weights from bone "${bone.name}" for mesh "${mesh.name}"`,
          bone: { uuid: bone.uuid, name: bone.name },
          mesh: { uuid: mesh.uuid, name: mesh.name },
          weightsCleared: count,
        },
        null,
        2
      );
    },
  }, armatureToolDocs[14].status);

}
