/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  type ToolSpec,
} from "@/lib/factories";
import {
  meshSchema,
  meshIdOptionalSchema,
  meshIdSchema,
  textureIdOptionalSchema,
  vec3,
  meshSelectionModeEnum,
  selectionActionEnum,
} from "@/lib/zodObjects";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import {
  assertFaceTextureAssignmentSupported,
  getMeshOrSelected,
  findMeshOrThrow,
  findTextureOrThrow,
} from "@/lib/util";
import {
  finishCreatedOutlinerEdit,
  resolveOutlinerParentOrThrow,
  rollbackCreatedOutlinerEdit,
} from "@/lib/modelSafety";
import {
  applySelectionAction,
  assertMeshVertexKeys,
  meshEdgeId,
  replaceArray,
  resolveMeshSelection,
  sameMeshEdge,
  uniqueKeys,
  type MeshEdge,
} from "@/lib/meshEditing";

type ThreeApi = typeof import("three");

function getThreeApi(): ThreeApi {
  return (globalThis as typeof globalThis & { THREE: ThreeApi }).THREE;
}

// ============================================================================
// Mesh Tool Parameter Schemas
// ============================================================================

export const placeMeshParameters = z.object({
  elements: z
    .array(meshSchema)
    .min(1)
    .describe("Array of meshes to place."),
  texture: textureIdOptionalSchema.describe("Texture ID or name to apply to the mesh."),
  group: z.string().min(1).optional().default("root").describe(
    "Parent group/bone UUID or unique name. Defaults to the Outliner root."
  ),
});

export const extrudeMeshParameters = z.object({
  mesh_id: meshIdOptionalSchema,
  distance: z.number().default(1).describe("Distance to extrude."),
  mode: z
    .enum(["faces", "edges", "vertices"])
    .default("faces")
    .describe("What to extrude: faces, edges, or vertices."),
});

export const subdivideMeshParameters = z.object({
  mesh_id: meshIdOptionalSchema,
  cuts: z
    .number()
    .min(1)
    .max(10)
    .default(1)
    .describe("Number of subdivision cuts to make."),
});

export const createSphereParameters = z.object({
  elements: z
    .array(
      z.object({
        name: z.string().describe("Name of the sphere."),
        position: vec3("Position of the sphere center."),
        diameter: z
          .number()
          .min(1)
          .max(64)
          .default(16)
          .describe("Diameter of the sphere."),
        sides: z
          .number()
          .min(3)
          .max(48)
          .default(12)
          .describe(
            "Number of horizontal divisions (affects sphere quality)."
          ),
        rotation: vec3()
          .optional()
          .default([0, 0, 0])
          .describe("Rotation of the sphere."),
        align_edges: z
          .boolean()
          .optional()
          .default(true)
          .describe("Whether to align edges for better geometry."),
      })
    )
    .min(1)
    .describe("Array of spheres to create."),
  texture: textureIdOptionalSchema.describe("Texture ID or name to apply to the sphere."),
  group: z.string().min(1).optional().default("root").describe(
    "Parent group/bone UUID or unique name. Defaults to the Outliner root."
  ),
});

export const selectMeshElementsParameters = z.object({
  mesh_id: meshIdSchema.describe("ID or name of the mesh to select elements from."),
  mode: meshSelectionModeEnum.describe("Selection mode."),
  elements: z
    .array(
      z.union([
        z
          .string()
          .describe("Vertex key, edge as 'vkey1-vkey2', or face key"),
        z.number().describe("Index of the element"),
      ])
    )
    .optional()
    .describe("Specific elements to select. If not provided, selects all."),
  action: selectionActionEnum
    .default("select")
    .describe(
      "Selection action: select (replace), add, remove, or toggle."
    ),
});

export const moveMeshVerticesParameters = z.object({
  mesh_id: meshIdOptionalSchema,
  offset: vec3("Offset to move vertices by [x, y, z]."),
  vertices: z
    .array(z.string())
    .optional()
    .describe(
      "Specific vertex keys to move. If not provided, moves all selected vertices."
    ),
});

export const deleteMeshElementsParameters = z.object({
  mesh_id: meshIdOptionalSchema,
  mode: z
    .enum(["vertices", "edges", "faces"])
    .default("faces")
    .describe("What to delete: vertices, edges, or faces."),
  keep_vertices: z
    .boolean()
    .default(false)
    .describe("When deleting faces/edges, whether to keep the vertices."),
});

export const mergeMeshVerticesParameters = z.object({
  mesh_id: meshIdSchema,
  threshold: z
    .number()
    .min(0)
    .max(10)
    .default(0.1)
    .describe("Maximum distance between vertices to merge."),
  selected_only: z
    .boolean()
    .default(true)
    .describe("Whether to only merge selected vertices."),
});

export const createMeshFaceParameters = z.object({
  mesh_id: meshIdOptionalSchema,
  vertices: z
    .array(z.string())
    .min(3)
    .max(4)
    .describe("Vertex keys to create face from. Must be 3 or 4 vertices."),
  texture: textureIdOptionalSchema.describe("Texture ID or name to apply to the new face."),
});

export const createCylinderParameters = z.object({
  elements: z
    .array(
      z.object({
        name: z.string(),
        position: vec3(),
        height: z.number().min(1).max(64).default(16),
        diameter: z.number().min(1).max(64).default(16),
        sides: z.number().min(3).max(64).default(12),
        rotation: vec3().optional().default([0, 0, 0]),
        capped: z.boolean().optional().default(true),
      })
    )
    .min(1),
  texture: textureIdOptionalSchema,
  group: z.string().min(1).optional().default("root").describe(
    "Parent group/bone UUID or unique name. Defaults to the Outliner root."
  ),
});

export const createPyramidParameters = z.object({
  elements: z
    .array(
      z.object({
        name: z.string().min(1),
        base_center: vec3("Center of the polygon base in model coordinates."),
        apex: vec3("Apex position in model coordinates."),
        radius: z.number().positive().max(64).default(4),
        sides: z
          .number()
          .int()
          .min(3)
          .max(32)
          .default(4)
          .describe("3 creates a tetrahedron-like pyramid; larger values create a low-poly cone."),
        base_rotation: z.number().finite().optional().default(0),
        capped: z.boolean().optional().default(true),
      })
    )
    .min(1),
  texture: textureIdOptionalSchema,
  group: z.string().min(1).optional().default("root").describe(
    "Parent group/bone UUID or unique name. Defaults to the Outliner root."
  ),
});

export const knifeToolParameters = z.object({
  mesh_id: meshIdSchema.describe("ID or name of the mesh to cut."),
  points: z
    .array(
      z.object({
        position: vec3("3D position of the cut point."),
        face: z
          .string()
          .min(1)
          .describe("Existing face key containing this mesh-local cut point."),
      })
    )
    .min(2)
    .describe("Points defining the cut path."),
});

type MeshSelectionSnapshot = {
  vertices: string[];
  edges: MeshEdge[];
  faces: string[];
};

function selectionSnapshot(mesh: Mesh): MeshSelectionSnapshot {
  return {
    vertices: [...mesh.getSelectedVertices()],
    edges: mesh.getSelectedEdges().map((edge) => [edge[0], edge[1]]),
    faces: [...mesh.getSelectedFaces()],
  };
}

function updateMeshGeometry(mesh: Mesh): void {
  mesh.preview_controller.updateGeometry(mesh);
  mesh.preview_controller.updateUV(mesh);
  Canvas.updateView({
    elements: [mesh],
    selection: true,
    element_aspects: { geometry: true, uv: true, faces: true },
  });
}

function faceNormal(mesh: Mesh, vertexKey: string, faceKeys: readonly string[]): [number, number, number] {
  const normals = faceKeys
    .map((key) => mesh.faces[key])
    .filter((face) => face?.vertices.includes(vertexKey))
    .map((face) => face.getNormal(true));
  if (!normals.length) {
    for (const face of Object.values(mesh.faces)) {
      if (face.vertices.includes(vertexKey) && face.vertices.length >= 3) {
        normals.push(face.getNormal(true));
      }
    }
  }
  const result: [number, number, number] = [0, 0, 0];
  for (const normal of normals) {
    result[0] += normal[0];
    result[1] += normal[1];
    result[2] += normal[2];
  }
  const length = Math.hypot(...result);
  if (!length) return [0, 1, 0];
  return [result[0] / length, result[1] / length, result[2] / length];
}

function extrudeSelection(
  mesh: Mesh,
  mode: "faces" | "edges" | "vertices",
  distance: number
) {
  const selectedFaces = mode === "faces" ? [...mesh.getSelectedFaces()] : [];
  const selectedEdges = mode === "edges"
    ? mesh.getSelectedEdges().map((edge) => [edge[0], edge[1]] as MeshEdge)
    : [];
  let originalVertices = mode === "vertices" ? [...mesh.getSelectedVertices()] : [];
  if (mode === "faces") {
    if (!selectedFaces.length) throw new Error("Select at least one mesh face before extrusion.");
    const invalidFace = selectedFaces.find((key) => !mesh.faces[key]);
    if (invalidFace) throw new Error(`Selected mesh face key "${invalidFace}" no longer exists.`);
    originalVertices = uniqueKeys(selectedFaces.flatMap((key) => mesh.faces[key].vertices));
  } else if (mode === "edges") {
    if (!selectedEdges.length) throw new Error("Select at least one mesh edge before extrusion.");
    originalVertices = uniqueKeys(selectedEdges.flat());
  }
  assertMeshVertexKeys(mesh.vertices, originalVertices);

  const newVertexKeys = mesh.addVertices(...originalVertices.map((key) => {
    const source = mesh.vertices[key];
    const normal = faceNormal(mesh, key, selectedFaces);
    return [
      source[0] + normal[0] * distance,
      source[1] + normal[1] * distance,
      source[2] + normal[2] * distance,
    ] as ArrayVector3;
  }));
  const replacement = new Map(originalVertices.map((key, index) => [key, newVertexKeys[index]]));
  const newFaceKeys: string[] = [];

  if (mode === "faces") {
    const boundaryEdges = new Map<string, { edge: MeshEdge; face: MeshFace; count: number }>();
    for (const key of selectedFaces) {
      const face = mesh.faces[key];
      for (const edge of face.getEdges()) {
        const id = meshEdgeId(edge);
        const existing = boundaryEdges.get(id);
        if (existing) existing.count += 1;
        else boundaryEdges.set(id, { edge, face, count: 1 });
      }
      const oldVertices = [...face.vertices];
      const oldUv = { ...face.uv };
      face.vertices = oldVertices.map((vertexKey) => replacement.get(vertexKey)!);
      face.uv = Object.fromEntries(oldVertices.map((vertexKey) => [
        replacement.get(vertexKey)!,
        oldUv[vertexKey] ?? [0, 0],
      ]));
    }
    for (const { edge: [first, second], face, count } of boundaryEdges.values()) {
      if (count !== 1) continue;
      const nextFirst = replacement.get(first)!;
      const nextSecond = replacement.get(second)!;
      const side = new MeshFace(mesh, face).extend({
        vertices: [nextSecond, nextFirst, first, second],
        uv: {
          [nextSecond]: face.uv[nextSecond] ?? [0, 0],
          [nextFirst]: face.uv[nextFirst] ?? [0, 0],
          [first]: face.uv[nextFirst] ?? [0, 0],
          [second]: face.uv[nextSecond] ?? [0, 0],
        },
      });
      newFaceKeys.push(...mesh.addFaces(side));
    }
    replaceArray(mesh.getSelectedFaces(true), selectedFaces);
  } else if (mode === "edges") {
    for (const [first, second] of selectedEdges) {
      const adjacent = Object.values(mesh.faces).find((face) =>
        face.vertices.includes(first) && face.vertices.includes(second)
      );
      const side = new MeshFace(mesh, adjacent ?? {}).extend({
        vertices: [replacement.get(first)!, replacement.get(second)!, second, first],
      });
      newFaceKeys.push(...mesh.addFaces(side));
    }
    replaceArray(mesh.getSelectedEdges(true), selectedEdges.map(([first, second]) => [
      replacement.get(first)!, replacement.get(second)!,
    ]));
  } else {
    for (const key of originalVertices) {
      newFaceKeys.push(...mesh.addFaces(new MeshFace(mesh, {
        vertices: [key, replacement.get(key)!],
        uv: {},
      })));
    }
  }
  replaceArray(mesh.getSelectedVertices(true), newVertexKeys);
  return { newVertexKeys, newFaceKeys, selectedFaces };
}

function interpolate(first: readonly number[], second: readonly number[], ratio: number): ArrayVector3 {
  return [
    first[0] + (second[0] - first[0]) * ratio,
    first[1] + (second[1] - first[1]) * ratio,
    first[2] + (second[2] - first[2]) * ratio,
  ];
}

function interpolateUv(first: readonly number[] | undefined, second: readonly number[] | undefined, ratio: number): ArrayVector2 {
  const a = first ?? [0, 0];
  const b = second ?? [0, 0];
  return [a[0] + (b[0] - a[0]) * ratio, a[1] + (b[1] - a[1]) * ratio];
}

function subdivideFaces(mesh: Mesh, faceKeys: readonly string[], cuts: number) {
  if (!faceKeys.length) throw new Error("Select at least one mesh face before subdivision.");
  const invalid = faceKeys.find((key) => !mesh.faces[key]);
  if (invalid) throw new Error(`Selected mesh face key "${invalid}" no longer exists.`);
  const unsupported = faceKeys.find((key) => ![2, 3, 4].includes(mesh.faces[key].vertices.length));
  if (unsupported) throw new Error(`Mesh face "${unsupported}" has an unsupported vertex count for subdivision.`);

  const segments = cuts + 1;
  const edgeCache = new Map<string, string>();
  const createdVertices: string[] = [];
  const resultFaceKeys: string[] = [];

  const edgePoint = (first: string, second: string, step: number): string => {
    if (step === 0) return first;
    if (step === segments) return second;
    const forward = first < second;
    const normalizedStep = forward ? step : segments - step;
    const id = `${meshEdgeId([first, second])}\u0000${normalizedStep}/${segments}`;
    const existing = edgeCache.get(id);
    if (existing) return existing;
    const [key] = mesh.addVertices(interpolate(mesh.vertices[first], mesh.vertices[second], step / segments));
    edgeCache.set(id, key);
    createdVertices.push(key);
    return key;
  };

  for (const faceKey of faceKeys) {
    const face = mesh.faces[faceKey];
    const vertices = face.getSortedVertices();
    const polygons: Array<{ vertices: string[]; uv: Record<string, ArrayVector2> }> = [];
    const internal = new Map<string, string>();
    const internalPoint = (id: string, position: ArrayVector3): string => {
      const existing = internal.get(id);
      if (existing) return existing;
      const [key] = mesh.addVertices(position);
      internal.set(id, key);
      createdVertices.push(key);
      return key;
    };

    if (vertices.length === 2) {
      const chain = Array.from({ length: segments + 1 }, (_, step) => edgePoint(vertices[0], vertices[1], step));
      for (let index = 0; index < segments; index += 1) {
        const first = chain[index];
        const second = chain[index + 1];
        polygons.push({
          vertices: [first, second],
          uv: {
            [first]: interpolateUv(face.uv[vertices[0]], face.uv[vertices[1]], index / segments),
            [second]: interpolateUv(face.uv[vertices[0]], face.uv[vertices[1]], (index + 1) / segments),
          },
        });
      }
    } else if (vertices.length === 3) {
      const [a, b, c] = vertices;
      const point = (i: number, j: number) => {
        if (j === 0) return edgePoint(a, b, i);
        if (i === 0) return edgePoint(a, c, j);
        if (i + j === segments) return edgePoint(b, c, j);
        const wa = 1 - (i + j) / segments;
        const wb = i / segments;
        const wc = j / segments;
        return internalPoint(`${i},${j}`, [0, 1, 2].map((axis) =>
          mesh.vertices[a][axis] * wa + mesh.vertices[b][axis] * wb + mesh.vertices[c][axis] * wc
        ) as ArrayVector3);
      };
      const uvFor = (i: number, j: number): ArrayVector2 => {
        const wa = 1 - (i + j) / segments;
        const wb = i / segments;
        const wc = j / segments;
        return [0, 1].map((axis) =>
          (face.uv[a]?.[axis] ?? 0) * wa + (face.uv[b]?.[axis] ?? 0) * wb + (face.uv[c]?.[axis] ?? 0) * wc
        ) as ArrayVector2;
      };
      for (let i = 0; i < segments; i += 1) {
        for (let j = 0; j < segments - i; j += 1) {
          const first = point(i, j);
          const second = point(i + 1, j);
          const third = point(i, j + 1);
          polygons.push({ vertices: [first, second, third], uv: {
            [first]: uvFor(i, j), [second]: uvFor(i + 1, j), [third]: uvFor(i, j + 1),
          } });
          if (i + j >= segments - 1) continue;
          const fourth = point(i + 1, j + 1);
          polygons.push({ vertices: [second, fourth, third], uv: {
            [second]: uvFor(i + 1, j), [fourth]: uvFor(i + 1, j + 1), [third]: uvFor(i, j + 1),
          } });
        }
      }
    } else {
      const [a, b, c, d] = vertices;
      const point = (i: number, j: number) => {
        if (j === 0) return edgePoint(a, b, i);
        if (i === segments) return edgePoint(b, c, j);
        if (j === segments) return edgePoint(d, c, i);
        if (i === 0) return edgePoint(a, d, j);
        const top = interpolate(mesh.vertices[a], mesh.vertices[b], i / segments);
        const bottom = interpolate(mesh.vertices[d], mesh.vertices[c], i / segments);
        return internalPoint(`${i},${j}`, interpolate(top, bottom, j / segments));
      };
      const uvFor = (i: number, j: number) => {
        const top = interpolateUv(face.uv[a], face.uv[b], i / segments);
        const bottom = interpolateUv(face.uv[d], face.uv[c], i / segments);
        return interpolateUv(top, bottom, j / segments);
      };
      for (let j = 0; j < segments; j += 1) {
        for (let i = 0; i < segments; i += 1) {
          const polygon = [point(i, j), point(i + 1, j), point(i + 1, j + 1), point(i, j + 1)];
          polygons.push({ vertices: polygon, uv: Object.fromEntries([
            [polygon[0], uvFor(i, j)], [polygon[1], uvFor(i + 1, j)],
            [polygon[2], uvFor(i + 1, j + 1)], [polygon[3], uvFor(i, j + 1)],
          ]) });
        }
      }
    }

    const [first, ...rest] = polygons;
    face.extend(first);
    resultFaceKeys.push(faceKey);
    for (const polygon of rest) {
      resultFaceKeys.push(...mesh.addFaces(new MeshFace(mesh, face).extend(polygon)));
    }
  }
  replaceArray(mesh.getSelectedFaces(true), resultFaceKeys);
  replaceArray(mesh.getSelectedVertices(true), createdVertices);
  return { createdVertices, resultFaceKeys };
}

// ============================================================================
// Mesh Tool Docs
// ============================================================================

export const meshToolDocs: ToolSpec[] = [
  {
    name: "place_mesh",
    description:
      "Places one or more meshes at the Outliner root unless a parent group or bone is supplied.",
    annotations: {
      title: "Place Mesh",
      destructiveHint: true,
    },
    parameters: placeMeshParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "extrude_mesh",
    description: "Extrudes selected faces or edges of a mesh.",
    annotations: {
      title: "Extrude Mesh",
      destructiveHint: true,
    },
    parameters: extrudeMeshParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "subdivide_mesh",
    description: "Subdivides selected faces of a mesh to create more geometry.",
    annotations: {
      title: "Subdivide Mesh",
      destructiveHint: true,
    },
    parameters: subdivideMeshParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "create_sphere",
    description:
      "Creates one or more sphere meshes at the Outliner root unless a parent is supplied. The spheres use vertices and faces generated from spherical coordinates.",
    annotations: {
      title: "Create Sphere",
      destructiveHint: true,
    },
    parameters: createSphereParameters,
    status: STATUS_STABLE,
  },
  {
    name: "select_mesh_elements",
    description:
      "Selects vertices, edges, or faces of a mesh for manipulation.",
    annotations: {
      title: "Select Mesh Elements",
      destructiveHint: true,
    },
    parameters: selectMeshElementsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "move_mesh_vertices",
    description: "Moves selected vertices of a mesh by the specified offset.",
    annotations: {
      title: "Move Mesh Vertices",
      destructiveHint: true,
    },
    parameters: moveMeshVerticesParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "delete_mesh_elements",
    description: "Deletes selected vertices, edges, or faces from a mesh.",
    annotations: {
      title: "Delete Mesh Elements",
      destructiveHint: true,
    },
    parameters: deleteMeshElementsParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "merge_mesh_vertices",
    description:
      "Merges vertices that are within a specified distance of each other.",
    annotations: {
      title: "Merge Mesh Vertices",
      destructiveHint: true,
    },
    parameters: mergeMeshVerticesParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "create_mesh_face",
    description: "Creates a new face from selected vertices.",
    annotations: {
      title: "Create Mesh Face",
      destructiveHint: true,
    },
    parameters: createMeshFaceParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "create_cylinder",
    description:
      "Creates one or more cylinder meshes with optional end caps at the Outliner root unless a parent is supplied.",
    annotations: { title: "Create Cylinder", destructiveHint: true },
    parameters: createCylinderParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "knife_tool",
    description: "Uses the knife tool to cut custom edges into mesh faces.",
    annotations: {
      title: "Knife Tool",
      destructiveHint: true,
    },
    parameters: knifeToolParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "create_pyramid",
    description:
      "Creates sealed low-poly pyramids or cones from a polygon base and apex; sides=3 gives a tetrahedron-like primitive.",
    annotations: { title: "Create Pyramid", destructiveHint: true },
    parameters: createPyramidParameters,
    status: STATUS_STABLE,
  },
];

// ============================================================================
// Registration
// ============================================================================

export function registerMeshTools() {
  createInternalTool(meshToolDocs[0].name, {
    ...meshToolDocs[0],
    parameters: placeMeshParameters,
    async execute({ elements, texture, group }, { reportProgress }) {
      const total = elements.length;
      const projectTexture = texture
        ? findTextureOrThrow(texture)
        : Texture.getDefault();
      if (projectTexture) assertFaceTextureAssignmentSupported(projectTexture);
      const outlinerParent = resolveOutlinerParentOrThrow(group, "mesh");
      const meshes: Mesh[] = [];
      const created: Array<{
        mesh: { uuid: string; name: string };
        vertices: Array<{ input_index: number; key: string; position: ArrayVector3 }>;
        faces: Array<{ key: string; vertices: string[] }>;
      }> = [];
      Undo.initEdit({ elements: [], groups: [], outliner: true, collections: [] });
      try {
        for (const [progress, element] of elements.entries()) {
          const mesh = new Mesh({
            name: element.name,
            vertices: {},
            origin: element.position as ArrayVector3,
            rotation: element.rotation as ArrayVector3,
          }).init();
          meshes.push(mesh);

          const vertexRecords = element.vertices.map((vertex, inputIndex) => {
            const position = vertex.map((value, axis) => value * element.scale[axis]) as ArrayVector3;
            const [key] = mesh.addVertices(position);
            return { input_index: inputIndex, key, position: [...position] as ArrayVector3 };
          });

          mesh.addTo(outlinerParent);
          if (projectTexture) mesh.applyTexture(projectTexture);
          created.push({
            mesh: { uuid: mesh.uuid, name: mesh.name },
            vertices: vertexRecords,
            faces: Object.entries(mesh.faces).map(([key, face]) => ({
              key,
              vertices: [...face.vertices],
            })),
          });
          reportProgress({ progress: progress + 1, total });
        }
      } catch (error) {
        rollbackCreatedOutlinerEdit(meshes);
        throw error;
      }

      finishCreatedOutlinerEdit("Agent placed meshes", meshes);
      Canvas.updateAll();

      return JSON.stringify({ created }, null, 2);
    },
  }, meshToolDocs[0].status);

  createInternalTool(meshToolDocs[1].name, {
    ...meshToolDocs[1],
    parameters: extrudeMeshParameters,
    async execute({ mesh_id, distance, mode }) {
      const mesh = getMeshOrSelected(mesh_id);
      if (distance === 0) throw new Error("Extrusion distance must be non-zero.");
      Undo.initEdit({ elements: [mesh], selection: true });
      const result = extrudeSelection(mesh, mode, distance);
      Undo.finishEdit("Extrude mesh selection");
      updateMeshGeometry(mesh);
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        mode,
        distance,
        added_vertices: result.newVertexKeys,
        added_faces: result.newFaceKeys,
        moved_faces: result.selectedFaces,
      }, null, 2);
    },
  }, meshToolDocs[1].status);

  createInternalTool(meshToolDocs[2].name, {
    ...meshToolDocs[2],
    parameters: subdivideMeshParameters,
    async execute({ mesh_id, cuts }) {
      const mesh = getMeshOrSelected(mesh_id);
      const selectedFaces = [...mesh.getSelectedFaces()];
      Undo.initEdit({ elements: [mesh], selection: true });
      const result = subdivideFaces(mesh, selectedFaces, cuts);
      Undo.finishEdit("Subdivide mesh faces");
      updateMeshGeometry(mesh);
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        cuts,
        source_faces: selectedFaces,
        result_faces: result.resultFaceKeys,
        added_vertices: result.createdVertices,
      }, null, 2);
    },
  }, meshToolDocs[2].status);

  createInternalTool(meshToolDocs[3].name, {
    ...meshToolDocs[3],
    parameters: createSphereParameters,
    async execute({ elements, texture, group }, { reportProgress }) {
      const total = elements.length;
      const projectTexture = texture
        ? findTextureOrThrow(texture)
        : Texture.getDefault();
      if (projectTexture) assertFaceTextureAssignmentSupported(projectTexture);
      const outlinerParent = resolveOutlinerParentOrThrow(group, "mesh");
      const spheres: Mesh[] = [];
      Undo.initEdit({ elements: [], groups: [], outliner: true, collections: [] });
      try {
        for (const [progress, element] of elements.entries()) {
        const mesh = new Mesh({
          name: element.name,
          vertices: {},
          origin: element.position as [number, number, number],
          rotation: (element.rotation || [0, 0, 0]) as [
            number,
            number,
            number
          ],
        }).init();
        spheres.push(mesh);

        // Create sphere vertices using spherical coordinates
        const radius = element.diameter / 2;
        const sides = Math.round(element.sides / 2) * 2; // Ensure even number for symmetry

        // Add top and bottom vertices
        const [bottom] = mesh.addVertices([0, -radius, 0]);
        const [top] = mesh.addVertices([0, radius, 0]);

        const rings: string[][] = [];
        const off_ang = element.align_edges ? 0.5 : 0;

        // Create rings of vertices
        for (let i = 0; i < element.sides; i++) {
          const circle_x = Math.sin(
            ((i + off_ang) / element.sides) * Math.PI * 2
          );
          const circle_z = Math.cos(
            ((i + off_ang) / element.sides) * Math.PI * 2
          );

          const vertices: string[] = [];
          for (let j = 1; j < sides / 2; j++) {
            const slice_x = Math.sin((j / sides) * Math.PI * 2) * radius;
            const x = circle_x * slice_x;
            const y = Math.cos((j / sides) * Math.PI * 2) * radius;
            const z = circle_z * slice_x;
            vertices.push(...mesh.addVertices([x, y, z]));
          }
          rings.push(vertices);
        }

        // Create faces
        for (let i = 0; i < element.sides; i++) {
          const this_ring = rings[i];
          const next_ring = rings[i + 1] || rings[0];

          for (let j = 0; j < sides / 2; j++) {
            if (j == 0) {
              // Connect to top vertex
              mesh.addFaces(
                new MeshFace(mesh, {
                  vertices: [this_ring[j], next_ring[j], top],
                  uv: {},
                })
              );
              continue;
            }

            if (!this_ring[j]) {
              // Connect to bottom vertex
              mesh.addFaces(
                new MeshFace(mesh, {
                  vertices: [next_ring[j - 1], this_ring[j - 1], bottom],
                  uv: {},
                })
              );
              continue;
            }

            // Connect ring segments
            mesh.addFaces(
              new MeshFace(mesh, {
                vertices: [
                  this_ring[j],
                  next_ring[j],
                  this_ring[j - 1],
                  next_ring[j - 1],
                ],
                uv: {},
              })
            );
          }
        }

        mesh.addTo(outlinerParent);
        if (projectTexture) {
          mesh.applyTexture(projectTexture);
        }

        reportProgress({
          progress: progress + 1,
          total,
        });
        }
      } catch (error) {
        rollbackCreatedOutlinerEdit(spheres);
        throw error;
      }

      finishCreatedOutlinerEdit("Agent created spheres", spheres);
      Canvas.updateAll();

      return await Promise.resolve(
        JSON.stringify(
          spheres.map(
            (sphere) => `Added sphere ${sphere.name} with ID ${sphere.uuid}`
          )
        )
      );
    },
  }, meshToolDocs[3].status);

  createInternalTool(meshToolDocs[4].name, {
    ...meshToolDocs[4],
    parameters: selectMeshElementsParameters,
    async execute({ mesh_id, mode, elements, action }) {
      const mesh = findMeshOrThrow(mesh_id);
      const requested = resolveMeshSelection(mesh, mode, elements);
      Undo.initSelection();
      try {
        mesh.select();
        // Changing the mode may replace Project.mesh_selection, so obtain its
        // mutable arrays only after the target and mode are current.
        // @ts-expect-error Blockbench exposes a runtime setter on this toolbar selector.
        BarItems.selection_mode.set(mode);
        const vertices = mesh.getSelectedVertices(true);
        const edges = mesh.getSelectedEdges(true);
        const faces = mesh.getSelectedFaces(true);
        if (mode === "vertex") {
          replaceArray(vertices, applySelectionAction(vertices, requested.vertices, action));
          replaceArray(edges, []);
          replaceArray(faces, []);
        } else if (mode === "edge") {
          const nextEdges = applySelectionAction(edges, requested.edges, action, meshEdgeId);
          replaceArray(edges, nextEdges);
          replaceArray(faces, []);
          replaceArray(vertices, uniqueKeys(nextEdges.flat()));
        } else {
          const nextFaces = applySelectionAction(faces, requested.faces, action);
          replaceArray(faces, nextFaces);
          replaceArray(edges, []);
          replaceArray(vertices, uniqueKeys(nextFaces.flatMap((key) => mesh.faces[key].vertices)));
        }
        Canvas.updateView({ elements: [mesh], selection: true });
        Undo.finishSelection("Select mesh elements");
      } catch (error) {
        Undo.cancelSelection();
        throw error;
      }
      const selected = selectionSnapshot(mesh);
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        mode,
        selected: {
          vertex_keys: selected.vertices,
          edges: selected.edges,
          face_keys: selected.faces,
          counts: {
            vertices: selected.vertices.length,
            edges: selected.edges.length,
            faces: selected.faces.length,
          },
        },
      }, null, 2);
    },
  }, meshToolDocs[4].status);

  createInternalTool(meshToolDocs[5].name, {
    ...meshToolDocs[5],
    parameters: moveMeshVerticesParameters,
    async execute({ mesh_id, offset, vertices }) {
      const mesh = getMeshOrSelected(mesh_id);
      if (offset.every((value) => value === 0)) throw new Error("Vertex movement offset must be non-zero.");
      const verticesToMove = uniqueKeys(vertices ?? mesh.getSelectedVertices());
      assertMeshVertexKeys(mesh.vertices, verticesToMove);
      Undo.initEdit({ elements: [mesh] });
      for (const key of verticesToMove) {
        mesh.vertices[key][0] += offset[0];
        mesh.vertices[key][1] += offset[1];
        mesh.vertices[key][2] += offset[2];
      }
      Undo.finishEdit("Move mesh vertices");
      updateMeshGeometry(mesh);
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        moved_vertex_keys: verticesToMove,
        count: verticesToMove.length,
        offset,
      }, null, 2);
    },
  }, meshToolDocs[5].status);

  createInternalTool(meshToolDocs[6].name, {
    ...meshToolDocs[6],
    parameters: deleteMeshElementsParameters,
    async execute({ mesh_id, mode, keep_vertices }) {
      const mesh = getMeshOrSelected(mesh_id);
      const selected = selectionSnapshot(mesh);
      if (mode === "faces" && !selected.faces.length) throw new Error("Select at least one mesh face to delete.");
      if (mode === "edges" && !selected.edges.length) throw new Error("Select at least one mesh edge to delete.");
      if (mode === "vertices" && !selected.vertices.length) throw new Error("Select at least one mesh vertex to delete.");
      const before = { vertices: Object.keys(mesh.vertices).length, faces: Object.keys(mesh.faces).length };
      const deletedFaceKeys: string[] = [];
      const deletedVertexKeys: string[] = [];
      Undo.initEdit({ elements: [mesh], selection: true });

      if (mode === "faces") {
        for (const key of selected.faces) {
          if (!mesh.faces[key]) throw new Error(`Selected mesh face key "${key}" no longer exists.`);
          delete mesh.faces[key];
          deletedFaceKeys.push(key);
        }
      } else if (mode === "edges") {
        for (const [key, face] of Object.entries(mesh.faces)) {
          if (face.getEdges().some((edge) => selected.edges.some((selectedEdge) => sameMeshEdge(edge, selectedEdge)))) {
            delete mesh.faces[key];
            deletedFaceKeys.push(key);
          }
        }
      } else {
        assertMeshVertexKeys(mesh.vertices, selected.vertices);
        const selectedSet = new Set(selected.vertices);
        for (const [key, face] of Object.entries(mesh.faces)) {
          const remaining = face.vertices.filter((vertexKey) => !selectedSet.has(vertexKey));
          if (remaining.length < 2) {
            delete mesh.faces[key];
            deletedFaceKeys.push(key);
            continue;
          }
          for (const vertexKey of selected.vertices) delete face.uv[vertexKey];
          face.vertices = remaining;
        }
        for (const key of selected.vertices) {
          delete mesh.vertices[key];
          deletedVertexKeys.push(key);
        }
      }

      if (mode !== "vertices" && !keep_vertices) {
        const used = new Set(Object.values(mesh.faces).flatMap((face) => face.vertices));
        for (const key of Object.keys(mesh.vertices)) {
          if (used.has(key)) continue;
          delete mesh.vertices[key];
          deletedVertexKeys.push(key);
        }
      }
      replaceArray(mesh.getSelectedFaces(true), []);
      replaceArray(mesh.getSelectedEdges(true), []);
      replaceArray(mesh.getSelectedVertices(true), []);
      Undo.finishEdit("Delete mesh elements");
      updateMeshGeometry(mesh);
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        mode,
        keep_vertices,
        deleted_face_keys: deletedFaceKeys,
        deleted_vertex_keys: deletedVertexKeys,
        before,
        after: { vertices: Object.keys(mesh.vertices).length, faces: Object.keys(mesh.faces).length },
      }, null, 2);
    },
  }, meshToolDocs[6].status);

  createInternalTool(meshToolDocs[7].name, {
    ...meshToolDocs[7],
    parameters: mergeMeshVerticesParameters,
    async execute({ mesh_id, threshold, selected_only }) {
      const mesh = findMeshOrThrow(mesh_id);
      const verticesToCheck = selected_only
        ? [...mesh.getSelectedVertices()]
        : Object.keys(mesh.vertices);
      assertMeshVertexKeys(mesh.vertices, verticesToCheck, 2);
      const mergeMap: Record<string, string> = {};
      for (let i = 0; i < verticesToCheck.length; i++) {
        const vkey1 = verticesToCheck[i];
        if (mergeMap[vkey1]) continue;

        for (let j = i + 1; j < verticesToCheck.length; j++) {
          const vkey2 = verticesToCheck[j];
          if (mergeMap[vkey2]) continue;

          const v1 = mesh.vertices[vkey1];
          const v2 = mesh.vertices[vkey2];
          const distance = Math.sqrt(
            (v1[0] - v2[0]) ** 2 + (v1[1] - v2[1]) ** 2 + (v1[2] - v2[2]) ** 2
          );

          if (distance <= threshold) {
            mergeMap[vkey2] = vkey1;
          }
        }
      }
      const merges = Object.entries(mergeMap);
      if (!merges.length) {
        throw new Error(`No mesh vertices are within the merge threshold ${threshold}.`);
      }
      Undo.initEdit({ elements: [mesh], selection: true });
      const deletedFaces: string[] = [];
      Object.entries(mergeMap).forEach(([oldKey, newKey]) => {
        for (const fkey in mesh.faces) {
          const face = mesh.faces[fkey];
          if (!face.vertices.includes(oldKey)) continue;
          face.uv[newKey] = face.uv[oldKey] || face.uv[newKey] || [0, 0];
          delete face.uv[oldKey];
          const replaced = face.vertices.map((key) => key === oldKey ? newKey : key);
          face.vertices = replaced.filter((key, index) => replaced.indexOf(key) === index);
          if (face.vertices.length < 2) {
            delete mesh.faces[fkey];
            deletedFaces.push(fkey);
          }
        }
        delete mesh.vertices[oldKey];
      });
      replaceArray(
        mesh.getSelectedVertices(true),
        uniqueKeys(verticesToCheck.map((key) => mergeMap[key] ?? key).filter((key) => key in mesh.vertices))
      );
      Undo.finishEdit("Merge mesh vertices");
      updateMeshGeometry(mesh);
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        merged: merges.map(([removed, retained]) => ({ removed, retained })),
        merged_count: merges.length,
        deleted_degenerate_face_keys: deletedFaces,
      }, null, 2);
    },
  }, meshToolDocs[7].status);

  createInternalTool(meshToolDocs[8].name, {
    ...meshToolDocs[8],
    parameters: createMeshFaceParameters,
    async execute({ mesh_id, vertices, texture }) {
      const mesh = getMeshOrSelected(mesh_id);
      if (new Set(vertices).size !== vertices.length) {
        throw new Error("A mesh face requires distinct vertex keys.");
      }
      assertMeshVertexKeys(mesh.vertices, vertices, 3);
      const faceTexture = texture ? findTextureOrThrow(texture) : null;
      if (faceTexture) assertFaceTextureAssignmentSupported(faceTexture);
      Undo.initEdit({ elements: [mesh] });
      const face = new MeshFace(mesh, {
        vertices,
        texture: faceTexture?.uuid,
      });
      const [faceKey] = mesh.addFaces(face);
      UVEditor.setAutoSize(null, true, [faceKey]);
      Undo.finishEdit("Create mesh face");
      updateMeshGeometry(mesh);
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        face: { key: faceKey, vertices: [...vertices] },
      }, null, 2);
    },
  }, meshToolDocs[8].status);

  createInternalTool(meshToolDocs[9].name, {
    ...meshToolDocs[9],
    parameters: createCylinderParameters,
    async execute({ elements, texture, group }, { reportProgress }) {
      const total = elements.length;
      const projectTexture = texture
        ? findTextureOrThrow(texture)
        : Texture.getDefault();
      if (projectTexture) assertFaceTextureAssignmentSupported(projectTexture);
      const outlinerParent = resolveOutlinerParentOrThrow(group, "mesh");
      const cylinders: Mesh[] = [];
      Undo.initEdit({ elements: [], groups: [], outliner: true, collections: [] });
      try {
        for (const [progress, element] of elements.entries()) {
        const mesh = new Mesh({
          name: element.name,
          vertices: {},
          origin: element.position as [number, number, number],
          rotation: (element.rotation || [0, 0, 0]) as [
            number,
            number,
            number
          ],
        }).init();
        cylinders.push(mesh);
        const radius = element.diameter / 2;
        const height = element.height;
        const sides = Math.round(element.sides);
        // centres for the caps
        const topCenter = mesh.addVertices([0, height / 2, 0])[0];
        const bottomCenter = mesh.addVertices([0, -height / 2, 0])[0];
        const topRing: any[] = [];
        const bottomRing: any[] = [];
        for (let i = 0; i < sides; i++) {
          const ang = (i / sides) * Math.PI * 2;
          const x = Math.cos(ang) * radius;
          const z = Math.sin(ang) * radius;
          topRing.push(mesh.addVertices([x, height / 2, z])[0]);
          bottomRing.push(mesh.addVertices([x, -height / 2, z])[0]);
        }
        for (let i = 0; i < sides; i++) {
          const next = (i + 1) % sides;
          // side face
          mesh.addFaces(
            new MeshFace(mesh, {
              vertices: [
                bottomRing[i],
                bottomRing[next],
                topRing[next],
                topRing[i],
              ],
              uv: {},
            })
          );
          if (element.capped) {
            // top cap (triangle fan)
            mesh.addFaces(
              new MeshFace(mesh, {
                vertices: [topRing[i], topRing[next], topCenter],
                uv: {},
              })
            );
            // bottom cap
            mesh.addFaces(
              new MeshFace(mesh, {
                vertices: [bottomRing[next], bottomRing[i], bottomCenter],
                uv: {},
              })
            );
          }
        }
        mesh.addTo(outlinerParent);
        if (projectTexture) mesh.applyTexture(projectTexture);
        reportProgress({ progress: progress + 1, total });
        }
      } catch (error) {
        rollbackCreatedOutlinerEdit(cylinders);
        throw error;
      }
      finishCreatedOutlinerEdit("Agent created cylinders", cylinders);
      Canvas.updateAll();
      return JSON.stringify(
        cylinders.map((c) => `Added cylinder ${c.name} (ID ${c.uuid})`)
      );
    },
  }, meshToolDocs[9].status);

  createInternalTool(meshToolDocs[10].name, {
    ...meshToolDocs[10],
    parameters: knifeToolParameters,
    async execute({ mesh_id, points }) {
      const mesh = findMeshOrThrow(mesh_id);
      for (const [index, point] of points.entries()) {
        if (!mesh.faces[point.face]) {
          throw new Error(`Knife point ${index} references missing mesh face key "${point.face}".`);
        }
      }
      const before = {
        vertices: Object.keys(mesh.vertices).length,
        faces: Object.keys(mesh.faces).length,
      };
      // KnifeToolContext is Blockbench's geometry algorithm. It owns its Undo
      // edit and temporary preview lifecycle, so the MCP wrapper must not nest one.
      const knifeContext = new KnifeToolContext(mesh);
      const THREE_API = getThreeApi();
      points.forEach((point) => {
        knifeContext.points.push({
          position: new THREE_API.Vector3(...point.position),
          fkey: point.face,
          type: "face",
        });
      });
      try {
        knifeContext.apply();
      } catch (error) {
        knifeContext.remove?.();
        throw error;
      }
      const after = {
        vertices: Object.keys(mesh.vertices).length,
        faces: Object.keys(mesh.faces).length,
      };
      if (after.vertices === before.vertices && after.faces === before.faces) {
        throw new Error("The supplied knife path did not split any mesh face.");
      }
      return JSON.stringify({
        mesh: { uuid: mesh.uuid, name: mesh.name },
        points: points.length,
        before,
        after,
        added_vertices: after.vertices - before.vertices,
        added_faces: after.faces - before.faces,
      }, null, 2);
    },
  }, meshToolDocs[10].status);

  createInternalTool(meshToolDocs[11].name, {
    ...meshToolDocs[11],
    parameters: createPyramidParameters,
    async execute({ elements, texture, group }, { reportProgress }) {
      const projectTexture = texture
        ? findTextureOrThrow(texture)
        : Texture.getDefault();
      if (projectTexture) assertFaceTextureAssignmentSupported(projectTexture);
      const outlinerParent = resolveOutlinerParentOrThrow(group, "mesh");
      const meshes: Mesh[] = [];
      Undo.initEdit({ elements: [], groups: [], outliner: true, collections: [] });
      const THREE_API = getThreeApi();
      try {
        for (const [progress, element] of elements.entries()) {
          const baseCenter = new THREE_API.Vector3(...element.base_center);
          const axis = new THREE_API.Vector3(...element.apex).sub(baseCenter);
          if (axis.lengthSq() < 1e-10) {
            throw new Error(`Pyramid "${element.name}" needs distinct base_center and apex positions.`);
          }
          const axisDirection = axis.clone().normalize();
          const reference = Math.abs(axisDirection.y) < 0.9
            ? new THREE_API.Vector3(0, 1, 0)
            : new THREE_API.Vector3(1, 0, 0);
          const basisU = new THREE_API.Vector3().crossVectors(axisDirection, reference).normalize();
          const basisV = new THREE_API.Vector3().crossVectors(axisDirection, basisU).normalize();
          const rotation = THREE_API.MathUtils.degToRad(element.base_rotation);

          const mesh = new Mesh({
            name: element.name,
            vertices: {},
            origin: element.base_center as [number, number, number],
          }).init();
          meshes.push(mesh);
          const [apex] = mesh.addVertices(axis.toArray() as ArrayVector3);
          const baseVertices: string[] = [];
          for (let index = 0; index < element.sides; index++) {
            const angle = rotation + (index / element.sides) * Math.PI * 2;
            const point = basisU.clone().multiplyScalar(Math.cos(angle) * element.radius)
              .addScaledVector(basisV, Math.sin(angle) * element.radius);
            baseVertices.push(mesh.addVertices(point.toArray() as ArrayVector3)[0]);
          }
          for (let index = 0; index < element.sides; index++) {
            const next = (index + 1) % element.sides;
            mesh.addFaces(new MeshFace(mesh, {
              vertices: [baseVertices[index], baseVertices[next], apex],
              uv: {},
            }));
          }
          if (element.capped) {
            const [center] = mesh.addVertices([0, 0, 0]);
            for (let index = 0; index < element.sides; index++) {
              const next = (index + 1) % element.sides;
              mesh.addFaces(new MeshFace(mesh, {
                vertices: [baseVertices[next], baseVertices[index], center],
                uv: {},
              }));
            }
          }
          mesh.addTo(outlinerParent);
          if (projectTexture) mesh.applyTexture(projectTexture);
          mesh.preview_controller.updateGeometry(mesh);
          mesh.preview_controller.updateUV(mesh);
          reportProgress({ progress: progress + 1, total: elements.length });
        }
      } catch (error) {
        rollbackCreatedOutlinerEdit(meshes);
        throw error;
      }
      finishCreatedOutlinerEdit("Agent created pyramids", meshes);
      Canvas.updateAll();
      return JSON.stringify(meshes.map((mesh) => ({
        name: mesh.name,
        uuid: mesh.uuid,
      })));
    },
  }, meshToolDocs[11].status);

}
