export type TextureApplyMode = "all" | "blank" | "none";

export interface FaceTextureTarget {
  texture?: string | false | null;
}

export interface FaceTextureElementTarget {
  uuid: string;
  name: string;
  box_uv?: boolean;
  faces: Record<string, FaceTextureTarget>;
}

export interface ScopedTextureApplyResult {
  target_elements: number;
  matched_faces: number;
  changed_faces: number;
  unchanged_matching_faces: number;
  per_element: Array<{
    uuid: string;
    name: string;
    matched_faces: string[];
    changed_faces: string[];
  }>;
}

/**
 * Apply a texture UUID to an already-resolved set of element faces without
 * consulting or changing Blockbench's global selection.
 */
export function applyTextureToResolvedFaces(
  targetElements: readonly FaceTextureElementTarget[],
  textureUuid: string,
  mode: TextureApplyMode,
  selectedFaces: ReadonlyMap<FaceTextureElementTarget, ReadonlySet<string>>,
  validTextureUuids: ReadonlySet<string>
): ScopedTextureApplyResult {
  const perElement: ScopedTextureApplyResult["per_element"] = [];
  let matchedFaces = 0;
  let changedFaces = 0;
  for (const element of targetElements) {
    const selected = selectedFaces.get(element) ?? new Set<string>();
    const matched: string[] = [];
    const changed: string[] = [];

    for (const [faceKey, face] of Object.entries(element.faces)) {
      const previous = face.texture;
      const isBlank = previous !== null &&
        (typeof previous !== "string" || !validTextureUuids.has(previous));
      const shouldApply = mode === "all" ||
        (mode === "blank" && isBlank) ||
        (mode === "none" && (element.box_uv === true || selected.has(faceKey)));

      if (!shouldApply) continue;
      matched.push(faceKey);
      if (previous !== textureUuid) changed.push(faceKey);
      face.texture = textureUuid;
    }
    matchedFaces += matched.length;
    changedFaces += changed.length;
    perElement.push({
      uuid: element.uuid,
      name: element.name,
      matched_faces: matched,
      changed_faces: changed,
    });
  }

  return {
    target_elements: targetElements.length,
    matched_faces: matchedFaces,
    changed_faces: changedFaces,
    unchanged_matching_faces: matchedFaces - changedFaces,
    per_element: perElement,
  };
}
