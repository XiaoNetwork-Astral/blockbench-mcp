import { describe, expect, test } from "bun:test";
import { loadBedrockGeometryDocument } from "@/server/tools/import";

describe("Bedrock geometry import project setup", () => {
  test("uses Codec.load when Blockbench's start screen exposes Project as 0", () => {
    const calls: unknown[][] = [];
    const codec = {
      load(...args: unknown[]) {
        calls.push(["load", ...args]);
      },
      parse(...args: unknown[]) {
        calls.push(["parse", ...args]);
      },
    };
    const document = { "minecraft:geometry": [] };

    expect(loadBedrockGeometryDocument(
      codec,
      document,
      "D:\\models\\main.json",
      0
    )).toBe("created_project");
    expect(calls).toEqual([[
      "load",
      document,
      { path: "D:\\models\\main.json", no_file: false },
      {},
    ]]);
  });

  test("keeps the existing parse-in-place behavior when a project is open", () => {
    const calls: unknown[][] = [];
    const codec = {
      load(...args: unknown[]) {
        calls.push(["load", ...args]);
      },
      parse(...args: unknown[]) {
        calls.push(["parse", ...args]);
      },
    };
    const document = { "minecraft:geometry": [] };

    expect(loadBedrockGeometryDocument(
      codec,
      document,
      "",
      { uuid: "open-project" }
    )).toBe("current_project");
    expect(calls).toEqual([["parse", document, "", {}]]);
  });

  test("rejects a start-screen import when the codec cannot create a project", () => {
    expect(() => loadBedrockGeometryDocument(
      { parse() {} },
      {},
      "",
      null
    )).toThrow(/cannot create a project/i);
  });
});
