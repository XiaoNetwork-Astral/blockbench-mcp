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
});
