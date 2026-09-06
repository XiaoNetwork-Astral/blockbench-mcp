import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import packageJson from "../package.json";
import { PLUGIN_FILENAME, PLUGIN_ID, VERSION } from "@/lib/constants";

describe("Blockbench local plugin identity", () => {
  test("keeps the install filename and version aligned with plugin metadata", () => {
    expect(packageJson.name).toBe("blockbench-mcp");
    expect(VERSION).toBe(packageJson.version);
    expect(PLUGIN_ID).toBe("blockbench_mcp");
    expect(PLUGIN_FILENAME).toBe("blockbench_mcp.js");
    expect(PLUGIN_FILENAME).toBe(`${PLUGIN_ID}.js`);
    expect(basename(packageJson.main)).toBe(PLUGIN_FILENAME);
  });
});
