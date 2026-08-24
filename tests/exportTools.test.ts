import { describe, expect, test } from "bun:test";
import {
  assertPortableProjectExportMatches,
  compileCodecInProject,
} from "@/server/tools/export";

describe("export_model codec compilation", () => {
  test("resolves synchronous and asynchronous codec results before serialization", async () => {
    const run = <T>(callback: () => T) => callback();
    const sync = await compileCodecInProject(
      () => "sync-content",
      undefined,
      undefined,
      run,
      false,
      "sync"
    );
    const asyncResult = await compileCodecInProject(
      async () => ({ asset: { generator: "test" } }),
      undefined,
      undefined,
      run,
      false,
      "async"
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

    const result = await compileCodecInProject(
      codec.compile,
      "project",
      codec,
      (callback) => callback(),
      false,
      "project"
    );

    expect(result).toBe("bound-codec:project");
  });

  test("compiles a background project before restoring the foreground context", async () => {
    let currentProject = "foreground";
    const runInProject = <T>(callback: () => T): T => {
      const previous = currentProject;
      currentProject = "working-copy";
      try {
        return callback();
      } finally {
        currentProject = previous;
      }
    };

    const result = await compileCodecInProject(
      () => currentProject,
      undefined,
      undefined,
      runInProject,
      true,
      "project"
    );

    expect(result).toBe("working-copy");
    expect(currentProject).toBe("foreground");
  });

  test("does not let an asynchronous codec export an inactive tab", async () => {
    await expect(
      compileCodecInProject(
        async () => "late-content",
        undefined,
        undefined,
        (callback) => callback(),
        true,
        "gltf"
      )
    ).rejects.toThrow(/cannot safely export an inactive tab/i);
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
