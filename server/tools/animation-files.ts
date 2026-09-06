/// <reference types="blockbench-types/generated/animations/animation_codec" />
import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { codecInputFields, readCodecInput, writeCodecOutput } from "@/lib/codecFiles";
import { findAnimationOrThrow } from "@/src/blockbench/animation";
import { allControllers, findControllerOrThrow, resolveImportedControllerTransitions, type ImportedControllerStates } from "@/src/blockbench/animationControllers";

function getCodec(id?: string): AnimationCodec {
  const codec = id ? AnimationCodec.codecs[id] : AnimationCodec.getCodec();
  if (!codec) throw new Error("Animation codec is unavailable. Use inspect_animation_codecs and provide codec_id.");
  return codec;
}

export const animationFileTools: ToolDefinition[] = [
  defineTool({
    name: "inspect_animation_codecs",
    description: "Lists the installed native AnimationCodec registry with import/compile support and the current format's default. Includes codecs contributed by other plugins.",
    annotations: { title: "Inspect Animation Codecs", readOnlyHint: true },
    parameters: z.object({}), status: "stable",
    async execute() {
      return JSON.stringify({
        current: AnimationCodec.getCodec()?.id ?? null, codecs: Object.values(AnimationCodec.codecs).map(codec => ({
          id: codec.id, multiple_per_file: codec.multiple_per_file, can_import: typeof codec.loadFile === "function",
          can_compile: typeof codec.compileFile === "function" || typeof codec.compileAnimation === "function",
        }))
      });
    },
  }),
  defineTool({
    name: "import_animations",
    description: "Imports an animation file into the visible project through the current native AnimationCodec.loadFile API, with Undo. Accepts inline content or an absolute local file; optional names filter uses file animation IDs. Existing same-name animations/controllers are rejected for Bedrock JSON. Does not save or replace source files.",
    annotations: { title: "Import Animations", destructiveHint: true },
    parameters: z.object({
      codec_id: z.string().min(1).optional(), ...codecInputFields,
      names: z.array(z.string().min(1)).min(1).max(512).optional(),
    }).strict().refine(value => (value.content === undefined) !== (value.path === undefined), "Provide exactly one of content or path."),
    status: "stable",
    async execute({ codec_id, content, path, names }) {
      if (!Format.animation_mode) throw new Error(`Format "${Format.id}" does not support animation.`);
      const codec = getCodec(codec_id);
      if (!codec.loadFile) throw new Error(`Codec "${codec.id}" does not support programmatic import.`);
      const file = readCodecInput({ content, path });
      let controllerDefinitions: Record<string, { states: ImportedControllerStates }> | undefined;
      if (codec.id === "bedrock" || codec.id === "bedrock_animation_controller") {
        const json = JSON.parse(file.content as string);
        const controllers = json.animation_controllers;
        controllerDefinitions = controllers;
        const entries = controllers ?? json.animations;
        if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Expected an animations or animation_controllers object.");
        if (controllers && !Format.animation_controllers) throw new Error("The current format does not support animation controllers.");
        const selected = names ?? Object.keys(entries);
        if (selected.length > 512) throw new Error("Import at most 512 animations per call; provide names to filter.");
        const existing = controllers ? allControllers() : Animator.animations;
        for (const name of selected) {
          if (!Object.hasOwn(entries, name)) throw new Error(`Animation "${name}" is absent from the source file.`);
          if (existing.some(item => item.name === name)) throw new Error(`Animation "${name}" already exists in the project.`);
        }
      }
      const previousAnimations = new Set(Animator.animations);
      const previousControllers = new Set(allControllers());
      const animations: _Animation[] = [];
      const controllers: AnimationController[] = [];
      Undo.initEdit({ animations, animation_controllers: controllers });
      try {
        codec.loadFile(file, names);
      } finally {
        // Undo keeps these aspect arrays by reference, including when a codec fails midway.
        animations.push(...Animator.animations.filter(item => !previousAnimations.has(item)));
        controllers.push(...allControllers().filter(item => !previousControllers.has(item)));
      }
      if (!animations.length && !controllers.length) throw new Error("The codec did not import any animations.");
      for (const controller of controllers) {
        const definition = controllerDefinitions?.[controller.name];
        if (definition) resolveImportedControllerTransitions(controller, definition.states);
      }
      Undo.finishEdit("Import animation file", { animations, animation_controllers: controllers });
      return JSON.stringify({ codec: codec.id, animations: animations.map(item => ({ uuid: item.uuid, name: item.name })), controllers: controllers.map(item => ({ uuid: item.uuid, name: item.name })) });
    },
  }),
  defineTool({
    name: "export_animations",
    description: "Compiles named animations or controllers with the installed native AnimationCodec API. Returns content and optionally writes the exact output to an absolute path. Existing files require overwrite=true and are replaced in full; no implicit merge or save dialog. Controller export uses bedrock_animation_controller by default.",
    annotations: { title: "Export Animations", destructiveHint: true, openWorldHint: true },
    parameters: z.object({
      kind: z.enum(["animations", "controllers"]).default("animations"),
      ids: z.array(z.string().min(1)).min(1).max(512), codec_id: z.string().min(1).optional(),
      path: z.string().min(1).optional(), overwrite: z.boolean().default(false),
      max_content_length: z.number().int().min(0).max(2_000_000).default(100_000),
    }).strict(), status: "stable",
    async execute({ kind, ids, codec_id, path, overwrite, max_content_length }, context) {
      const items = kind === "controllers" ? ids.map(findControllerOrThrow) : ids.map(id => findAnimationOrThrow(id));
      if (new Set(items.map(item => item.name)).size !== items.length) throw new Error("Exported animation names must be unique; duplicate names would overwrite entries in the compiled file.");
      const codec = getCodec(codec_id ?? (kind === "controllers" ? "bedrock_animation_controller" : undefined));
      let compiled: unknown;
      if (codec.compileFile) compiled = await codec.compileFile(items);
      else if (items.length === 1 && codec.compileAnimation) compiled = await codec.compileAnimation(items[0] as _Animation);
      else throw new Error(`Codec "${codec.id}" cannot compile this selection as one file.`);
      const text = typeof compiled === "string" ? compiled : JSON.stringify(compiled, null, 2);
      if (typeof text !== "string") throw new Error("Animation codec returned no content.");
      if (path) writeCodecOutput(path, text, context.project!, "export_animations", overwrite);
      return JSON.stringify({ codec: codec.id, count: items.length, wrote_to_path: path ?? null, content: text.slice(0, max_content_length), truncated: text.length > max_content_length, character_count: text.length });
    },
  }),
];
