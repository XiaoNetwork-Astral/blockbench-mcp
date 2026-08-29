import { lexMolang } from "@/lib/molang/lexer";
import type {
  MolangBinaryExpression,
  MolangDiagnostic,
  MolangExpression,
  MolangParseResult,
  MolangProgram,
  MolangToken,
  MolangTokenKind,
} from "@/lib/molang/types";

const BINARY_PRECEDENCE: Partial<Record<MolangTokenKind, number>> = {
  "=": 1,
  "??": 1200,
  "||": 1600,
  "&&": 1800,
  "==": 2000,
  "!=": 2000,
  "<": 2200,
  "<=": 2200,
  ">": 2200,
  ">=": 2200,
  "+": 2400,
  "-": 2400,
  "*": 2600,
  "/": 2600,
  "->": 3000,
};

const CONDITIONAL_PRECEDENCE = 1400;
const UNARY_PRECEDENCE = 2800;

function canBeCalled(expression: MolangExpression): boolean {
  return expression.type === "Identifier"
    || expression.type === "MemberExpression"
    || expression.type === "IndexExpression"
    || expression.type === "CallExpression";
}
class Parser {
  private index = 0;
  readonly diagnostics: MolangDiagnostic[] = [];

  constructor(
    private readonly source: string,
    private readonly tokens: MolangToken[]
  ) {}

  private current(): MolangToken {
    return this.tokens[this.index] ?? this.tokens[this.tokens.length - 1];
  }

  private previous(): MolangToken {
    return this.tokens[Math.max(0, this.index - 1)];
  }

  private advance(): MolangToken {
    const current = this.current();
    if (current.kind !== "eof") this.index++;
    return current;
  }

  private match(kind: MolangTokenKind): boolean {
    if (this.current().kind !== kind) return false;
    this.advance();
    return true;
  }

  private error(token: MolangToken, code: string, message: string): void {
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      range: {
        start: token.start,
        end: Math.max(token.end, token.start + 1),
        line: token.line,
        column: token.column,
      },
      source: "parser",
    });
  }

  private expect(kind: MolangTokenKind, message: string): MolangToken | null {
    if (this.current().kind === kind) return this.advance();
    this.error(this.current(), "MOLANG_EXPECTED_TOKEN", message);
    return null;
  }

  parseProgram(): MolangProgram {
    const body: MolangExpression[] = [];
    while (this.current().kind !== "eof") {
      if (this.match(";")) continue;
      const startIndex = this.index;
      const expression = this.parseExpression(0);
      if (expression) body.push(expression);

      if (this.current().kind === ";") {
        this.advance();
      } else if (this.current().kind !== "eof") {
        this.error(
          this.current(),
          "MOLANG_MISSING_SEMICOLON",
          `Expected a semicolon before '${this.current().raw || "end of expression"}'.`
        );
        this.synchronize();
      }
      if (this.index === startIndex) this.advance();
    }

    const first = body[0];
    const end = body[body.length - 1]?.end ?? 0;
    return {
      type: "Program",
      body,
      start: first?.start ?? 0,
      end,
      line: first?.line ?? 1,
      column: first?.column ?? 1,
    };
  }

  private synchronize(): void {
    while (this.current().kind !== "eof" && this.current().kind !== ";" && this.current().kind !== "}") {
      this.advance();
    }
    if (this.current().kind === ";") this.advance();
  }

  private parseExpression(minimumPrecedence: number): MolangExpression | null {
    let left = this.parsePrefix();
    if (!left) return null;
    left = this.parsePostfix(left);

    while (true) {
      const current = this.current();

      if (current.kind === "?" && CONDITIONAL_PRECEDENCE > minimumPrecedence) {
        this.advance();
        const consequent = this.parseExpression(CONDITIONAL_PRECEDENCE);
        if (!consequent) return left;
        if (this.match(":")) {
          const alternate = this.parseExpression(CONDITIONAL_PRECEDENCE - 1);
          if (!alternate) return left;
          left = {
            type: "ConditionalExpression",
            test: left,
            consequent,
            alternate,
            start: left.start,
            end: alternate.end,
            line: left.line,
            column: left.column,
          };
        } else {
          left = {
            type: "BinaryExpression",
            operator: "?",
            left,
            right: consequent,
            start: left.start,
            end: consequent.end,
            line: left.line,
            column: left.column,
          };
        }
        continue;
      }

      let operator = current.kind;
      let precedence = BINARY_PRECEDENCE[operator];
      let implicitMultiplication = false;
      if (operator === "(" && !canBeCalled(left)) {
        operator = "*";
        precedence = BINARY_PRECEDENCE["*"];
        implicitMultiplication = true;
      }
      if (precedence === undefined || precedence <= minimumPrecedence) break;

      if (!implicitMultiplication) this.advance();
      const right = this.parseExpression(precedence);
      if (!right) {
        this.error(current, "MOLANG_MISSING_OPERAND", `Expected an expression after '${current.raw}'.`);
        break;
      }
      left = {
        type: "BinaryExpression",
        operator: operator as MolangBinaryExpression["operator"],
        left,
        right,
        start: left.start,
        end: right.end,
        line: left.line,
        column: left.column,
      };
      left = this.parsePostfix(left);
    }
    return left;
  }

  private parsePrefix(): MolangExpression | null {
    const current = this.advance();
    switch (current.kind) {
      case "number":
        return {
          type: "NumberLiteral",
          value: typeof current.value === "number" ? current.value : 0,
          raw: current.raw,
          start: current.start,
          end: current.end,
          line: current.line,
          column: current.column,
        };
      case "string":
        return {
          type: "StringLiteral",
          value: String(current.value ?? ""),
          raw: current.raw,
          start: current.start,
          end: current.end,
          line: current.line,
          column: current.column,
        };
      case "true":
      case "false":
        return {
          type: "NumberLiteral",
          value: current.kind === "true" ? 1 : 0,
          raw: current.raw,
          start: current.start,
          end: current.end,
          line: current.line,
          column: current.column,
        };
      case "identifier":
        return {
          type: "Identifier",
          name: String(current.value),
          start: current.start,
          end: current.end,
          line: current.line,
          column: current.column,
        };
      case "+":
      case "-":
      case "!":
      case "return": {
        const argument = this.parseExpression(current.kind === "return" ? -1 : UNARY_PRECEDENCE);
        if (!argument) {
          this.error(current, "MOLANG_MISSING_UNARY_OPERAND", `Expected an expression after '${current.raw}'.`);
          return null;
        }
        return {
          type: "UnaryExpression",
          operator: current.kind,
          argument,
          start: current.start,
          end: argument.end,
          line: current.line,
          column: current.column,
        };
      }
      case "break":
      case "continue":
        return {
          type: "StatementExpression",
          statement: current.kind,
          start: current.start,
          end: current.end,
          line: current.line,
          column: current.column,
        };
      case "(": {
        const expression = this.parseExpression(0);
        const close = this.expect(")", "Expected ')' to close the parenthesized expression.");
        if (expression && close) expression.end = close.end;
        return expression;
      }
      case "{":
        return this.parseScope(current);
      case "error":
        this.error(current, "MOLANG_INVALID_TOKEN", String(current.value ?? "Invalid token."));
        return null;
      default:
        this.error(current, "MOLANG_EXPECTED_EXPRESSION", `Expected an expression, found '${current.raw || "end"}'.`);
        return null;
    }
  }

  private parseScope(open: MolangToken): MolangExpression {
    const body: MolangExpression[] = [];
    while (this.current().kind !== "}" && this.current().kind !== "eof") {
      if (this.match(";")) continue;
      const expression = this.parseExpression(0);
      if (expression) body.push(expression);
      if (this.current().kind === ";") {
        this.advance();
      } else if (this.current().kind !== "}") {
        this.error(this.current(), "MOLANG_MISSING_SEMICOLON", "Expected ';' between scope expressions.");
        this.synchronize();
      }
    }
    const close = this.expect("}", "Expected '}' to close the execution scope.");
    return {
      type: "ScopeExpression",
      body,
      start: open.start,
      end: close?.end ?? this.previous().end,
      line: open.line,
      column: open.column,
    };
  }

  private parsePostfix(initial: MolangExpression): MolangExpression {
    let expression = initial;
    while (true) {
      if (this.match(".")) {
        const property = this.expect("identifier", "Expected a field name after '.'.");
        if (!property) break;
        expression = {
          type: "MemberExpression",
          object: expression,
          property: String(property.value),
          start: expression.start,
          end: property.end,
          line: expression.line,
          column: expression.column,
        };
        continue;
      }
      if (this.match("[")) {
        const index = this.parseExpression(0);
        const close = this.expect("]", "Expected ']' after an array index.");
        if (!index) break;
        expression = {
          type: "IndexExpression",
          object: expression,
          index,
          start: expression.start,
          end: close?.end ?? index.end,
          line: expression.line,
          column: expression.column,
        };
        continue;
      }
      if (this.current().kind === "(" && canBeCalled(expression)) {
        this.advance();
        const args: MolangExpression[] = [];
        if (this.current().kind !== ")") {
          while (true) {
            const argument = this.parseExpression(0);
            if (argument) args.push(argument);
            if (!this.match(",")) break;
          }
        }
        const close = this.expect(")", "Expected ')' after function arguments.");
        expression = {
          type: "CallExpression",
          callee: expression,
          arguments: args,
          start: expression.start,
          end: close?.end ?? args[args.length - 1]?.end ?? expression.end,
          line: expression.line,
          column: expression.column,
        };
        continue;
      }
      break;
    }
    return expression;
  }
}

export function parseMolang(source: string): MolangParseResult {
  const lexed = lexMolang(source);
  const parser = new Parser(source, lexed.tokens);
  const ast = parser.parseProgram();
  const diagnostics = [...lexed.diagnostics, ...parser.diagnostics];
  return {
    source,
    tokens: lexed.tokens,
    ast: diagnostics.some((item) => item.severity === "error") ? null : ast,
    diagnostics,
  };
}
