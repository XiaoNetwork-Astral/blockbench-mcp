import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  setPluginWorkspaceRoot,
  syncPluginWorkspaceRootFromSetting,
  teardownPluginWorkspace,
} from "@/lib/pluginWorkspace";
import {
  discoverYsmDocuments,
  inventoryYsmMolangExpressions,
} from "@/lib/ysmMolangDocuments";
import { editYsmMolangExpressions } from "@/lib/ysmMolangEditing";

const originals = new Map<string, unknown>();
let workspace = "";

function replaceGlobal(name: string, value: unknown): void {
  if (!originals.has(name)) originals.set(name, (globalThis as Record<string, unknown>)[name]);
  (globalThis as Record<string, unknown>)[name] = value;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "blockbench-mcp-ysm-"));
  replaceGlobal("PathModule", path);
  replaceGlobal("Settings", { get: () => undefined });
  replaceGlobal("requireNativeModule", (name: string) => {
    if (name === "fs") return fs;
    if (name === "crypto") return { createHash };
    return undefined;
  });
  setPluginWorkspaceRoot(workspace, false);
  fs.mkdirSync(path.join(workspace, "animations"), { recursive: true });
  fs.writeFileSync(path.join(workspace, "ysm.json"), `${JSON.stringify({
    spec: 2,
    files: { animation: "animations/main.animation.json" },
  }, null, 2)}\n`);
});

afterEach(() => {
  syncPluginWorkspaceRootFromSetting("");
  teardownPluginWorkspace();
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
  for (const [name, value] of originals) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[name];
    else (globalThis as Record<string, unknown>)[name] = value;
  }
  originals.clear();
});

function animationText(): string {
  return [
    "{",
    "  // Preserve this comment and formatting.",
    '  "format_version": "1.8.0",',
    '  "animations": {',
    '    "animation.ema.main": {',
    '      "loop": true,',
    '      "bones": {',
    '        "pre_parallel0": {',
    '          "rotation": ["-ysm.head_pitch", "ysm.head_yaw", 0]',
    "        },",
    '        "BeretStrap": {',
    '          "rotation": [0, 0, "ysm.second_order(\'strap\', query.anim_time, 2, 0.8, 0.3)"]',
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
    "",
  ].join("\r\n");
}

describe("YSM Molang package discovery and editing", () => {
  test("discovers manifest sidecars and inventories exact owners and hashes", () => {
    fs.writeFileSync(path.join(workspace, "animations", "main.animation.json"), animationText());
    const discovery = discoverYsmDocuments("ysm.json");
    expect(discovery.manifest.spec).toBe(2);
    expect(discovery.documents).toContainEqual(expect.objectContaining({
      path: "animations/main.animation.json",
      kind: "animation",
      exists: true,
    }));

    const inventory = inventoryYsmMolangExpressions("ysm.json");
    const strap = inventory.expressions.find((item) => item.owner.bone === "BeretStrap" && item.json_pointer.endsWith("/2"));
    const pupil = inventory.expressions.find((item) => item.decoded === "ysm.head_yaw");
    expect(strap).toMatchObject({
      document_kind: "animation",
      expression_kind: "animation_transform",
      owner: {
        animation: "animation.ema.main",
        bone: "BeretStrap",
        channel: "rotation",
      },
    });
    expect(strap?.file_sha256).toHaveLength(64);
    expect(strap?.literal_sha256).toHaveLength(64);
    expect(pupil?.owner.bone).toBe("pre_parallel0");
  });

  test("dry-runs and atomically applies one targeted edit while preserving unrelated bytes", () => {
    const file = path.join(workspace, "animations", "main.animation.json");
    const before = animationText();
    fs.writeFileSync(file, before);
    const inventory = inventoryYsmMolangExpressions("ysm.json");
    const target = inventory.expressions.find((item) => item.owner.bone === "BeretStrap" && item.json_pointer.endsWith("/2"));
    expect(target).toBeDefined();
    const replacement = "ysm.second_order('strap', query.anim_time, 2.5, 0.75, 0.25)";
    const request = {
      manifest: "ysm.json",
      file: "animations/main.animation.json",
      expected_file_sha256: hash(before),
      edits: [{
        operation: "replace" as const,
        expression_id: target!.expression_id,
        expected_literal_sha256: target!.literal_sha256,
        value: replacement,
      }],
      dry_run: true,
      dialect: "stable_2_6_5" as const,
    };

    const preview = editYsmMolangExpressions(request);
    expect(preview.applied).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(preview.edits[0].before).toBe(target!.decoded);
    expect(preview.edits[0].after).toBe(replacement);

    const applied = editYsmMolangExpressions({ ...request, dry_run: false });
    const after = fs.readFileSync(file, "utf8");
    expect(applied.applied).toBe(true);
    expect(hash(after)).toBe(applied.after_sha256);
    expect(after).toContain(replacement);
    expect(after).toContain('["-ysm.head_pitch", "ysm.head_yaw", 0]');
    expect(after).toContain("// Preserve this comment and formatting.");
    expect(after.replace(JSON.stringify(replacement), JSON.stringify(target!.decoded))).toBe(before);
  });

  test("rejects stale hashes and malformed duplicate-key documents", () => {
    const file = path.join(workspace, "animations", "main.animation.json");
    fs.writeFileSync(file, animationText());
    const inventory = inventoryYsmMolangExpressions("ysm.json");
    const target = inventory.expressions.find((item) => item.owner.bone === "BeretStrap" && item.json_pointer.endsWith("/2"))!;
    expect(() => editYsmMolangExpressions({
      manifest: "ysm.json",
      file: "animations/main.animation.json",
      expected_file_sha256: "0".repeat(64),
      edits: [{
        operation: "replace",
        expression_id: target.expression_id,
        expected_literal_sha256: target.literal_sha256,
        value: "0",
      }],
    })).toThrow(/changed outside this request/i);

    fs.writeFileSync(file, '{"animations": {}, "animations": {}}\n');
    const malformed = inventoryYsmMolangExpressions("ysm.json");
    expect(malformed.diagnostics.some((item) => item.code === "YSM_DUPLICATE_JSON_KEY")).toBe(true);
  });

  test("preserves a BOM and trailing commas while reporting offsets against the hashed file", () => {
    const file = path.join(workspace, "animations", "main.animation.json");
    const before = [
      "\ufeff{",
      '  "format_version": "1.8.0",',
      '  "animations": {',
      '    "animation.ema.main": {',
      '      "bones": {',
      '        "Head": {',
      '          "rotation": [0, "ysm.head_yaw", 0],',
      "        },",
      "      },",
      "    },",
      "  },",
      "}",
      "",
    ].join("\r\n");
    fs.writeFileSync(file, before);
    const target = inventoryYsmMolangExpressions("ysm.json").expressions
      .find((item) => item.decoded === "ysm.head_yaw")!;
    const replacement = "ysm.head_yaw + 1";

    const result = editYsmMolangExpressions({
      manifest: "ysm.json",
      file: "animations/main.animation.json",
      expected_file_sha256: hash(before),
      edits: [{
        operation: "replace",
        expression_id: target.expression_id,
        expected_literal_sha256: target.literal_sha256,
        value: replacement,
      }],
      dry_run: false,
    });
    const after = fs.readFileSync(file, "utf8");
    const textEdit = result.edits[0].text_edits[0];

    expect(after.startsWith("\ufeff{")).toBe(true);
    expect(after).toContain('"rotation": [0, "ysm.head_yaw + 1", 0],');
    expect(after).toContain("      },\r\n");
    expect(result.edits[0].text_edit_basis_sha256).toBe(hash(before));
    expect(textEdit.offset).toBe(before.indexOf(JSON.stringify(target.decoded)));
    expect(after.replace(JSON.stringify(replacement), JSON.stringify(target.decoded))).toBe(before);
  });
});
