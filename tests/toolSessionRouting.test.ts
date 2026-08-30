import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("stateless tool routing", () => {
  test("contains no transport-session project context", () => {
    const source = readFileSync(new URL("../lib/factories.ts", import.meta.url), "utf8");
    expect(source).toContain("getVisibleProject()");
    expect(source).not.toContain("sessionId");
    expect(source).not.toContain("toolRequestExtraForSession");
  });
});
