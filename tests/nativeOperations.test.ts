import { afterEach, describe, expect, test } from "bun:test";
import { prepareElementProperties, type NativeProperty } from "@/src/blockbench/elementProperties";

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

});
