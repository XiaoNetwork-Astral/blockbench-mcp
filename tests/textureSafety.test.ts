import { afterEach, describe, expect, test } from "bun:test";
import path from "node:path";
import {
  assertExternalWriteAllowed,
  editTextureWithUndo,
  PROJECT_LOCAL_TEXTURE_EDIT_OPTIONS,
  prepareTextureForMutation,
  rememberProjectTextureDependencies,
} from "@/lib/textureSafety";
import { setProjectReadOnly } from "@/lib/projectRoles";

const originalGlobals = new Map<string, unknown>();

function replaceGlobal(name: string, value: unknown): void {
  if (!originalGlobals.has(name)) originalGlobals.set(name, (globalThis as any)[name]);
  (globalThis as any)[name] = value;
}

function project(uuid: string, texturePath: string, name = uuid) {
  const texture = {
    uuid: `${uuid}-texture`,
    id: "0",
    name: "default.png",
    path: texturePath,
    relative_path: "",
    internal: false,
    saved: true,
    sync_to_project: "other-project",
    stopWatcherCalls: 0,
    stopWatcher() { this.stopWatcherCalls += 1; },
    getDataURL() { return "data:image/png;base64,AAAA"; },
    convertToInternal(source: string) {
      this.internal = true;
      (this as any).source = source;
      this.saved = false;
    },
  };
  return {
    project: {
      uuid,
      name,
      save_path: `D:\\models\\${uuid}.bbmodel`,
      export_path: "",
      saved: true,
      textures: [texture],
    },
    texture,
  };
}

afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete (globalThis as any)[name];
    else (globalThis as any)[name] = value;
  }
  originalGlobals.clear();
});

describe("project-scoped texture safety", () => {
  test("suppresses Painter's nested Undo ownership", () => {
    expect(PROJECT_LOCAL_TEXTURE_EDIT_OPTIONS).toEqual({
      no_undo_init: true,
      no_undo_finish: true,
    });
  });

  test("detaches external and cross-project synchronization before Undo snapshots", () => {
    replaceGlobal("PathModule", path.win32);
    const { project: target, texture } = project(
      "working",
      "D:\\workspace\\textures\\default.png"
    );

    prepareTextureForMutation(target as unknown as ModelProject, texture as unknown as Texture);

    expect(texture.internal).toBe(true);
    expect((texture as any).source).toBe("data:image/png;base64,AAAA");
    expect(texture.path).toBe("D:\\workspace\\textures\\default.png");
    expect(texture.sync_to_project).toBe("");
    expect(texture.stopWatcherCalls).toBe(1);
    expect(texture.saved).toBe(true);
    expect(target.saved).toBe(true);
  });

  test("blocks a write that would alter another open project's texture dependency", () => {
    replaceGlobal("PathModule", path.win32);
    const storage = {
      value: null as string | null,
      getItem() { return this.value; },
      setItem(_key: string, value: string) { this.value = value; },
    };
    replaceGlobal("localStorage", storage);
    const shared = "D:\\workspace\\textures\\default.png";
    const { project: baseline } = project("baseline", shared, "baseline");
    const { project: working } = project("working", shared, "working");
    replaceGlobal("ModelProject", { all: [baseline, working] });
    setProjectReadOnly(baseline as unknown as ModelProject, true);
    rememberProjectTextureDependencies(baseline as unknown as ModelProject);

    expect(() => assertExternalWriteAllowed(
      shared,
      working as unknown as ModelProject,
      "test texture save"
    )).toThrow(/baseline.*read-only|read-only.*baseline/i);

    expect(() => assertExternalWriteAllowed(
      "D:\\workspace\\textures\\working-only.png",
      working as unknown as ModelProject,
      "test texture save"
    )).not.toThrow();
  });

  test("permits only explicit texture saves to overwrite the working project's own dependency", () => {
    replaceGlobal("PathModule", path.win32);
    const ownTexturePath = "D:\\workspace\\textures\\working.png";
    const { project: working } = project("working", ownTexturePath, "working");
    replaceGlobal("ModelProject", { all: [working] });

    expect(() => assertExternalWriteAllowed(
      ownTexturePath,
      working as unknown as ModelProject,
      "export_model"
    )).toThrow(/not an explicit texture save/i);
    expect(() => assertExternalWriteAllowed(
      ownTexturePath,
      working as unknown as ModelProject,
      "save_texture",
      { allowOwnTextureDependency: true }
    )).not.toThrow();
    expect(() => assertExternalWriteAllowed(
      working.save_path,
      working as unknown as ModelProject,
      "export_model"
    )).not.toThrow();
  });

  test("rejects one live texture object shared by multiple project tabs", () => {
    replaceGlobal("PathModule", path.win32);
    const { project: working, texture } = project(
      "working",
      "D:\\workspace\\textures\\working.png",
      "working"
    );
    const baseline = {
      ...working,
      uuid: "baseline",
      name: "baseline",
      textures: [texture],
    };
    replaceGlobal("ModelProject", { all: [baseline, working] });

    expect(() => prepareTextureForMutation(
      working as unknown as ModelProject,
      texture as unknown as Texture
    )).toThrow(/same live object in multiple projects/i);
  });

  test("owns exactly one Undo transaction around Texture.edit", () => {
    replaceGlobal("PathModule", path.win32);
    const { project: working, texture } = project(
      "working",
      "D:\\workspace\\textures\\working.png",
      "working"
    );
    replaceGlobal("ModelProject", { all: [working] });
    const calls: string[] = [];
    let receivedOptions: Record<string, unknown> | null = null;
    let callbackRan = false;
    (texture as any).edit = (
      callback: (canvas: HTMLCanvasElement) => void,
      options: Record<string, unknown>
    ) => {
      receivedOptions = options;
      callback({} as HTMLCanvasElement);
    };
    replaceGlobal("Undo", {
      initEdit() { calls.push("init"); },
      finishEdit() { calls.push("finish"); },
      cancelEdit() { calls.push("cancel"); },
    });

    editTextureWithUndo(
      working as unknown as ModelProject,
      texture as unknown as Texture,
      "test edit",
      () => { callbackRan = true; }
    );

    expect(calls).toEqual(["init", "finish"]);
    expect(callbackRan).toBe(true);
    expect(receivedOptions).toMatchObject({
      edit_name: "test edit",
      no_undo_init: true,
      no_undo_finish: true,
    });
  });
});
