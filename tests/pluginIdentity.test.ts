import { describe, expect, test } from "bun:test";
import { basename } from "node:path";
import packageJson from "../package.json";
import { PLUGIN_FILENAME, PLUGIN_ID } from "@/lib/constants";

describe("Blockbench local plugin identity", () => {
  test("keeps the install filename identical to the registered plugin ID", () => {
    expect(PLUGIN_FILENAME).toBe(`${PLUGIN_ID}.js`);
    expect(basename(packageJson.main)).toBe(PLUGIN_FILENAME);
  });
});
