import { describe, expect, test } from "bun:test";
import { compileCodecResult } from "@/server/tools/export";

describe("export_model codec compilation", () => {
  test("resolves synchronous and asynchronous codec results before serialization", async () => {
    const sync = await compileCodecResult(() => "sync-content");
    const asyncResult = await compileCodecResult(
      async () => ({ asset: { generator: "test" } })
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

    const result = await compileCodecResult(codec.compile, "project", codec);

    expect(result).toBe("bound-codec:project");
  });
});
