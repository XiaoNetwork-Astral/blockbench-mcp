import { beforeEach, describe, expect, test } from "bun:test";
import {
  clearAllValidationSnapshots,
  getValidationSnapshot,
  MAX_VALIDATION_SNAPSHOTS_PER_SESSION,
  storeValidationSnapshot,
} from "@/lib/validationSnapshots";

beforeEach(() => clearAllValidationSnapshots());

describe("validation snapshot retention", () => {
  test("keeps a bounded, session-isolated insertion window", () => {
    const ids: string[] = [];
    for (let index = 0; index <= MAX_VALIDATION_SNAPSHOTS_PER_SESSION; index++) {
      ids.push(storeValidationSnapshot("session-a", "project", String(index), { index }).id);
    }

    expect(() => getValidationSnapshot("session-a", ids[0], "project")).toThrow(/absent/i);
    expect(getValidationSnapshot<{ index: number }>(
      "session-a",
      ids.at(-1)!,
      "project"
    ).value.index).toBe(MAX_VALIDATION_SNAPSHOTS_PER_SESSION);
    expect(() => getValidationSnapshot("session-b", ids.at(-1)!, "project")).toThrow(/absent/i);
  });
});
