import catalogData from "@/lib/molang/catalog.generated.json";
import type {
  MolangCatalogEntry,
  MolangDiagnostic,
  MolangDialect,
  MolangExpression,
  MolangParseResult,
} from "@/lib/molang/types";

interface GeneratedCatalog {
  schema_version: number;
  generated_from: {
    stable: {
      declared_version: string;
      commit: null;
      root_digest: string;
      files: Array<{ path: string; sha256: string }>;
    };
    dev: {
      declared_version: string;
      commit: null;
      root_digest: string;
      files: Array<{ path: string; sha256: string }>;
    };
  };
  stable_keys: string[];
  entries: MolangCatalogEntry[];
}

const CATALOG = catalogData as GeneratedCatalog;
const STABLE_KEYS = new Set(CATALOG.stable_keys);
const ENTRIES = new Map(
  CATALOG.entries.map((entry) => [`${entry.namespace}.${entry.name}`, entry])
);
const KNOWN_NAMESPACES = new Set(
  CATALOG.entries
    .filter((entry) => entry.namespace === "root" && entry.kind === "namespace")
    .map((entry) => entry.name)
);
const DYNAMIC_NAMESPACES = new Set(["variable", "temp", "context", "args", "fn"]);

const ARGUMENT_COUNTS: Record<string, [number, number | null]> = {
  loop: [2, 2],
  for_each: [3, 3],
  "math.floor": [1, 1], "math.round": [1, 1], "math.ceil": [1, 1], "math.trunc": [1, 1],
  "math.clamp": [3, 3], "math.max": [2, 2], "math.min": [2, 2],
  "math.abs": [1, 1], "math.exp": [1, 1], "math.ln": [1, 1], "math.sqrt": [1, 1],
  "math.mod": [2, 2], "math.pow": [2, 2], "math.sin": [1, 1], "math.cos": [1, 1],
  "math.acos": [1, 1], "math.asin": [1, 1], "math.atan": [1, 1], "math.atan2": [2, 2],
  "math.lerp": [3, 3], "math.lerprotate": [3, 3], "math.random": [2, 3],
  "math.random_integer": [2, 2], "math.randomi": [2, 2], "math.die_roll": [3, 3],
  "math.roll": [3, 3], "math.die_roll_integer": [3, 3], "math.rolli": [3, 3],
  "math.hermite_blend": [1, 1], "math.hermite": [1, 1], "math.min_angle": [1, 1],
  "ysm.first_order": [2, null], "ysm.second_order": [2, null],
};

function pathOf(expression: MolangExpression): string | null {
  if (expression.type === "Identifier") {
    if (expression.name === "q") return "query";
    if (expression.name === "v") return "variable";
    if (expression.name === "t") return "temp";
    if (expression.name === "c") return "context";
    return expression.name;
  }
  if (expression.type === "MemberExpression") {
    const parent = pathOf(expression.object);
    return parent ? `${parent}.${expression.property}` : null;
  }
  return null;
}

function walk(
  expression: MolangExpression,
  visit: (node: MolangExpression, parent: MolangExpression | null) => void,
  parent: MolangExpression | null = null
): void {
  visit(expression, parent);
  switch (expression.type) {
    case "UnaryExpression": walk(expression.argument, visit, expression); break;
    case "BinaryExpression": walk(expression.left, visit, expression); walk(expression.right, visit, expression); break;
    case "ConditionalExpression":
      walk(expression.test, visit, expression);
      walk(expression.consequent, visit, expression);
      walk(expression.alternate, visit, expression);
      break;
    case "MemberExpression": walk(expression.object, visit, expression); break;
    case "IndexExpression":
      walk(expression.object, visit, expression);
      walk(expression.index, visit, expression);
      break;
    case "CallExpression":
      walk(expression.callee, visit, expression);
      expression.arguments.forEach((argument) => walk(argument, visit, expression));
      break;
    case "ScopeExpression": expression.body.forEach((child) => walk(child, visit, expression)); break;
  }
}

function semanticDiagnostic(
  expression: MolangExpression,
  code: string,
  severity: MolangDiagnostic["severity"],
  message: string
): MolangDiagnostic {
  return {
    code,
    severity,
    message,
    range: {
      start: expression.start,
      end: expression.end,
      line: expression.line,
      column: expression.column,
    },
    source: "semantic",
  };
}

export function getMolangCatalogMetadata(): GeneratedCatalog["generated_from"] {
  return CATALOG.generated_from;
}

export function listMolangCatalog(
  dialect: MolangDialect,
  namespace?: string
): MolangCatalogEntry[] {
  return CATALOG.entries
    .filter((entry) => dialect === "dev_3_0_experimental" || STABLE_KEYS.has(`${entry.namespace}.${entry.name}`))
    .filter((entry) => !namespace || entry.namespace === namespace)
    .map((entry) => {
      const counts = ARGUMENT_COUNTS[entry.namespace === "root" ? entry.name : `${entry.namespace}.${entry.name}`];
      return counts
        ? { ...entry, minimum_arguments: counts[0], maximum_arguments: counts[1] }
        : entry;
    });
}

export interface MolangSemanticEnvironment {
  report_runtime_availability?: boolean;
  available_binding_paths?: Iterable<string>;
  available_function_results?: Iterable<string>;
  available_user_functions?: Iterable<string>;
}

function normalizedPaths(values: Iterable<string> | undefined): Set<string> {
  return new Set([...values ?? []].map((value) => {
    const [root, ...rest] = value.toLowerCase().split(".");
    return [pathOf({
      type: "Identifier",
      name: root,
      start: 0,
      end: 0,
      line: 1,
      column: 1,
    }) ?? root, ...rest].join(".");
  }));
}

function catalogEntryForPath(path: string): MolangCatalogEntry | undefined {
  const [namespace, name] = path.split(".");
  return name ? ENTRIES.get(`${namespace}.${name}`) : ENTRIES.get(`root.${namespace}`);
}

function validateControlFlow(
  expression: MolangExpression,
  dialect: MolangDialect,
  diagnostics: MolangDiagnostic[],
  loopDepth = 0
): void {
  if (expression.type === "StatementExpression" && loopDepth === 0) {
    diagnostics.push(semanticDiagnostic(
      expression,
      "MOLANG_INVALID_CONTROL_FLOW",
      "error",
      `'${expression.statement}' can only be used inside a loop or for_each execution scope.`
    ));
    return;
  }

  if (expression.type === "CallExpression") {
    const path = pathOf(expression.callee);
    let executionScopeIndex = -1;
    if (path === "loop") {
      executionScopeIndex = 1;
      if (expression.arguments[1]?.type !== "ScopeExpression") {
        diagnostics.push(semanticDiagnostic(
          expression.arguments[1] ?? expression,
          "MOLANG_INVALID_LOOP_SCOPE",
          "error",
          "loop's second argument must be an execution scope enclosed in braces."
        ));
      }
    } else if (path === "for_each") {
      executionScopeIndex = 2;
      const targetExpression = expression.arguments[0];
      const target = targetExpression ? pathOf(targetExpression) : null;
      const root = target?.split(".")[0];
      const mutable = root === "variable"
        || root === "temp"
        || (root === "context" && dialect === "dev_3_0_experimental");
      if (!target || !mutable) {
        diagnostics.push(semanticDiagnostic(
          targetExpression ?? expression,
          "MOLANG_INVALID_FOR_EACH_TARGET",
          "error",
          "for_each's first argument must be a mutable variable or temp path."
        ));
      }
      if (expression.arguments[2]?.type !== "ScopeExpression") {
        diagnostics.push(semanticDiagnostic(
          expression.arguments[2] ?? expression,
          "MOLANG_INVALID_FOR_EACH_SCOPE",
          "error",
          "for_each's third argument must be an execution scope enclosed in braces."
        ));
      }
    }
    validateControlFlow(expression.callee, dialect, diagnostics, loopDepth);
    expression.arguments.forEach((argument, index) =>
      validateControlFlow(
        argument,
        dialect,
        diagnostics,
        index === executionScopeIndex && argument.type === "ScopeExpression"
          ? loopDepth + 1
          : loopDepth
      )
    );
    return;
  }

  switch (expression.type) {
    case "UnaryExpression":
      validateControlFlow(expression.argument, dialect, diagnostics, loopDepth);
      break;
    case "BinaryExpression":
      validateControlFlow(expression.left, dialect, diagnostics, loopDepth);
      validateControlFlow(expression.right, dialect, diagnostics, loopDepth);
      break;
    case "ConditionalExpression":
      validateControlFlow(expression.test, dialect, diagnostics, loopDepth);
      validateControlFlow(expression.consequent, dialect, diagnostics, loopDepth);
      validateControlFlow(expression.alternate, dialect, diagnostics, loopDepth);
      break;
    case "MemberExpression":
      validateControlFlow(expression.object, dialect, diagnostics, loopDepth);
      break;
    case "IndexExpression":
      validateControlFlow(expression.object, dialect, diagnostics, loopDepth);
      validateControlFlow(expression.index, dialect, diagnostics, loopDepth);
      break;
    case "ScopeExpression":
      expression.body.forEach((child) => validateControlFlow(child, dialect, diagnostics, loopDepth));
      break;
  }
}

export function validateMolangSemantics(
  parsed: MolangParseResult,
  dialect: MolangDialect = "stable_2_6_5",
  environment: MolangSemanticEnvironment = {}
): MolangDiagnostic[] {
  if (!parsed.ast) return [...parsed.diagnostics];
  const diagnostics = [...parsed.diagnostics];
  const availableBindings = normalizedPaths(environment.available_binding_paths);
  const availableFunctions = normalizedPaths(environment.available_function_results);
  const availableUserFunctions = new Set(
    [...environment.available_user_functions ?? []].map((name) => name.toLowerCase().replace(/^fn\./, ""))
  );

  const checkCatalogEntry = (node: MolangExpression, path: string, entry: MolangCatalogEntry): void => {
    if (entry.experimental && dialect === "stable_2_6_5") {
      diagnostics.push(semanticDiagnostic(
        node,
        "MOLANG_EXPERIMENTAL_SYMBOL",
        "error",
        `'${path}' is present only in the audited 3.0-dev source line.`
      ));
    } else if (entry.experimental) {
      diagnostics.push(semanticDiagnostic(
        node,
        "MOLANG_EXPERIMENTAL_SYMBOL",
        "warning",
        `'${path}' is an experimental 3.0-dev symbol and has no stable evaluator guarantee.`
      ));
    }
  };

  for (const expression of parsed.ast.body) {
    validateControlFlow(expression, dialect, diagnostics);
    walk(expression, (node, parent) => {
      if (node.type === "BinaryExpression" && node.operator === "=") {
        const target = pathOf(node.left);
        if (!target) {
          diagnostics.push(semanticDiagnostic(
            node.left,
            "MOLANG_INVALID_ASSIGNMENT_TARGET",
            "error",
            "Assignment target must be a named variable path."
          ));
        } else {
          const root = target.split(".")[0];
          const mutable = root === "variable"
            || root === "temp"
            || (root === "context" && dialect === "dev_3_0_experimental");
          if (!mutable) {
            diagnostics.push(semanticDiagnostic(
              node.left,
              "MOLANG_READ_ONLY_ASSIGNMENT",
              "error",
              `Cannot assign to read-only Molang path '${target}'.`
            ));
          }
        }
      }

      if (node.type === "CallExpression") {
        const path = pathOf(node.callee);
        if (!path) {
          diagnostics.push(semanticDiagnostic(node, "MOLANG_INVALID_CALL", "error", "Only named Molang functions can be called."));
          return;
        }
        if (path.startsWith("fn.")) {
          const name = path.slice(3).toLowerCase();
          if (environment.report_runtime_availability && !availableUserFunctions.has(name)) {
            diagnostics.push(semanticDiagnostic(
              node,
              "MOLANG_USER_FUNCTION_REQUIRED",
              "warning",
              `User function '${path}' must be supplied before standalone evaluation.`
            ));
          }
          return;
        }
        const key = path.includes(".") ? path : `root.${path}`;
        const entry = ENTRIES.get(key);
        if (!entry || entry.kind !== "function") {
          diagnostics.push(semanticDiagnostic(node, "MOLANG_UNKNOWN_FUNCTION", "error", `Unknown function '${path}'.`));
          return;
        }
        checkCatalogEntry(node, path, entry);
        if (
          environment.report_runtime_availability
          && entry.runtime_only
          && !availableFunctions.has(path)
        ) {
          diagnostics.push(semanticDiagnostic(
            node,
            "MOLANG_RUNTIME_FUNCTION_REQUIRED",
            "warning",
            `'${path}' requires an OpenYSM runtime implementation or an explicit function result.`
          ));
        }
        const counts = ARGUMENT_COUNTS[path];
        if (counts && (node.arguments.length < counts[0] || (counts[1] !== null && node.arguments.length > counts[1]))) {
          diagnostics.push(semanticDiagnostic(
            node,
            "MOLANG_ARGUMENT_COUNT",
            "error",
            `'${path}' expects ${counts[1] === null ? `at least ${counts[0]}` : counts[0] === counts[1] ? counts[0] : `${counts[0]}-${counts[1]}`} argument(s), received ${node.arguments.length}.`
          ));
        }
        return;
      }

      if (node.type === "Identifier") {
        if (parent?.type === "MemberExpression" || parent?.type === "CallExpression") return;
        const path = pathOf(node)!;
        if (!KNOWN_NAMESPACES.has(path) && !ENTRIES.has(`root.${path}`)) {
          diagnostics.push(semanticDiagnostic(node, "MOLANG_UNKNOWN_IDENTIFIER", "error", `Unknown identifier '${path}'.`));
        }
        return;
      }

      if (node.type !== "MemberExpression") return;
      if (parent?.type === "MemberExpression" && parent.object === node) return;
      if (parent?.type === "CallExpression" && parent.callee === node) return;
      const path = pathOf(node);
      if (!path) return;
      const [namespace] = path.split(".");
      if (!KNOWN_NAMESPACES.has(namespace)) {
        diagnostics.push(semanticDiagnostic(
          node,
          "MOLANG_UNKNOWN_NAMESPACE",
          "error",
          `Unknown Molang namespace '${namespace}'.`
        ));
        return;
      }
      if (DYNAMIC_NAMESPACES.has(namespace)) return;
      const entry = catalogEntryForPath(path);
      if (!entry || entry.kind === "namespace") {
        diagnostics.push(semanticDiagnostic(node, "MOLANG_UNKNOWN_SYMBOL", "error", `Unknown Molang symbol '${path}'.`));
        return;
      }
      checkCatalogEntry(node, path, entry);
      if (
        environment.report_runtime_availability
        && entry.runtime_only
        && !availableBindings.has(path)
      ) {
        diagnostics.push(semanticDiagnostic(
          node,
          "MOLANG_RUNTIME_VALUE_REQUIRED",
          "warning",
          `'${path}' requires a caller-supplied runtime binding for standalone evaluation.`
        ));
      }
    });
  }
  return diagnostics;
}
