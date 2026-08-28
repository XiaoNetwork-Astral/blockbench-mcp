import { describe, expect, test } from "bun:test";
import {
  LEGACY_PROJECT_ROLES_STORAGE_KEY,
  LEGACY_SETTING_ID_MAP,
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
      [LEGACY_PROJECT_ROLES_STORAGE_KEY, '{"project":{"role":"working_copy"}}'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    } as unknown as Storage;

    const migrated = readMigratedStorageItem(
      storage,
      "blockbench_mcp.project_roles",
      [LEGACY_PROJECT_ROLES_STORAGE_KEY]
    );
    expect(migrated).toContain("working_copy");
    expect(values.get("blockbench_mcp.project_roles")).toBe(migrated);
    expect(values.has(LEGACY_PROJECT_ROLES_STORAGE_KEY)).toBe(false);
  });
});
