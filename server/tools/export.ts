/// <reference types="three" />
/// <reference types="blockbench-types" />
import { z } from "zod";
import { createTool, type ToolSpec } from "@/lib/factories";
import { STATUS_EXPERIMENTAL, STATUS_STABLE } from "@/lib/constants";
import { parseBbmodelText } from "@/lib/projectFiles";

export const listExportFormatsParameters = z.object({
  only_current_format: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, only return codecs compatible with the current project's format."
    ),
});

export const exportModelParameters = z.object({
  codec_id: z
    .string()
    .optional()
    .describe(
      "Codec ID to use for export (e.g., 'obj', 'gltf', 'project', 'bedrock'). If omitted, uses the current project format's codec. Use `inspect_export_formats` to see available IDs."
    ),
  options: z
    .record(z.unknown())
    .optional()
    .describe(
      "Codec-specific export options. Defaults to the codec's configured export options."
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Absolute filesystem path to write the compiled model to. Requires user permission (Blockbench v5.0+ prompts for 'fs' access). If omitted, content is returned in the response only."
    ),
  max_content_length: z
    .number()
    .int()
    .min(0)
    .max(2_000_000)
    .optional()
    .default(100_000)
    .describe(
      "Maximum number of characters to include in the returned `content` field. Use 0 to omit content entirely (useful when only writing to disk). Larger values risk exceeding MCP context limits."
    ),
});

export const exportToolDocs: ToolSpec[] = [
  {
    name: "inspect_export_formats",
    description:
      "Lists all registered export codecs with their id, display name, file extension, and whether they support compile/export. Use before `export_model` to pick a codec.",
    annotations: {
      title: "Inspect Export Formats",
      readOnlyHint: true,
    },
    parameters: listExportFormatsParameters,
    status: STATUS_STABLE,
  },
  {
    name: "export_model",
    description:
      "Compiles the MCP working project through the named codec and returns the result as text. Optionally writes the compiled content to a filesystem path (requires user permission in Blockbench v5.0+). Use `inspect_export_formats` first to discover codec IDs.",
    annotations: {
      title: "Export Model",
      destructiveHint: false,
      openWorldHint: true,
    },
    parameters: exportModelParameters,
    status: STATUS_EXPERIMENTAL,
  },
];

interface ICodecSummary {
  id: string;
  name: string;
  extension: string | null;
  has_compile: boolean;
  has_export: boolean;
  supports_partial_export: boolean;
  belongs_to_current_format: boolean;
}

interface ProgrammaticCodec {
  id?: string;
  name?: string;
  extension?: string;
  compile?: (options?: unknown) => unknown | Promise<unknown>;
  getExportOptions?: () => Record<string, unknown>;
  fileName?: () => string;
}

interface ExportPlan {
  id: string;
  codec: ProgrammaticCodec & {
    compile: (options?: unknown) => unknown | Promise<unknown>;
  };
  options: unknown;
  fileName: string;
}

function toTextContent(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") return JSON.stringify(raw, null, 2);
  return String(raw);
}

function createExportPlan(
  codecId: string | undefined,
  options: Record<string, unknown> | undefined,
  targetName: string
): ExportPlan {
  // @ts-ignore - Codecs and Format are Blockbench globals
  const registry = Codecs as Record<string, ProgrammaticCodec>;
  // @ts-ignore - Format is a Blockbench global
  const id = codecId ?? (Format as { codec?: { id?: string } } | undefined)?.codec?.id;
  if (!id) {
    throw new Error(
      "No codec_id provided and the MCP project format has no default codec. Use `inspect_export_formats` to pick one."
    );
  }
  const codec = registry[id];
  if (!codec) {
    throw new Error(
      `Codec "${id}" not found. Use \`inspect_export_formats\` to see available codecs.`
    );
  }
  if (typeof codec.compile !== "function") {
    throw new Error(`Codec "${id}" does not support programmatic export.`);
  }
  return {
    id,
    codec: codec as ExportPlan["codec"],
    options: options ?? codec.getExportOptions?.(),
    fileName: codec.fileName?.() ?? targetName,
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      typeof (value as PromiseLike<unknown>).then === "function"
  );
}

/** Compile while the target project is installed as Blockbench's active data context. */
export async function compileCodecInProject(
  compile: (options?: unknown) => unknown | Promise<unknown>,
  options: unknown,
  receiver: unknown,
  runInProject: <T>(callback: () => T) => T,
  background: boolean,
  codecId: string
): Promise<unknown> {
  const started = runInProject(() => compile.call(receiver, options));
  if (background && isPromiseLike(started)) {
    void Promise.resolve(started).catch(() => undefined);
    throw new Error(
      `Codec "${codecId}" returned an asynchronous compilation and cannot safely export an inactive tab. ` +
        "Show the MCP working project before exporting with this codec."
    );
  }
  return started;
}

function nodeSignature(items: unknown): string | null {
  if (!Array.isArray(items)) return null;
  const ids: string[] = [];
  for (const item of items) {
    const uuid = item && typeof item === "object"
      ? (item as { uuid?: unknown }).uuid
      : undefined;
    if (typeof uuid !== "string") return null;
    ids.push(uuid);
  }
  return ids.sort().join("\n");
}

/** One final identity check before a portable project export can reach disk. */
export function assertPortableProjectExportMatches(
  raw: unknown,
  target: {
    name: string;
    elements: ArrayLike<{ uuid: string }>;
    groups: ArrayLike<{ uuid: string }>;
  }
): void {
  const exported = (typeof raw === "string"
    ? parseBbmodelText(raw, "compiled project")
    : raw) as {
    name?: unknown;
    elements?: unknown;
    groups?: unknown;
  } | null;
  if (
    !exported ||
    exported.name !== target.name ||
    nodeSignature(exported.elements) !== nodeSignature(Array.from(target.elements)) ||
    nodeSignature(exported.groups) !== nodeSignature(Array.from(target.groups))
  ) {
    throw new Error(
      `Refusing to write the .bbmodel: compiled content does not match MCP project "${target.name}".`
    );
  }
}

export function registerExportTools() {
  createTool(exportToolDocs[0].name, {
    ...exportToolDocs[0],
    async execute({ only_current_format }) {
      // @ts-ignore - Codecs is a Blockbench global
      const registry = Codecs as Record<string, unknown>;
      // @ts-ignore - Format is a Blockbench global
      const currentFormatCodecId = (Format as { codec?: { id?: string } } | undefined)
        ?.codec?.id;

      const summaries: ICodecSummary[] = Object.entries(registry).map(
        ([id, codec]) => {
          const c = codec as {
            id?: string;
            name?: string;
            extension?: string;
            compile?: unknown;
            export?: unknown;
            support_partial_export?: boolean;
          };
          return {
            id,
            name: c.name ?? id,
            extension: c.extension ?? null,
            has_compile: typeof c.compile === "function",
            has_export: typeof c.export === "function",
            supports_partial_export: Boolean(c.support_partial_export),
            belongs_to_current_format: c.id === currentFormatCodecId,
          };
        }
      );

      const filtered = only_current_format
        ? summaries.filter((s) => s.belongs_to_current_format)
        : summaries;

      return JSON.stringify(
        {
          current_format_codec: currentFormatCodecId ?? null,
          count: filtered.length,
          codecs: filtered.sort((a, b) => a.id.localeCompare(b.id)),
        },
        null,
        2
      );
    },
  }, exportToolDocs[0].status);

  createTool(exportToolDocs[1].name, {
    ...exportToolDocs[1],
    async execute({ codec_id, options, path, max_content_length }, context) {
      const targetProject = context.project!;
      const runInTarget = <T>(callback: () => T): T =>
        context.runInProject(callback, targetProject);

      const plan = runInTarget(() =>
        createExportPlan(codec_id, options, targetProject.name)
      );

      const rawResult = await compileCodecInProject(
        plan.codec.compile,
        plan.options,
        plan.codec,
        runInTarget,
        context.background,
        plan.id
      );

      const isArrayBuffer = rawResult instanceof ArrayBuffer;
      const isBinaryView =
        ArrayBuffer.isView(rawResult) && !(rawResult instanceof DataView);
      const binaryBuffer = isArrayBuffer
        ? Buffer.from(rawResult as ArrayBuffer)
        : isBinaryView
          ? Buffer.from(
              (rawResult as ArrayBufferView).buffer,
              (rawResult as ArrayBufferView).byteOffset,
              (rawResult as ArrayBufferView).byteLength
            )
          : null;

      const text = binaryBuffer ? null : toTextContent(rawResult);
      const byteLength = binaryBuffer
        ? binaryBuffer.byteLength
        : Buffer.byteLength(text ?? "", "utf8");
      const encoding: "utf-8" | "base64" = binaryBuffer ? "base64" : "utf-8";

      let wrote_to_path: string | null = null;
      if (path) {
        if (plan.id === "project") {
          assertPortableProjectExportMatches(rawResult, targetProject);
        }
        // @ts-ignore - requireNativeModule is a Blockbench global
        const fs = requireNativeModule("fs", {
          message: `MCP export_model requested write access to save model to ${path}`,
        });
        if (!fs) {
          throw new Error(
            "File system access was denied. Unable to write to path. You can omit `path` to retrieve the content in the response."
          );
        }
        fs.writeFileSync(path, binaryBuffer ?? (text ?? ""));
        wrote_to_path = path;
      }

      const fullContent = binaryBuffer
        ? binaryBuffer.toString("base64")
        : (text ?? "");
      const truncated = fullContent.length > max_content_length;
      const returnedContent = max_content_length === 0
        ? null
        : truncated
          ? fullContent.slice(0, max_content_length)
          : fullContent;

      return JSON.stringify(
        {
          codec: {
            id: plan.id,
            name: plan.codec.name ?? plan.id,
            extension: plan.codec.extension ?? null,
          },
          project: {
            uuid: targetProject.uuid,
            name: targetProject.name,
          },
          file_name: plan.fileName,
          byte_length: byteLength,
          encoding,
          wrote_to_path,
          truncated,
          content: returnedContent,
        },
        null,
        2
      );
    },
  }, exportToolDocs[1].status);
}
