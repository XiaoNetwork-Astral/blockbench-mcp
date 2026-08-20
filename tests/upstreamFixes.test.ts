import { describe, expect, test } from "bun:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import { addGroupParameters } from "@/server/tools/element";
import { applyKeyframeValues, applyTextureRenderSettings } from "@/lib/toolFixes";

describe("upstream issue regressions", () => {
  test("add_group advertises independent optional vectors with defaults", () => {
    const parsed = (addGroupParameters as any).parse({ name: "test" }) as {
      origin: number[];
      rotation: number[];
    };
    expect(parsed.origin).toEqual([0, 0, 0]);
    expect(parsed.rotation).toEqual([0, 0, 0]);
    expect(addGroupParameters.shape.origin).not.toBe(addGroupParameters.shape.rotation);

    const schema = zodToJsonSchema(addGroupParameters as any, { $refStrategy: "root" }) as {
      properties?: Record<string, { type?: string; $ref?: string }>;
      required?: string[];
    };
    expect(schema.properties?.origin.type).toBe("array");
    expect(schema.properties?.rotation.type).toBe("array");
    expect(schema.properties?.rotation.$ref).toBeUndefined();
    expect(schema.required).toEqual(["name"]);
  });

  test("texture render settings reach the final texture and rebuild material", () => {
    let updates = 0;
    const texture = {
      render_mode: "default",
      render_sides: "auto",
      updateMaterial: () => { updates += 1; },
    };
    applyTextureRenderSettings(texture, "emissive", "double");
    expect(texture.render_mode).toBe("emissive");
    expect(texture.render_sides).toBe("double");
    expect(updates).toBe(1);
  });

  test("keyframe values are applied per axis, including zero and non-uniform scale", () => {
    const values = { x: 1, y: 1, z: 1 };
    const keyframe = {
      uniform: true,
      set(axis: "x" | "y" | "z", value: number) {
        values[axis] = value;
      },
    };
    applyKeyframeValues(keyframe, [0, 2.5, 0]);
    expect(keyframe.uniform).toBe(false);
    expect(values).toEqual({ x: 0, y: 2.5, z: 0 });

    keyframe.uniform = true;
    applyKeyframeValues(keyframe, 0);
    expect(values).toEqual({ x: 0, y: 0, z: 0 });
  });
});
