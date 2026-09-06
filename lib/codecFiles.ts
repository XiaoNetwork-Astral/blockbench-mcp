import { z } from "zod";
import { assertExternalWriteAllowed } from "@/lib/textureSafety";

const MAX_INPUT_BYTES = 5 * 1024 * 1024;
export const codecInputFields = {
  content: z.string().max(MAX_INPUT_BYTES).optional().describe("Inline file content. Provide content or path, not both."),
  path: z.string().min(1).optional().describe("Absolute local source path; remote URLs are not supported."),
};

function nativeFs() {
  const fs = requireNativeModule("fs", { message: "Read or write the explicitly requested MCP model or animation file." });
  if (!fs) throw new Error("File system access was denied. Use inline content instead.");
  return fs as typeof import("node:fs");
}

function assertAbsoluteLocalPath(path: string): void {
  const paths = requireNativeModule("path") as typeof import("node:path");
  if (!paths.isAbsolute(path) || /^[a-z]+:\/\//i.test(path)) throw new Error("Provide an absolute local file path.");
}

export function readCodecInput(input: { content?: string; path?: string }): Filesystem.FileResult {
  if ((input.content === undefined) === (input.path === undefined)) throw new Error("Provide exactly one of content or path.");
  let content = input.content;
  if (input.path) {
    assertAbsoluteLocalPath(input.path);
    const fs = nativeFs();
    if (fs.statSync(input.path).size > MAX_INPUT_BYTES) throw new Error("Input file exceeds the 5 MiB limit.");
    content = fs.readFileSync(input.path, "utf8");
  }
  if (new TextEncoder().encode(content).byteLength > MAX_INPUT_BYTES) throw new Error("Input content exceeds the 5 MiB limit.");
  return { name: input.path?.split(/[\\/]/).pop() ?? "inline", path: input.path ?? "", content: content! };
}

export function writeCodecOutput(path: string, content: string, project: ModelProject, operation: string, overwrite: boolean): void {
  assertAbsoluteLocalPath(path);
  assertExternalWriteAllowed(path, project, operation, { allowOwnProjectPath: false });
  const fs = nativeFs();
  // Exclusive creation keeps a newly appearing file from being silently overwritten.
  fs.writeFileSync(path, content, { encoding: "utf8", flag: overwrite ? "w" : "wx" });
}
