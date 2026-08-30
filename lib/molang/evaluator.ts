import { parseMolang } from "@/lib/molang/parser";
import type {
  MolangDiagnostic,
  MolangDialect,
  MolangExpression,
  MolangParseResult,
  MolangProgram,
  MolangValue,
} from "@/lib/molang/types";

export interface FirstOrderState {
  kind: "first_order";
  input: number;
  response: number;
  last_simulation: number;
}

export interface SecondOrderState {
  kind: "second_order";
  input: number;
  frequency: number;
  coefficient: number;
  response: number;
  input_function: number;
  last_simulation: number;
  last_simulation_dot: number;
}

export type MolangPhysicsState = FirstOrderState | SecondOrderState;

export interface MolangEvaluatorState {
  variables: Record<string, MolangValue>;
  temp: Record<string, MolangValue>;
  physics: Record<string, MolangPhysicsState>;
  random_state: number;
}

export interface MolangEvaluationOptions {
  dialect?: MolangDialect;
  bindings?: Record<string, MolangValue>;
  variables?: Record<string, MolangValue>;
  temp?: Record<string, MolangValue>;
  context?: Record<string, MolangValue>;
  function_results?: Record<string, MolangValue>;
  user_functions?: Record<string, string | MolangProgram>;
  initial_state?: Partial<MolangEvaluatorState>;
  seed?: number;
  delta_seconds?: number;
}

export interface MolangEvaluationResult {
  value: MolangValue;
  diagnostics: MolangDiagnostic[];
  state: MolangEvaluatorState;
}

interface ReturnSignal {
  signal: "return";
  value: MolangValue;
}

interface LoopSignal {
  signal: "break" | "continue";
}

type InternalValue = MolangValue | ReturnSignal | LoopSignal;

interface Environment {
  dialect: MolangDialect;
  roots: Record<string, MolangValue>;
  functionResults: Record<string, MolangValue>;
  userFunctions: Record<string, MolangProgram>;
  diagnostics: MolangDiagnostic[];
  state: MolangEvaluatorState;
  deltaSeconds: number;
  callDepth: number;
  remainingOperations: number;
  operationLimitReported: boolean;
}

const MAX_CALL_DEPTH = 64;
const MAX_LOOP_ROUNDS = 1024;
const MAX_EVALUATION_OPERATIONS = 100_000;

function isSignal(value: InternalValue): value is ReturnSignal | LoopSignal {
  return typeof value === "object" && value !== null && "signal" in value;
}

function finite(value: number): number {
  return Number.isFinite(value) && !Number.isNaN(value) ? value : 0;
}

function asNumber(value: InternalValue): number {
  if (isSignal(value) || value === null) return 0;
  if (typeof value === "number") return finite(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  return 1;
}

function asInteger(value: InternalValue): number {
  return Math.trunc(asNumber(value));
}

function asBoolean(value: InternalValue): boolean {
  if (isSignal(value) || value === null) return false;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  return true;
}

function asString(value: InternalValue): string | null {
  return typeof value === "string" ? value : null;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneValue(item)])
    ) as T;
  }
  return value;
}

function normalizeRoot(name: string): string {
  if (name === "q") return "query";
  if (name === "v") return "variable";
  if (name === "t") return "temp";
  if (name === "c") return "context";
  return name;
}

function normalizeBindingValue(value: MolangValue): MolangValue {
  if (Array.isArray(value)) return value.map(normalizeBindingValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key.toLowerCase(),
        normalizeBindingValue(child),
      ])
    );
  }
  return value;
}

export function normalizeMolangBindings(
  bindings: Record<string, MolangValue>
): Record<string, MolangValue> {
  const normalized: Record<string, MolangValue> = {};
  const entries = Object.entries(bindings);

  for (const [name, value] of entries.filter(([name]) => !name.includes("."))) {
    normalized[normalizeRoot(name.toLowerCase())] = normalizeBindingValue(value);
  }
  for (const [name, value] of entries.filter(([name]) => name.includes("."))) {
    const segments = name.toLowerCase().split(".");
    segments[0] = normalizeRoot(segments[0]);
    let current = normalized;
    for (const segment of segments.slice(0, -1)) {
      const existing = current[segment];
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        current[segment] = {};
      }
      current = current[segment] as Record<string, MolangValue>;
    }
    current[segments[segments.length - 1]] = normalizeBindingValue(value);
  }
  return normalized;
}

function expressionPath(expression: MolangExpression): string | null {
  if (expression.type === "Identifier") return normalizeRoot(expression.name);
  if (expression.type === "MemberExpression") {
    const parent = expressionPath(expression.object);
    return parent ? `${parent}.${expression.property}` : null;
  }
  return null;
}

function diagnostic(
  environment: Environment,
  expression: MolangExpression,
  code: string,
  message: string,
  severity: MolangDiagnostic["severity"] = "error"
): void {
  environment.diagnostics.push({
    code,
    severity,
    message,
    range: {
      start: expression.start,
      end: expression.end,
      line: expression.line,
      column: expression.column,
    },
    source: "runtime",
  });
}

function consumeOperation(environment: Environment, expression: MolangExpression): boolean {
  if (environment.remainingOperations > 0) {
    environment.remainingOperations--;
    return true;
  }
  if (!environment.operationLimitReported) {
    environment.operationLimitReported = true;
    diagnostic(
      environment,
      expression,
      "MOLANG_OPERATION_LIMIT",
      `Standalone evaluation exceeded the ${MAX_EVALUATION_OPERATIONS}-operation safety limit.`
    );
  }
  return false;
}

function readPath(roots: Record<string, MolangValue>, path: string): MolangValue {
  const segments = path.split(".");
  let current: MolangValue = roots[normalizeRoot(segments[0])] ?? null;
  for (const segment of segments.slice(1)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = current[segment] ?? null;
  }
  return current;
}

function assignPath(environment: Environment, path: string, value: MolangValue): boolean {
  const segments = path.split(".");
  const root = normalizeRoot(segments[0]);
  const mutable = root === "variable"
    || root === "temp"
    || (root === "context" && environment.dialect === "dev_3_0_experimental");
  if (!mutable) return false;
  if (segments.length === 1) {
    environment.roots[root] = cloneValue(value);
    return true;
  }
  const existing = environment.roots[root];
  let current: Record<string, MolangValue> = existing
    && typeof existing === "object"
    && !Array.isArray(existing)
    ? existing
    : {};
  environment.roots[root] = current;
  for (let index = 1; index < segments.length - 1; index++) {
    const segment = segments[index];
    const candidate = current[segment];
    let next: Record<string, MolangValue>;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      next = {};
      current[segment] = next;
    } else {
      next = candidate;
    }
    current = next;
  }
  current[segments[segments.length - 1]] = cloneValue(value);
  return true;
}

function updateFirstOrder(state: FirstOrderState, timeStep: number): void {
  if (timeStep <= 0) return;
  if (state.response === 0) {
    state.last_simulation = state.input;
    return;
  }
  state.last_simulation =
    (1 - timeStep / state.response) * state.last_simulation
    + (timeStep / state.response) * state.input;
}

function updateSecondOrder(state: SecondOrderState, timeStep: number): void {
  if (timeStep <= 0) return;
  const frequency = Math.min(5, Math.max(0, state.frequency));
  const coefficient = Math.min(1, Math.max(0, state.coefficient));
  if (frequency === 0) {
    state.last_simulation = state.input;
    state.last_simulation_dot = 0;
    state.input_function = state.input;
    return;
  }
  const k1 = coefficient / Math.PI / frequency;
  const denominator = 2 * Math.PI * frequency;
  const k2 = 1 / denominator / denominator;
  const k3 = state.response * coefficient / 2 / Math.PI / frequency;
  const inputFunctionDot = (state.input - state.input_function) / timeStep;
  state.input_function = state.input;
  const maxTimeStep = Math.sqrt(4 * k2 + k1 * k1) - k1;
  const cycles = Math.max(1, Math.ceil(timeStep / Math.max(maxTimeStep, Number.EPSILON)));
  const step = timeStep / cycles;
  for (let cycle = 0; cycle < cycles; cycle++) {
    state.last_simulation += step * state.last_simulation_dot;
    state.last_simulation_dot += step * (
      k3 * inputFunctionDot
      + state.input
      - state.last_simulation
      - k1 * state.last_simulation_dot
    ) / k2;
  }
}

function advancePhysics(state: MolangEvaluatorState, timeStep: number): void {
  for (const physics of Object.values(state.physics)) {
    if (physics.kind === "first_order") updateFirstOrder(physics, timeStep);
    else updateSecondOrder(physics, timeStep);
  }
}

function random(environment: Environment): number {
  let value = environment.state.random_state >>> 0;
  value += 0x6d2b79f5;
  environment.state.random_state = value >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function rangeRandom(environment: Environment, minimum: number, maximum: number): number {
  let low = minimum;
  let high = maximum;
  if (low > high) [low, high] = [high, low];
  return low + random(environment) * (high - low);
}

function wrapDegrees(value: number): number {
  let wrapped = value % 360;
  if (wrapped >= 180) wrapped -= 360;
  if (wrapped < -180) wrapped += 360;
  return wrapped;
}

function normalizeYaw(a: number, b: number): number {
  let difference = a - b;
  if (difference > 180 || difference < -180) {
    difference = Math.sign(difference || 1) * (360 - Math.abs(difference));
    return a + difference;
  }
  return b;
}

function evaluateMath(
  environment: Environment,
  path: string,
  args: InternalValue[],
  expression: MolangExpression
): InternalValue | undefined {
  const name = path.slice("math.".length);
  const values = args.map(asNumber);
  const requireCount = (...counts: number[]): boolean => {
    if (counts.includes(args.length)) return true;
    diagnostic(
      environment,
      expression,
      "MOLANG_ARGUMENT_COUNT",
      `${path} expects ${counts.join(" or ")} argument(s), received ${args.length}.`
    );
    return false;
  };

  switch (name) {
    case "floor": return requireCount(1) ? Math.floor(values[0]) : null;
    case "round": return requireCount(1) ? Math.floor(values[0] + 0.5) : null;
    case "ceil": return requireCount(1) ? Math.ceil(values[0]) : null;
    case "trunc": return requireCount(1) ? Math.trunc(values[0]) : null;
    case "clamp": return requireCount(3) ? Math.min(values[2], Math.max(values[1], values[0])) : null;
    case "max": return requireCount(2) ? Math.max(values[0], values[1]) : null;
    case "min": return requireCount(2) ? Math.min(values[0], values[1]) : null;
    case "abs": return requireCount(1) ? Math.abs(values[0]) : null;
    case "exp": return requireCount(1) ? finite(Math.exp(values[0])) : null;
    case "ln": return requireCount(1) ? finite(Math.log(values[0])) : null;
    case "sqrt": return requireCount(1) ? finite(Math.sqrt(values[0])) : null;
    case "mod": return requireCount(2) ? finite(values[0] % values[1]) : null;
    case "pow": return requireCount(2) ? finite(Math.pow(values[0], values[1])) : null;
    case "sin": return requireCount(1) ? Math.sin(values[0] / 180 * Math.PI) : null;
    case "cos": return requireCount(1) ? Math.cos(values[0] / 180 * Math.PI) : null;
    case "acos": return requireCount(1) ? finite(Math.acos(values[0])) : null;
    case "asin": return requireCount(1) ? finite(Math.asin(values[0])) : null;
    case "atan": return requireCount(1) ? finite(Math.atan(values[0])) : null;
    case "atan2": return requireCount(2) ? finite(Math.atan2(values[0], values[1])) : null;
    case "lerp": return requireCount(3) ? values[0] + (values[1] - values[0]) * values[2] : null;
    case "lerprotate": {
      if (!requireCount(3)) return null;
      const a = wrapDegrees(values[0]);
      const b = wrapDegrees(values[1]);
      return a + (normalizeYaw(a, b) - a) * values[2];
    }
    case "random": return requireCount(2, 3) ? rangeRandom(environment, values[0], values[1]) : null;
    case "random_integer":
    case "randomi": {
      if (!requireCount(2)) return null;
      const low = Math.trunc(Math.min(values[0], values[1]));
      const high = Math.trunc(Math.max(values[0], values[1]));
      return high === low ? low : low + Math.floor(random(environment) * (high - low));
    }
    case "die_roll":
    case "roll": {
      if (!requireCount(3)) return null;
      let total = 0;
      for (let count = Math.max(0, asInteger(args[0])); count > 0; count--) {
        if (!consumeOperation(environment, expression)) return null;
        total += rangeRandom(environment, values[1], values[2]);
      }
      return total;
    }
    case "die_roll_integer":
    case "rolli": {
      if (!requireCount(3)) return null;
      let total = 0;
      const low = Math.trunc(Math.min(values[1], values[2]));
      const high = Math.trunc(Math.max(values[1], values[2]));
      for (let count = Math.max(0, Math.floor(values[0] + 0.5)); count > 0; count--) {
        if (!consumeOperation(environment, expression)) return null;
        total += high === low ? low : low + Math.floor(random(environment) * (high - low));
      }
      return total;
    }
    case "hermite_blend":
    case "hermite": {
      if (!requireCount(1)) return null;
      const roundedUp = Math.ceil(values[0]);
      return Math.floor(3 * roundedUp ** 2 - 2 * roundedUp ** 3);
    }
    case "min_angle": return requireCount(1) ? wrapDegrees(values[0]) : null;
    default: return undefined;
  }
}

function evaluatePhysics(
  environment: Environment,
  path: string,
  args: InternalValue[],
  expression: MolangExpression
): InternalValue | undefined {
  if (path !== "ysm.first_order" && path !== "ysm.second_order") return undefined;
  if (args.length < 2) {
    diagnostic(environment, expression, "MOLANG_ARGUMENT_COUNT", `${path} requires at least two arguments.`);
    return null;
  }
  const name = asString(args[0]);
  if (!name) return 0;
  const input = asNumber(args[1]);
  const existing = environment.state.physics[name];
  if (path === "ysm.first_order") {
    const response = args.length >= 3 ? asNumber(args[2]) : 1;
    if (!existing || existing.kind !== "first_order") {
      environment.state.physics[name] = {
        kind: "first_order",
        input,
        response,
        last_simulation: 0,
      };
      return input;
    }
    existing.input = input;
    existing.response = response;
    return finite(existing.last_simulation);
  }

  const frequency = args.length >= 3 ? asNumber(args[2]) : 1;
  const coefficient = args.length >= 4 ? asNumber(args[3]) : 1;
  const response = args.length >= 5 ? asNumber(args[4]) : 1;
  if (!existing || existing.kind !== "second_order") {
    environment.state.physics[name] = {
      kind: "second_order",
      input,
      frequency: Math.min(5, Math.max(0, frequency)),
      coefficient: Math.min(1, Math.max(0, coefficient)),
      response,
      input_function: 0,
      last_simulation: 0,
      last_simulation_dot: 0,
    };
    return input;
  }
  existing.input = input;
  existing.frequency = frequency;
  existing.coefficient = coefficient;
  existing.response = response;
  return finite(existing.last_simulation);
}

function evaluateCall(expression: Extract<MolangExpression, { type: "CallExpression" }>, environment: Environment): InternalValue {
  const path = expressionPath(expression.callee);
  if (!path) {
    diagnostic(environment, expression, "MOLANG_INVALID_CALL", "Only named Molang functions can be called.");
    return null;
  }

  if (path === "loop") {
    if (expression.arguments.length < 2 || expression.arguments[1]?.type !== "ScopeExpression") {
      diagnostic(environment, expression, "MOLANG_INVALID_LOOP", "loop expects a count and an execution scope.");
      return null;
    }
    const count = Math.min(MAX_LOOP_ROUNDS, Math.max(0, Math.round(asNumber(evaluateExpression(expression.arguments[0], environment)))));
    for (let index = 0; index < count; index++) {
      const result = evaluateExpression(expression.arguments[1], environment);
      if (isSignal(result)) {
        if (result.signal === "return") return result;
        if (result.signal === "break") break;
      }
    }
    return null;
  }

  if (path === "for_each") {
    if (expression.arguments.length !== 3 || expression.arguments[2]?.type !== "ScopeExpression") {
      diagnostic(environment, expression, "MOLANG_INVALID_FOR_EACH", "for_each expects an assignable variable, an array, and an execution scope.");
      return null;
    }
    const target = expressionPath(expression.arguments[0]);
    const iterable = evaluateExpression(expression.arguments[1], environment);
    if (!target || !Array.isArray(iterable)) {
      diagnostic(environment, expression, "MOLANG_INVALID_FOR_EACH", "for_each requires an assignable variable and an array value.");
      return null;
    }
    for (const item of iterable) {
      if (!assignPath(environment, target, item)) {
        diagnostic(environment, expression.arguments[0], "MOLANG_READ_ONLY_ASSIGNMENT", `Cannot assign to '${target}'.`);
        return null;
      }
      const result = evaluateExpression(expression.arguments[2], environment);
      if (isSignal(result)) {
        if (result.signal === "return") return result;
        if (result.signal === "break") break;
      }
    }
    return null;
  }

  const args = expression.arguments.map((argument) => evaluateExpression(argument, environment));
  const signaled = args.find(isSignal);
  if (signaled) return signaled;

  if (path.startsWith("math.")) {
    const result = evaluateMath(environment, path, args, expression);
    if (result !== undefined) return result;
  }
  const physics = evaluatePhysics(environment, path, args, expression);
  if (physics !== undefined) return physics;

  if (path.startsWith("fn.")) {
    const functionName = path.slice(3);
    const program = environment.userFunctions[functionName];
    if (!program) {
      diagnostic(environment, expression, "MOLANG_UNKNOWN_USER_FUNCTION", `Unknown user function '${functionName}'.`);
      return null;
    }
    if (environment.callDepth >= MAX_CALL_DEPTH) {
      diagnostic(environment, expression, "MOLANG_CALL_DEPTH", `User function call depth exceeds ${MAX_CALL_DEPTH}.`);
      return null;
    }
    const previousArgs = environment.roots.args;
    environment.roots.args = args.map((value) => isSignal(value) ? null : value);
    environment.callDepth++;
    try {
      return evaluateProgram(program, environment);
    } finally {
      environment.callDepth--;
      environment.roots.args = previousArgs;
    }
  }

  if (Object.hasOwn(environment.functionResults, path)) {
    return cloneValue(environment.functionResults[path]);
  }

  diagnostic(
    environment,
    expression,
    "MOLANG_RUNTIME_BINDING_REQUIRED",
    `Function '${path}' depends on a runtime binding. Supply function_results.${path} to evaluate it.`,
    "warning"
  );
  return null;
}

function evaluateExpression(expression: MolangExpression, environment: Environment): InternalValue {
  if (!consumeOperation(environment, expression)) return { signal: "return", value: null };
  switch (expression.type) {
    case "NumberLiteral": return expression.value;
    case "StringLiteral": return expression.value;
    case "Identifier": {
      const root = normalizeRoot(expression.name);
      if (root === "math") return { pi: Math.PI, e: Math.E };
      if (Object.hasOwn(environment.roots, root)) return environment.roots[root];
      diagnostic(environment, expression, "MOLANG_UNKNOWN_IDENTIFIER", `Unknown identifier '${expression.name}'.`);
      return null;
    }
    case "MemberExpression": {
      const path = expressionPath(expression);
      if (path === "math.pi") return Math.PI;
      if (path === "math.e") return Math.E;
      return path ? readPath(environment.roots, path) : null;
    }
    case "IndexExpression": {
      const object = evaluateExpression(expression.object, environment);
      const index = Math.max(0, asInteger(evaluateExpression(expression.index, environment)));
      return Array.isArray(object) && index < object.length ? object[index] : null;
    }
    case "CallExpression": return evaluateCall(expression, environment);
    case "UnaryExpression": {
      const value = evaluateExpression(expression.argument, environment);
      if (isSignal(value)) return value;
      if (expression.operator === "+") return asNumber(value);
      if (expression.operator === "-") return -asNumber(value);
      if (expression.operator === "!") return !asBoolean(value);
      return { signal: "return", value };
    }
    case "BinaryExpression": {
      if (expression.operator === "=") {
        const path = expressionPath(expression.left);
        const value = evaluateExpression(expression.right, environment);
        if (isSignal(value)) return value;
        if (!path || !assignPath(environment, path, value)) {
          diagnostic(environment, expression.left, "MOLANG_READ_ONLY_ASSIGNMENT", `Cannot assign to '${path ?? "this expression"}'.`);
        }
        return value;
      }
      const left = evaluateExpression(expression.left, environment);
      if (isSignal(left)) return left;
      if (expression.operator === "&&") return asBoolean(left) && asBoolean(evaluateExpression(expression.right, environment));
      if (expression.operator === "||") return asBoolean(left) || asBoolean(evaluateExpression(expression.right, environment));
      if (expression.operator === "??") return left === null ? evaluateExpression(expression.right, environment) : left;
      if (expression.operator === "?") return asBoolean(left) ? evaluateExpression(expression.right, environment) : null;
      if (expression.operator === "->") {
        if (left === null) return null;
        const previous = environment.roots.context;
        environment.roots.context = typeof left === "object" && left !== null && !Array.isArray(left)
          ? left
          : { value: left };
        try {
          return evaluateExpression(expression.right, environment);
        } finally {
          environment.roots.context = previous;
        }
      }
      const right = evaluateExpression(expression.right, environment);
      if (isSignal(right)) return right;
      switch (expression.operator) {
        case "+": return asNumber(left) + asNumber(right);
        case "-": return asNumber(left) - asNumber(right);
        case "*": return asNumber(left) * asNumber(right);
        case "/": return asNumber(right) === 0 ? 0 : asNumber(left) / asNumber(right);
        case "<": return asNumber(left) < asNumber(right);
        case "<=": return asNumber(left) <= asNumber(right);
        case ">": return asNumber(left) > asNumber(right);
        case ">=": return asNumber(left) >= asNumber(right);
        case "==": {
          if (left === right) return true;
          if (typeof left === "number" || typeof right === "number") return asNumber(left) === asNumber(right);
          return false;
        }
        case "!=": {
          if (left === right) return false;
          if (typeof left === "number" || typeof right === "number") return asNumber(left) !== asNumber(right);
          return true;
        }
      }
      return null;
    }
    case "ConditionalExpression": {
      const test = evaluateExpression(expression.test, environment);
      if (isSignal(test)) return test;
      return evaluateExpression(asBoolean(test) ? expression.consequent : expression.alternate, environment);
    }
    case "ScopeExpression": {
      let value: InternalValue = null;
      for (const child of expression.body) {
        value = evaluateExpression(child, environment);
        if (isSignal(value)) return value;
      }
      return value;
    }
    case "StatementExpression": return { signal: expression.statement };
  }
}

function evaluateProgram(program: MolangProgram, environment: Environment): InternalValue {
  let value: InternalValue = 0;
  for (const expression of program.body) {
    value = evaluateExpression(expression, environment);
    if (isSignal(value)) {
      return value.signal === "return" ? value.value : null;
    }
  }
  return value;
}

function parseUserFunctions(
  functions: Record<string, string | MolangProgram> | undefined,
  diagnostics: MolangDiagnostic[]
): Record<string, MolangProgram> {
  const parsed: Record<string, MolangProgram> = {};
  for (const [name, source] of Object.entries(functions ?? {})) {
    if (typeof source !== "string") {
      parsed[name.toLowerCase()] = source;
      continue;
    }
    const result = parseMolang(source);
    diagnostics.push(...result.diagnostics.map((item) => ({ ...item, message: `fn.${name}: ${item.message}` })));
    if (result.ast) parsed[name.toLowerCase()] = result.ast;
  }
  return parsed;
}

export function evaluateParsedMolang(
  parsed: MolangParseResult,
  options: MolangEvaluationOptions = {}
): MolangEvaluationResult {
  const diagnostics = [...parsed.diagnostics];
  const seed = options.seed ?? options.initial_state?.random_state ?? 0x6d2b79f5;
  const state: MolangEvaluatorState = {
    variables: cloneValue(options.initial_state?.variables ?? options.variables ?? {}),
    temp: cloneValue(options.initial_state?.temp ?? options.temp ?? {}),
    physics: cloneValue(options.initial_state?.physics ?? {}),
    random_state: seed >>> 0,
  };
  const bindings = normalizeMolangBindings(options.bindings ?? {});
  const roots: Record<string, MolangValue> = {
    ...bindings,
    query: cloneValue((bindings.query as Record<string, MolangValue> | undefined) ?? {}),
    variable: state.variables,
    temp: state.temp,
    context: cloneValue(options.context ?? (bindings.context as Record<string, MolangValue> | undefined) ?? {}),
    ysm: cloneValue((bindings.ysm as Record<string, MolangValue> | undefined) ?? {}),
    ctrl: cloneValue((bindings.ctrl as Record<string, MolangValue> | undefined) ?? {}),
    tlm: cloneValue((bindings.tlm as Record<string, MolangValue> | undefined) ?? {}),
    args: cloneValue((bindings.args as MolangValue[] | undefined) ?? []),
  };
  const environment: Environment = {
    dialect: options.dialect ?? "stable_2_6_5",
    roots,
    functionResults: options.function_results ?? {},
    userFunctions: parseUserFunctions(options.user_functions, diagnostics),
    diagnostics,
    state,
    deltaSeconds: Math.max(0, options.delta_seconds ?? 0),
    callDepth: 0,
    remainingOperations: MAX_EVALUATION_OPERATIONS,
    operationLimitReported: false,
  };
  advancePhysics(state, environment.deltaSeconds);
  const evaluated = parsed.ast ? evaluateProgram(parsed.ast, environment) : null;
  const value = isSignal(evaluated) ? null : evaluated;
  state.variables = roots.variable as Record<string, MolangValue>;
  state.temp = roots.temp as Record<string, MolangValue>;
  return { value, diagnostics, state };
}

export function evaluateMolang(
  source: string,
  options: MolangEvaluationOptions = {}
): MolangEvaluationResult {
  return evaluateParsedMolang(parseMolang(source), options);
}
