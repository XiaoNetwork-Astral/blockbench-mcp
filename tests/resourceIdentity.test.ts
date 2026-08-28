import { describe, expect, test } from "bun:test";
import {
  findByExactUuid,
  findByResourceId,
  makeResourceId,
} from "@/lib/resourceUri";

describe("MCP resource identity", () => {
  const first = { uuid: "aaaaaaaa-1111-1111-1111-111111111111", name: "Main Skin" };
  const second = { uuid: "bbbbbbbb-2222-2222-2222-222222222222", name: "Main Skin" };

  test("emits and resolves collision-qualified resource IDs", () => {
    const items = [first, second];
    expect(makeResourceId(first, items)).toBe("main-skin~aaaaaaaa");
    expect(makeResourceId(second, items)).toBe("main-skin~bbbbbbbb");
    expect(findByResourceId(items, "main-skin~aaaaaaaa")).toBe(first);
  });

  test("rejects ambiguous exact names and bare slugs", () => {
    const items = [first, second];
    expect(() => findByResourceId(items, "Main Skin")).toThrow(/ambiguous/i);
    expect(() => findByResourceId(items, "main-skin")).toThrow(/ambiguous/i);
  });

  test("rejects duplicated UUIDs instead of choosing the first object", () => {
    const duplicate = { ...second, uuid: first.uuid };
    expect(() => findByResourceId([first, duplicate], first.uuid)).toThrow(
      /UUID.*duplicated/i
    );
    expect(() => makeResourceId(first, [first, duplicate])).toThrow(
      /UUID.*duplicated/i
    );
  });

  test("project scopes require an exact UUID and never accept a project name", () => {
    const projects = [
      { uuid: "project-a", name: "working" },
      { uuid: "project-b", name: "working" },
    ];
    expect(findByExactUuid(projects, "project-b", "Project")).toBe(projects[1]);
    expect(() => findByExactUuid(projects, "working", "Project")).toThrow(/not found/i);
  });
});
