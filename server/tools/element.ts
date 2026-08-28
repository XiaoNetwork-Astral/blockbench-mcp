/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolSpec,
} from "@/lib/factories";
import { findElementOrThrow, findGroupOrThrow, findTextureOrThrow } from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import {
  elementIdSchema,
  vec3,
  autoUvEnum,
} from "@/lib/zodObjects";
import {
  collectOutlinerSubtree,
  finishCreatedOutlinerEdit,
  resolveOutlinerParentOrThrow,
  rollbackCreatedOutlinerEdit,
  translateOutlinerSubtree,
  vectorsNearlyEqual,
} from "@/lib/modelSafety";

export const removeElementParameters = z.object({
  id: elementIdSchema.describe("ID or name of the element to remove."),
});

export const elementTypeEnum = z.enum(["cube", "mesh", "group", "any"]);

export const findElementsByCriteriaParameters = z.object({
  name_pattern: z
    .string()
    .optional()
    .describe(
      "Regex pattern to match element names (e.g., '^arm_.*'). Case-sensitive."
    ),
  name_contains: z
    .string()
    .optional()
    .describe("Substring to match in element names. Case-insensitive."),
  type: elementTypeEnum
    .optional()
    .default("any")
    .describe("Restrict to a single element type."),
  parent_group: z
    .string()
    .optional()
    .describe(
      "UUID or name of a parent group. Only descendants of this group are returned."
    ),
  min_size: vec3(
    "Minimum [x,y,z] size for cubes. Cubes smaller on any axis are excluded."
  ).optional(),
  max_size: vec3(
    "Maximum [x,y,z] size for cubes. Cubes larger on any axis are excluded."
  ).optional(),
  selected_only: z
    .boolean()
    .optional()
    .default(false)
    .describe("Only consider currently selected elements."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .optional()
    .default(200)
    .describe("Maximum number of results to return."),
});

export const selectAllOfTypeParameters = z.object({
  type: z
    .enum(["cube", "mesh", "group"])
    .describe("Element type to select."),
  add_to_selection: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, add to current selection. If false, replace selection."),
  parent_group: z
    .string()
    .optional()
    .describe(
      "UUID or name of a parent group. If provided, only descendants of this group are selected."
    ),
});

export const filterByMaterialParameters = z.object({
  texture: z
    .string()
    .describe("Texture ID, UUID or name to search for."),
  include_face_keys: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "Include the list of cube face keys (e.g., 'north') that reference the texture."
    ),
});

export const getSelectionParameters = z.object({});

export const addGroupParameters = z.object({
  name: z.string(),
  origin: vec3("Pivot point of the group as [x, y, z].")
    .optional()
    .default([0, 0, 0]),
  rotation: vec3("Rotation of the group in degrees as [x, y, z].")
    .optional()
    .default([0, 0, 0]),
  parent: z
    .string()
    .min(1)
    .describe(
      "Required parent UUID or unique name. Use the exact literal 'root' only for an intentional root-level group."
    ),
  visibility: z.boolean().optional().default(true),
  autouv: autoUvEnum
    .optional()
    .default("0")
    .describe(
      "Auto UV setting. 0 = disabled, 1 = enabled, 2 = relative auto UV."
    ),
  selected: z.boolean().optional().default(false),
  shade: z.boolean().optional().default(false),
});

export const listOutlineParameters = z.object({
  include_cubes: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, include cubes as leaves. If false, return groups only."),
  include_meshes: z
    .boolean()
    .optional()
    .default(true)
    .describe("If true, include meshes as leaves. If false, omit meshes."),
  max_depth: z
    .number()
    .int()
    .min(1)
    .max(32)
    .optional()
    .default(32)
    .describe("Maximum tree depth to traverse. Use a small value to summarize large projects."),
});

export const duplicateElementParameters = z.object({
  id: elementIdSchema.describe("ID or name of the element to duplicate."),
  parent: z
    .string()
    .min(1)
    .describe(
      "Required target parent UUID or unique name. Use the exact literal 'root' only for an intentional root-level duplicate."
    ),
  offset: vec3().optional().default([0, 0, 0]),
  newName: z.string().optional(),
});

export const renameElementParameters = z.object({
  id: elementIdSchema.describe("ID or name of the element to rename."),
  new_name: z.string().describe("New name to assign."),
});

export const modifyGroupParameters = z
  .object({
    id: z.string().describe("Group/bone UUID or unique name."),
    origin: vec3(
      "Set the group's model-space pivot directly without translating descendants."
    ).optional(),
    rotation: vec3(
      "Set the group's local Euler rotation in degrees [x, y, z]."
    ).optional(),
    position: vec3(
      "Move the complete subtree so the group's model-space origin reaches this absolute [x, y, z] position."
    ).optional(),
  })
  .refine(({ origin, rotation, position }) =>
    origin !== undefined || rotation !== undefined || position !== undefined, {
    message: "Provide origin, rotation, or position.",
  })
  .refine(({ origin, position }) => !(origin && position), {
    message: "origin and position have different semantics and cannot be combined.",
    path: ["origin", "position"],
  });

export const reparentElementParameters = z.object({
  id: elementIdSchema.describe("Element or group UUID or unique name."),
  parent: z
    .string()
    .min(1)
    .describe(
      "Required target parent UUID or unique name. Use the exact literal 'root' only for intentional root placement."
    ),
  preserve_world_transform: z
    .boolean()
    .optional()
    .default(true)
    .describe("Keep the node and its descendants in the same rendered world-space pose."),
});

export const listCollectionsParameters = z.object({
  include_members: z.boolean().optional().default(true),
});

export const editCollectionParameters = z.object({
  operation: z.enum(["create", "update", "remove"]),
  collection: z
    .string()
    .optional()
    .describe("Collection UUID or unique name. Required for update and remove."),
  name: z.string().min(1).optional(),
  members: z
    .array(elementIdSchema)
    .optional()
    .describe("Replacement member UUIDs or unique names. An empty array clears membership."),
});

export const elementToolDocs: ToolSpec[] = [
  {
    name: "remove_element",
    description: "Removes the element with the given ID.",
    annotations: {
      title: "Remove Element",
      destructiveHint: true,
    },
    parameters: removeElementParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "add_group",
    description:
      "Adds a new group under a mandatory explicit parent. Use parent='root' only for an intentional root-level group; omitted, missing, or ambiguous parents are rejected before mutation.",
    annotations: {
      title: "Add Group",
      destructiveHint: true,
    },
    parameters: addGroupParameters,
    status: STATUS_STABLE,
  },
  {
    name: "list_outline",
    description:
      "Returns the project outline as a hierarchical tree. Each node reports { name, uuid, type (cube|mesh|group), children? }. Groups contain child cubes, meshes, and sub-groups. Use `include_cubes=false` to get a group-only skeleton when you just need structure, or `max_depth` to bound very deep trees.",
    annotations: {
      title: "List Outline",
      readOnlyHint: true,
    },
    parameters: listOutlineParameters,
    status: STATUS_STABLE,
  },
  {
    name: "duplicate_element",
    description:
      "Duplicates a cube, mesh, or group under a mandatory explicit target parent while preserving geometry, UVs, textures, and descendants. You may offset the duplicate or assign a new name.",
    annotations: { title: "Duplicate Element", destructiveHint: true },
    parameters: duplicateElementParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "rename_element",
    description: "Renames a cube, mesh or group by ID or name.",
    annotations: { title: "Rename Element", destructiveHint: true },
    parameters: renameElementParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "find_elements_by_criteria",
    description:
      "Searches the current project for elements matching the given criteria. Supports name pattern matching (regex or substring), type filtering, scoping to a parent group, cube size ranges, and selection scope. Returns element metadata, never modifies state.",
    annotations: {
      title: "Find Elements by Criteria",
      readOnlyHint: true,
    },
    parameters: findElementsByCriteriaParameters,
    status: STATUS_STABLE,
  },
  {
    name: "select_all_of_type",
    description:
      "Selects all elements of the given type (cube, mesh, or group) in the current project. Optionally restrict to descendants of a parent group, or add to (rather than replace) the current selection.",
    annotations: {
      title: "Select All of Type",
      destructiveHint: true,
    },
    parameters: selectAllOfTypeParameters,
    status: STATUS_STABLE,
  },
  {
    name: "filter_by_material",
    description:
      "Returns all elements that reference the given texture. For cubes, includes the list of face keys (e.g., 'north', 'up') that use the texture. For meshes, returns the mesh if any face uses the texture.",
    annotations: {
      title: "Filter Elements by Material",
      readOnlyHint: true,
    },
    parameters: filterByMaterialParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_selection",
    description:
      "Returns the current selection state: selected cube/mesh/group UUIDs and names, plus the active texture. Use this to verify what the edit_textures action apply_texture or an edit_texture_paint action with fill_mode=\"selected_elements\" will target.",
    annotations: {
      title: "Get Selection",
      readOnlyHint: true,
    },
    parameters: getSelectionParameters,
    status: STATUS_STABLE,
  },
  {
    name: "modify_group",
    description:
      "Updates an ordinary Outliner group/bone. origin changes only its pivot; rotation sets its local Euler rotation; position translates the entire subtree so the group origin reaches an absolute model-space coordinate. The affected subtree is captured in one Undo edit and read back before success.",
    annotations: {
      title: "Modify Group",
      destructiveHint: true,
    },
    parameters: modifyGroupParameters,
    status: STATUS_STABLE,
  },
  {
    name: "reparent_element",
    description:
      "Moves one cube, mesh, or group to an explicit parent and preserves its rendered world transform by default.",
    annotations: { title: "Reparent Element", destructiveHint: true },
    parameters: reparentElementParameters,
    status: STATUS_STABLE,
  },
  {
    name: "list_collections",
    description:
      "Lists Blockbench Collections, which organize elements independently from the Outliner and bone hierarchy.",
    annotations: { title: "List Collections", readOnlyHint: true },
    parameters: listCollectionsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "edit_collection",
    description:
      "Creates, renames, replaces the members of, or removes one editor-only Collection without changing Outliner parents or bones.",
    annotations: { title: "Edit Collection", destructiveHint: true },
    parameters: editCollectionParameters,
    status: STATUS_STABLE,
  },
];

const elementReadOperations = [
  elementToolDocs[2],
  elementToolDocs[5],
  elementToolDocs[7],
  elementToolDocs[8],
  elementToolDocs[11],
];
const elementEditOperations = [
  elementToolDocs[0],
  elementToolDocs[1],
  elementToolDocs[3],
  elementToolDocs[4],
  elementToolDocs[6],
  elementToolDocs[9],
  elementToolDocs[10],
  elementToolDocs[12],
];

export const elementPublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_elements",
    description:
      "Lists the Outliner or Collections, searches elements, reports selection, or finds texture users through one read-only command.action.",
    annotations: { title: "Inspect Elements", readOnlyHint: true },
    parameters: createToolGroupParameters(elementReadOperations),
    status: STATUS_STABLE,
  },
  {
    name: "edit_elements",
    description:
      "Edits Outliner elements or editor-only Collections through one explicit command.action.",
    annotations: { title: "Edit Elements", destructiveHint: true },
    parameters: createToolGroupParameters(elementEditOperations),
    status: STATUS_STABLE,
  },
];

interface IElementMatch {
  uuid: string;
  name: string;
  type: "cube" | "mesh" | "group";
  parent: string | null;
}

interface IFilterByMaterialMatch {
  uuid: string;
  name: string;
  type: "cube" | "mesh";
  faces?: string[];
}

function getElementType(el: unknown): "cube" | "mesh" | "group" | null {
  if (el instanceof Cube) return "cube";
  if (el instanceof Mesh) return "mesh";
  if (el instanceof Group) return "group";
  return null;
}

function getParentName(el: { parent?: unknown }): string | null {
  const parent = el.parent as { name?: string; uuid?: string } | undefined;
  if (!parent || typeof parent !== "object") return null;
  return parent.name ?? parent.uuid ?? null;
}

function isDescendantOf(el: { parent?: unknown }, targetGroup: Group): boolean {
  let current: { parent?: unknown } | undefined = el;
  while (current && current.parent && typeof current.parent === "object") {
    if (current.parent === targetGroup) return true;
    current = current.parent as { parent?: unknown };
  }
  return false;
}

function findCollectionOrThrow(reference: string): Collection {
  const byUuid = Collection.all.filter((collection) => collection.uuid === reference);
  if (byUuid.length === 1) return byUuid[0];
  if (byUuid.length > 1) {
    throw new Error(`Collection UUID "${reference}" is duplicated (${byUuid.length} matches).`);
  }
  const byName = Collection.all.filter((collection) => collection.name === reference);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) {
    throw new Error(
      `Collection name "${reference}" is ambiguous. Use an exact UUID from list_collections.`
    );
  }
  throw new Error(`Collection "${reference}" not found. Use list_collections first.`);
}

function collectionMembers(references: string[]): OutlinerNode[] {
  return Array.from(new Set(references.map((reference) => findElementOrThrow(reference))));
}

function describeCollection(collection: Collection, includeMembers = true) {
  const members = collection.getChildren();
  return {
    uuid: collection.uuid,
    name: collection.name,
    member_count: members.length,
    ...(includeMembers
      ? {
          members: members.map((member) => ({
            uuid: member.uuid,
            name: member.name,
            type: getElementType(member) ?? member.type,
          })),
        }
      : {}),
  };
}

function cubeSize(cube: Cube): [number, number, number] {
  return [
    cube.to[0] - cube.from[0],
    cube.to[1] - cube.from[1],
    cube.to[2] - cube.from[2],
  ];
}

function exceedsBounds(
  size: [number, number, number],
  min?: number[],
  max?: number[]
): boolean {
  if (min && size.some((v, i) => v < (min[i] ?? -Infinity))) return true;
  if (max && size.some((v, i) => v > (max[i] ?? Infinity))) return true;
  return false;
}

const MAX_REGEX_PATTERN_LENGTH = 512;
// Heuristic: nested quantifiers like (a+)+, (.*)*, (a+|b)*, (foo){2,}+ are the
// classic catastrophic-backtracking shape. Reject quantifiers applied to a
// group whose body already contains a quantifier.
const CATASTROPHIC_BACKTRACK_HEURISTIC = /\([^)]*[+*?][^)]*\)\s*[+*?{]/;

function safeCompileRegex(pattern: string | undefined): RegExp | null {
  if (!pattern) return null;
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    console.warn(
      `[MCP] find_elements_by_criteria: name_pattern rejected — exceeds ${MAX_REGEX_PATTERN_LENGTH} chars (got ${pattern.length}).`
    );
    return null;
  }
  if (CATASTROPHIC_BACKTRACK_HEURISTIC.test(pattern)) {
    console.warn(
      `[MCP] find_elements_by_criteria: name_pattern rejected — nested quantifiers risk catastrophic backtracking: ${pattern}`
    );
    return null;
  }
  try {
    return new RegExp(pattern);
  } catch (err) {
    console.warn(
      `[MCP] find_elements_by_criteria: name_pattern failed to compile, ignoring filter:`,
      err
    );
    return null;
  }
}

export function registerElementTools() {
  createInternalTool(elementToolDocs[0].name, {
    ...elementToolDocs[0],
    async execute({ id }) {
      const element = findElementOrThrow(id);
      const deleted = collectOutlinerSubtree([element]);
      Undo.initEdit({
        elements: deleted.elements,
        groups: deleted.groups,
        outliner: true,
        collections: [],
      });

      element.remove(false);
      // Blockbench compares the same mutable arrays at finish time. Emptying
      // them records that the nodes no longer exist in the post-edit state.
      deleted.elements.length = 0;
      deleted.groups.length = 0;
      Undo.finishEdit("Agent removed element", {
        elements: deleted.elements,
        groups: deleted.groups,
        outliner: true,
        collections: [],
      });
      Canvas.updateAll();

      return `Removed element with ID ${id}`;
    },
  }, elementToolDocs[0].status);

  createInternalTool(elementToolDocs[1].name, {
    ...elementToolDocs[1],
    async execute({
      name,
      origin,
      rotation,
      parent,
      visibility,
      autouv,
      selected,
      shade,
    }) {
      const parentGroup = resolveOutlinerParentOrThrow(parent, "group");
      Undo.initEdit({
        elements: [],
        groups: [],
        outliner: true,
        collections: [],
      });
      let group: Group | undefined;
      try {
        group = new Group({
          name,
          origin,
          rotation,
          autouv: Number(autouv) as 0 | 1 | 2,
          visibility: Boolean(visibility),
          selected: Boolean(selected),
          shade: Boolean(shade),
        }).init();
        group.addTo(parentGroup);
      } catch (error) {
        if (group) rollbackCreatedOutlinerEdit([group]);
        else Undo.cancelEdit();
        throw error;
      }

      finishCreatedOutlinerEdit("Agent added group", [group]);
      Canvas.updateAll();

      return `Added group ${group.name} with ID ${group.uuid}`;
    },
  }, elementToolDocs[1].status);

  createInternalTool(elementToolDocs[2].name, {
    ...elementToolDocs[2],
    async execute({ include_cubes, include_meshes, max_depth }) {
      interface IOutlineNode {
        name: string;
        uuid: string;
        type: "cube" | "mesh" | "group";
        children?: IOutlineNode[];
      }

      const truncated: string[] = [];

      const nodeFor = (el: unknown, depth: number): IOutlineNode | null => {
        if (el instanceof Group) {
          const node: IOutlineNode = {
            name: el.name,
            uuid: el.uuid,
            type: "group",
            children: [],
          };
          if (depth >= max_depth) {
            truncated.push(el.name);
            delete node.children;
            return node;
          }
          for (const child of el.children ?? []) {
            const childNode = nodeFor(child, depth + 1);
            if (childNode) node.children!.push(childNode);
          }
          return node;
        }
        if (el instanceof Cube) {
          if (!include_cubes) return null;
          return { name: el.name, uuid: el.uuid, type: "cube" };
        }
        if (el instanceof Mesh) {
          if (!include_meshes) return null;
          return { name: el.name, uuid: el.uuid, type: "mesh" };
        }
        return null;
      };

      const roots = Outliner.root
        .map((el) => nodeFor(el, 0))
        .filter((n): n is IOutlineNode => n !== null);

      const counts = {
        groups: Group.all.length,
        cubes: Cube.all.length,
        meshes: Mesh.all.length,
      };

      return JSON.stringify(
        {
          counts,
          truncated_at_max_depth: truncated.length ? truncated : undefined,
          roots,
        },
        null,
        2
      );
    },
  }, elementToolDocs[2].status);

  createInternalTool(elementToolDocs[3].name, {
    ...elementToolDocs[3],
    async execute({ id, parent, offset, newName }) {
      const element = findElementOrThrow(id);
      if (!(element instanceof Cube || element instanceof Mesh || element instanceof Group)) {
        throw new Error(
          `Element "${id}" has unsupported type "${element.type}". duplicate_element supports cubes, meshes, and groups.`
        );
      }
      const targetParent = resolveOutlinerParentOrThrow(parent, element.type);

      Undo.initEdit({ elements: [], groups: [], outliner: true, collections: [] });
      let duplicate: OutlinerNode | undefined;
      try {
        const duplicateMethod = (element as OutlinerNode & {
          duplicate?: () => OutlinerNode;
        }).duplicate;
        if (typeof duplicateMethod !== "function") {
          throw new Error(`Blockbench does not expose duplication for ${element.type} nodes.`);
        }
        duplicate = duplicateMethod.call(element);
        if (newName) duplicate.name = newName;
        duplicate.addTo(targetParent);
        translateOutlinerSubtree(duplicate, offset as [number, number, number]);
      } catch (error) {
        if (duplicate) rollbackCreatedOutlinerEdit([duplicate]);
        else Undo.cancelEdit();
        throw error;
      }

      finishCreatedOutlinerEdit("Agent duplicated element", [duplicate]);
      Canvas.updateAll();
      return `Duplicated "${element.name}" as "${duplicate.name}" (ID: ${duplicate.uuid}).`;
    },
  }, elementToolDocs[3].status);

  /**
   * Rename an element.  Mirrors the simple property change seen in the existing tools,
   * using `extend` to apply the change and updating the editor.
   */
  createInternalTool(elementToolDocs[4].name, {
    ...elementToolDocs[4],
    async execute({ id, new_name }) {
      const element = findElementOrThrow(id);
      Undo.initEdit(
        element instanceof Group
          ? { groups: [element], outliner: true, collections: [] }
          : { elements: [element], outliner: true, collections: [] }
      );
      element.extend({ name: new_name });
      Undo.finishEdit("Agent renamed element");
      Canvas.updateAll();
      return `Renamed element "${id}" to "${new_name}".`;
    },
  }, elementToolDocs[4].status);

  createInternalTool(elementToolDocs[5].name, {
    ...elementToolDocs[5],
    async execute({
      name_pattern,
      name_contains,
      type,
      parent_group,
      min_size,
      max_size,
      selected_only,
      limit,
    }) {
      const regex = safeCompileRegex(name_pattern);
      const needle = name_contains?.toLowerCase() ?? null;
      const parentScope = parent_group
        ? findGroupOrThrow(parent_group)
        : null;

      const candidates: Array<Cube | Mesh | Group> = [
        ...(selected_only ? Cube.selected : Cube.all),
        ...(selected_only ? Mesh.selected : Mesh.all),
        ...(selected_only ? Group.all.filter((g: Group) => g.selected) : Group.all),
      ];

      const matches: IElementMatch[] = [];

      for (const el of candidates) {
        if (matches.length >= limit) break;

        const elType = getElementType(el);
        if (!elType) continue;
        if (type !== "any" && elType !== type) continue;
        if (regex && !regex.test(el.name)) continue;
        if (needle && !el.name.toLowerCase().includes(needle)) continue;
        if (parentScope && !isDescendantOf(el, parentScope)) continue;

        if (el instanceof Cube && (min_size || max_size)) {
          if (exceedsBounds(cubeSize(el), min_size, max_size)) continue;
        }

        matches.push({
          uuid: el.uuid,
          name: el.name,
          type: elType,
          parent: getParentName(el),
        });
      }

      return JSON.stringify(
        {
          count: matches.length,
          truncated: matches.length >= limit,
          matches,
        },
        null,
        2
      );
    },
  }, elementToolDocs[5].status);

  createInternalTool(elementToolDocs[6].name, {
    ...elementToolDocs[6],
    async execute({ type, add_to_selection, parent_group }) {
      const parentScope = parent_group
        ? findGroupOrThrow(parent_group)
        : null;

      const pool: Array<Cube | Mesh | Group> = (() => {
        if (type === "cube") return [...Cube.all];
        if (type === "mesh") return [...Mesh.all];
        return [...Group.all];
      })();

      const targets = parentScope
        ? pool.filter((el) => isDescendantOf(el, parentScope))
        : pool;

      if (!add_to_selection) {
        // @ts-ignore - selected method available on element classes
        Cube.all.forEach((c: Cube) => c.selected && c.unselect?.());
        // @ts-ignore - selected method available on element classes
        Mesh.all.forEach((m: Mesh) => m.selected && m.unselect?.());
        Group.all.forEach((g: Group) => {
          if (g.selected) g.selected = false;
        });
      }

      for (const el of targets) {
        if (el instanceof Group) {
          el.selected = true;
          continue;
        }
        // @ts-ignore - select method available on outliner elements
        el.select?.({ shiftKey: true });
      }

      updateSelection();
      Canvas.updateAll();

      return JSON.stringify(
        {
          type,
          selected: targets.length,
          parent_group: parentScope?.name ?? null,
        },
        null,
        2
      );
    },
  }, elementToolDocs[6].status);

  createInternalTool(elementToolDocs[7].name, {
    ...elementToolDocs[7],
    async execute({ texture, include_face_keys }) {
      const tex = findTextureOrThrow(texture);
      const matches: IFilterByMaterialMatch[] = [];

      for (const cube of Cube.all) {
        const faceKeys: string[] = [];
        for (const [key, face] of Object.entries(cube.faces ?? {})) {
          const typedFace = face as {
            texture?: unknown;
            getTexture?: () => Texture | null;
          };
          const effectiveTexture = typedFace.getTexture?.();
          const faceTexId = typedFace.texture;
          if (
            effectiveTexture?.uuid === tex.uuid ||
            (!effectiveTexture && (faceTexId === tex.uuid || String(faceTexId) === String(tex.id)))
          ) {
            faceKeys.push(key);
          }
        }
        if (faceKeys.length > 0) {
          matches.push({
            uuid: cube.uuid,
            name: cube.name,
            type: "cube",
            ...(include_face_keys ? { faces: faceKeys } : {}),
          });
        }
      }

      for (const mesh of Mesh.all) {
        const faceKeys: string[] = [];
        for (const [key, face] of Object.entries(mesh.faces ?? {})) {
          const typedFace = face as {
            texture?: unknown;
            getTexture?: () => Texture | null;
          };
          const effectiveTexture = typedFace.getTexture?.();
          const faceTexId = typedFace.texture;
          if (
            effectiveTexture?.uuid === tex.uuid ||
            (!effectiveTexture && (faceTexId === tex.uuid || String(faceTexId) === String(tex.id)))
          ) {
            faceKeys.push(key);
          }
        }
        if (faceKeys.length > 0) {
          matches.push({
            uuid: mesh.uuid,
            name: mesh.name,
            type: "mesh",
            ...(include_face_keys ? { faces: faceKeys } : {}),
          });
        }
      }

      return JSON.stringify(
        {
          texture: { uuid: tex.uuid, name: tex.name },
          count: matches.length,
          matches,
        },
        null,
        2
      );
    },
  }, elementToolDocs[7].status);

  createInternalTool(elementToolDocs[8].name, {
    ...elementToolDocs[8],
    async execute() {
      const cubes = Cube.selected.map((c: Cube) => ({
        uuid: c.uuid,
        name: c.name,
        type: "cube" as const,
      }));
      const meshes = Mesh.selected.map((m: Mesh) => ({
        uuid: m.uuid,
        name: m.name,
        type: "mesh" as const,
      }));
      const groups = Group.all
        .filter((g: Group) => g.selected)
        .map((g: Group) => ({
          uuid: g.uuid,
          name: g.name,
          type: "group" as const,
        }));

      const activeTexture = Texture.selected
        ? {
            uuid: Texture.selected.uuid,
            id: Texture.selected.id,
            name: Texture.selected.name,
            width: Texture.selected.width,
            height: Texture.selected.height,
          }
        : null;

      return JSON.stringify(
        {
          counts: {
            cubes: cubes.length,
            meshes: meshes.length,
            groups: groups.length,
          },
          cubes,
          meshes,
          groups,
          active_texture: activeTexture,
        },
        null,
        2
      );
    },
  }, elementToolDocs[8].status);

  createInternalTool(elementToolDocs[9].name, {
    ...elementToolDocs[9],
    async execute({ id, origin, rotation, position }) {
      const element = findElementOrThrow(id);
      if (!(element instanceof Group)) {
        throw new Error(`Element "${id}" is not an ordinary Outliner group/bone.`);
      }
      const affected = collectOutlinerSubtree([element]);
      const undoAspects: UndoAspects = {
        elements: affected.elements,
        groups: affected.groups,
        outliner: true,
        collections: [],
      };
      Undo.initEdit(undoAspects);
      if (position) {
        const offset: [number, number, number] = [
          position[0] - element.origin[0],
          position[1] - element.origin[1],
          position[2] - element.origin[2],
        ];
        translateOutlinerSubtree(element, offset);
      } else if (origin) {
        element.extend({ origin: origin as [number, number, number] });
      }
      if (rotation) {
        element.extend({ rotation: rotation as [number, number, number] });
      }
      element.preview_controller?.updateAll(element);

      Undo.finishEdit("Agent modified group", undoAspects);
      Canvas.updateAll();
      return JSON.stringify({
        group: {
          name: element.name,
          uuid: element.uuid,
          origin: [...element.origin],
          rotation: [...element.rotation],
        },
        semantics: position
          ? "translated_subtree_to_position"
          : origin
            ? "changed_pivot_only"
            : "rotation_only",
        affected: {
          groups: affected.groups.length,
          elements: affected.elements.length,
        },
      }, null, 2);
    },
  }, elementToolDocs[9].status);

  createInternalTool(elementToolDocs[10].name, {
    ...elementToolDocs[10],
    async execute({ id, parent, preserve_world_transform }) {
      const element = findElementOrThrow(id);
      const childType = element instanceof Group
        ? "group"
        : element instanceof Cube
          ? "cube"
          : element instanceof Mesh
            ? "mesh"
            : undefined;
      const target = resolveOutlinerParentOrThrow(parent, childType);
      if (
        target !== "root" &&
        (target === element || target.isChildOf(element, Number.POSITIVE_INFINITY))
      ) {
        throw new Error("An element cannot be parented to itself or one of its descendants.");
      }
      if (element.parent === target || (target === "root" && element.parent === "root")) {
        return JSON.stringify({
          uuid: element.uuid,
          name: element.name,
          parent,
          changed: false,
          preserved_world_transform: preserve_world_transform,
        });
      }

      const state = collectOutlinerSubtree([element]);
      const sceneObject = element.scene_object;
      sceneObject.updateMatrixWorld(true);
      const worldBefore = sceneObject.matrixWorld.clone();
      const oldParent = element.parent;
      const oldLocal = sceneObject.matrix.clone();
      Undo.initEdit({ ...state, outliner: true, collections: [] });
      try {
        element.addTo(target);
        element.preview_controller?.updateTransform?.(element);
        element.preview_controller?.updateGeometry?.(element);

        if (preserve_world_transform) {
          const Three = (globalThis as typeof globalThis & {
            THREE: typeof import("three");
          }).THREE;
          const newSceneParent = sceneObject.parent;
          if (!newSceneParent) throw new Error("The new parent has no scene transform.");
          newSceneParent.updateMatrixWorld(true);
          const parentChange = new Three.Matrix4()
            .copy(newSceneParent.matrixWorld)
            .invert();
          if (oldParent instanceof OutlinerNode) {
            oldParent.scene_object.updateMatrixWorld(true);
            parentChange.multiply(oldParent.scene_object.matrixWorld);
          }
          const nextLocal = oldLocal.clone().premultiply(parentChange);
          const position = new Three.Vector3();
          const quaternion = new Three.Quaternion();
          const scale = new Three.Vector3();
          nextLocal.decompose(position, quaternion, scale);
          if (!vectorsNearlyEqual(scale.toArray(), [1, 1, 1], 1e-5)) {
            throw new Error(
              "Preserving this world transform would require unsupported node scaling."
            );
          }

          const absolutePosition = Boolean(
            Format.bone_rig &&
            element.parent instanceof OutlinerNode &&
            element.parent.getTypeBehavior?.("parent") &&
            element.parent.getTypeBehavior?.("use_absolute_position")
          );
          if (absolutePosition && element.parent instanceof Group) {
            position.add(new Three.Vector3(...element.parent.origin));
          }
          const nextPosition = position.toArray() as [number, number, number];

          if (
            "forEachChild" in element &&
            element.getTypeBehavior?.("use_absolute_position")
          ) {
            const offset = nextPosition.map(
              (value, index) => value - Number(element.origin[index])
            ) as [number, number, number];
            element.forEachChild((child: OutlinerNode) => {
              const positioned = child as OutlinerNode & {
                from?: number[];
                to?: number[];
                origin?: number[];
              };
              for (const vector of [positioned.from, positioned.to, positioned.origin]) {
                if (!vector) continue;
                for (let index = 0; index < 3; index++) vector[index] += offset[index];
              }
            });
          }

          if (element instanceof Cube) {
            const offset = nextPosition.map(
              (value, index) => value - Number(element.origin[index])
            ) as [number, number, number];
            for (let index = 0; index < 3; index++) {
              element.from[index] += offset[index];
              element.to[index] += offset[index];
              element.origin[index] += offset[index];
            }
          } else if ("origin" in element) {
            element.origin.V3_set(nextPosition);
          }

          if (element.getTypeBehavior?.("rotatable")) {
            const euler = new Three.Euler().setFromQuaternion(
              quaternion,
              sceneObject.rotation.order
            );
            const rotatable = element as typeof element & { rotation: number[] };
            rotatable.rotation.V3_set([
              Three.MathUtils.radToDeg(euler.x),
              Three.MathUtils.radToDeg(euler.y),
              Three.MathUtils.radToDeg(euler.z),
            ]);
          }
          element.preview_controller?.updateAll?.(element);
          sceneObject.updateMatrixWorld(true);
          if (!vectorsNearlyEqual(
            sceneObject.matrixWorld.elements,
            worldBefore.elements,
            1e-4
          )) {
            throw new Error("World-transform verification failed after reparenting.");
          }
        }
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }

      Undo.finishEdit("Reparent element", { ...state, outliner: true, collections: [] });
      Canvas.updateAll();
      return JSON.stringify({
        uuid: element.uuid,
        name: element.name,
        parent: target === "root"
          ? "root"
          : { uuid: target.uuid, name: target.name },
        changed: true,
        preserved_world_transform: preserve_world_transform,
      }, null, 2);
    },
  }, elementToolDocs[10].status);

  createInternalTool(elementToolDocs[11].name, {
    ...elementToolDocs[11],
    async execute({ include_members }) {
      return JSON.stringify(
        {
          count: Collection.all.length,
          collections: Collection.all.map((collection) =>
            describeCollection(collection, include_members)
          ),
        },
        null,
        2
      );
    },
  }, elementToolDocs[11].status);

  createInternalTool(elementToolDocs[12].name, {
    ...elementToolDocs[12],
    async execute({ operation, collection: reference, name, members }) {
      if (operation === "create") {
        if (!name) throw new Error("Creating a Collection requires name.");
        const resolvedMembers = collectionMembers(members ?? []);
        Undo.initEdit({ collections: [] });
        const collection = new Collection({
          name,
          children: resolvedMembers.map((member) => member.uuid),
        }).add();
        Undo.finishEdit("Agent created collection", { collections: [collection] });
        return JSON.stringify(describeCollection(collection), null, 2);
      }

      if (!reference) {
        throw new Error(`${operation} requires a Collection UUID or unique name.`);
      }
      const collection = findCollectionOrThrow(reference);
      if (operation === "remove") {
        Undo.initEdit({ collections: [collection] });
        Collection.all.splice(Collection.all.indexOf(collection), 1);
        Undo.finishEdit("Agent removed collection");
        return JSON.stringify({
          removed: { uuid: collection.uuid, name: collection.name },
        }, null, 2);
      }

      Undo.initEdit({ collections: [collection] });
      if (name !== undefined) collection.name = name;
      if (members !== undefined) {
        collection.children.splice(
          0,
          collection.children.length,
          ...collectionMembers(members).map((member) => member.uuid)
        );
      }
      (collection as Collection & { saved: boolean }).saved = false;
      Undo.finishEdit("Agent edited collection", { collections: [collection] });
      return JSON.stringify(describeCollection(collection), null, 2);
    },
  }, elementToolDocs[12].status);

  createToolGroup(elementPublicToolDocs[0], elementReadOperations);
  createToolGroup(elementPublicToolDocs[1], elementEditOperations);
}
