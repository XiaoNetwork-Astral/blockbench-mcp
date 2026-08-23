/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import {
  createInternalTool,
  createToolGroup,
  createToolGroupParameters,
  type ToolSpec,
} from "@/lib/factories";
import {
  getProjectTexture,
  imageContent,
  findElementOrThrow,
  findTextureOrThrow,
  findTextureGroupOrThrow,
  getChannelTextureInfo,
} from "@/lib/util";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import {
  applyTextureCreationSettings,
  applyTextureRenderSettings,
} from "@/lib/toolFixes";
import {
  applyTextureToResolvedFaces,
  type FaceTextureElementTarget,
} from "@/lib/faceTextures";
import {
  colorSchema,
  elementIdSchema,
  textureIdSchema,
  textureIdOptionalSchema,
  pbrChannelEnum,
  renderModeEnum,
  renderSidesEnum,
} from "@/lib/zodObjects";

// ============================================================================
// Texture Tool Parameter Schemas
// ============================================================================

export const createTextureParameters = z
  .object({
    name: z.string(),
    width: z.number().min(16).max(4096).default(16),
    height: z.number().min(16).max(4096).default(16),
    data: z
      .string()
      .optional()
      .describe("Path to the image file or data URL."),
    group: z.string().optional(),
    fill_color: colorSchema
      .optional()
      .describe("RGBA color to fill the texture, as tuple or HEX string."),
    layer_name: z
      .string()
      .optional()
      .describe(
        "Name of the texture layer. Required if fill_color is set."
      ),
    pbr_channel: pbrChannelEnum
      .optional()
      .describe(
        "PBR channel to use for the texture. Color, normal, height, or Metalness/Emissive/Roughness (MER) map."
      ),
    render_mode: renderModeEnum
      .optional()
      .default("default")
      .describe(
        "Render mode for the texture. Default, emissive, additive, or layered."
      ),
    render_sides: renderSidesEnum
      .optional()
      .default("auto")
      .describe("Render sides for the texture. Auto, front, or double."),
  })
  .refine((params) => !(params.data && params.fill_color), {
    message:
      "The 'data' and 'fill_color' properties cannot both be defined.",
    path: ["data", "fill_color"],
  })
  .refine((params) => !(params.fill_color && !params.layer_name), {
    message:
      "The 'layer_name' property is required when 'fill_color' is set.",
    path: ["layer_name", "fill_color"],
  })
  .refine(
    ({ pbr_channel, group }) => (pbr_channel && group) || !pbr_channel,
    {
      message:
        "The 'group' property is required when 'pbr_channel' is set.",
      path: ["group", "pbr_channel"],
    }
  );

export const applyTextureParameters = z.object({
  id: elementIdSchema.describe("ID or name of the element to apply the texture to."),
  texture: textureIdSchema.describe("ID or name of the texture to apply."),
  applyTo: z
    .enum(["all", "blank", "none"])
    .describe(
      "Face scope: all faces, only blank/unresolved faces, or (none) the currently selected faces of per-face UV elements. Box UV elements always apply as a whole."
    )
    .optional()
    .default("blank"),
});

export const removeTextureParameters = z
  .object({
    texture: textureIdSchema.describe("ID, UUID, or unique name of the texture to remove."),
    replacement: textureIdSchema
      .optional()
      .describe(
        "Optional replacement texture. Every face/group reference is changed atomically before removal."
      ),
    clear_references: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Explicitly clear all face/group references when no replacement is supplied. Referenced textures are otherwise refused."
      ),
  })
  .refine(({ replacement, clear_references }) => !(replacement && clear_references), {
    message: "Use either replacement or clear_references, not both.",
    path: ["replacement", "clear_references"],
  });

export const addTextureGroupParameters = z.object({
  name: z.string(),
  textures: z
    .array(z.string())
    .optional()
    .describe("Array of texture IDs or names to add to the group."),
  is_material: z
    .boolean()
    .optional()
    .default(true)
    .describe("Whether the texture group is a PBR material or not."),
});

export const listTexturesParameters = z.object({});

export const getTextureParameters = z.object({
  texture: textureIdOptionalSchema,
});

export const createPbrMaterialParameters = z.object({
  name: z.string().describe("Name of the material."),
  color_texture: z
    .string()
    .optional()
    .describe("Texture ID/name for the color (albedo) channel."),
  normal_texture: z
    .string()
    .optional()
    .describe("Texture ID/name for the normal map channel."),
  height_texture: z
    .string()
    .optional()
    .describe("Texture ID/name for the height/displacement map channel."),
  mer_texture: z
    .string()
    .optional()
    .describe(
      "Texture ID/name for the MER (Metalness/Emissive/Roughness) channel."
    ),
  color_value: z
    .array(z.number().min(0).max(255))
    .length(4)
    .optional()
    .describe(
      "Uniform RGBA color [R,G,B,A] when no color texture is provided."
    ),
  mer_value: z
    .array(z.number().min(0).max(255))
    .length(3)
    .optional()
    .describe(
      "Uniform MER values [Metalness, Emissive, Roughness] (0-255) when no MER texture is provided."
    ),
  subsurface_value: z
    .number()
    .min(0)
    .max(255)
    .optional()
    .describe(
      "Subsurface scattering value (0-255) for Bedrock 1.21.30+ materials."
    ),
});

export const configureMaterialParameters = z.object({
  material: z.string().describe("Material name or UUID to configure."),
  color_texture: z
    .string()
    .optional()
    .describe(
      "Texture ID/name for the color channel, or 'none' to use uniform color."
    ),
  normal_texture: z
    .string()
    .optional()
    .describe(
      "Texture ID/name for the normal map, or 'none' to remove."
    ),
  height_texture: z
    .string()
    .optional()
    .describe(
      "Texture ID/name for the height map, or 'none' to remove."
    ),
  mer_texture: z
    .string()
    .optional()
    .describe(
      "Texture ID/name for MER channel, or 'none' to use uniform values."
    ),
  color_value: z
    .array(z.number().min(0).max(255))
    .length(4)
    .optional()
    .describe("Uniform RGBA color [R,G,B,A] when no color texture."),
  mer_value: z
    .array(z.number().min(0).max(255))
    .length(3)
    .optional()
    .describe(
      "Uniform MER values [Metalness, Emissive, Roughness] (0-255)."
    ),
  subsurface_value: z
    .number()
    .min(0)
    .max(255)
    .optional()
    .describe("Subsurface scattering value (0-255)."),
});

export const listMaterialsParameters = z.object({});

export const getMaterialInfoParameters = z.object({
  material: z.string().describe("Material name or UUID."),
});

export const importTextureSetParameters = z.object({
  path: z
    .string()
    .describe(
      "Path to the .texture_set.json file to import."
    ),
});

export const assignTextureChannelParameters = z.object({
  material: z.string().describe("Material name or UUID."),
  texture: textureIdSchema.describe("Texture name or UUID to assign."),
  channel: pbrChannelEnum.describe("PBR channel to assign the texture to."),
});

export const saveMaterialConfigParameters = z.object({
  material: z.string().describe("Material name or UUID to save."),
});

const TEXTURE_LOAD_TIMEOUT_MS = 15_000;

function waitForTextureImage(
  texture: Texture,
  startLoading: () => void,
  sourceDescription: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      finish(new Error(`Timed out while loading ${sourceDescription}.`));
    }, TEXTURE_LOAD_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      texture.img.removeEventListener("load", onLoad);
      texture.img.removeEventListener("error", onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const onLoad = () => {
      if (!texture.img.naturalWidth || !texture.img.naturalHeight) {
        finish(new Error(`${sourceDescription} did not contain a usable image.`));
        return;
      }
      finish();
    };
    const onError = () => {
      finish(new Error(`Could not load ${sourceDescription}.`));
    };

    texture.img.addEventListener("load", onLoad);
    texture.img.addEventListener("error", onError);
    try {
      startLoading();
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

function createSizedTextureDataUrl(
  width: number,
  height: number,
  draw?: (ctx: CanvasRenderingContext2D) => void
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Blockbench could not create a 2D texture canvas.");
  ctx.imageSmoothingEnabled = false;
  draw?.(ctx);
  return canvas.toDataURL("image/png", 1);
}

async function resizeTextureSource(
  texture: Texture,
  width: number,
  height: number
): Promise<void> {
  if (texture.width === width && texture.height === height) return;
  const resizedSource = createSizedTextureDataUrl(width, height, (ctx) => {
    ctx.drawImage(texture.canvas, 0, 0, width, height);
  });
  (texture as Texture & { keep_size?: boolean }).keep_size = true;
  await waitForTextureImage(
    texture,
    () => texture.fromDataURL(resizedSource),
    `resized ${width}×${height} texture`
  );
}

// ============================================================================
// Texture Tool Docs
// ============================================================================

export const textureToolDocs: ToolSpec[] = [
  {
    name: "create_texture",
    description: "Creates a new texture with the given name and size.",
    annotations: {
      title: "Create Texture",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createTextureParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "apply_texture",
    description:
      "Applies the given texture to the element with the specified ID.",
    annotations: {
      title: "Apply Texture",
      destructiveHint: true,
    },
    parameters: applyTextureParameters,
    status: STATUS_STABLE,
  },
  {
    name: "add_texture_group",
    description: "Adds a new texture group with the given name.",
    annotations: {
      title: "Add Texture Group",
      destructiveHint: true,
    },
    parameters: addTextureGroupParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "list_textures",
    description: "Returns a list of all textures in the Blockbench editor.",
    annotations: {
      title: "List Textures",
      readOnlyHint: true,
    },
    parameters: listTexturesParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_texture",
    description:
      "Returns the image data of the given texture or default texture.",
    annotations: {
      title: "Get Texture",
      readOnlyHint: true,
    },
    parameters: getTextureParameters,
    status: STATUS_STABLE,
  },
  {
    name: "create_pbr_material",
    description:
      "Creates a new PBR material (texture group with is_material=true) and optionally assigns textures to PBR channels. Use this for Minecraft Bedrock resource packs or any format supporting PBR.",
    annotations: {
      title: "Create PBR Material",
      destructiveHint: true,
    },
    parameters: createPbrMaterialParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "configure_material",
    description:
      "Configures an existing PBR material's properties including channel assignments, uniform values, and subsurface scattering.",
    annotations: {
      title: "Configure Material",
      destructiveHint: true,
    },
    parameters: configureMaterialParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "list_materials",
    description:
      "Lists all PBR materials (texture groups with is_material=true) and their assigned textures per channel.",
    annotations: {
      title: "List Materials",
      readOnlyHint: true,
    },
    parameters: listMaterialsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "get_material_info",
    description:
      "Gets detailed information about a PBR material including the compiled texture_set.json preview for Bedrock export.",
    annotations: {
      title: "Get Material Info",
      readOnlyHint: true,
    },
    parameters: getMaterialInfoParameters,
    status: STATUS_STABLE,
  },
  {
    name: "import_texture_set",
    description:
      "Imports a Minecraft Bedrock texture_set.json file and creates a PBR material with the associated textures.",
    annotations: {
      title: "Import Texture Set",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: importTextureSetParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "assign_texture_channel",
    description:
      "Assigns a texture to a specific PBR channel within a material.",
    annotations: {
      title: "Assign Texture Channel",
      destructiveHint: true,
    },
    parameters: assignTextureChannelParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "save_material_config",
    description:
      "Saves the material's texture_set.json file to disk (Bedrock format). Requires the color texture to have a valid file path.",
    annotations: {
      title: "Save Material Config",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: saveMaterialConfigParameters,
    status: STATUS_EXPERIMENTAL,
  },
  {
    name: "remove_texture",
    description:
      "Removes an entire texture from the active project. If it is referenced, supply a replacement texture or explicitly clear references; otherwise the operation refuses before mutation. Reference rewrites and removal share one Undo transaction and are verified before success is returned.",
    annotations: {
      title: "Remove Texture",
      destructiveHint: true,
    },
    parameters: removeTextureParameters,
    status: STATUS_STABLE,
  },
];

const textureReadOperations = [textureToolDocs[3], textureToolDocs[4]];
const textureEditOperations = [
  textureToolDocs[0],
  textureToolDocs[1],
  textureToolDocs[2],
  textureToolDocs[12],
];
const materialReadOperations = [textureToolDocs[7], textureToolDocs[8]];
const materialEditOperations = [
  textureToolDocs[5],
  textureToolDocs[6],
  textureToolDocs[9],
  textureToolDocs[10],
  textureToolDocs[11],
];

export const texturePublicToolDocs: ToolSpec[] = [
  {
    name: "inspect_textures",
    description:
      "Lists project textures or returns one texture's image data through a read-only command.action.",
    annotations: { title: "Inspect Textures", readOnlyHint: true },
    parameters: createToolGroupParameters(textureReadOperations),
    status: STATUS_STABLE,
  },
  {
    name: "edit_textures",
    description:
      "Creates, applies, groups, or safely removes textures through one command.action. Paint actions accept texture_id directly, so the redundant activate_texture command is no longer exposed.",
    annotations: {
      title: "Edit Textures",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createToolGroupParameters(textureEditOperations),
    status: STATUS_STABLE,
  },
  {
    name: "inspect_materials",
    description:
      "Lists PBR materials or returns one material's detailed channel configuration.",
    annotations: { title: "Inspect Materials", readOnlyHint: true },
    parameters: createToolGroupParameters(materialReadOperations),
    status: STATUS_STABLE,
  },
  {
    name: "edit_materials",
    description:
      "Creates, imports, configures, assigns channels to, or saves PBR materials through one command.action.",
    annotations: {
      title: "Edit Materials",
      destructiveHint: true,
      openWorldHint: true,
    },
    parameters: createToolGroupParameters(materialEditOperations),
    status: STATUS_STABLE,
  },
];

// ============================================================================
// Tool Registration
// ============================================================================

export function registerTextureTools() {
  createInternalTool(textureToolDocs[0].name, {
    ...textureToolDocs[0],
    async execute({
      name,
      width,
      height,
      data,
      pbr_channel,
      fill_color,
      group,
      layer_name,
      render_mode,
      render_sides,
    }) {
      const textureGroup = group ? findTextureGroupOrThrow(group) : undefined;
      const resolvedGroup = textureGroup?.uuid;
      Undo.initEdit({
        textures: [],
        selected_texture: true,
        bitmap: true,
        collections: [],
      });

      const texture = new Texture({
        name,
        width,
        height,
        group: resolvedGroup,
        pbr_channel,
        render_mode,
        render_sides,
        internal: true,
      });
      texture.add();

      try {
        if (data) {
          (texture as Texture & { keep_size?: boolean }).keep_size = true;
          if (data.startsWith("data:image/")) {
            await waitForTextureImage(
              texture,
              () => texture.fromDataURL(data),
              "the supplied data URL"
            );
          } else {
            const localPath = data.replace(/^file:\/\/\/?/, "");
            await waitForTextureImage(
              texture,
              () => {
                texture.fromFile({
                  name: localPath.split(/[\/\\]/).pop() || localPath,
                  path: localPath,
                });
              },
              `texture file "${localPath}"`
            );
          }
          await resizeTextureSource(texture, width, height);
        } else {
          const source = createSizedTextureDataUrl(width, height, (ctx) => {
            if (!fill_color) return;
            const color = Array.isArray(fill_color)
              // @ts-ignore - tinycolor is available globally in Blockbench
              ? tinycolor({
                r: Number(fill_color[0]),
                g: Number(fill_color[1]),
                b: Number(fill_color[2]),
                a: Number(fill_color[3] ?? 255) / 255,
              })
              // @ts-ignore - tinycolor is available globally in Blockbench
              : tinycolor(fill_color);
            ctx.fillStyle = color.toRgbString().toLowerCase();
            ctx.fillRect(0, 0, width, height);
          });
          (texture as Texture & { keep_size?: boolean }).keep_size = true;
          await waitForTextureImage(
            texture,
            () => texture.fromDataURL(source),
            `${width}×${height} texture canvas`
          );
        }

        texture.layers_enabled = false;
        if (data) texture.fillParticle();
        applyTextureCreationSettings(texture, {
          name,
          width,
          height,
          group: resolvedGroup,
          pbrChannel: pbr_channel,
          renderMode: render_mode,
          renderSides: render_sides,
        });

        if (layer_name) {
          if (!texture.layers_enabled) texture.activateLayers(true);
          if (texture.selected_layer) texture.selected_layer.name = layer_name;
        }

        Undo.finishEdit("Agent created texture", {
          textures: [texture],
          selected_texture: true,
          bitmap: true,
          collections: [],
        });
        Canvas.updateAll();

        return imageContent({
          url: texture.getDataURL(),
        });
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        if (Texture.all.includes(texture)) texture.remove(true);
        throw error;
      }
    },
  }, textureToolDocs[0].status);

  createInternalTool(textureToolDocs[1].name, {
    ...textureToolDocs[1],
    async execute({ applyTo, id, texture }) {
      const element = findElementOrThrow(id);
      const projectTexture = texture
        ? findTextureOrThrow(texture)
        : Texture.getDefault();

      if (!projectTexture) {
        throw new Error(
          "No default texture available. Use edit_textures with command.action \"create_texture\" to create one first."
        );
      }

      // Resolve `id` to the concrete set of cubes/meshes to texture.
      // - Group → all descendant cubes + meshes
      // - Cube / Mesh → that single element
      const targets: Array<Cube | Mesh> = [];
      if (element instanceof Group) {
        const collectDescendants = (group: Group) => {
          for (const child of group.children ?? []) {
            if (child instanceof Cube || child instanceof Mesh) {
              targets.push(child);
              continue;
            }
            if (child instanceof Group) collectDescendants(child);
          }
        };
        collectDescendants(element);
      } else if (element instanceof Cube || element instanceof Mesh) {
        targets.push(element);
      } else {
        throw new Error(
          `Element "${id}" is not a cube, mesh, or group — cannot apply texture to it.`
        );
      }

      if (targets.length === 0) {
        throw new Error(
          `Element "${id}" resolved to no paintable cubes or meshes.`
        );
      }

      // Per-group texture formats persist a texture on the owning Group rather
      // than on individual faces. Resolve that scope directly as well.
      if (Format.per_group_texture) {
        const groups = element instanceof Group
          ? [element]
          : element.parent instanceof Group
            ? [element.parent]
            : [];
        if (groups.length === 0) {
          throw new Error(
            `Element "${id}" has no owning group in this per-group texture format.`
          );
        }
        Undo.initEdit({ groups, collections: [] });
        try {
          for (const group of groups) group.texture = projectTexture.uuid;
          const failed = groups.filter((group) => group.texture !== projectTexture.uuid);
          if (failed.length > 0) {
            throw new Error(
              `Texture assignment verification failed for groups: ${failed.map((group) => group.uuid).join(", ")}`
            );
          }
        } catch (error) {
          (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
          throw error;
        }
        Undo.finishEdit("Agent applied group texture", { groups, collections: [] });
        Canvas.updateAll();
        return JSON.stringify({
          texture: { name: projectTexture.name, uuid: projectTexture.uuid },
          scope: { id, kind: "per_group_texture" },
          target_groups: groups.map((group) => ({ name: group.name, uuid: group.uuid })),
          verified: true,
        }, null, 2);
      }

      const allElements = [...Cube.all, ...Mesh.all] as FaceTextureElementTarget[];
      const faceTargets = targets as FaceTextureElementTarget[];
      const selectedFaces = new Map<FaceTextureElementTarget, ReadonlySet<string>>();
      if (applyTo === "none") {
        for (const target of targets) {
          const selected = target instanceof Cube && target.box_uv
            ? Object.keys(target.faces)
            : (UVEditor.getSelectedFaces(target) ?? []);
          selectedFaces.set(
            target as FaceTextureElementTarget,
            new Set(selected)
          );
        }
      }
      const validTextureUuids = new Set(
        (Project?.textures ?? Texture.all).map((entry) => entry.uuid)
      );
      const undoAspects: UndoAspects = {
        elements: targets,
        outliner: false,
        collections: [],
      };
      Undo.initEdit(undoAspects);

      let result;
      try {
        result = applyTextureToResolvedFaces(
          allElements,
          faceTargets,
          projectTexture.uuid,
          applyTo,
          selectedFaces,
          validTextureUuids
        );
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }

      Undo.finishEdit("Agent applied texture", undoAspects);

      // Force face-level render refresh so the viewport matches the data.
      // Canvas.updateAll() alone sometimes doesn't push new face materials
      // into the THREE.js render targets.
      Canvas.updateView({
        elements: targets,
        element_aspects: { faces: true, uv: true, geometry: false },
      });
      Canvas.updateAll();

      return JSON.stringify({
        texture: { name: projectTexture.name, uuid: projectTexture.uuid },
        scope: {
          id,
          kind: element instanceof Group ? "group" : element instanceof Cube ? "cube" : "mesh",
          face_mode: applyTo,
        },
        ...result,
        verified: true,
      }, null, 2);
    },
  }, textureToolDocs[1].status);

  createInternalTool(textureToolDocs[2].name, {
    ...textureToolDocs[2],
    async execute({ name, textures, is_material }) {
      const textureList = [...new Map<string, Texture>(
        ((textures ?? []) as string[]).map((reference: string) => {
          const texture = findTextureOrThrow(reference);
          return [texture.uuid, texture] as const;
        })
      ).values()];
      const beforeAspects = {
        textures: textureList,
        texture_groups: [] as TextureGroup[],
        collections: [],
      } as UndoAspects & { texture_groups: TextureGroup[] };
      Undo.initEdit(beforeAspects);

      let textureGroup: TextureGroup | undefined;
      try {
        textureGroup = new TextureGroup({ name, is_material }).add();
        for (const texture of textureList) {
          texture.extend({ group: textureGroup.uuid });
        }
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        if (textureGroup && TextureGroup.all.includes(textureGroup)) textureGroup.remove();
        throw error;
      }

      Undo.finishEdit("Agent added texture group", {
        textures: textureList,
        texture_groups: [textureGroup],
        collections: [],
      } as UndoAspects & { texture_groups: TextureGroup[] });
      Canvas.updateAll();

      return `Added texture group ${textureGroup.name} with ID ${textureGroup.uuid}`;
    },
  }, textureToolDocs[2].status);

  createInternalTool(textureToolDocs[3].name, {
    ...textureToolDocs[3],
    async execute() {
      const textures = Project?.textures ?? Texture.all;

      return JSON.stringify(
        textures.map((texture) => ({
          name: texture.name,
          uuid: texture.uuid,
          id: texture.id,
          group: texture.group,
        }))
      );
    },
  }, textureToolDocs[3].status);

  createInternalTool(textureToolDocs[4].name, {
    ...textureToolDocs[4],
    async execute({ texture }) {
      if (!texture) {
        const defaultTexture = Texture.getDefault();
        if (!defaultTexture) {
          throw new Error(
            "No default texture available. Use edit_textures with command.action \"create_texture\" first, or specify a texture ID."
          );
        }
        return imageContent({ url: defaultTexture.getDataURL() });
      }

      const image = findTextureOrThrow(texture);
      return imageContent({ url: image.getDataURL() });
    },
  }, textureToolDocs[4].status);

  createInternalTool(textureToolDocs[5].name, {
    ...textureToolDocs[5],
    async execute({
      name,
      color_texture,
      normal_texture,
      height_texture,
      mer_texture,
      color_value,
      mer_value,
      subsurface_value,
    }) {
      const channelReferences = [
        [color_texture, "color"],
        [normal_texture, "normal"],
        [height_texture, "height"],
        [mer_texture, "mer"],
      ] as const;
      const channelAssignments = channelReferences
        .filter((entry): entry is [string, typeof entry[1]] => Boolean(entry[0]))
        .map(([reference, channel]) => ({
          texture: findTextureOrThrow(reference),
          channel,
        }));
      const texturesToAdd = [...new Map(
        channelAssignments.map(({ texture }) => [texture.uuid, texture] as const)
      ).values()];
      Undo.initEdit({
        texture_groups: [],
        textures: texturesToAdd,
        collections: [],
      } as UndoAspects & { texture_groups: TextureGroup[] });

      let textureGroup: TextureGroup | undefined;
      try {
        textureGroup = new TextureGroup({ name, is_material: true });

        if (color_value) textureGroup.material_config.color_value = color_value;
        if (mer_value) textureGroup.material_config.mer_value = mer_value;
        if (subsurface_value !== undefined) {
          (
            textureGroup.material_config as TextureGroupMaterialConfig & {
              subsurface_value?: number;
            }
          ).subsurface_value = subsurface_value;
        }
        textureGroup.material_config.saved = false;
        textureGroup.add();

        for (const { texture, channel } of channelAssignments) {
          texture.extend({ group: textureGroup.uuid, pbr_channel: channel });
        }
        textureGroup.updateMaterial();
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        if (textureGroup && TextureGroup.all.includes(textureGroup)) textureGroup.remove();
        throw error;
      }

      Undo.finishEdit("Agent created PBR material", {
        texture_groups: [textureGroup],
        textures: texturesToAdd,
        collections: [],
      } as UndoAspects & { texture_groups: TextureGroup[] });
      Canvas.updateAll();

      return JSON.stringify({
        success: true,
        material: {
          name: textureGroup.name,
          uuid: textureGroup.uuid,
          is_material: true,
          channels: {
            color: color_texture ? true : !!color_value,
            normal: !!normal_texture,
            height: !!height_texture,
            mer: mer_texture ? true : !!mer_value,
          },
        },
      });
    },
  }, textureToolDocs[5].status);

  createInternalTool(textureToolDocs[6].name, {
    ...textureToolDocs[6],
    async execute({
      material,
      color_texture,
      normal_texture,
      height_texture,
      mer_texture,
      color_value,
      mer_value,
      subsurface_value,
    }) {
      const textureGroup = findTextureGroupOrThrow(material);
      const textures = textureGroup.getTextures();

      Undo.initEdit({
        texture_groups: [textureGroup],
        textures,
      });

      // Handle color channel
      if (color_texture === "none") {
        textures
          .filter((t: Texture) => t.pbr_channel === "color")
          .forEach((t: Texture) => (t.group = ""));
      } else if (color_texture) {
        textures
          .filter((t: Texture) => t.pbr_channel === "color")
          .forEach((t: Texture) => (t.pbr_channel = "color"));
        const tex = findTextureOrThrow(color_texture);
        tex.extend({ group: textureGroup.uuid, pbr_channel: "color" });
      }

      // Handle normal channel
      if (normal_texture === "none") {
        textures
          .filter((t: Texture) => t.pbr_channel === "normal")
          .forEach((t: Texture) => (t.group = ""));
      } else if (normal_texture) {
        const tex = findTextureOrThrow(normal_texture);
        tex.extend({ group: textureGroup.uuid, pbr_channel: "normal" });
      }

      // Handle height channel
      if (height_texture === "none") {
        textures
          .filter((t: Texture) => t.pbr_channel === "height")
          .forEach((t: Texture) => (t.group = ""));
      } else if (height_texture) {
        const tex = findTextureOrThrow(height_texture);
        tex.extend({ group: textureGroup.uuid, pbr_channel: "height" });
      }

      // Handle MER channel
      if (mer_texture === "none") {
        textures
          .filter((t: Texture) => t.pbr_channel === "mer")
          .forEach((t: Texture) => (t.group = ""));
      } else if (mer_texture) {
        const tex = findTextureOrThrow(mer_texture);
        tex.extend({ group: textureGroup.uuid, pbr_channel: "mer" });
      }

      // Update uniform values
      if (color_value) {
        textureGroup.material_config.color_value = color_value;
      }
      if (mer_value) {
        textureGroup.material_config.mer_value = mer_value;
      }
      if (subsurface_value !== undefined) {
        textureGroup.material_config.subsurface_value = subsurface_value;
      }

      textureGroup.material_config.saved = false;
      textureGroup.updateMaterial();

      Undo.finishEdit("Agent configured material");
      Canvas.updateAll();

      return `Configured material "${textureGroup.name}"`;
    },
  }, textureToolDocs[6].status);

  createInternalTool(textureToolDocs[7].name, {
    ...textureToolDocs[7],
    async execute() {
      // @ts-ignore - TextureGroup is globally available
      const materials = TextureGroup.all.filter(
        (g: TextureGroup) => g.is_material
      );

      const result = materials.map((group: TextureGroup) => {
        const textures = group.getTextures();
        return {
          name: group.name,
          uuid: group.uuid,
          channels: {
            color: getChannelTextureInfo(textures, "color"),
            normal: getChannelTextureInfo(textures, "normal"),
            height: getChannelTextureInfo(textures, "height"),
            mer: getChannelTextureInfo(textures, "mer"),
          },
          config: {
            color_value: group.material_config.color_value,
            mer_value: group.material_config.mer_value,
            subsurface_value: group.material_config.subsurface_value,
            saved: group.material_config.saved,
          },
        };
      });

      return JSON.stringify(result, null, 2);
    },
  }, textureToolDocs[7].status);

  createInternalTool(textureToolDocs[8].name, {
    ...textureToolDocs[8],
    async execute({ material }) {
      const textureGroup = findTextureGroupOrThrow(material);
      const textures = textureGroup.getTextures();

      // Get compiled texture_set.json
      let textureSetJson = null;
      try {
        textureSetJson = textureGroup.material_config.compileForBedrock();
      } catch {
        // Format might not support texture_set.json
      }

      const result = {
        name: textureGroup.name,
        uuid: textureGroup.uuid,
        is_material: textureGroup.is_material,
        textures: textures.map((tex: Texture) => ({
          name: tex.name,
          uuid: tex.uuid,
          pbr_channel: tex.pbr_channel,
          width: tex.width,
          height: tex.height,
          render_mode: tex.render_mode,
          render_sides: tex.render_sides,
        })),
        config: {
          color_value: textureGroup.material_config.color_value,
          mer_value: textureGroup.material_config.mer_value,
          subsurface_value: textureGroup.material_config.subsurface_value,
          saved: textureGroup.material_config.saved,
          file_path: textureGroup.material_config.getFilePath(),
        },
        texture_set_json: textureSetJson,
      };

      return JSON.stringify(result, null, 2);
    },
  }, textureToolDocs[8].status);

  createInternalTool(textureToolDocs[9].name, {
    ...textureToolDocs[9],
    async execute({ path }) {
      // Validate path ends with texture_set.json
      if (!path.endsWith(".texture_set.json")) {
        throw new Error(
          "Path must end with '.texture_set.json'. Example: 'path/to/mytexture.texture_set.json'"
        );
      }

      // @ts-ignore - fs module available via Blockbench
      const fs = requireNativeModule("fs");
      if (!fs.existsSync(path)) {
        throw new Error(`File not found: ${path}`);
      }

      // Use Blockbench's importTextureSet function
      // @ts-ignore - importTextureSet is globally available
      importTextureSet({ path, name: path.split(/[\/\\]/).pop() });

      return `Imported texture set from "${path}". Check the textures panel for the new material.`;
    },
  }, textureToolDocs[9].status);

  createInternalTool(textureToolDocs[10].name, {
    ...textureToolDocs[10],
    async execute({ material, texture, channel }) {
      const textureGroup = findTextureGroupOrThrow(material);
      const tex = findTextureOrThrow(texture);

      Undo.initEdit({
        texture_groups: [textureGroup],
        textures: [tex],
      });

      // Remove any existing texture from this channel in the group
      const existingTextures = textureGroup.getTextures();
      existingTextures
        .filter((t: Texture) => t.pbr_channel === channel && t.uuid !== tex.uuid)
        .forEach((t: Texture) => {
          t.pbr_channel = "color"; // Reset to color
        });

      // Assign the texture to the channel
      tex.extend({
        group: textureGroup.uuid,
        pbr_channel: channel,
      });

      textureGroup.material_config.saved = false;
      textureGroup.updateMaterial();

      Undo.finishEdit("Agent assigned texture channel");
      Canvas.updateAll();

      return `Assigned texture "${tex.name}" to ${channel} channel of material "${textureGroup.name}"`;
    },
  }, textureToolDocs[10].status);

  createInternalTool(textureToolDocs[11].name, {
    ...textureToolDocs[11],
    async execute({ material }) {
      const textureGroup = findTextureGroupOrThrow(material);
      const filePath = textureGroup.material_config.getFilePath();

      if (!filePath) {
        throw new Error(
          "Cannot save: Material needs a color texture with a valid file path. Save the color texture first, then try again."
        );
      }

      textureGroup.material_config.save();

      return `Saved material config to "${filePath}"`;
    },
  }, textureToolDocs[11].status);

  createInternalTool(textureToolDocs[12].name, {
    ...textureToolDocs[12],
    async execute({ texture, replacement, clear_references }) {
      const target = findTextureOrThrow(texture);
      const replacementTexture = replacement
        ? findTextureOrThrow(replacement)
        : undefined;
      if (replacementTexture?.uuid === target.uuid) {
        throw new Error("The replacement texture must differ from the texture being removed.");
      }

      const faceElements = [...Cube.all, ...Mesh.all];
      const referencedElements = faceElements.filter((element) =>
        Object.values(element.faces).some((face) => face.texture === target.uuid)
      );
      const referencedGroups = Group.all.filter(
        (group) => group.texture === target.uuid
      );
      const referencedFaces = referencedElements.reduce(
        (count, element) => count + Object.values(element.faces)
          .filter((face) => face.texture === target.uuid).length,
        0
      );
      const referenceCount = referencedFaces + referencedGroups.length;
      if (referenceCount > 0 && !replacementTexture && !clear_references) {
        throw new Error(
          `Refusing to remove referenced texture "${target.name}" (${target.uuid}): ` +
            `${referencedFaces} face reference(s), ${referencedGroups.length} group reference(s). ` +
            "Supply replacement or explicitly set clear_references=true."
        );
      }

      const wasSelected = Texture.selected?.uuid === target.uuid;
      const wasParticle = target.particle;
      const wasDefault = target.use_as_default;
      const beforeAspects = {
        textures: [target, ...(replacementTexture ? [replacementTexture] : [])],
        elements: referencedElements,
        groups: referencedGroups,
        selected_texture: true,
        collections: [],
      } as UndoAspects;
      Undo.initEdit(beforeAspects);
      try {
        const nextReference = replacementTexture?.uuid ?? false;
        for (const element of referencedElements) {
          for (const face of Object.values(element.faces)) {
            if (face.texture === target.uuid) face.texture = nextReference;
          }
        }
        for (const group of referencedGroups) {
          group.texture = replacementTexture?.uuid ?? "";
        }
        target.remove(true);

        if (Texture.all.includes(target)) {
          throw new Error("Blockbench did not remove the requested texture from the project.");
        }
        const remainingFaceReferences = faceElements.reduce(
          (count, element) => count + Object.values(element.faces)
            .filter((face) => face.texture === target.uuid).length,
          0
        );
        const remainingGroupReferences = Group.all.filter(
          (group) => group.texture === target.uuid
        ).length;
        if (remainingFaceReferences + remainingGroupReferences > 0) {
          throw new Error(
            `Removal verification found ${remainingFaceReferences} face and ` +
              `${remainingGroupReferences} group reference(s) still pointing to the removed texture.`
          );
        }

        if (replacementTexture) {
          if (wasSelected) replacementTexture.select();
          if (wasParticle) replacementTexture.enableParticle();
          if (wasDefault) replacementTexture.setAsDefaultTexture();
        }
      } catch (error) {
        (Undo.cancelEdit as unknown as (revertChanges?: boolean) => void)(true);
        throw error;
      }

      const afterAspects = {
        textures: replacementTexture ? [replacementTexture] : [],
        elements: referencedElements,
        groups: referencedGroups,
        selected_texture: true,
        collections: [],
      } as UndoAspects;
      Undo.finishEdit("Agent removed texture", afterAspects);
      if ((Canvas as typeof Canvas & { layered_material?: unknown }).layered_material) {
        Canvas.updateLayeredTextures();
      }
      Canvas.updateAllFaces();
      TextureAnimator.updateButton();
      BARS.updateConditions();
      if (Outliner.selected.length > 0) UVEditor.loadData();

      return JSON.stringify({
        removed: { name: target.name, uuid: target.uuid },
        replacement: replacementTexture
          ? { name: replacementTexture.name, uuid: replacementTexture.uuid }
          : null,
        cleared_references: !replacementTexture && clear_references,
        rewritten_face_references: referencedFaces,
        rewritten_group_references: referencedGroups.length,
        remaining_textures: Texture.all.length,
        verified: true,
      }, null, 2);
    },
  }, textureToolDocs[12].status);

  createToolGroup(texturePublicToolDocs[0], textureReadOperations);
  createToolGroup(texturePublicToolDocs[1], textureEditOperations);
  createToolGroup(texturePublicToolDocs[2], materialReadOperations);
  createToolGroup(texturePublicToolDocs[3], materialEditOperations);
}
