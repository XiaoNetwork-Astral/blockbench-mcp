import { isProjectProtected } from "@/lib/projectRoles";

type TextureWithExternalState = Texture & {
  relative_path?: string;
  sync_to_project?: string;
  stopWatcher?: () => unknown;
};

const rememberedTextureDependencies = new WeakMap<ModelProject, Set<string>>();

function isLocalPath(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !/^(?:data|blob|https?):/i.test(value.trim());
}

/** Canonical comparison form for local paths; Windows paths compare case-insensitively. */
export function normalizeExternalPath(value: string): string {
  const resolved = PathModule.resolve(value.trim()).replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[a-z]:\//i.test(resolved) || resolved.startsWith("//")
    ? resolved.toLocaleLowerCase()
    : resolved;
}

function textureDependencyPaths(
  project: ModelProject,
  texture: TextureWithExternalState
): string[] {
  const paths = new Set<string>();
  if (isLocalPath(texture.path)) paths.add(normalizeExternalPath(texture.path));

  const relative = texture.relative_path;
  if (isLocalPath(relative)) {
    const absolute = PathModule.isAbsolute(relative)
      ? relative
      : project.save_path
        ? PathModule.resolve(PathModule.dirname(project.save_path), relative)
        : "";
    if (absolute) paths.add(normalizeExternalPath(absolute));
  }
  return [...paths];
}

/** Preserve dependencies even after a linked texture is detached in memory. */
export function rememberProjectTextureDependencies(project: ModelProject): void {
  const remembered = rememberedTextureDependencies.get(project) ?? new Set<string>();
  for (const texture of project.textures as TextureWithExternalState[]) {
    for (const path of textureDependencyPaths(project, texture)) remembered.add(path);
  }
  rememberedTextureDependencies.set(project, remembered);
}

/** Detach a texture from file watching and Blockbench's cross-tab pixel sync. */
export function prepareTextureForMutation(
  project: ModelProject,
  texture: Texture
): void {
  const foreignOwners = currentProjects().filter(
    (candidate) => candidate !== project && candidate.textures.includes(texture)
  );
  if (foreignOwners.length > 0) {
    throw new Error(
      `Texture "${texture.name}" (${texture.uuid}) is the same live object in multiple projects: ` +
        `${[project, ...foreignOwners].map((owner) => `"${owner.name}" (${owner.uuid})`).join(", ")}. ` +
        "Stop editing and reopen an isolated working copy."
    );
  }

  rememberProjectTextureDependencies(project);
  const guarded = texture as TextureWithExternalState;
  const projectSaved = project.saved;
  const textureSaved = texture.saved;
  guarded.stopWatcher?.();
  guarded.sync_to_project = "";
  if (!texture.internal) {
    texture.convertToInternal(texture.getDataURL());
  }
  texture.saved = textureSaved;
  project.saved = projectSaved;
}

export const PROJECT_LOCAL_TEXTURE_EDIT_OPTIONS = Object.freeze({
  no_undo_init: true,
  no_undo_finish: true,
});

/** Run Texture.edit inside exactly one project-local bitmap Undo transaction. */
export function editTextureWithUndo(
  project: ModelProject,
  texture: Texture,
  action: string,
  callback: (canvas: HTMLCanvasElement) => void,
  includeSelection = false
): void {
  prepareTextureForMutation(project, texture);
  const aspects: UndoAspects & { layers?: TextureLayer[] } = {
    bitmap: true,
    ...(texture.layers_enabled && texture.selected_layer
      ? { layers: [texture.selected_layer] }
      : { textures: [texture] }),
    ...(includeSelection ? { selected_texture: true } : {}),
  };
  Undo.initEdit(aspects);
  try {
    (texture.edit as unknown as (
      callback: (canvas: HTMLCanvasElement) => void,
      options: Record<string, unknown>
    ) => void)(callback, {
      edit_name: action,
      ...PROJECT_LOCAL_TEXTURE_EDIT_OPTIONS,
    });
    Undo.finishEdit(action, aspects);
  } catch (error) {
    Undo.cancelEdit();
    throw error;
  }
}

/** Detach every texture in a project while preserving its saved indicator. */
export function isolateProjectTextures(project: ModelProject): void {
  for (const texture of [...project.textures]) {
    prepareTextureForMutation(project, texture);
  }
}

function currentProjects(): ModelProject[] {
  return (globalThis as typeof globalThis & {
    ModelProject?: { all?: ModelProject[] };
  }).ModelProject?.all ?? [];
}

function projectPathMatches(project: ModelProject, normalizedPath: string): string | null {
  if (isLocalPath(project.save_path) && normalizeExternalPath(project.save_path) === normalizedPath) {
    return "project save path";
  }
  if (isLocalPath(project.export_path) && normalizeExternalPath(project.export_path) === normalizedPath) {
    return "project export path";
  }
  return null;
}

function projectTexturePathMatches(project: ModelProject, normalizedPath: string): boolean {
  if ((rememberedTextureDependencies.get(project) ?? new Set()).has(normalizedPath)) return true;
  return project.textures.some((texture) =>
    textureDependencyPaths(project, texture as TextureWithExternalState).includes(normalizedPath)
  );
}

/**
 * Reject an external write when the path belongs to another open project or a
 * read-only project's texture dependency. Call this before permission prompts,
 * compilation side effects, or any filesystem write.
 */
export function assertExternalWriteAllowed(
  path: string,
  writerProject: ModelProject | null | undefined,
  operation: string,
  options: {
    /** Model/project output may normally overwrite its own established save/export path. */
    allowOwnProjectPath?: boolean;
    /** Only a deliberate texture-save operation may overwrite its own linked texture. */
    allowOwnTextureDependency?: boolean;
  } = {}
): void {
  if (!isLocalPath(path)) throw new Error(`${operation} requires a non-empty local path.`);
  const normalized = normalizeExternalPath(path);

  if (writerProject && isProjectProtected(writerProject)) {
    throw new Error(
      `${operation} cannot write for read-only project "${writerProject.name}".`
    );
  }

  for (const project of currentProjects()) {
    const projectPathKind = projectPathMatches(project, normalized);
    const textureDependency = projectTexturePathMatches(project, normalized);
    if (!projectPathKind && !textureDependency) continue;
    if (project === writerProject) {
      if (textureDependency && !options.allowOwnTextureDependency) {
        throw new Error(
          `${operation} cannot write ${path}: it is a texture dependency of the same project ` +
            `"${project.name}" (${project.uuid}), but this operation is not an explicit texture save.`
        );
      }
      if (projectPathKind && options.allowOwnProjectPath === false) {
        throw new Error(
          `${operation} cannot write ${path}: it is the ${projectPathKind} of project ` +
            `"${project.name}" (${project.uuid}).`
        );
      }
      continue;
    }

    const targetKind = projectPathKind ?? "texture dependency";
    if (isProjectProtected(project)) {
      throw new Error(
        `${operation} cannot write ${path}: it is a ${targetKind} of read-only project ` +
          `"${project.name}" (${project.uuid}).`
      );
    }
    throw new Error(
      `${operation} cannot write ${path}: it is a ${targetKind} of another open project ` +
        `"${project.name}" (${project.uuid}).`
    );
  }
}
