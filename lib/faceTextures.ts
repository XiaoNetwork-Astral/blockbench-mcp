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
 *
 * The complete element list is snapshotted so the post-write verification
 * also proves that faces outside the requested scope retained their values.
 * Callers should keep an Undo edit open while invoking this helper and cancel
 * it if verification throws.
 */
export function applyTextureToResolvedFaces(
  allElements: readonly FaceTextureElementTarget[],
  targetElements: readonly FaceTextureElementTarget[],
  textureUuid: string,
  mode: TextureApplyMode,
  selectedFaces: ReadonlyMap<FaceTextureElementTarget, ReadonlySet<string>>,
  validTextureUuids: ReadonlySet<string>
): ScopedTextureApplyResult {
  const targetSet = new Set(targetElements);
  const before = new Map<FaceTextureTarget, string | false | null | undefined>();
  const intended = new Set<FaceTextureTarget>();
  const intendedKeys = new Map<FaceTextureElementTarget, string[]>();

  for (const element of allElements) {
    for (const face of Object.values(element.faces)) {
      before.set(face, face.texture);
    }
  }

  for (const element of targetElements) {
    if (!targetSet.has(element)) continue;
    const selected = selectedFaces.get(element) ?? new Set<string>();
    const keys: string[] = [];

    for (const [faceKey, face] of Object.entries(element.faces)) {
      const previous = before.get(face);
      const isBlank = previous !== null &&
        (typeof previous !== "string" || !validTextureUuids.has(previous));
      const shouldApply = mode === "all" ||
        (mode === "blank" && isBlank) ||
        (mode === "none" && (element.box_uv === true || selected.has(faceKey)));

      if (!shouldApply) continue;
      intended.add(face);
      keys.push(faceKey);
      face.texture = textureUuid;
    }
    intendedKeys.set(element, keys);
  }

  const verificationErrors: string[] = [];
  for (const element of allElements) {
    for (const [faceKey, face] of Object.entries(element.faces)) {
      const expected = intended.has(face) ? textureUuid : before.get(face);
      if (face.texture !== expected) {
        verificationErrors.push(
          `${element.name} (${element.uuid}) face ${faceKey}: expected ` +
            `${String(expected)}, read back ${String(face.texture)}`
        );
      }
    }
  }
  if (verificationErrors.length > 0) {
    throw new Error(
      "Texture assignment verification failed before commit: " +
        verificationErrors.slice(0, 10).join("; ") +
        (verificationErrors.length > 10
          ? `; and ${verificationErrors.length - 10} more`
          : "")
    );
  }

  const perElement = targetElements.map((element) => {
    const matched = intendedKeys.get(element) ?? [];
    const changed = matched.filter(
      (faceKey) => before.get(element.faces[faceKey]) !== textureUuid
    );
    return {
      uuid: element.uuid,
      name: element.name,
      matched_faces: matched,
      changed_faces: changed,
    };
  });
  const matchedFaces = perElement.reduce(
    (sum, element) => sum + element.matched_faces.length,
    0
  );
  const changedFaces = perElement.reduce(
    (sum, element) => sum + element.changed_faces.length,
    0
  );

  return {
    target_elements: targetElements.length,
    matched_faces: matchedFaces,
    changed_faces: changedFaces,
    unchanged_matching_faces: matchedFaces - changedFaces,
    per_element: perElement,
  };
}
