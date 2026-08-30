import { describe, expect, test } from "bun:test";
import {
  LEGACY_SETTING_ID_MAP,
  LEGACY_YSM_BINDINGS_STORAGE_KEY,
  migrateRecordKeys,
  readMigratedStorageItem,
} from "@/lib/brandingMigration";

describe("Blockbench MCP branding migration", () => {
  test("moves legacy settings while preserving an explicit new value", () => {
    const legacyPortId = Object.entries(LEGACY_SETTING_ID_MAP).find(
      ([, current]) => current === "blockbench_mcp_port"
    )?.[0];
    const legacyEndpointId = Object.entries(LEGACY_SETTING_ID_MAP).find(
      ([, current]) => current === "blockbench_mcp_endpoint"
    )?.[0];
    expect(legacyPortId).toBeDefined();
    expect(legacyEndpointId).toBeDefined();

    const records: Record<string, unknown> = {
      [legacyPortId!]: { value: 3001 },
      [legacyEndpointId!]: { value: "/legacy" },
      blockbench_mcp_port: { value: 4777 },
    };

    expect(migrateRecordKeys(records)).toBe(true);
    expect(records.blockbench_mcp_port).toEqual({ value: 4777 });
    expect(records.blockbench_mcp_endpoint).toEqual({ value: "/legacy" });
    expect(records[legacyPortId!]).toBeUndefined();
    expect(records[legacyEndpointId!]).toBeUndefined();
  });

  test("copies a legacy localStorage value once and removes its old key", () => {
    const values = new Map<string, string>([
      [LEGACY_YSM_BINDINGS_STORAGE_KEY, '{"project":{"geometry":"models/hero.json"}}'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;

    const migrated = readMigratedStorageItem(
      storage,
      "blockbench_mcp.ysm_bindings",
      [LEGACY_YSM_BINDINGS_STORAGE_KEY]
    );
    expect(migrated).not.toBeNull();
    expect(migrated).toContain("models/hero.json");
    expect(values.get("blockbench_mcp.ysm_bindings")).toBe(migrated!);
    expect(values.has(LEGACY_YSM_BINDINGS_STORAGE_KEY)).toBe(false);
  });
});
