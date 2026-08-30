export type MeshSelectionMode = "vertex" | "edge" | "face";
export type MeshEdge = [string, string];

export interface MeshSelectionSource {
  vertices: Record<string, readonly number[]>;
  faces: Record<string, { getEdges(): MeshEdge[] }>;
}

export interface ResolvedMeshSelection {
  vertices: string[];
  edges: MeshEdge[];
  faces: string[];
}

export function replaceArray<T>(target: T[], values: readonly T[]): void {
  target.splice(0, target.length, ...values);
}

export function sameMeshEdge(first: readonly string[], second: readonly string[]): boolean {
  return first.length === 2
    && second.length === 2
    && ((first[0] === second[0] && first[1] === second[1])
      || (first[0] === second[1] && first[1] === second[0]));
}

export function meshEdgeId(edge: readonly string[]): string {
  return edge[0] < edge[1]
    ? `${edge[0]}\u0000${edge[1]}`
    : `${edge[1]}\u0000${edge[0]}`;
}

export function listMeshEdges(source: MeshSelectionSource): MeshEdge[] {
  const result: MeshEdge[] = [];
  const seen = new Set<string>();
  for (const face of Object.values(source.faces)) {
    for (const edge of face.getEdges()) {
      const id = meshEdgeId(edge);
      if (seen.has(id)) continue;
      seen.add(id);
      result.push([edge[0], edge[1]]);
    }
  }
  return result;
}

function indexedKey(keys: string[], reference: string | number, kind: string): string {
  if (typeof reference === "number") {
    const key = keys[reference];
    if (!key) throw new Error(`${kind} index ${reference} is out of range.`);
    return key;
  }
  if (!keys.includes(reference)) {
    throw new Error(`${kind} key "${reference}" does not exist in this mesh.`);
  }
  return reference;
}

function parseEdge(reference: string | number, edges: MeshEdge[]): MeshEdge {
  if (typeof reference === "number") {
    const edge = edges[reference];
    if (!edge) throw new Error(`Mesh edge index ${reference} is out of range.`);
    return edge;
  }
  const edge = edges.find((candidate) => {
    const forward = `${candidate[0]}-${candidate[1]}`;
    const reverse = `${candidate[1]}-${candidate[0]}`;
    return reference === forward || reference === reverse;
  });
  if (!edge) throw new Error(`Mesh edge "${reference}" does not exist in this mesh.`);
  return edge;
}

export function resolveMeshSelection(
  source: MeshSelectionSource,
  mode: MeshSelectionMode,
  references?: readonly (string | number)[]
): ResolvedMeshSelection {
  const vertexKeys = Object.keys(source.vertices);
  const faceKeys = Object.keys(source.faces);
  const allEdges = listMeshEdges(source);
  const requested = references?.length ? references : undefined;

  if (mode === "vertex") {
    return {
      vertices: requested
        ? [...new Set(requested.map((reference) => indexedKey(vertexKeys, reference, "Mesh vertex")))]
        : vertexKeys,
      edges: [],
      faces: [],
    };
  }
  if (mode === "face") {
    return {
      vertices: [],
      edges: [],
      faces: requested
        ? [...new Set(requested.map((reference) => indexedKey(faceKeys, reference, "Mesh face")))]
        : faceKeys,
    };
  }

  const edges = requested ? requested.map((reference) => parseEdge(reference, allEdges)) : allEdges;
  const unique = new Map(edges.map((edge) => [meshEdgeId(edge), edge]));
  return { vertices: [], edges: [...unique.values()], faces: [] };
}

export function applySelectionAction<T>(
  current: readonly T[],
  requested: readonly T[],
  action: "select" | "add" | "remove" | "toggle",
  identity: (value: T) => string = (value) => String(value)
): T[] {
  if (action === "select") return [...requested];
  const result = new Map(current.map((value) => [identity(value), value]));
  for (const value of requested) {
    const key = identity(value);
    if (action === "add") result.set(key, value);
    else if (action === "remove") result.delete(key);
    else if (result.has(key)) result.delete(key);
    else result.set(key, value);
  }
  return [...result.values()];
}

export function assertMeshVertexKeys(
  vertices: Record<string, readonly number[]>,
  keys: readonly string[],
  minimum = 1
): void {
  if (keys.length < minimum) {
    throw new Error(`At least ${minimum} mesh ${minimum === 1 ? "vertex" : "vertices"} must be supplied or selected.`);
  }
  const missing = keys.find((key) => !(key in vertices));
  if (missing) throw new Error(`Mesh vertex key "${missing}" does not exist in this mesh.`);
}

export function uniqueKeys(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}
