import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearAllValidationSnapshots,
  getValidationSnapshot,
  MAX_VALIDATION_SNAPSHOTS_PER_PROJECT,
  storeValidationSnapshot,
} from "@/lib/validationSnapshots";

beforeEach(() => clearAllValidationSnapshots());

describe("validation snapshot retention", () => {
  test("keeps a bounded insertion window for each project", () => {
    const ids: string[] = [];
    for (let index = 0; index <= MAX_VALIDATION_SNAPSHOTS_PER_PROJECT; index++) {
      ids.push(storeValidationSnapshot("project", String(index), { index }).id);
    }

    expect(() => getValidationSnapshot(ids[0], "project")).toThrow(/absent/i);
    expect(getValidationSnapshot<{ index: number }>(
      ids.at(-1)!,
      "project"
    ).value.index).toBe(MAX_VALIDATION_SNAPSHOTS_PER_PROJECT);
    expect(() => getValidationSnapshot(ids.at(-1)!, "other-project")).toThrow(/absent/i);
  });
});
