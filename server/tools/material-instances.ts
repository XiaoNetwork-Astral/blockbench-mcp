/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import { findElementOrThrow } from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { faceEnum, cubeIdOptionalSchema, cubeIdSchema } from "@/lib/zodObjects";

// ============================================================================
// Material Instance Parameter Schemas
// ============================================================================

/** Empty parameters schema */
export const emptyParametersSchema = z.object({});

/** Faces array optional */
export const facesArrayOptionalSchema = z
  .array(faceEnum)
  .optional()
  .describe("Specific faces to get/clear material instances for. If not provided, returns/clears all faces.");

/** Parameters for getting face material instances */
export const getFaceMaterialInstancesParametersSchema = z.object({
  cube_id: cubeIdOptionalSchema.describe(
    "ID or name of the cube. If not provided, uses the first selected cube."
  ),
  faces: facesArrayOptionalSchema,
});

/** Single material instance assignment */
export const materialInstanceAssignmentSchema = z.object({
  cube_id: cubeIdSchema,
  faces: z.array(faceEnum).describe("Faces to set the material instance on."),
  material_name: z.string().describe("Material instance name to assign."),
});

/** Parameters for bulk setting material instances */
export const bulkSetMaterialInstancesParametersSchema = z.object({
  assignments: z
    .array(materialInstanceAssignmentSchema)
    .min(1)
    .describe("Array of material instance assignments."),
});

/** Parameters for clearing material instances */
export const clearMaterialInstancesParametersSchema = z.object({
  cube_id: cubeIdOptionalSchema.describe(
    "ID or name of the cube. If not provided, clears from all selected cubes."
  ),
  faces: facesArrayOptionalSchema.describe(
    "Specific faces to clear. If not provided, clears all faces."
  ),
  all_cubes: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, clears material instances from all cubes in the project."
    ),
});

/**
 * Helper to find a cube by ID or name
 */
function findCubeOrThrow(id: string): Cube {
  const element = findElementOrThrow(id);
  if (!(element instanceof Cube)) {
    throw new Error(`Element "${id}" is not a cube. Material instances are only supported on cube faces.`);
  }
  return element;
}

// ============================================================================
// Material Instance Tool Docs
// ============================================================================

export const materialInstanceToolDocs: ToolSpec[] = [
  {
    name: "get_face_material_instances",
    description:
      "Gets the material instance names for cube faces. Material instances are used in Bedrock Block format to map faces to materials defined in the minecraft:material_instances component.",
    annotations: {
      title: "Get Face Material Instances",
      readOnlyHint: true,
    },
    parameters: getFaceMaterialInstancesParametersSchema,
    status: STATUS_STABLE,
  },
  {
    name: "list_material_instances",
    description:
      "Lists all unique material instance names used in the project. Returns the material instance names along with which cubes and faces use them.",
    annotations: {
      title: "List Material Instances",
      readOnlyHint: true,
    },
    parameters: emptyParametersSchema,
    status: STATUS_STABLE,
  },
  {
    name: "bulk_set_material_instances",
    description:
      "Sets material instance names on multiple cubes at once. Useful for assigning different material instances to different faces across the project.",
    annotations: {
      title: "Bulk Set Material Instances",
      destructiveHint: true,
    },
    parameters: bulkSetMaterialInstancesParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "clear_material_instances",
    description:
      "Clears (removes) material instance names from cube faces. Useful for resetting material assignments.",
    annotations: {
      title: "Clear Material Instances",
      destructiveHint: true,
    },
    parameters: clearMaterialInstancesParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerMaterialInstanceTools() {
  createInternalTool(
    materialInstanceToolDocs[0].name,
    {
      ...materialInstanceToolDocs[0],
      async execute({ cube_id, faces }) {
        const cube: Cube | undefined = cube_id ? findCubeOrThrow(cube_id) : Cube.selected.at(0);

        if (!cube) {
          throw new Error("No cube found to get material instances from.");
        }

        const facesToCheck = faces || faceEnum.options;
        const result: Record<string, { material_name: string; texture: string | null }> = {};

        for (const faceDir of facesToCheck) {
          const face = cube.faces[faceDir];
          if (face) {
            result[faceDir] = {
              material_name: face.material_name || "",
              texture: face.texture ? (face.getTexture()?.name || face.texture.toString()) : null,
            };
          }
        }

        return JSON.stringify({
          cube: {
            name: cube.name,
            uuid: cube.uuid,
          },
          faces: result,
        }, null, 2);
      },
    },
    materialInstanceToolDocs[0].status
  );

  createInternalTool(
    materialInstanceToolDocs[1].name,
    {
      ...materialInstanceToolDocs[1],
      async execute() {
        const materialMap: Record<
          string,
          Array<{ cube_name: string; cube_uuid: string; face: string }>
        > = {};

        for (const cube of Cube.all) {
          for (const faceDir of faceEnum.options) {
            const face = cube.faces[faceDir];
            if (face && face.material_name) {
              if (!materialMap[face.material_name]) {
                materialMap[face.material_name] = [];
              }
              materialMap[face.material_name].push({
                cube_name: cube.name,
                cube_uuid: cube.uuid,
                face: faceDir,
              });
            }
          }
        }

        const materialInstances = Object.entries(materialMap).map(
          ([name, usages]) => ({
            name,
            usage_count: usages.length,
            usages,
          })
        );

        return JSON.stringify({
          total_unique_instances: materialInstances.length,
          material_instances: materialInstances,
        }, null, 2);
      },
    },
    materialInstanceToolDocs[1].status
  );

  createInternalTool(
    materialInstanceToolDocs[2].name,
    {
      ...materialInstanceToolDocs[2],
      async execute({ assignments }) {
        const cubeCache: Record<string, Cube> = {};
        const cubesToEdit: Cube[] = [];

        // Validate and cache cubes
        for (const assignment of assignments) {
          if (!cubeCache[assignment.cube_id]) {
            const cube = findCubeOrThrow(assignment.cube_id);
            cubeCache[assignment.cube_id] = cube;
            cubesToEdit.push(cube);
          }
        }

        Undo.initEdit({
          elements: cubesToEdit,
          // @ts-expect-error - uv_only is a valid Blockbench API property
          uv_only: true,
        });

        let totalModified = 0;

        for (const assignment of assignments) {
          const cube = cubeCache[assignment.cube_id];
          for (const faceDir of assignment.faces) {
            const face = cube.faces[faceDir];
            if (face) {
              face.extend({ material_name: assignment.material_name });
              totalModified++;
            }
          }
        }

        Undo.finishEdit("Bulk set material instances");
        Canvas.updateAll();

        return `Applied ${assignments.length} material instance assignment(s) affecting ${totalModified} face(s) on ${cubesToEdit.length} cube(s).`;
      },
    },
    materialInstanceToolDocs[2].status
  );

  createInternalTool(
    materialInstanceToolDocs[3].name,
    {
      ...materialInstanceToolDocs[3],
      async execute({ cube_id, faces, all_cubes }) {
        let cubes: Cube[];

        if (all_cubes) {
          cubes = Cube.all;
        } else if (cube_id) {
          cubes = [findCubeOrThrow(cube_id)];
        } else {
          if (!Cube.selected.length) {
            throw new Error(
              "No cube specified and no cubes selected. Provide a cube_id, select cubes, or set all_cubes=true."
            );
          }
          cubes = Cube.selected;
        }

        if (cubes.length === 0) {
          return "No cubes to process.";
        }

        Undo.initEdit({
          elements: cubes,
          // @ts-expect-error - uv_only is a valid Blockbench API property
          uv_only: true,
        });

        const facesToClear = faces || faceEnum.options;
        let clearedCount = 0;

        for (const cube of cubes) {
          for (const faceDir of facesToClear) {
            const face = cube.faces[faceDir];
            if (face && face.material_name) {
              face.extend({ material_name: "" });
              clearedCount++;
            }
          }
        }

        Undo.finishEdit("Clear material instances");
        Canvas.updateAll();

        return `Cleared material instances from ${clearedCount} face(s) across ${cubes.length} cube(s).`;
      },
    },
    materialInstanceToolDocs[3].status
  );

}
