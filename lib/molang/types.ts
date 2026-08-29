export type MolangDialect = "stable_2_6_5" | "dev_3_0_experimental";

export interface MolangRange {
  start: number;
  end: number;
  line: number;
  column: number;
}
export type MolangTokenKind =
  | "eof"
  | "error"
  | "identifier"
  | "string"
  | "number"
  | "true"
  | "false"
  | "break"
  | "continue"
  | "return"
  | "."
  | "!"
  | "&&"
  | "||"
  | "<"
  | "<="
  | ">"
  | ">="
  | "="
  | "=="
  | "!="
  | "*"
  | "/"
  | "+"
  | "-"
  | "??"
  | "?"
  | ":"
  | "->"
  | "["
  | "]"
  | ","
  | ";"
  | "("
  | ")"
  | "{"
  | "}";

export interface MolangToken extends MolangRange {
  kind: MolangTokenKind;
  raw: string;
  value?: string | number;
}

export type MolangDiagnosticSeverity = "error" | "warning" | "info";

export interface MolangDiagnostic {
  code: string;
  severity: MolangDiagnosticSeverity;
  message: string;
  range: MolangRange;
  source?: "lexer" | "parser" | "semantic" | "runtime" | "workspace";
}

interface NodeBase extends MolangRange {
  type: string;
}

export interface MolangProgram extends NodeBase {
  type: "Program";
  body: MolangExpression[];
}

export interface MolangNumberLiteral extends NodeBase {
  type: "NumberLiteral";
  value: number;
  raw: string;
}

export interface MolangStringLiteral extends NodeBase {
  type: "StringLiteral";
  value: string;
  raw: string;
}

export interface MolangIdentifier extends NodeBase {
  type: "Identifier";
  name: string;
}

export interface MolangUnaryExpression extends NodeBase {
  type: "UnaryExpression";
  operator: "+" | "-" | "!" | "return";
  argument: MolangExpression;
}

export interface MolangBinaryExpression extends NodeBase {
  type: "BinaryExpression";
  operator:
    | "&&"
    | "||"
    | "<"
    | "<="
    | ">"
    | ">="
    | "+"
    | "-"
    | "*"
    | "/"
    | "->"
    | "??"
    | "="
    | "=="
    | "!="
    | "?";
  left: MolangExpression;
  right: MolangExpression;
}

export interface MolangConditionalExpression extends NodeBase {
  type: "ConditionalExpression";
  test: MolangExpression;
  consequent: MolangExpression;
  alternate: MolangExpression;
}

export interface MolangMemberExpression extends NodeBase {
  type: "MemberExpression";
  object: MolangExpression;
  property: string;
}

export interface MolangIndexExpression extends NodeBase {
  type: "IndexExpression";
  object: MolangExpression;
  index: MolangExpression;
}

export interface MolangCallExpression extends NodeBase {
  type: "CallExpression";
  callee: MolangExpression;
  arguments: MolangExpression[];
}

export interface MolangScopeExpression extends NodeBase {
  type: "ScopeExpression";
  body: MolangExpression[];
}

export interface MolangStatementExpression extends NodeBase {
  type: "StatementExpression";
  statement: "break" | "continue";
}

export type MolangExpression =
  | MolangNumberLiteral
  | MolangStringLiteral
  | MolangIdentifier
  | MolangUnaryExpression
  | MolangBinaryExpression
  | MolangConditionalExpression
  | MolangMemberExpression
  | MolangIndexExpression
  | MolangCallExpression
  | MolangScopeExpression
  | MolangStatementExpression;

export interface MolangParseResult {
  source: string;
  tokens: MolangToken[];
  ast: MolangProgram | null;
  diagnostics: MolangDiagnostic[];
}

export type MolangValue =
  | number
  | boolean
  | string
  | null
  | MolangValue[]
  | { [key: string]: MolangValue };

export interface MolangCatalogEntry {
  namespace: string;
  name: string;
  kind: "function" | "variable" | "namespace";
  minimum_arguments?: number;
  maximum_arguments?: number | null;
  mutable?: boolean;
  runtime_only: boolean;
  experimental: boolean;
  aliases?: string[];
  source_files: string[];
}
