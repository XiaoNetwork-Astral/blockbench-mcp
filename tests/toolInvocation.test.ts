import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseToolArguments } from "@/lib/factories";

describe("tool invocation schema", () => {
  test("applies whole-object refinements after SDK field parsing", () => {
    const schema = z.object({
      first: z.string().optional(),
      second: z.string().optional(),
    }).refine(({ first, second }) => Boolean(first || second), {
      message: "Provide first or second.",
    });

    expect(() => parseToolArguments(schema, {})).toThrow("Provide first or second");
    expect(parseToolArguments(schema, { first: "value" })).toEqual({ first: "value" });
  });
});
