import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";
import {
  listWorkspaceFiles,
  readWorkspaceText,
  resolvePluginWorkspacePath,
  sha256WorkspaceFile,
  sha256WorkspaceValue,
  workspaceDirectoryExists,
  workspaceFileExists,
} from "@/lib/pluginWorkspace";
import { getMolangCatalogMetadata } from "@/lib/molang/catalog";
import type { MolangDiagnostic } from "@/lib/molang/types";

export type YsmDocumentKind =
  | "manifest"
  | "geometry"
  | "animation"
  | "controller"
  | "function"
  | "texture"
  | "other";

export interface YsmDiscoveredDocument {
  path: string;
  kind: YsmDocumentKind;
  sha256: string | null;
  exists: boolean;
  source: string;
}

export interface YsmDiscoveryResult {
  schema_version: "1";
  manifest: {
    path: string;
    sha256: string;
    spec: number | null;
  };
  documents: YsmDiscoveredDocument[];
  diagnostics: MolangDiagnostic[];
  truncated: boolean;
  provenance: ReturnType<typeof getMolangCatalogMetadata>;
}

export interface YsmMolangExpression {
  expression_id: string;
  file: string;
  document_kind: YsmDocumentKind;
  expression_kind:
    | "animation_transform"
    | "animation_weight"
    | "animation_timing"
    | "timeline"
    | "controller_transition"
    | "controller_script"
    | "controller_weight"
    | "function";
  owner: {
    animation: string | null;
    controller: string | null;
    state: string | null;
    bone: string | null;
    channel: string | null;
  };
  json_pointer: string;
  json_path: Array<string | number>;
  decoded: string;
  value_type: "string" | "number";
  utf16_range: { start: number; end: number };
  byte_range: { start: number; end: number };
  line: number;
  column: number;
  file_sha256: string;
  literal_sha256: string;
  expression_sha256: string;
}

export interface YsmExpressionInventory {
  schema_version: "1";
  discovery: YsmDiscoveryResult;
  total: number;
  expressions: YsmMolangExpression[];
  diagnostics: MolangDiagnostic[];
}

interface ParsedJsonDocument {
  text: string;
  tree: JsonNode;
  value: unknown;
  bomLength: number;
}

function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index++) {
    if (text.charCodeAt(index) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}

function workspaceDiagnostic(
  file: string,
  code: string,
  message: string,
  severity: MolangDiagnostic["severity"] = "error",
  start = 0,
  end = 0,
  text = ""
): MolangDiagnostic {
  return {
    code,
    severity,
    message: `${file}: ${message}`,
    range: { start, end, ...lineAndColumn(text, start) },
    source: "workspace",
  };
}

function duplicateKeyDiagnostics(file: string, text: string, node: JsonNode): MolangDiagnostic[] {
  const diagnostics: MolangDiagnostic[] = [];
  const visit = (current: JsonNode): void => {
    if (current.type === "object") {
      const seen = new Map<string, JsonNode>();
      for (const property of current.children ?? []) {
        const key = property.children?.[0];
        if (!key) continue;
        const name = String(key.value);
        const previous = seen.get(name);
        if (previous) {
          diagnostics.push(workspaceDiagnostic(
            file,
            "YSM_DUPLICATE_JSON_KEY",
            `Duplicate JSON key '${name}' makes expression targeting ambiguous.`,
            "error",
            key.offset,
            key.offset + key.length,
            text
          ));
        } else {
          seen.set(name, key);
        }
        const value = property.children?.[1];
        if (value) visit(value);
      }
      return;
    }
    for (const child of current.children ?? []) visit(child);
  };
  visit(node);
  return diagnostics;
}

export function parseYsmJsonDocument(
  file: string,
  diagnostics: MolangDiagnostic[] = []
): ParsedJsonDocument | null {
  const original = readWorkspaceText(file);
  const bomLength = original.charCodeAt(0) === 0xfeff ? 1 : 0;
  const text = bomLength ? original.slice(1) : original;
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
  for (const error of errors) {
    diagnostics.push(workspaceDiagnostic(
      file,
      "YSM_INVALID_JSON",
      `${printParseErrorCode(error.error)} at offset ${error.offset}.`,
      "error",
      error.offset + bomLength,
      error.offset + error.length + bomLength,
      original
    ));
  }
  if (!tree || errors.length > 0) return null;
  const adjustedTree = bomLength ? shiftNode(tree, bomLength) : tree;
  diagnostics.push(...duplicateKeyDiagnostics(file, original, adjustedTree));
  return { text: original, tree: adjustedTree, value: getNodeValue(tree), bomLength };
}

function shiftNode(node: JsonNode, amount: number): JsonNode {
  return {
    ...node,
    offset: node.offset + amount,
    children: node.children?.map((child) => shiftNode(child, amount)),
  };
}

function slashJoin(base: string, value: string): string {
  const joined = PathModule.normalize(PathModule.join(base, value));
  return joined.split(PathModule.sep).join("/").replace(/^\.\//, "");
}

function inferDocumentKind(path: Array<string | number>): YsmDocumentKind {
  const lowered = path.map((part) => String(part).toLocaleLowerCase());
  if (lowered.some((part) => part.includes("animation_controller") || part === "controller")) return "controller";
  if (lowered.includes("animation")) return "animation";
  if (lowered.includes("model")) return "geometry";
  if (lowered.includes("texture")) return "texture";
  return "other";
}

function manifestReferences(value: unknown): Array<{ path: string; kind: YsmDocumentKind; source: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const root = value as Record<string, unknown>;
  const references: Array<{ path: string; kind: YsmDocumentKind; source: string }> = [];
  const walk = (current: unknown, path: Array<string | number>): void => {
    if (typeof current === "string" && path[0] === "files") {
      const kind = inferDocumentKind(path);
      if (kind !== "other") references.push({ path: current, kind, source: path.join(".") });
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, [...path, index]));
      return;
    }
    if (current && typeof current === "object") {
      for (const [key, item] of Object.entries(current)) walk(item, [...path, key]);
    }
  };
  walk(root.files, ["files"]);
  return references;
}

function findStringProperty(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record[key] === "string") return record[key] as string;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    const found = findStringProperty(child, key);
    if (found !== null) return found;
  }
  return null;
}

export function discoverYsmDocuments(manifestPath = "ysm.json"): YsmDiscoveryResult {
  // Resolve eagerly so path traversal fails even when the file does not exist.
  resolvePluginWorkspacePath(manifestPath);
  const diagnostics: MolangDiagnostic[] = [];
  if (!workspaceFileExists(manifestPath)) {
    throw new Error(`YSM manifest does not exist inside the plugin workspace: ${manifestPath}`);
  }
  const manifest = parseYsmJsonDocument(manifestPath, diagnostics);
  if (!manifest) {
    throw new Error(`YSM manifest is invalid: ${manifestPath}`);
  }
  const manifestValue = manifest.value as Record<string, unknown>;
  const spec = typeof manifestValue.spec === "number" ? manifestValue.spec : null;
  if (spec !== 2) {
    diagnostics.push(workspaceDiagnostic(
      manifestPath,
      "YSM_UNSUPPORTED_MANIFEST_SPEC",
      `Expected manifest spec 2, received ${String(manifestValue.spec ?? "missing")}.`
    ));
  }
  const base = PathModule.dirname(manifestPath);
  const documents = new Map<string, YsmDiscoveredDocument>();
  const add = (path: string, kind: YsmDocumentKind, source: string): void => {
    const relative = slashJoin(base, path);
    resolvePluginWorkspacePath(relative);
    const exists = workspaceFileExists(relative);
    const previous = documents.get(relative);
    if (!previous || previous.kind === "other") {
      documents.set(relative, {
        path: relative,
        kind,
        sha256: exists ? sha256WorkspaceFile(relative) : null,
        exists,
        source,
      });
    }
    if (!exists) {
      diagnostics.push(workspaceDiagnostic(relative, "YSM_MISSING_DOCUMENT", `Referenced by ${source}, but the file does not exist.`));
    }
  };
  add(PathModule.basename(manifestPath), "manifest", "manifest");
  for (const reference of manifestReferences(manifestValue)) add(reference.path, reference.kind, reference.source);

  const configuredFunctionPath = findStringProperty(manifestValue, "function_path");
  const functionDirectory = slashJoin(base, configuredFunctionPath ?? "functions");
  let truncated = false;
  if (workspaceDirectoryExists(functionDirectory)) {
    const listed = listWorkspaceFiles(functionDirectory, { extension: ".molang", limit: 512 });
    truncated = listed.truncated;
    for (const file of listed.files) {
      documents.set(file, {
        path: file,
        kind: "function",
        sha256: sha256WorkspaceFile(file),
        exists: true,
        source: configuredFunctionPath ? "function_path" : "default_function_path",
      });
    }
  }
  if (truncated) {
    diagnostics.push(workspaceDiagnostic(
      functionDirectory,
      "YSM_FUNCTION_LIST_TRUNCATED",
      "More than 512 .molang function files were found; narrow the function directory.",
      "warning"
    ));
  }

  return {
    schema_version: "1",
    manifest: { path: manifestPath, sha256: sha256WorkspaceFile(manifestPath), spec },
    documents: [...documents.values()].sort((a, b) => a.path.localeCompare(b.path)),
    diagnostics,
    truncated,
    provenance: getMolangCatalogMetadata(),
  };
}

function jsonPointer(path: Array<string | number>): string {
  if (path.length === 0) return "";
  return `/${path.map((part) => String(part).replace(/~/g, "~0").replace(/\//g, "~1")).join("/")}`;
}

function expressionKind(
  documentKind: YsmDocumentKind,
  path: Array<string | number>
): YsmMolangExpression["expression_kind"] | null {
  if (documentKind === "function") return "function";
  const lowered = path.map((part) => String(part).toLocaleLowerCase());
  const last = lowered[lowered.length - 1];
  if (documentKind === "animation") {
    if (lowered.includes("timeline")) return "timeline";
    if (["blend_weight"].includes(last)) return "animation_weight";
    if (["start_delay", "loop_delay", "anim_time_update"].includes(last)) return "animation_timing";
    if (lowered.some((part) => part === "rotation" || part === "position" || part === "scale" || part === "pre" || part === "post" || part === "vector")) {
      return "animation_transform";
    }
  }
  if (documentKind === "controller") {
    if (lowered.includes("transitions")) return "controller_transition";
    if (lowered.includes("on_entry") || lowered.includes("on_exit")) return "controller_script";
    if (lowered.includes("animations")) return "controller_weight";
  }
  return null;
}

function valueAfter(path: Array<string | number>, key: string): string | null {
  const lowered = path.map((part) => String(part).toLocaleLowerCase());
  const index = lowered.indexOf(key);
  const value = index >= 0 ? path[index + 1] : undefined;
  return value === undefined ? null : String(value);
}

function expressionOwner(
  documentKind: YsmDocumentKind,
  path: Array<string | number>
): YsmMolangExpression["owner"] {
  const lowered = path.map((part) => String(part).toLocaleLowerCase());
  const channel = [...lowered].reverse().find((part) =>
    [
      "rotation", "position", "scale", "blend_weight", "start_delay",
      "loop_delay", "anim_time_update", "timeline", "transitions",
      "on_entry", "on_exit", "animations",
    ].includes(part)
  ) ?? null;
  return {
    animation: documentKind === "animation" ? valueAfter(path, "animations") : null,
    controller: documentKind === "controller"
      ? valueAfter(path, lowered.includes("animation_controllers") ? "animation_controllers" : "controllers")
      : null,
    state: documentKind === "controller" ? valueAfter(path, "states") : null,
    bone: documentKind === "animation" ? valueAfter(path, "bones") : null,
    channel,
  };
}

function walkJsonValues(
  node: JsonNode,
  path: Array<string | number>,
  visit: (node: JsonNode, path: Array<string | number>) => void
): void {
  if (node.type === "object") {
    for (const property of node.children ?? []) {
      const key = property.children?.[0];
      const value = property.children?.[1];
      if (key && value) walkJsonValues(value, [...path, String(key.value)], visit);
    }
    return;
  }
  if (node.type === "array") {
    (node.children ?? []).forEach((child, index) => walkJsonValues(child, [...path, index], visit));
    return;
  }
  visit(node, path);
}

function byteOffset(text: string, utf16Offset: number): number {
  return Buffer.byteLength(text.slice(0, utf16Offset), "utf8");
}

function inventoryJsonExpressions(
  file: string,
  documentKind: YsmDocumentKind,
  diagnostics: MolangDiagnostic[]
): YsmMolangExpression[] {
  const parsed = parseYsmJsonDocument(file, diagnostics);
  if (!parsed) return [];
  const fileHash = sha256WorkspaceFile(file);
  const expressions: YsmMolangExpression[] = [];
  walkJsonValues(parsed.tree, [], (node, path) => {
    if (node.type !== "string" && node.type !== "number") return;
    const kind = expressionKind(documentKind, path);
    if (!kind) return;
    const value = getNodeValue(node);
    const decoded = typeof value === "number" ? String(value) : String(value ?? "");
    const literal = parsed.text.slice(node.offset, node.offset + node.length);
    const pointer = jsonPointer(path);
    const literalHash = sha256WorkspaceValue(literal);
    const expressionHash = sha256WorkspaceValue(decoded);
    expressions.push({
      expression_id: sha256WorkspaceValue(`${file}\0${pointer}\0${literalHash}`),
      file,
      document_kind: documentKind,
      expression_kind: kind,
      owner: expressionOwner(documentKind, path),
      json_pointer: pointer,
      json_path: path,
      decoded,
      value_type: typeof value === "number" ? "number" : "string",
      utf16_range: { start: node.offset, end: node.offset + node.length },
      byte_range: {
        start: byteOffset(parsed.text, node.offset),
        end: byteOffset(parsed.text, node.offset + node.length),
      },
      ...lineAndColumn(parsed.text, node.offset),
      file_sha256: fileHash,
      literal_sha256: literalHash,
      expression_sha256: expressionHash,
    });
  });
  return expressions;
}

export function inventoryYsmMolangExpressions(manifestPath = "ysm.json"): YsmExpressionInventory {
  const discovery = discoverYsmDocuments(manifestPath);
  const diagnostics = [...discovery.diagnostics];
  const expressions: YsmMolangExpression[] = [];
  for (const document of discovery.documents) {
    if (!document.exists) continue;
    if (document.kind === "animation" || document.kind === "controller") {
      expressions.push(...inventoryJsonExpressions(document.path, document.kind, diagnostics));
    } else if (document.kind === "function") {
      const text = readWorkspaceText(document.path);
      const hash = sha256WorkspaceFile(document.path);
      const expressionHash = sha256WorkspaceValue(text);
      expressions.push({
        expression_id: sha256WorkspaceValue(`${document.path}\0\0${hash}`),
        file: document.path,
        document_kind: "function",
        expression_kind: "function",
        owner: {
          animation: null,
          controller: null,
          state: null,
          bone: null,
          channel: null,
        },
        json_pointer: "",
        json_path: [],
        decoded: text,
        value_type: "string",
        utf16_range: { start: 0, end: text.length },
        byte_range: { start: 0, end: Buffer.byteLength(text, "utf8") },
        line: 1,
        column: 1,
        file_sha256: hash,
        literal_sha256: hash,
        expression_sha256: expressionHash,
      });
    }
  }
  expressions.sort((a, b) => a.file.localeCompare(b.file) || a.utf16_range.start - b.utf16_range.start);
  return {
    schema_version: "1",
    discovery,
    total: expressions.length,
    expressions,
    diagnostics,
  };
}
