/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_STABLE } from "@/lib/constants";
import { getAndActivateTexture, imageContent } from "@/lib/util";

const byte = z.number().int().min(0).max(255);

export const applyTexturePixelsParameters = z.object({
  texture_id: z
    .string()
    .optional()
    .describe("Texture ID, UUID, or name. Defaults to the active/default texture."),
  pixels: z
    .array(
      z.object({
        x: z.number().int().min(0),
        y: z.number().int().min(0),
        rgba: z.array(byte).length(4),
      })
    )
    .min(1)
    .max(65_536)
    .describe("Exact canvas pixels in top-left-origin texture coordinates."),
});

export const codexTextureToolDocs: ToolSpec[] = [
  {
    name: "edit_texture_pixels",
    description:
      "Applies exact RGBA values to texture pixels inside Blockbench so the user can see the change immediately and undo it normally.",
    annotations: {
      title: "Edit Exact Texture Pixels",
      destructiveHint: true,
    },
    parameters: applyTexturePixelsParameters,
    status: STATUS_STABLE,
  },
];

type ApplyTexturePixelsArgs = z.infer<typeof applyTexturePixelsParameters>;

export function registerCodexTextureTools() {
  createTool(codexTextureToolDocs[0].name, {
    ...codexTextureToolDocs[0],
    async execute({ texture_id, pixels }: ApplyTexturePixelsArgs) {
      const texture = getAndActivateTexture(texture_id);
      const invalid = pixels.find(
        ({ x, y }) => x >= texture.width || y >= texture.height
      );
      if (invalid) {
        throw new Error(
          `Pixel (${invalid.x}, ${invalid.y}) is outside texture "${texture.name}" ` +
            `(${texture.width}×${texture.height}).`
        );
      }

      Undo.initEdit({ textures: [texture], selected_texture: true, bitmap: true });
      texture.edit(
        (canvas: HTMLCanvasElement) => {
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (!ctx) throw new Error("Texture canvas has no 2D context.");
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (const { x, y, rgba } of pixels) {
            const offset = (y * canvas.width + x) * 4;
            image.data[offset] = rgba[0];
            image.data[offset + 1] = rgba[1];
            image.data[offset + 2] = rgba[2];
            image.data[offset + 3] = rgba[3];
          }
          ctx.putImageData(image, 0, 0);
        },
        { edit_name: "MCP exact texture pixel edit" }
      );
      Undo.finishEdit("MCP applied exact texture pixels");
      texture.saved = false;
      if (Project) Project.saved = false;
      Canvas.updateAll();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                texture: texture.name,
                uuid: texture.uuid,
                width: texture.width,
                height: texture.height,
                changed_pixels: pixels.length,
              },
              null,
              2
            ),
          },
          ...imageContent(texture.getDataURL()).content,
        ],
      };
    },
  }, codexTextureToolDocs[0].status);
}
