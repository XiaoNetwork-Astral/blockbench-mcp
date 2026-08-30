/// <reference types="blockbench-types" />

type BlockbenchProjectGlobals = typeof globalThis & {
  ModelProject?: { all?: ModelProject[] };
  Blockbench?: { Project?: ModelProject | 0 | null };
};

function runtimeGlobals(): BlockbenchProjectGlobals {
  return globalThis as BlockbenchProjectGlobals;
}

function openProjects(): ModelProject[] {
  return runtimeGlobals().ModelProject?.all ?? [];
}

/** The project tab visible in Blockbench right now. */
export function getVisibleProject(): ModelProject | null {
  const selected = openProjects().find((project) => project.selected);
  if (selected) return selected;

  const current = runtimeGlobals().Blockbench?.Project;
  return current && typeof current === "object" ? current : null;
}

/** Resolve an open tab by exact UUID, exact save path, or unique exact name. */
export function resolveOpenProject(reference: string): ModelProject {
  const projects = openProjects();
  const uuid = projects.find((project) => project.uuid === reference);
  if (uuid) return uuid;

  const pathMatches = projects.filter(
    (project) => project.save_path === reference || project.export_path === reference
  );
  if (pathMatches.length === 1) return pathMatches[0];
  if (pathMatches.length > 1) {
    throw new Error(`More than one open project uses path "${reference}".`);
  }

  const nameMatches = projects.filter((project) => project.name === reference);
  if (nameMatches.length === 1) return nameMatches[0];
  if (nameMatches.length > 1) {
    throw new Error(
      `Project name "${reference}" is ambiguous. Use an exact UUID from list_projects.`
    );
  }

  throw new Error(`Open project "${reference}" was not found. Use list_projects first.`);
}

export function selectProject(reference: string): ModelProject {
  const project = resolveOpenProject(reference);
  if (!project.selected && !project.select()) {
    throw new Error(`Blockbench refused to select project "${project.name}".`);
  }
  return project;
}
