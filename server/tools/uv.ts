/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import { findMeshOrThrow, getMeshOrSelected } from "@/lib/util";
import { STATUS_EXPERIMENTAL } from "@/lib/constants";
import {
  meshIdSchema,
  meshIdOptionalSchema,
  vector2Schema,
  uvMappingModeEnum,
  uvRotationAngleEnum,
  faceKeysOptionalSchema,
} from "@/lib/zodObjects";

// ============================================================================
// UV Tool Parameter Schemas
// ============================================================================

/** Parameters for setting mesh UV */
export const setMeshUvParametersSchema = z.object({
  mesh_id: meshIdSchema,
  face_key: z.string().describe("Face key to set UV for."),
  uv_mapping: z
    .record(
      z.string(), // vertex key
      vector2Schema // UV coordinates
    )
    .describe("UV coordinates for each vertex of the face."),
});

/** Parameters for auto UV mesh */
export const autoUvMeshParametersSchema = z.object({
  mesh_id: meshIdOptionalSchema,
  mode: uvMappingModeEnum
    .default("project")
    .describe(
      "UV mapping mode: project from view, unwrap, cylinder, or sphere mapping."
    ),
  faces: faceKeysOptionalSchema.describe(
    "Specific face keys to UV map. If not provided, maps all selected faces."
  ),
});

/** Parameters for rotating mesh UV */
export const rotateMeshUvParametersSchema = z.object({
  mesh_id: meshIdOptionalSchema,
  angle: uvRotationAngleEnum.default("90").describe("Rotation angle in degrees."),
  faces: faceKeysOptionalSchema.describe(
    "Specific face keys to rotate UV for. If not provided, rotates all selected faces."
  ),
});

// ============================================================================
// UV Tool Docs
// ============================================================================

export const uvToolDocs: ToolSpec[] = [
  {
    name: "set_mesh_uv",
    description: "Sets UV coordinates for mesh faces or vertices.",
    annotations: {
      title: "Set Mesh UV",
      destructiveHint: true,
    },
    parameters: setMeshUvParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "auto_uv_mesh",
    description: "Automatically generates UV mapping for selected mesh faces.",
    annotations: {
      title: "Auto UV Mesh",
      destructiveHint: true,
    },
    parameters: autoUvMeshParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "rotate_mesh_uv",
    description: "Rotates UV coordinates of selected mesh faces.",
    annotations: {
      title: "Rotate Mesh UV",
      destructiveHint: true,
    },
    parameters: rotateMeshUvParametersSchema,
    status: STATUS_EXPERIMENTAL,
  },
];

export function registerUVTools() {
  createInternalTool(
    uvToolDocs[0].name,
    {
      ...uvToolDocs[0],
      parameters: setMeshUvParametersSchema,
      async execute({ mesh_id, face_key, uv_mapping }) {
        const mesh = findMeshOrThrow(mesh_id);
        const face = mesh.faces[face_key];
        if (!face) {
          throw new Error(`Face with key "${face_key}" not found in mesh.`);
        }

        Undo.initEdit({ elements: [mesh] });

        // Set UV coordinates for each vertex
        Object.entries(uv_mapping).forEach(([vkey, uv]) => {
          if (face.vertices.includes(vkey)) {
            face.uv[vkey] = uv as ArrayVector2;
          }
        });

        mesh.preview_controller.updateUV(mesh);
        UVEditor.loadData();

        Undo.finishEdit("Set mesh UV");

        return `Set UV mapping for face "${face_key}" of mesh "${mesh.name}"`;
      },
    },
    uvToolDocs[0].status
  );

  createInternalTool(
    uvToolDocs[1].name,
    {
      ...uvToolDocs[1],
      parameters: autoUvMeshParametersSchema,
      async execute({ mesh_id, mode, faces }, { project }) {
        const mesh = getMeshOrSelected(mesh_id);
        const target = project!;
        const selectedFaces = (faces ?? UVEditor.getSelectedFaces(mesh)) as string[];
        const unknownFaces = selectedFaces.filter((faceKey) => !mesh.faces[faceKey]);
        if (unknownFaces.length > 0) {
          throw new Error(`Unknown mesh face keys: ${unknownFaces.join(", ")}.`);
        }
        if (selectedFaces.length === 0) {
          throw new Error("Select at least one mesh face or supply face keys.");
        }

        if (mode === "project") {
          mesh.select();
          const selection = mesh.getSelectedFaces(true);
          selection.length = 0;
          selection.push(...selectedFaces);
          const action = BarItems.uv_project_from_view as Action;
          if (!action.trigger()) {
            throw new Error("Blockbench's project-from-view action is unavailable in the current mode.");
          }
        } else {
          Undo.initEdit({ elements: [mesh] });
          // Manual UV mapping based on mode
          selectedFaces.forEach((fkey: string) => {
            const face = mesh.faces[fkey];

            if (mode === "unwrap") {
              // Simple planar unwrap
              UVEditor.setAutoSize(null, true, [fkey]);
            } else if (mode === "cylinder") {
              // Cylindrical mapping
              const vertices = face.getSortedVertices();
              vertices.forEach((vkey) => {
                const vertex = mesh.vertices[vkey];
                const angle = Math.atan2(vertex[0], vertex[2]);
                const u =
                  ((angle + Math.PI) / (2 * Math.PI)) * target.texture_width;
                const v = ((vertex[1] + 8) / 16) * target.texture_height;
                face.uv[vkey] = [u, v];
              });
            } else if (mode === "sphere") {
              // Spherical mapping
              const vertices = face.getSortedVertices();
              vertices.forEach((vkey) => {
                const vertex = mesh.vertices[vkey];
                const length = Math.sqrt(
                  vertex[0] ** 2 + vertex[1] ** 2 + vertex[2] ** 2
                );
                const theta = length === 0 ? Math.PI / 2 : Math.acos(vertex[1] / length);
                const phi = Math.atan2(vertex[0], vertex[2]);
                const u =
                  ((phi + Math.PI) / (2 * Math.PI)) * target.texture_width;
                const v = (theta / Math.PI) * target.texture_height;
                face.uv[vkey] = [u, v];
              });
            }
          });
          mesh.preview_controller.updateUV(mesh);
          UVEditor.loadData();
          Undo.finishEdit("Auto UV mesh");
        }

        return `Applied ${mode} UV mapping to ${selectedFaces.length} faces of mesh "${mesh.name}"`;
      },
    },
    uvToolDocs[1].status
  );

  createInternalTool(
    uvToolDocs[2].name,
    {
      ...uvToolDocs[2],
      parameters: rotateMeshUvParametersSchema,
      async execute({ mesh_id, angle, faces }) {
        const mesh = getMeshOrSelected(mesh_id);

        Undo.initEdit({ elements: [mesh] });

        // Set the face selection before rotating so UVEditor.rotate
        // operates on the caller-specified faces instead of whatever
        // happens to be selected in the viewport.
        if (faces && faces.length > 0) {
          const sel = mesh.getSelectedFaces(true);
          sel.length = 0;
          sel.push(...faces);
        }

        const rotation = parseInt(angle);
        UVEditor.rotate(rotation);

        Undo.finishEdit("Rotate mesh UV");

        const affected = faces ?? mesh.getSelectedFaces();
        return `Rotated UV by ${angle} degrees for ${affected.length} faces of mesh "${mesh.name}"`;
      },
    },
    uvToolDocs[2].status
  );

}
