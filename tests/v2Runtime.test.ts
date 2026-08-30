import { afterEach, describe, expect, test } from "bun:test";
import {
  getVisibleProject,
  resolveOpenProject,
  selectProject,
} from "@/src/blockbench/projects";
import { runMutation } from "@/src/runtime/mutationQueue";

const testGlobals = globalThis as typeof globalThis & {
  ModelProject?: unknown;
  Blockbench?: unknown;
};
const previousModelProject = testGlobals.ModelProject;
const previousBlockbench = testGlobals.Blockbench;

afterEach(() => {
  if (previousModelProject === undefined) delete (globalThis as any).ModelProject;
  else (globalThis as any).ModelProject = previousModelProject;
  if (previousBlockbench === undefined) delete (globalThis as any).Blockbench;
  else (globalThis as any).Blockbench = previousBlockbench;
});

function project(uuid: string, name: string, selected = false): ModelProject {
  return {
    uuid,
    name,
    selected,
    save_path: "",
    export_path: "",
    select(this: { selected: boolean }) {
      for (const item of (globalThis as any).ModelProject.all as Array<{ selected: boolean }>) {
        item.selected = false;
      }
      this.selected = true;
      (globalThis as any).Blockbench.Project = this;
      return this;
    },
  } as unknown as ModelProject;
}

describe("v2 visible project adapter", () => {
  test("uses the visibly selected tab instead of connection-owned state", () => {
    const first = project("first", "First");
    const second = project("second", "Second", true);
    (globalThis as any).ModelProject = { all: [first, second] };
    (globalThis as any).Blockbench = { Project: first };

    expect(getVisibleProject()).toBe(second);
  });

  test("resolves exact UUIDs or unique exact names and rejects ambiguity", () => {
    const first = project("first", "Duplicate");
    const second = project("second", "Duplicate");
    (globalThis as any).ModelProject = { all: [first, second] };
    (globalThis as any).Blockbench = { Project: first };

    expect(resolveOpenProject("second")).toBe(second);
    expect(() => resolveOpenProject("Duplicate")).toThrow(/ambiguous/i);
  });

  test("select_project visibly selects the resolved tab", () => {
    const first = project("first", "First", true);
    const second = project("second", "Second");
    (globalThis as any).ModelProject = { all: [first, second] };
    (globalThis as any).Blockbench = { Project: first };

    expect(selectProject("second")).toBe(second);
    expect(getVisibleProject()).toBe(second);
  });
});

describe("v2 mutation queue", () => {
  test("does not interleave concurrent Blockbench mutations", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = runMutation(async () => {
      events.push("first:start");
      await gate;
      events.push("first:end");
    });
    const second = runMutation(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first:start",
      "first:end",
      "second:start",
      "second:end",
    ]);
  });
});
