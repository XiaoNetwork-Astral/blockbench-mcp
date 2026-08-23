import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { auditManager } from "@/lib/audit";

let originalProject: unknown;

beforeEach(async () => {
  originalProject = (globalThis as { Project?: unknown }).Project;
  await auditManager.clearHistory();
});

afterEach(async () => {
  if (originalProject === undefined) {
    delete (globalThis as { Project?: unknown }).Project;
  } else {
    (globalThis as { Project?: unknown }).Project = originalProject;
  }
  await auditManager.clearHistory();
});

describe("read-only audit overhead", () => {
  test("records the Undo position without walking the Undo entries", async () => {
    let indexedEntryReads = 0;
    const history = new Proxy([{}, {}, {}], {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) {
          indexedEntryReads += 1;
        }
        return Reflect.get(target, property, receiver);
      },
    });
    (globalThis as { Project?: unknown }).Project = {
      uuid: "slow-project",
      name: "Large Undo History",
      save_path: "",
      undo: { history, index: 2 },
    };

    const handle = auditManager.beginMcpOperation({
      toolName: "inspect_projects",
      title: "Inspect Projects",
      args: {},
      readOnly: true,
    });
    auditManager.finishMcpOperation(handle, "ok");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const page = await auditManager.queryPage({ page: 0, pageSize: 10 });
    const record = page.items.find(({ id }) => id === handle.id);
    expect(indexedEntryReads).toBe(0);
    expect(record).toBeDefined();
    expect(record?.before.prefixHash).toBe("read-only");
    expect(record?.after.prefixHash).toBe("read-only");
    expect(record?.undoDelta).toBe(0);
    expect(record?.reversible).toBe(false);
  });
});
