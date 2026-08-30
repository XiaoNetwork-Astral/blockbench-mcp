import { describe, expect, test } from "bun:test";
import { verifyBlockbenchPluginArtifact } from "@/build/artifact-verifier";

const expected = {
  id: "blockbench_mcp",
  version: "1.7.0-blockbench.40",
};

describe("standalone Blockbench artifact verification", () => {
  test("accepts exactly one matching registration", () => {
    const registration = verifyBlockbenchPluginArtifact(
      `BBPlugin.register("blockbench_mcp", { version: "1.7.0-blockbench.40" });`,
      expected
    );

    expect(registration.id).toBe(expected.id);
    expect(registration.metadata.version).toBe(expected.version);
  });

  test("rejects package or relative runtime dependencies", () => {
    expect(() =>
      verifyBlockbenchPluginArtifact(
        `require("./impl/format"); BBPlugin.register("blockbench_mcp", { version: "1.7.0-blockbench.40" });`,
        expected
      )
    ).toThrow("non-native runtime module");
  });

  test("rejects native modules that Blockbench does not expose to plugins", () => {
    expect(() =>
      verifyBlockbenchPluginArtifact(
        `BBPlugin.register("blockbench_mcp", {
          version: "1.7.0-blockbench.40",
          onload() { requireNativeModule("http"); }
        });`,
        expected
      )
    ).toThrow("unsupported Blockbench native module");
  });

  test("rejects stale plugin identity metadata", () => {
    expect(() =>
      verifyBlockbenchPluginArtifact(
        `Plugin.register("blockbench_mcp", { version: "1.7.0-blockbench.39" });`,
        expected
      )
    ).toThrow("Expected plugin version");
  });
});
