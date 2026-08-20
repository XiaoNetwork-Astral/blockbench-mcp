import { describe, expect, test } from "bun:test";
import {
  checkUndoTravel,
  hashUndoPrefix,
  sanitizeForAudit,
  stringifyAuditValue,
} from "@/lib/auditCore";

describe("audit sanitization", () => {
  test("redacts credentials and omits bulk payloads before persistence", () => {
    const value = sanitizeForAudit({
      name: "flower_edit",
      access_token: "should-never-be-stored",
      nested: { password: "also-secret" },
      image: "A".repeat(1024),
    }) as Record<string, unknown>;

    expect(value.access_token).toBe("[redacted]");
    expect((value.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect(value.image).toBe("[omitted binary/base64 payload: 1024 characters]");
  });

  test("handles circular values and bounds serialized details", () => {
    const value: Record<string, unknown> = { name: "loop" };
    value.self = value;
    const text = stringifyAuditValue(value, 80);
    expect(text).toContain("circular reference");
    expect(text.length).toBeLessThanOrEqual(140);
  });
});

describe("per-model Undo travel validation", () => {
  test("accepts the same model branch and marks manual entries as unsafe", () => {
    const entries = ["model-a:1", "model-a:2", "model-a:3"];
    const ownership = new Map([
      [entries[0], { source: "mcp" as const }],
      [entries[1], { source: "user" as const }],
      [entries[2], { source: "mcp" as const }],
    ]);
    const result = checkUndoTravel({
      currentEntryIds: entries,
      currentIndex: 3,
      targetIndex: 1,
      targetPrefixHash: hashUndoPrefix(entries.slice(0, 1)),
      ownership,
    });

    expect(result.compatible).toBe(true);
    expect(result.direction).toBe("undo");
    expect(result.steps).toBe(2);
    expect(result.unsafeEntryIds).toEqual(["model-a:2"]);
  });

  test("rejects a target from a different or rewritten model history", () => {
    const modelA = ["model-a:1", "model-a:2"];
    const modelB = ["model-b:1", "model-b:2"];
    const result = checkUndoTravel({
      currentEntryIds: modelB,
      currentIndex: 2,
      targetIndex: 1,
      targetPrefixHash: hashUndoPrefix(modelA.slice(0, 1)),
      ownership: new Map(),
    });

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain("branch has changed");
  });
});
