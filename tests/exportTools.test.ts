import { describe, expect, test } from "bun:test";
import {
  assertPortableProjectExportMatches,
  compileCodec,
} from "@/server/tools/export";

describe("export_model codec compilation", () => {
  test("resolves synchronous and asynchronous codec results before serialization", async () => {
    const sync = await compileCodec(
      () => "sync-content",
      undefined,
      undefined
    );
    const asyncResult = await compileCodec(
      async () => ({ asset: { generator: "test" } }),
      undefined,
      undefined
    );

    expect(sync).toBe("sync-content");
    expect(asyncResult).toEqual({ asset: { generator: "test" } });
  });

  test("preserves the codec receiver for Blockbench compile methods", async () => {
    const codec = {
      marker: "bound-codec",
      compile(this: { marker: string }, suffix?: unknown) {
        return `${this.marker}:${String(suffix)}`;
      },
    };

    const result = await compileCodec(
      codec.compile,
      "project",
      codec
    );

    expect(result).toBe("bound-codec:project");
  });

  test("rejects portable project content from a different tab before writing", () => {
    const target = {
      name: "working-copy",
      elements: [{ uuid: "working-element" }],
      groups: [{ uuid: "working-group" }],
    };
    const correct = JSON.stringify({
      meta: { model_format: "free" },
      name: "working-copy",
      elements: [{ uuid: "working-element" }],
      groups: [{ uuid: "working-group" }],
    });
    const foreground = JSON.stringify({
      meta: { model_format: "free" },
      name: "baseline",
      elements: [{ uuid: "baseline-element" }],
      groups: [{ uuid: "baseline-group" }],
    });

    expect(() => assertPortableProjectExportMatches(correct, target)).not.toThrow();
    expect(() => assertPortableProjectExportMatches(foreground, target)).toThrow(
      /does not match MCP project/i
    );
  });
});
