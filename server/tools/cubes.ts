/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { cubeSchema } from "@/lib/zodObjects";
import { STATUS_STABLE } from "@/lib/constants";
import { findElementOrThrow, getProjectTexture } from "@/lib/util";
import {
  CUBE_FACE_KEYS,
  applyCubeTextureMapping,
  type CubeFaceKey,
  type CubeFaceUV,
  type CubeTextureFaceSelection,
} from "@/lib/toolFixes";
import {
  finishCreatedOutlinerEdit,
  resolveOutlinerParentOrThrow,
  rollbackCreatedOutlinerEdit,
} from "@/lib/modelSafety";

type CubeInput = z.infer<typeof cubeSchema>;

export const placeCubeParameters = z.object({
  elements: z.array(cubeSchema).min(1).describe("Array of cubes to place."),
  texture: z
    .string()
    .optional()
    .describe("Texture ID or name to apply to the cube."),
  group: z
    .string()
    .min(1)
    .describe(
      "Required parent group/bone UUID or unique name. Use the exact literal 'root' only for an intentional root-level cube."
    ),
  faces: z
    .union([
      z
        .array(z.enum(["north", "south", "east", "west", "up", "down"]))
        .describe("Array of faces to apply the texture to."),
      z
        .boolean()
        .optional()
        .describe(
          "Whether to apply the texture to all faces. Set to `true` to enable auto UV mapping."
        ),
      z
        .array(
          z.object({
            face: z
              .enum(["north", "south", "east", "west", "up", "down"])
              .describe("Face to apply the texture to."),
            uv: z
              .array(z.number()).length(4)
              .describe("Custom UV mapping for the face."),
          })
        )
        .describe("Array of faces with custom UV mapping."),
    ])
    .optional()
    .default(true)
    .describe(
      "Faces to apply the texture to. Set to `true` to enable auto UV mapping."
    ),
});

export const modifyCubeParameters = z.object({
  id: z
    .string()
    .optional()
    .describe(
      "ID or name of the cube to modify. Defaults to selected, which could be more than one."
    ),
  name: z.string().optional().describe("New name of the cube."),
  origin: z
    .array(z.number()).length(3)
    .optional()
    .describe("Pivot point of the cube."),
  from: z
    .array(z.number()).length(3)
    .optional()
    .describe("Starting point of the cube."),
  to: z
    .array(z.number()).length(3)
    .optional()
    .describe("Ending point of the cube."),
  rotation: z
    .array(z.number()).length(3)
    .optional()
    .describe("Rotation of the cube."),
  autouv: z
    .enum(["0", "1", "2"])
    .optional()
    .describe(
      "Auto UV setting. 0 = disabled, 1 = enabled, 2 = relative auto UV."
    ),
  uv_offset: z
    .array(z.number()).length(2)
    .optional()
    .describe("UV offset for the texture."),
  mirror_uv: z.boolean().optional().describe("Whether to mirror the UVs."),
  shade: z
    .boolean()
    .optional()
    .describe("Whether to apply shading to the cube."),
  inflate: z.number().optional().describe("Inflation amount for the cube."),
  color: z
    .number()
    .optional()
    .describe("Single digit to represent a color from a palette."),
  visibility: z
    .boolean()
    .optional()
    .describe("Whether the cube is visible or not."),
});

const cubeFaceUvUpdateSchema = z.object({
  north: z.array(z.number()).length(4).optional(),
  south: z.array(z.number()).length(4).optional(),
  east: z.array(z.number()).length(4).optional(),
  west: z.array(z.number()).length(4).optional(),
  up: z.array(z.number()).length(4).optional(),
  down: z.array(z.number()).length(4).optional(),
});

const cubeUvUpdateSchema = z
  .object({
    id: z.string().describe("Cube UUID or unique name."),
    uv_offset: z
      .array(z.number())
      .length(2)
      .optional()
      .describe("New Box UV offset [u, v]."),
    face_uv: cubeFaceUvUpdateSchema
      .optional()
      .describe(
        "Per-face UV rectangles [u1, v1, u2, v2]. Supplying any face automatically switches the cube to per-face UV mode."
      ),
    uv_mode: z
      .enum(["preserve", "box", "per_face"])
      .optional()
      .default("preserve")
      .describe("Preserve or explicitly set the cube UV mode."),
  })
  .refine(({ uv_offset, face_uv, uv_mode }) =>
    uv_offset !== undefined || face_uv !== undefined || uv_mode !== "preserve", {
    message: "Each update must change uv_offset, face_uv, or uv_mode.",
  })
  .refine(({ face_uv, uv_mode }) => !(face_uv && uv_mode === "box"), {
    message: "face_uv cannot be combined with uv_mode='box'.",
    path: ["face_uv", "uv_mode"],
  })
  .refine(({ face_uv, uv_offset }) => !(face_uv && uv_offset), {
    message: "uv_offset and face_uv target different UV modes; use separate cube updates.",
    path: ["uv_offset", "face_uv"],
  });

type CubeUvUpdate = {
  id: string;
  uv_offset?: number[];
  face_uv?: Partial<Record<CubeFaceKey, number[]>>;
  uv_mode?: "preserve" | "box" | "per_face";
};

export const batchSetCubeUvParameters = z.object({
  updates: z
    .array(cubeUvUpdateSchema)
    .min(1)
    .max(500)
    .describe("Cube UV updates resolved and committed as one atomic Undo edit."),
});

export const cubeToolDocs: ToolSpec[] = [
  {
    name: "place_cube",
    description:
      "Places one or more cubes under a mandatory explicit parent. Use group='root' only for intentional root-level cubes; omitted, missing, or ambiguous parents are rejected before mutation.",
    annotations: {
      title: "Place Cube",
      destructiveHint: true,
    },
    parameters: placeCubeParameters,
    status: STATUS_STABLE,
  },
  {
    name: "modify_cube",
    description:
      "Modifies the cube with the given ID. Auto UV setting: saved as an integer, where 0 means disabled, 1 means enabled, and 2 means relative auto UV (cube position affects UV)",
    annotations: {
      title: "Modify Cube",
      destructiveHint: true,
    },
    parameters: modifyCubeParameters,
    status: STATUS_STABLE,
  },
  {
    name: "batch_set_cube_uv",
    description:
      "Atomically updates Box UV offsets and/or per-face UV rectangles for up to 500 existing cubes. All cube references are resolved before mutation, duplicate targets are refused, explicit face rectangles switch to per-face UV mode, and every requested value is read back before success.",
    annotations: {
      title: "Batch Set Cube UV",
      destructiveHint: true,
    },
    parameters: batchSetCubeUvParameters,
    status: STATUS_STABLE,
  },
];

export function registerCubesTools() {
createTool(cubeToolDocs[0].name, {
  ...cubeToolDocs[0],
  async execute({ elements, texture, faces, group }) {
    const projectTexture = texture
      ? getProjectTexture(texture)
      : Texture.getDefault();

    if (texture && !projectTexture) {
      throw new Error(`No texture found for "${texture}".`);
    }
    const outlinerParent = resolveOutlinerParentOrThrow(group, "cube");

    const autouv =
      faces === true ||
      (Array.isArray(faces) &&
        faces.every((face) => typeof face === "string"));

    const cubes: Cube[] = [];
    Undo.initEdit({ elements: [], groups: [], outliner: true, collections: [] });
    try {
      for (const element of elements as CubeInput[]) {
        const elementAutouv = element.autouv === undefined
          ? (autouv ? 1 : 0)
          : Number(element.autouv) as 0 | 1 | 2;
        const cube = new Cube({
          autouv: elementAutouv,
          name: element.name,
          from: element.from as [number, number, number],
          to: element.to as [number, number, number],
          origin: element.origin as [number, number, number],
          rotation: element.rotation as [number, number, number],
          inflate: element.inflate,
          mirror_uv: element.mirror_uv,
          shade: element.shade,
          visibility: element.visibility,
          uv_offset: element.uv_offset as [number, number] | undefined,
        }).init();
        cubes.push(cube);
        cube.addTo(outlinerParent);

        applyCubeTextureMapping(
          cube,
          projectTexture ?? undefined,
          element.face_uv as Partial<Record<CubeFaceKey, CubeFaceUV>> | undefined,
          faces as CubeTextureFaceSelection
        );
      }
    } catch (error) {
      rollbackCreatedOutlinerEdit(cubes);
      throw error;
    }

    finishCreatedOutlinerEdit("Agent placed cubes", cubes);
    Canvas.updateAll();

    return await Promise.resolve(
      JSON.stringify(
        cubes.map((cube: Cube) => `Added cube ${cube.name} with ID ${cube.uuid}`)
      )
    );
  },
}, cubeToolDocs[0].status);

createTool(cubeToolDocs[1].name, {
  ...cubeToolDocs[1],
  async execute({
    id,
    name,
    origin,
    from,
    to,
    rotation,
    uv_offset,
    autouv,
    mirror_uv,
    shade,
    inflate,
    color,
    visibility,
  }) {
    let cubes: Cube[];
    if (id) {
      cubes = (Cube.all ?? []).filter((el: Cube) => el.uuid === id || el.name === id);
      if (!cubes.length) {
        throw new Error(`Cube with ID "${id}" not found. Use the list_outline tool to see available cubes.`);
      }
    } else {
      cubes = Cube.selected;
      if (!cubes.length) {
        throw new Error("No cube selected and no id provided. Select a cube or provide an id.");
      }
    }

    Undo.initEdit({
      elements: Array.isArray(cubes) ? cubes : [cubes],
      outliner: true,
      collections: [],
    });

    cubes.forEach((cube) => {
      const cubeOrigin: [number, number, number] = (origin ?? cube.origin) as [number, number, number];
      const cubeFrom: [number, number, number] = (from ?? cube.from) as [number, number, number];
      const cubeTo: [number, number, number] = (to ?? cube.to) as [number, number, number];
      const cubeRotation: [number, number, number] = (rotation ?? cube.rotation) as [number, number, number];
      const cubeUVOffset: [number, number] = (uv_offset ?? cube.uv_offset) as [number, number];

      cube.extend({
        name: name ?? cube.name,
        origin: cubeOrigin,
        from: cubeFrom,
        to: cubeTo,
        rotation: cubeRotation,
        uv_offset: cubeUVOffset,
        autouv: autouv ? (Number(autouv) as 0 | 1 | 2) : cube.autouv,
        mirror_uv: Boolean(mirror_uv ?? cube.mirror_uv),
        inflate: inflate ?? cube.inflate,
        color: color ?? cube.color,
        visibility: visibility ?? cube.visibility,
        shade: shade ?? cube.shade,
      });
    });

    Undo.finishEdit("Agent modified cubes");
    Canvas.updateAll();

    return `Modified cubes ${cubes
      .map((cube) => cube.name)
      .join(", ")} with IDs ${cubes.map((cube) => cube.uuid).join(", ")}`;
  },
}, cubeToolDocs[1].status);

createTool(cubeToolDocs[2].name, {
  ...cubeToolDocs[2],
  async execute({ updates }) {
    const resolved = (updates as CubeUvUpdate[]).map((update) => {
      const element = findElementOrThrow(update.id);
      if (!(element instanceof Cube)) {
        throw new Error(`Element "${update.id}" is not a cube.`);
      }
      return { update, cube: element };
    });
    const duplicateIds = resolved
      .map(({ cube }) => cube.uuid)
      .filter((uuid, index, all) => all.indexOf(uuid) !== index);
    if (duplicateIds.length > 0) {
      throw new Error(
        `Duplicate cube targets are not allowed in one batch: ${[...new Set(duplicateIds)].join(", ")}`
      );
    }
    for (const { update, cube } of resolved) {
      if (update.uv_offset && !cube.box_uv && update.uv_mode !== "box") {
        throw new Error(
          `Cube "${cube.name}" (${cube.uuid}) currently uses per-face UV. ` +
            "Set uv_mode='box' explicitly before applying uv_offset."
        );
      }
      if (update.uv_offset && update.uv_mode === "per_face") {
        throw new Error("uv_offset cannot be combined with uv_mode='per_face'.");
      }
    }

    const cubes = resolved.map(({ cube }) => cube);
    const undoAspects = {
      elements: cubes,
      uv_only: true,
      collections: [],
    } as UndoAspects;
    Undo.initEdit(undoAspects);
    try {
      for (const { update, cube } of resolved) {
        if (update.uv_mode === "box") cube.setUVMode(true);
        if (update.uv_mode === "per_face" || update.face_uv) {
          cube.setUVMode(false);
        }
        if (update.uv_offset) {
          cube.uv_offset[0] = update.uv_offset[0];
          cube.uv_offset[1] = update.uv_offset[1];
        }
        for (const faceKey of CUBE_FACE_KEYS) {
          const uv = update.face_uv?.[faceKey];
          if (uv) cube.faces[faceKey].extend({ uv: [...uv] as CubeFaceUV });
        }
      }

      const failures: string[] = [];
      for (const { update, cube } of resolved) {
        if (update.uv_mode === "box" && !cube.box_uv) {
          failures.push(`${cube.uuid}: expected Box UV mode`);
        }
        if ((update.uv_mode === "per_face" || update.face_uv) && cube.box_uv) {
          failures.push(`${cube.uuid}: expected per-face UV mode`);
        }
        if (update.uv_offset && update.uv_offset.some(
          (value, index) => cube.uv_offset[index] !== value
        )) {
          failures.push(`${cube.uuid}: uv_offset readback mismatch`);
        }
        for (const faceKey of CUBE_FACE_KEYS) {
          const expected = update.face_uv?.[faceKey];
          if (expected && expected.some(
            (value, index) => cube.faces[faceKey].uv[index] !== value
          )) {
            failures.push(`${cube.uuid}: ${faceKey} face UV readback mismatch`);
          }
        }
      }
      if (failures.length > 0) {
        throw new Error(`Cube UV verification failed: ${failures.join("; ")}`);
      }
    } catch (error) {
      (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
      throw error;
    }

    Undo.finishEdit("Agent batch updated cube UVs", undoAspects);
    Canvas.updateView({
      elements: cubes,
      element_aspects: { faces: true, uv: true, geometry: false },
    });
    Canvas.updateAllUVs();
    if (Outliner.selected.length > 0) UVEditor.loadData();

    return JSON.stringify({
      updated: resolved.map(({ cube }) => ({
        name: cube.name,
        uuid: cube.uuid,
        uv_mode: cube.box_uv ? "box" : "per_face",
        uv_offset: [...cube.uv_offset],
      })),
      count: cubes.length,
      verified: true,
    }, null, 2);
  },
}, cubeToolDocs[2].status);
}
