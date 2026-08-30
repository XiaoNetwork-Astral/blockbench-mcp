import { isProjectReadOnly } from "@/src/features/readOnly/service";

export function assertProjectMayBeMutated(
  project: ModelProject,
  toolName: string
): void {
  if (!isProjectReadOnly(project)) return;
  throw new Error(
    `Tool "${toolName}" cannot modify project "${project.name}" because it is read-only. ` +
      "Select a writable tab or turn off its read-only lock first."
  );
}

export function describeProject(project: ModelProject): Record<string, unknown> {
  const readOnly = isProjectReadOnly(project);
  return {
    uuid: project.uuid,
    name: project.name,
    selected: project.selected,
    saved: project.saved,
    save_path: project.save_path || null,
    export_path: project.export_path || null,
    format: project.format?.id ?? null,
    read_only: readOnly,
    agent_writable: !readOnly,
    counts: {
      elements: project.elements.length,
      groups: project.groups.length,
      textures: project.textures.length,
      animations: project.animations.length,
    },
  };
}
