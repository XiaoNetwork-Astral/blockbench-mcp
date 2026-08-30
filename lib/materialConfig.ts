export type MaterialChannel = "color" | "normal" | "height" | "mer";

export interface MaterialTextureTarget {
  uuid: string;
  name: string;
  group: string;
  pbr_channel: string;
}

export interface TextureGroupMember {
  uuid: string;
  group: string;
}

export function assignTexturesToGroup(
  groupUuid: string,
  textures: readonly TextureGroupMember[]
): string[] {
  for (const texture of textures) texture.group = groupUuid;
  return textures.map((texture) => texture.uuid);
}

export type MaterialChannelAssignments = Partial<
  Record<MaterialChannel, MaterialTextureTarget | null>
>;

export function applyMaterialChannelAssignments(
  groupUuid: string,
  currentTextures: readonly MaterialTextureTarget[],
  assignments: MaterialChannelAssignments
): {
  assigned: Partial<Record<MaterialChannel, string>>;
  detached: string[];
} {
  const detached: string[] = [];
  const assigned: Partial<Record<MaterialChannel, string>> = {};
  for (const channel of ["color", "normal", "height", "mer"] as const) {
    if (!(channel in assignments)) continue;
    const target = assignments[channel] ?? null;
    for (const texture of currentTextures) {
      if (
        texture.group === groupUuid
        && texture.pbr_channel === channel
        && texture.uuid !== target?.uuid
      ) {
        texture.group = "";
        detached.push(texture.uuid);
      }
    }
    if (target) {
      target.group = groupUuid;
      target.pbr_channel = channel;
      assigned[channel] = target.uuid;
    }
  }
  return { assigned, detached: [...new Set(detached)] };
}

export function safeMaterialFileStem(name: string): string {
  const stem = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/[. ]+$/g, "");
  return stem || "material";
}

export function resolveMaterialConfigPath(input: {
  explicitPath?: string;
  nativePath?: string | null;
  colorTexturePath?: string | null;
  projectSavePath?: string | null;
  materialName: string;
  pathApi: Pick<typeof import("node:path"), "isAbsolute" | "resolve" | "dirname" | "basename" | "join">;
}): string {
  const { pathApi } = input;
  if (input.explicitPath) {
    if (!pathApi.isAbsolute(input.explicitPath)) {
      throw new Error("save_material_config path must be an absolute local path.");
    }
    return pathApi.resolve(input.explicitPath);
  }
  if (input.nativePath && pathApi.isAbsolute(input.nativePath)) {
    return pathApi.resolve(input.nativePath);
  }

  const relativeName = input.nativePath
    ? pathApi.basename(input.nativePath)
    : "";
  const fileName = !relativeName || relativeName === ".texture_set.json"
    ? `${safeMaterialFileStem(input.materialName)}.texture_set.json`
    : relativeName;

  if (input.colorTexturePath) {
    const texturePath = pathApi.isAbsolute(input.colorTexturePath)
      ? input.colorTexturePath
      : input.projectSavePath
        ? pathApi.resolve(pathApi.dirname(input.projectSavePath), input.colorTexturePath)
        : null;
    if (texturePath) return pathApi.join(pathApi.dirname(texturePath), fileName);
  }
  if (input.projectSavePath) {
    return pathApi.join(pathApi.dirname(input.projectSavePath), fileName);
  }
  throw new Error(
    "Material save location is ambiguous. Save the project or supply an absolute path."
  );
}
