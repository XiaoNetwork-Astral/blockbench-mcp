import { z } from "zod";
import { defineTool, type ToolDefinition } from "@/lib/factories";
import { codecInputFields, readCodecInput } from "@/lib/codecFiles";

export const modelFileTools: ToolDefinition[] = [
  defineTool({
    name: "inspect_import_formats",
    description: "Lists registered model codecs that expose a parser and a target format, along with their native file extensions and input encoding. Use open_bbmodel for native project files and import_model for other text/JSON model formats.",
    project: "none", annotations: { title: "Inspect Import Formats", readOnlyHint: true },
    parameters: z.object({}), status: "stable",
    async execute() {
      return JSON.stringify({
        codecs: Object.values(Codecs).filter(codec => typeof codec.parse === "function" && codec.format).map(codec => ({
          id: codec.id, name: codec.name, extension: codec.extension, format: codec.format!.id,
          input_type: codec.load_filter?.type ?? "json",
        }))
      });
    },
  }),
  defineTool({
    name: "import_model",
    description: "Parses an existing text/JSON model into a new visible project using a registered codec's native parser and target format. Accepts inline content or an absolute local source path. Does not merge into an existing tab or save source files; use open_bbmodel for native .bbmodel projects. Discover supported codecs with inspect_import_formats.",
    project: "optional", writableProject: false,
    annotations: { title: "Import Model", destructiveHint: true },
    parameters: z.object({ codec_id: z.string().min(1), name: z.string().min(1).max(256).optional(), ...codecInputFields }).strict()
      .refine(value => (value.content === undefined) !== (value.path === undefined), "Provide exactly one of content or path."), status: "stable",
    async execute({ codec_id, name, content, path }) {
      if (codec_id === "project") throw new Error("Use open_bbmodel for native Blockbench projects.");
      const codec = Codecs[codec_id];
      if (!codec?.parse || !codec.format) throw new Error("This codec has no programmatic model parser and target format. Use inspect_import_formats.");
      const inputType = codec.load_filter?.type ?? "json";
      if (inputType !== "json" && inputType !== "text") throw new Error(`Input type "${inputType}" is not a text/JSON model.`);
      const file = readCodecInput({ content, path });
      const model = inputType === "json" ? JSON.parse(file.content as string) : file.content;
      if (inputType === "json" && (!model || typeof model !== "object")) throw new Error("A JSON model must contain an object.");
      if (codec.load_filter?.condition && !codec.load_filter.condition(model)) throw new Error("This file does not match the selected codec.");
      if (!setupProject(codec.format)) throw new Error("Blockbench could not create the destination project.");
      const project = Project;
      try {
        codec.parse(model, file.path);
        if (name) project.name = name;
        project.saved = false;
      } catch (error) {
        await project.close(true);
        throw error;
      }
      return JSON.stringify({ uuid: project.uuid, name: project.name, format: project.format.id, elements: project.elements.length, codec: codec.id });
    },
  }),
];
