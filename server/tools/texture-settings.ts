import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { getAndActivateTexture } from "@/lib/util";
import { prepareTextureForMutation, PROJECT_LOCAL_TEXTURE_EDIT_OPTIONS } from "@/lib/textureSafety";

const textureSettingsSchema = z.object({
  name: z.string().min(1).max(256).optional(),
  frame_time: z.number().int().min(1).max(72000).optional(),
  frame_interpolate: z.boolean().optional(),
  frame_order_type: z.enum(["loop", "backwards", "back_and_forth", "custom"]).optional(),
  frame_order: z.string().max(16_384).optional(),
  wrap_mode: z.enum(["limited", "repeat", "clamp"]).optional(),
}).strict().refine(value => Object.keys(value).length > 0, "Provide at least one texture setting.");

export const textureSettingsTools: ToolDefinition[] = [
  defineTool({
    name: "configure_texture",
    description: "Edits one texture's name, animated-frame timing/order/interpolation or wrapping with Undo. Uses the visible project's texture; no source file is saved. Texture animation settings require animated_textures and wrapping requires per_texture_wrap_mode in the current format.",
    annotations: { title: "Configure Texture", destructiveHint: true },
    parameters: z.object({ texture_id: z.string().min(1), settings: textureSettingsSchema }).strict(), status: "stable",
    async execute({ texture_id, settings: values }, context) {
      const texture = getAndActivateTexture(texture_id);
      if (Object.keys(values).some(key => key.startsWith("frame_")) && !Format.animated_textures) throw new Error("This format does not support animated textures.");
      if (values.wrap_mode !== undefined && !Format.per_texture_wrap_mode) throw new Error("This format does not support per-texture wrapping.");
      prepareTextureForMutation(context.project!, texture);
      Undo.initEdit({ textures: [texture] });
      Object.assign(texture, values);
      texture.saved = false;
      texture.updateMaterial();
      Undo.finishEdit("Configure texture");
      return JSON.stringify({ uuid: texture.uuid, name: texture.name, updated: values });
    },
  }),
  defineTool({
    name: "resize_texture",
    description: "Resizes the complete texture bitmap, including layers, using nearest-neighbor scaling or a top-left canvas crop/expansion. Width and height refer to the full image including all animation frames. Logical UV dimensions and coordinates stay unchanged; use set_project_texture_resolution or UV tools when those also need changing. No linked source file is written.",
    annotations: { title: "Resize Texture", destructiveHint: true },
    parameters: z.object({
      texture_id: z.string().min(1), width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192),
      mode: z.enum(["scale", "canvas"]).default("scale"),
    }).strict().refine(value => value.width * value.height <= 16_777_216, "Use at most 16 megapixels per texture."), status: "stable",
    async execute({ texture_id, width, height, mode }, context) {
      const texture = getAndActivateTexture(texture_id);
      const oldWidth = texture.width, oldHeight = texture.height;
      if (!oldWidth || !oldHeight) throw new Error("Texture has not finished loading.");
      if (width === oldWidth && height === oldHeight) return JSON.stringify({ uuid: texture.uuid, width, height, changed: false });
      const resize = (canvas: HTMLCanvasElement, targetWidth: number, targetHeight: number) => {
        const copy = document.createElement("canvas");
        copy.width = canvas.width; copy.height = canvas.height;
        copy.getContext("2d")!.drawImage(canvas, 0, 0);
        canvas.width = targetWidth; canvas.height = targetHeight;
        const ctx = canvas.getContext("2d")!;
        ctx.imageSmoothingEnabled = false;
        if (mode === "scale") ctx.drawImage(copy, 0, 0, targetWidth, targetHeight);
        else ctx.drawImage(copy, 0, 0);
      };
      prepareTextureForMutation(context.project!, texture);
      Undo.initEdit({ textures: [texture], bitmap: true });
      texture.edit(() => {
        if (texture.layers_enabled && texture.layers.length) {
          if (mode === "scale") for (const layer of texture.layers) {
            resize(layer.canvas, Math.max(1, Math.round(layer.canvas.width * width / oldWidth)), Math.max(1, Math.round(layer.canvas.height * height / oldHeight)));
            layer.offset[0] = Math.round(layer.offset[0] * width / oldWidth);
            layer.offset[1] = Math.round(layer.offset[1] * height / oldHeight);
          }
          texture.canvas.width = width; texture.canvas.height = height;
        } else resize(texture.canvas, width, height);
        texture.width = width; texture.height = height;
        (texture as Texture & { keep_size: boolean }).keep_size = true;
      }, { ...PROJECT_LOCAL_TEXTURE_EDIT_OPTIONS });
      if (texture.layers_enabled) texture.updateLayerChanges();
      Canvas.updateAllUVs();
      Undo.finishEdit("Resize texture");
      return JSON.stringify({ uuid: texture.uuid, width: texture.width, height: texture.height, layers: texture.layers.length, mode, changed: true });
    },
  }),
];
