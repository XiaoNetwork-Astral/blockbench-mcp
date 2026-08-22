export interface NamedUuidReference {
  uuid: string;
  name: string;
}

/**
 * Resolve references deterministically: an exact UUID wins, while a name must
 * identify exactly one object. Silent first-match behavior is unsafe for model
 * hierarchy because duplicate display names are valid in Blockbench.
 */
export function resolveUniqueReference<T extends NamedUuidReference>(
  reference: string,
  candidates: readonly T[],
  kind: string,
  discoveryTool: string
): T {
  const uuidMatches = candidates.filter((candidate) => candidate.uuid === reference);
  if (uuidMatches.length === 1) return uuidMatches[0];
  if (uuidMatches.length > 1) {
    throw new Error(
      `${kind} UUID "${reference}" is duplicated in the current project. ` +
        "Stop editing and repair the project before continuing."
    );
  }

  const nameMatches = candidates.filter((candidate) => candidate.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `${kind} name "${reference}" is ambiguous (${nameMatches.length} matches: ` +
        `${nameMatches.map((candidate) => candidate.uuid).join(", ")}). ` +
        `Use an exact UUID from ${discoveryTool}.`
    );
  }

  throw new Error(
    `${kind} "${reference}" was not found. Use ${discoveryTool} to inspect valid references.`
  );
}

export type ExplicitOutlinerParent =
  | "root"
  | (OutlinerNode & { children: OutlinerNode[] });

function listOutlinerParents(): Array<OutlinerNode & { children: OutlinerNode[] }> {
  const parents: Array<OutlinerNode & { children: OutlinerNode[] }> = [];
  const seen = new Set<string>();

  const visit = (node: OutlinerNode): void => {
    const possibleParent = node as OutlinerNode & { children?: OutlinerNode[] };
    if (Array.isArray(possibleParent.children)) {
      if (!seen.has(node.uuid)) {
        seen.add(node.uuid);
        parents.push(possibleParent as OutlinerNode & { children: OutlinerNode[] });
      }
      for (const child of possibleParent.children) visit(child);
    }
  };

  for (const node of Outliner.root) visit(node);
  return parents;
}

/** Resolve the caller's mandatory parent without ever falling back to root. */
export function resolveOutlinerParentOrThrow(
  reference: string,
  childType?: string
): ExplicitOutlinerParent {
  if (reference === "root") return "root";

  const parent = resolveUniqueReference(
    reference,
    listOutlinerParents(),
    "Outliner parent",
    "list_outline"
  );

  const childTypes = parent.getTypeBehavior?.("child_types");
  if (
    childType &&
    Array.isArray(childTypes) &&
    !childTypes.includes(childType)
  ) {
    throw new Error(
      `Outliner parent "${parent.name}" (${parent.uuid}) cannot contain ${childType} nodes.`
    );
  }
  return parent;
}

export function collectOutlinerSubtree(roots: readonly OutlinerNode[]): {
  elements: OutlinerElement[];
  groups: Group[];
} {
  const elements: OutlinerElement[] = [];
  const groups: Group[] = [];
  const seen = new Set<string>();

  const visit = (node: OutlinerNode): void => {
    if (seen.has(node.uuid)) return;
    seen.add(node.uuid);

    if (node instanceof Group) groups.push(node);
    else if (node instanceof OutlinerElement) elements.push(node);

    const children = (node as OutlinerNode & { children?: OutlinerNode[] }).children;
    if (Array.isArray(children)) {
      for (const child of children) visit(child);
    }
  };

  for (const root of roots) visit(root);
  return { elements, groups };
}

export function finishCreatedOutlinerEdit(
  action: string,
  roots: readonly OutlinerNode[]
): void {
  const { elements, groups } = collectOutlinerSubtree(roots);
  Undo.finishEdit(action, {
    elements,
    groups,
    outliner: true,
    collections: [],
  });
}

/**
 * Roll back a failed creation whose entire subtree was created by this call.
 * Reverting the Outliner first restores any pre-existing hierarchy; removing
 * the still-unhandled new roots then clears Blockbench's UUID registries.
 */
export function rollbackCreatedOutlinerEdit(
  roots: readonly OutlinerNode[]
): void {
  try {
    (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
  } finally {
    for (const root of [...roots].reverse()) {
      try {
        root.remove(false);
      } catch {
        // Preserve the original tool error; the global safety net will still
        // clear any edit that remained open.
      }
    }
    Canvas.updateAll();
  }
}
