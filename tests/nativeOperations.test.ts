import { afterEach, describe, expect, test } from "bun:test";
import { prepareElementProperties, type NativeProperty } from "@/src/blockbench/elementProperties";
import { controllerStatesSchema, prepareControllerGraph, resolveImportedControllerTransitions } from "@/src/blockbench/animationControllers";
import { animationFileTools } from "@/server/tools/animation-files";

const originals = new Map<string, PropertyDescriptor | undefined>();
function setGlobal(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

describe("native operation boundaries", () => {
  test("resolves imported forward transitions before an Undo snapshot is taken", () => {
    const controller = {
      states: [
        { name: "idle", uuid: "idle-id", transitions: [{ target: "", condition: "query.is_moving" }] },
        { name: "walk", uuid: "walk-id", transitions: [{ target: "idle-id", condition: "!query.is_moving" }] },
      ]
    } as unknown as AnimationController;
    resolveImportedControllerTransitions(controller, {
      idle: { transitions: [{ walk: "query.is_moving" }] }, walk: { transitions: [{ idle: "!query.is_moving" }] },
    });
    const snapshot = structuredClone(controller);
    expect(snapshot.states[0].transitions[0].target).toBe("walk-id");
    expect(snapshot.states[1].transitions[0].target).toBe("idle-id");
  });

  test("rejects invalid native property patches before applying any field", () => {
    let merged = false;
    const properties: Record<string, NativeProperty> = {
      position: { type: "vector", merge() { merged = true; } },
      facing: { type: "enum", enum_values: ["lookat", "rotate"], merge() { merged = true; } },
      scope: { type: "number", merge() { merged = true; } },
    };
    expect(() => prepareElementProperties(properties, { position: [1, 2, 3], facing: "unsupported" })).toThrow(/Invalid enum/);
    expect(() => prepareElementProperties(properties, { position: [1, 2] })).toThrow(/Invalid vector/);
    expect(() => prepareElementProperties(properties, { scope: 2 })).toThrow(/not editable/);
    expect(merged).toBe(false);
  });

  test("checks native format conditions and bounds expensive spline resolution", () => {
    const properties: Record<string, NativeProperty> = {
      radial_resolution: { type: "number", merge() { } },
      optional: { type: "boolean", condition: () => false, merge() { } },
    };
    setGlobal("Condition", () => false);
    expect(() => prepareElementProperties(properties, { optional: true }, {} as OutlinerNode)).toThrow(/unavailable/);
    expect(() => prepareElementProperties(properties, { radial_resolution: 1000 })).toThrow(/between 3 and 64/);
  });

  test("rejects incomplete or ambiguous controller graphs before resolving animations", () => {
    const states = (input: unknown) => controllerStatesSchema.parse(input);
    expect(() => prepareControllerGraph(states([{ name: "idle" }, { name: "idle" }]), "idle")).toThrow(/unique/);
    expect(() => prepareControllerGraph(states([{ name: "idle" }]), "missing")).toThrow(/Initial state/);
    expect(() => prepareControllerGraph(states([{ name: "idle", transitions: [{ target: "walk", condition: "1" }] }]), "idle")).toThrow(/missing state/);
  });

  test("includes partially imported animations in the Undo rollback aspects", async () => {
    const animations: unknown[] = [];
    const controllers: unknown[] = [];
    let aspects: { animations: unknown[]; animation_controllers: unknown[] } | undefined;
    setGlobal("Format", { id: "free", animation_mode: true });
    setGlobal("Animator", { animations });
    setGlobal("AnimationController", { all: controllers });
    setGlobal("AnimationCodec", {
      codecs: {
        failing: {
          id: "failing", loadFile() {
            animations.push({ uuid: "partially-imported" });
            throw new Error("Malformed second animation");
          }
        }
      }
    });
    setGlobal("Undo", { initEdit(value: typeof aspects) { aspects = value; } });
    const tool = animationFileTools.find(tool => tool.name === "import_animations")!;
    await expect(tool.execute(tool.parameters.parse({ codec_id: "failing", content: "{}" }), { project: {} as ModelProject })).rejects.toThrow(/Malformed second/);
    expect(aspects?.animations).toEqual([{ uuid: "partially-imported" }]);
    expect(aspects?.animation_controllers).toEqual([]);
  });

  test("refuses duplicate animation exports before invoking a codec", async () => {
    const animation = { uuid: "animation-id", name: "animation.idle" };
    setGlobal("Animator", { animations: [animation] });
    const tool = animationFileTools.find(tool => tool.name === "export_animations")!;
    await expect(tool.execute(tool.parameters.parse({ ids: ["animation-id", "animation-id"] }), { project: {} as ModelProject })).rejects.toThrow(/must be unique/);
  });
});
