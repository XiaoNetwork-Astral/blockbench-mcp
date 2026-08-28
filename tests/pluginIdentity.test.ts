import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import packageJson from "../package.json";
import { PLUGIN_FILENAME, PLUGIN_ID } from "@/lib/constants";

describe("Blockbench local plugin identity", () => {
  test("keeps the install filename identical to the registered plugin ID", () => {
    expect(packageJson.name).toBe("blockbench-mcp");
    expect(packageJson.version).toBe("1.7.0-blockbench.37");
    expect(PLUGIN_ID).toBe("blockbench_mcp");
    expect(PLUGIN_FILENAME).toBe("blockbench_mcp.js");
    expect(PLUGIN_FILENAME).toBe(`${PLUGIN_ID}.js`);
    expect(basename(packageJson.main)).toBe(PLUGIN_FILENAME);
  });
});
