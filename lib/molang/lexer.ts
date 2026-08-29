import type {
  MolangDiagnostic,
  MolangRange,
  MolangToken,
  MolangTokenKind,
} from "@/lib/molang/types";

const KEYWORDS: Record<string, MolangTokenKind> = {
  true: "true",
  false: "false",
  break: "break",
  continue: "continue",
  return: "return",
};

const TWO_CHARACTER_TOKENS: Record<string, MolangTokenKind> = {
  "&&": "&&",
  "||": "||",
  "<=": "<=",
  ">=": ">=",
  "==": "==",
  "!=": "!=",
  "??": "??",
  "->": "->",
};

const SINGLE_CHARACTER_TOKENS = new Set<MolangTokenKind>([
  ".", "!", "<", ">", "=", "*", "/", "+", "-", "?", ":",
  "[", "]", ",", ";", "(", ")", "{", "}",
]);

function position(source: string, offset: number): Pick<MolangRange, "line" | "column"> {
  let line = 1;
  let column = 1;
  for (let index = 0; index < offset; index++) {
    if (source.charCodeAt(index) === 10) {
      line++;
      column = 1;
    } else {
      column++;
    }
  }
  return { line, column };
}
function token(
  source: string,
  kind: MolangTokenKind,
  start: number,
  end: number,
  value?: string | number
): MolangToken {
  return {
    kind,
    raw: source.slice(start, end),
    value,
    start,
    end,
    ...position(source, start),
  };
}

function diagnostic(source: string, start: number, end: number, message: string): MolangDiagnostic {
  return {
    code: "MOLANG_LEXER_ERROR",
    severity: "error",
    message,
    range: { start, end, ...position(source, start) },
    source: "lexer",
  };
}

function isWordStart(character: string): boolean {
  return /[A-Za-z_]/.test(character);
}

function isWordContinuation(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

export function lexMolang(source: string): {
  tokens: MolangToken[];
  diagnostics: MolangDiagnostic[];
} {
  const tokens: MolangToken[] = [];
  const diagnostics: MolangDiagnostic[] = [];
  let offset = 0;
  let previousKind: MolangTokenKind | null = null;

  while (offset < source.length) {
    const character = source[offset];
    if (/\s/.test(character)) {
      offset++;
      continue;
    }

    const start = offset;
    const pair = source.slice(offset, offset + 2);
    const pairKind = TWO_CHARACTER_TOKENS[pair];
    if (pairKind) {
      offset += 2;
      tokens.push(token(source, pairKind, start, offset));
      previousKind = pairKind;
      continue;
    }

    if (character === "&" || character === "|") {
      offset++;
      const message = `Unexpected '${character}'. Molang supports only '${character}${character}'.`;
      tokens.push(token(source, "error", start, offset, message));
      diagnostics.push(diagnostic(source, start, offset, message));
      previousKind = "error";
      continue;
    }

    const mayStartFraction = character === "." && previousKind !== "identifier" && previousKind !== ")";
    if (/[0-9]/.test(character) || mayStartFraction) {
      if (mayStartFraction && !/[0-9]/.test(source[offset + 1] ?? "")) {
        offset++;
        tokens.push(token(source, ".", start, offset));
        previousKind = ".";
        continue;
      }
      while (/[0-9]/.test(source[offset] ?? "")) offset++;
      if (source[offset] === ".") {
        offset++;
        while (/[0-9]/.test(source[offset] ?? "")) offset++;
      }
      const raw = source.slice(start, offset);
      const parsed = Number(raw.startsWith(".") ? `0${raw}` : raw);
      tokens.push(token(source, "number", start, offset, Number.isFinite(parsed) ? parsed : 0));
      previousKind = "number";
      continue;
    }

    if (isWordStart(character)) {
      offset++;
      while (isWordContinuation(source[offset] ?? "")) offset++;
      const raw = source.slice(start, offset);
      const value = raw.toLowerCase();
      const kind = KEYWORDS[value] ?? "identifier";
      tokens.push(token(source, kind, start, offset, kind === "identifier" ? value : undefined));
      previousKind = kind;
      continue;
    }

    if (character === "'") {
      offset++;
      const valueStart = offset;
      while (offset < source.length && source[offset] !== "'") offset++;
      if (offset >= source.length) {
        const message = "Found end-of-expression before the closing single quote.";
        tokens.push(token(source, "error", start, offset, message));
        diagnostics.push(diagnostic(source, start, offset, message));
        previousKind = "error";
        continue;
      }
      const value = source.slice(valueStart, offset);
      offset++;
      tokens.push(token(source, "string", start, offset, value));
      previousKind = "string";
      continue;
    }

    if (SINGLE_CHARACTER_TOKENS.has(character as MolangTokenKind)) {
      offset++;
      const kind = character as MolangTokenKind;
      tokens.push(token(source, kind, start, offset));
      previousKind = kind;
      continue;
    }

    offset++;
    const message = `Unexpected token '${character}'.`;
    tokens.push(token(source, "error", start, offset, message));
    diagnostics.push(diagnostic(source, start, offset, message));
    previousKind = "error";
  }

  tokens.push(token(source, "eof", source.length, source.length));
  return { tokens, diagnostics };
}
