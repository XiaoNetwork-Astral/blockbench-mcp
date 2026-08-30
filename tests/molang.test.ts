import { describe, expect, test } from "bun:test";
import { lexMolang } from "@/lib/molang/lexer";
import { parseMolang } from "@/lib/molang/parser";
import {
  evaluateMolang,
  type MolangEvaluatorState,
} from "@/lib/molang/evaluator";
import {
  listMolangCatalog,
  validateMolangSemantics,
} from "@/lib/molang/catalog";

describe("source-backed YSM Molang", () => {
  test("lexes the stable operators, literals, keywords, and lowercase identifiers", () => {
    const result = lexMolang("Return Math.Clamp(YSM.Head_Yaw / 120, -.35, .35) ?? 'idle';");
    expect(result.diagnostics).toEqual([]);
    expect(result.tokens.map((token) => token.kind)).toEqual([
      "return", "identifier", ".", "identifier", "(", "identifier", ".", "identifier",
      "/", "number", ",", "-", "number", ",", "number", ")", "??", "string", ";", "eof",
    ]);
    expect(result.tokens.filter((token) => token.kind === "identifier").map((token) => token.value)).toEqual([
      "math", "clamp", "ysm", "head_yaw",
    ]);
  });

  test("produces a ranged AST for scopes, assignment, calls, indexing, and ternaries", () => {
    const result = parseMolang("v.x = args[0]; loop(2, {v.x = v.x + 1;}); return v.x > 2 ? v.x : 0;");
    expect(result.diagnostics).toEqual([]);
    expect(result.ast?.body).toHaveLength(3);
    expect(result.ast?.body[0]?.type).toBe("BinaryExpression");
    expect(result.ast?.body[1]?.type).toBe("CallExpression");
    expect(result.ast?.body[2]?.type).toBe("UnaryExpression");
    expect(result.ast?.end).toBeGreaterThan(60);
  });

  test("matches stable arithmetic, comparison, assignment, and division-by-zero behavior", () => {
    const result = evaluateMolang(
      "v.x = math.clamp(ysm.head_yaw / 120, -0.35, 0.35); loop(3, {v.x = v.x + 1;}); return v.x / 0;",
      { bindings: { ysm: { head_yaw: 60 } } }
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value).toBe(0);
    expect(result.state.variables.x).toBe(3.35);
  });

  test("evaluates flat dotted bindings with the same contract as nested bindings", () => {
    const source = "math.sin(query.anim_time * 90) * 5";
    const nested = evaluateMolang(source, {
      bindings: { query: { anim_time: 0.25 } },
    });
    const flat = evaluateMolang(source, {
      bindings: { "query.anim_time": 0.25 },
    });

    expect(flat.diagnostics).toEqual([]);
    expect(flat.value).toBe(nested.value);
    expect(evaluateMolang("query.anim_time", {
      bindings: {
        query: { anim_time: 0.1 },
        "query.anim_time": 0.25,
      },
    }).value).toBe(0.25);
  });

  test("supports deterministic, serializable second-order physics state", () => {
    const source = "ysm.second_order('strap', 1, 2, 0.8, 0.3)";
    const first = evaluateMolang(source, { seed: 17, delta_seconds: 0 });
    expect(first.value).toBe(1);
    const second = evaluateMolang(source, {
      seed: 17,
      delta_seconds: 0.05,
      initial_state: first.state as MolangEvaluatorState,
    });
    const repeated = evaluateMolang(source, {
      seed: 17,
      delta_seconds: 0.05,
      initial_state: first.state as MolangEvaluatorState,
    });
    expect(second.value).toBe(0);

    const third = evaluateMolang(source, {
      seed: 17,
      delta_seconds: 0.05,
      initial_state: second.state,
    });
    const repeatedThird = evaluateMolang(source, {
      seed: 17,
      delta_seconds: 0.05,
      initial_state: second.state,
    });

    expect(third.value).toBeGreaterThan(0);
    expect(repeatedThird.value).toBe(third.value);
    expect(repeatedThird.state).toEqual(third.state);
    expect(second).toEqual(repeated);
  });

  test("catalogs the stable line while gating audited dev-only additions", () => {
    const stable = listMolangCatalog("stable_2_6_5");
    const dev = listMolangCatalog("dev_3_0_experimental");
    expect(stable.some((entry) => entry.namespace === "ysm" && entry.name === "second_order")).toBe(true);
    expect(stable.some((entry) => entry.namespace === "ysm" && entry.name === "bone_color")).toBe(false);
    expect(dev.some((entry) => entry.namespace === "ysm" && entry.name === "bone_color" && entry.experimental)).toBe(true);

    const parsed = parseMolang("ysm.bone_color('Head', 1, 1, 1)");
    expect(validateMolangSemantics(parsed, "stable_2_6_5").some((item) => item.code === "MOLANG_EXPERIMENTAL_SYMBOL" && item.severity === "error")).toBe(true);
    expect(validateMolangSemantics(parsed, "dev_3_0_experimental").some((item) => item.code === "MOLANG_EXPERIMENTAL_SYMBOL" && item.severity === "warning")).toBe(true);
  });

  test("reports unknown namespaces, symbols, invalid assignments, and missing runtime values", () => {
    const parsed = parseMolang("query.not_a_real_query + bogus.value; query.anim_time = 1");
    const diagnostics = validateMolangSemantics(parsed, "stable_2_6_5", {
      report_runtime_availability: true,
    });
    expect(diagnostics.map((item) => item.code)).toContain("MOLANG_UNKNOWN_SYMBOL");
    expect(diagnostics.map((item) => item.code)).toContain("MOLANG_UNKNOWN_NAMESPACE");
    expect(diagnostics.map((item) => item.code)).toContain("MOLANG_READ_ONLY_ASSIGNMENT");

    const available = validateMolangSemantics(
      parseMolang("query.anim_time"),
      "stable_2_6_5",
      {
        report_runtime_availability: true,
        available_binding_paths: ["query.anim_time"],
      }
    );
    expect(available.some((item) => item.code === "MOLANG_RUNTIME_VALUE_REQUIRED")).toBe(false);
  });

  test("validates loop control and scope shapes", () => {
    const diagnostics = validateMolangSemantics(parseMolang(
      "break; continue; loop(1, 0); for_each(query.anim_time, args, 0)"
    ));
    const codes = diagnostics.map((item) => item.code);
    expect(codes.filter((code) => code === "MOLANG_INVALID_CONTROL_FLOW")).toHaveLength(2);
    expect(codes).toContain("MOLANG_INVALID_LOOP_SCOPE");
    expect(codes).toContain("MOLANG_INVALID_FOR_EACH_TARGET");
    expect(codes).toContain("MOLANG_INVALID_FOR_EACH_SCOPE");

    const valid = validateMolangSemantics(parseMolang(
      "loop(1, {continue;}); for_each(v.item, args, {break;})"
    ));
    expect(valid.some((item) => item.code === "MOLANG_INVALID_CONTROL_FLOW")).toBe(false);
  });

  test("bounds standalone evaluation work across nested loops", () => {
    const result = evaluateMolang(
      "v.x = 0; loop(1024, {loop(1024, {v.x = v.x + 1;});}); return v.x;"
    );
    expect(result.diagnostics.filter((item) => item.code === "MOLANG_OPERATION_LIMIT")).toHaveLength(1);
    expect(Number(result.state.variables.x)).toBeLessThan(1024 * 1024);
  });
});
