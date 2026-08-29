import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  type FormattingOptions,
  type Node as JsonNode,
} from "jsonc-parser";
import { parseMolang } from "@/lib/molang/parser";
import { validateMolangSemantics } from "@/lib/molang/catalog";
import type { MolangDiagnostic, MolangDialect } from "@/lib/molang/types";
import {
  atomicWriteWorkspaceText,
  resolvePluginWorkspacePath,
  sha256WorkspaceFile,
  sha256WorkspaceValue,
} from "@/lib/pluginWorkspace";
import {
  discoverYsmDocuments,
  inventoryYsmMolangExpressions,
  parseYsmJsonDocument,
  type YsmMolangExpression,
} from "@/lib/ysmMolangDocuments";

export interface YsmMolangEdit {
  operation: "create" | "replace" | "remove";
  expression_id?: string;
  json_pointer?: string;
  expected_literal_sha256?: string;
  value?: string | number;
}

export interface YsmMolangEditRequest {
  manifest: string;
  file: string;
  expected_file_sha256: string;
  edits: YsmMolangEdit[];
  dialect?: MolangDialect;
  dry_run?: boolean;
}

export interface YsmMolangEditPreview {
  operation: YsmMolangEdit["operation"];
  json_pointer: string;
  expression_id: string | null;
  before: string | number | null;
  after: string | number | null;
  original_utf16_range: { start: number; end: number } | null;
  original_byte_range: { start: number; end: number } | null;
  text_edit_basis_sha256: string;
  text_edits: Array<{ offset: number; length: number; content: string }>;
  diagnostics: MolangDiagnostic[];
}

export interface YsmMolangEditResult {
  schema_version: "1";
  dry_run: boolean;
  applied: boolean;
  file: string;
  before_sha256: string;
  after_sha256: string;
  edits: YsmMolangEditPreview[];
  unchanged_bytes_outside_reported_edits: true;
}

function pointerSegments(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`Invalid JSON pointer '${pointer}'.`);
  return pointer.slice(1).split("/").map((part) =>
    part.replace(/~1/g, "/").replace(/~0/g, "~")
  );
}

function pointerPath(tree: JsonNode, pointer: string): Array<string | number> {
  const path: Array<string | number> = [];
  let current: JsonNode | undefined = tree;
  for (const segment of pointerSegments(pointer)) {
    const part = current?.type === "array"
      ? /^(0|[1-9][0-9]*)$/.test(segment)
        ? Number(segment)
        : segment
      : segment;
    path.push(part);
    current = current ? findNodeAtLocation(tree, path) : undefined;
  }
  return path;
}

function formattingOptions(text: string): FormattingOptions {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indentation = /(?:^|\r?\n)([ \t]+)\S/.exec(text)?.[1] ?? "  ";
  return {
    insertSpaces: !indentation.includes("\t"),
    tabSize: indentation.includes("\t") ? 1 : Math.max(1, indentation.length),
    eol,
  };
}

function byteRange(text: string, node: JsonNode): { start: number; end: number } {
  return {
    start: Buffer.byteLength(text.slice(0, node.offset), "utf8"),
    end: Buffer.byteLength(text.slice(0, node.offset + node.length), "utf8"),
  };
}

function validateReplacement(value: string | number, dialect: MolangDialect): MolangDiagnostic[] {
  const parsed = parseMolang(String(value));
  return validateMolangSemantics(parsed, dialect);
}

function findExpression(
  expressions: YsmMolangExpression[],
  edit: YsmMolangEdit,
  file: string
): YsmMolangExpression | null {
  if (!edit.expression_id) return null;
  const matches = expressions.filter((candidate) => candidate.expression_id === edit.expression_id);
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Expression ID '${edit.expression_id}' is not current. Re-inventory the manifest before editing.`
        : `Expression ID '${edit.expression_id}' is ambiguous.`
    );
  }
  if (matches[0].file !== file) {
    throw new Error(`Expression '${edit.expression_id}' belongs to ${matches[0].file}, not ${file}.`);
  }
  return matches[0];
}

function resolvedPointer(edit: YsmMolangEdit, expression: YsmMolangExpression | null): string {
  if (edit.json_pointer && expression && edit.json_pointer !== expression.json_pointer) {
    throw new Error(
      `Edit pointer '${edit.json_pointer}' does not match inventoried expression '${expression.json_pointer}'.`
    );
  }
  const pointer = edit.json_pointer ?? expression?.json_pointer;
  if (pointer === undefined) throw new Error("Each edit requires expression_id or json_pointer.");
  return pointer;
}

export function editYsmMolangExpressions(request: YsmMolangEditRequest): YsmMolangEditResult {
  if (request.edits.length === 0 || request.edits.length > 64) {
    throw new Error("Molang edit batches must contain between 1 and 64 edits.");
  }
  resolvePluginWorkspacePath(request.file);
  const discovery = discoverYsmDocuments(request.manifest);
  const document = discovery.documents.find((candidate) => candidate.path === request.file);
  if (!document || !document.exists || (document.kind !== "animation" && document.kind !== "controller")) {
    throw new Error(
      `${request.file} is not a discovered YSM animation or controller JSON document for ${request.manifest}.`
    );
  }
  const beforeHash = sha256WorkspaceFile(request.file);
  if (beforeHash !== request.expected_file_sha256.toLocaleLowerCase()) {
    throw new Error(
      `Molang source changed outside this request. Expected ${request.expected_file_sha256}, got ${beforeHash}. Re-inventory before editing.`
    );
  }

  const inventory = inventoryYsmMolangExpressions(request.manifest);
  const fatalInventory = inventory.diagnostics.find((item) => item.severity === "error");
  if (fatalInventory) throw new Error(fatalInventory.message);
  const originalParsed = parseYsmJsonDocument(request.file);
  if (!originalParsed) throw new Error(`Cannot edit invalid JSON: ${request.file}`);
  const originalText = originalParsed.text;
  const bom = originalText.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
  let currentText = bom ? originalText.slice(1) : originalText;
  const format = formattingOptions(currentText);
  const previews: YsmMolangEditPreview[] = [];
  const seenPointers = new Set<string>();

  for (const edit of request.edits) {
    const expression = findExpression(inventory.expressions, edit, request.file);
    const pointer = resolvedPointer(edit, expression);
    if (seenPointers.has(pointer)) throw new Error(`The edit batch targets '${pointer}' more than once.`);
    seenPointers.add(pointer);
    if (pointer === "") throw new Error("Replacing or removing an entire JSON document is not supported.");
    const currentDiagnostics: MolangDiagnostic[] = [];
    const parsedCurrent = parseYsmJsonDocumentFromText(request.file, `${bom}${currentText}`, currentDiagnostics);
    if (!parsedCurrent) throw new Error(currentDiagnostics[0]?.message ?? `Invalid JSON in ${request.file}.`);
    const path = pointerPath(parsedCurrent.tree, pointer);
    const currentNode = findNodeAtLocation(parsedCurrent.tree, path);

    if (edit.operation === "create" && currentNode) {
      throw new Error(`Cannot create '${pointer}' because it already exists.`);
    }
    if (edit.operation !== "create" && !currentNode) {
      throw new Error(`Cannot ${edit.operation} '${pointer}' because it does not exist.`);
    }
    if (edit.operation === "create") {
      const parent = findNodeAtLocation(parsedCurrent.tree, path.slice(0, -1));
      if (!parent || (parent.type !== "object" && parent.type !== "array")) {
        throw new Error(`Cannot create '${pointer}' because its parent container does not exist.`);
      }
    }

    const literal = currentNode
      ? parsedCurrent.text.slice(currentNode.offset, currentNode.offset + currentNode.length)
      : null;
    if (edit.operation !== "create") {
      if (!edit.expected_literal_sha256) {
        throw new Error(`${edit.operation} '${pointer}' requires expected_literal_sha256.`);
      }
      const actualLiteralHash = sha256WorkspaceValue(literal ?? "");
      if (actualLiteralHash !== edit.expected_literal_sha256.toLocaleLowerCase()) {
        throw new Error(
          `Literal '${pointer}' changed. Expected ${edit.expected_literal_sha256}, got ${actualLiteralHash}. Re-inventory before editing.`
        );
      }
    }
    if (edit.operation !== "remove" && edit.value === undefined) {
      throw new Error(`${edit.operation} '${pointer}' requires a string or number value.`);
    }
    if (edit.operation === "remove" && edit.value !== undefined) {
      throw new Error(`remove '${pointer}' must not include a replacement value.`);
    }

    const diagnostics = edit.operation === "remove"
      ? []
      : validateReplacement(edit.value!, request.dialect ?? "stable_2_6_5");
    const invalid = diagnostics.find((item) => item.severity === "error");
    if (invalid) throw new Error(`Replacement for '${pointer}' is invalid: ${invalid.message}`);

    const editBasisHash = sha256WorkspaceValue(`${bom}${currentText}`);
    const edits = modify(
      currentText,
      path,
      edit.operation === "remove" ? undefined : edit.value,
      { formattingOptions: format, isArrayInsertion: false }
    );
    const originalNode = expression
      ? findNodeAtLocation(originalParsed.tree, expression.json_path)
      : findNodeAtLocation(originalParsed.tree, path);
    previews.push({
      operation: edit.operation,
      json_pointer: pointer,
      expression_id: expression?.expression_id ?? null,
      before: currentNode ? getNodeValue(currentNode) as string | number : null,
      after: edit.operation === "remove" ? null : edit.value!,
      original_utf16_range: originalNode
        ? { start: originalNode.offset, end: originalNode.offset + originalNode.length }
        : null,
      original_byte_range: originalNode ? byteRange(originalText, originalNode) : null,
      text_edit_basis_sha256: editBasisHash,
      text_edits: edits.map((textEdit) => ({
        ...textEdit,
        offset: textEdit.offset + bom.length,
      })),
      diagnostics,
    });
    currentText = applyEdits(currentText, edits);
  }

  const outputText = `${bom}${currentText}`;
  const afterHash = sha256WorkspaceValue(outputText);
  const dryRun = request.dry_run ?? true;
  if (!dryRun) {
    const currentHash = sha256WorkspaceFile(request.file);
    if (currentHash !== beforeHash) {
      throw new Error(
        `Molang source changed during the edit. Expected ${beforeHash}, got ${currentHash}; nothing was written.`
      );
    }
    atomicWriteWorkspaceText(request.file, outputText);
    const writtenHash = sha256WorkspaceFile(request.file);
    if (writtenHash !== afterHash) {
      throw new Error(`Atomic write verification failed for ${request.file}.`);
    }
  }
  return {
    schema_version: "1",
    dry_run: dryRun,
    applied: !dryRun,
    file: request.file,
    before_sha256: beforeHash,
    after_sha256: afterHash,
    edits: previews,
    unchanged_bytes_outside_reported_edits: true,
  };
}

function parseYsmJsonDocumentFromText(
  file: string,
  text: string,
  diagnostics: MolangDiagnostic[]
): { text: string; tree: JsonNode } | null {
  // Reuse the same JSONC parser behavior without touching the workspace file.
  const bomLength = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const body = bomLength ? text.slice(1) : text;
  const errors: import("jsonc-parser").ParseError[] = [];
  const tree = importParseTree(body, errors);
  if (!tree || errors.length > 0) {
    diagnostics.push({
      code: "YSM_INVALID_JSON",
      severity: "error",
      message: `${file}: JSON became invalid while preparing edits.`,
      range: { start: errors[0]?.offset ?? 0, end: (errors[0]?.offset ?? 0) + (errors[0]?.length ?? 0), line: 1, column: 1 },
      source: "workspace",
    });
    return null;
  }
  return { text, tree: bomLength ? shiftTree(tree, bomLength) : tree };
}

function importParseTree(text: string, errors: import("jsonc-parser").ParseError[]): JsonNode | undefined {
  // Kept separate so edit parsing and workspace parsing use identical options.
  return parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });
}

function shiftTree(node: JsonNode, amount: number): JsonNode {
  return {
    ...node,
    offset: node.offset + amount,
    children: node.children?.map((child) => shiftTree(child, amount)),
  };
}
