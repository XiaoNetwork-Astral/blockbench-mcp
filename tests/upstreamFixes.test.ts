import { describe, expect, test } from "bun:test";
import { zodToJsonSchema } from "zod-to-json-schema";
import { addGroupParameters } from "@/server/tools/element";
import {
  CUBE_FACE_KEYS,
  applyCubeTextureMapping,
  applyKeyframeValues,
  applyTextureCreationSettings,
  applyTextureRenderSettings,
  getDeterministicShapeGeometry,
  scaleProjectElementUvs,
  type CubeFaceKey,
  type CubeFaceUV,
} from "@/lib/toolFixes";
import { vec3 } from "@/lib/zodObjects";
import { applyTexturePixelsParameters } from "@/server/tools/exact-texture";
import { createTextureParameters } from "@/server/tools/texture";
import {
  displayToolDocs,
  hasDisplayTransformChange,
  setDisplayTransformParameters,
} from "@/server/tools/display";

describe("upstream issue regressions", () => {
  test("add_group advertises independent optional vectors and a root default", () => {
    const parsed = (addGroupParameters as any).parse({ name: "test" }) as {
      origin: number[];
      rotation: number[];
      parent: string;
    };
    expect(parsed.origin).toEqual([0, 0, 0]);
    expect(parsed.rotation).toEqual([0, 0, 0]);
    expect(parsed.parent).toBe("root");
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

  test("custom cube face UVs switch out of Box UV and retain the requested texture", () => {
    const calls: Array<unknown> = [];
    const faces = Object.fromEntries(CUBE_FACE_KEYS.map((key) => [key, {
      texture: "old-texture",
      uv: undefined as CubeFaceUV | undefined,
      extend(data: { texture?: string; uv?: CubeFaceUV }) {
        Object.assign(this, data);
      },
    }]));
    const cube = {
      faces,
      setUVMode(boxUv: boolean) { calls.push(["setUVMode", boxUv]); },
      applyTexture(texture: { uuid: string }, selected: true | undefined | CubeFaceKey[]) {
        calls.push(["applyTexture", selected]);
        const keys = selected === true || selected === undefined
          ? CUBE_FACE_KEYS
          : selected;
        keys.forEach((key) => { faces[key].texture = texture.uuid; });
      },
      mapAutoUV() { calls.push(["mapAutoUV"]); },
    };

    applyCubeTextureMapping(
      cube,
      { uuid: "requested-texture" },
      { north: [1, 2, 3, 4] },
      true
    );

    expect(calls).toEqual([
      ["setUVMode", false],
      ["applyTexture", true],
    ]);
    expect(faces.north).toMatchObject({
      texture: "requested-texture",
      uv: [1, 2, 3, 4],
    });
  });

  test("automatic cube UV mapping cannot replace the requested face texture", () => {
    const faces = Object.fromEntries(CUBE_FACE_KEYS.map((key) => [key, {
      texture: "old-texture",
      extend(data: { texture?: string; uv?: CubeFaceUV }) {
        Object.assign(this, data);
      },
    }]));
    const cube = {
      faces,
      setUVMode() {},
      applyTexture(texture: { uuid: string }, selected: true | undefined | CubeFaceKey[]) {
        const keys = selected === true || selected === undefined
          ? CUBE_FACE_KEYS
          : selected;
        keys.forEach((key) => { faces[key].texture = texture.uuid; });
      },
      mapAutoUV() {
        CUBE_FACE_KEYS.forEach((key) => { faces[key].texture = "mapping-default"; });
      },
    };

    applyCubeTextureMapping(
      cube,
      { uuid: "requested-texture" },
      undefined,
      ["north"]
    );

    expect(faces.north.texture).toBe("requested-texture");
    expect(faces.south.texture).toBe("mapping-default");
  });

  test("texture creation reapplies requested identity, dimensions, and render settings", () => {
    let materialUpdates = 0;
    const texture = {
      name: "source-file.png",
      width: 16,
      height: 16,
      uv_width: 16,
      uv_height: 16,
      group: "",
      pbr_channel: "color",
      render_mode: "default",
      render_sides: "auto",
      updateMaterial() { materialUpdates += 1; },
    };

    applyTextureCreationSettings(texture, {
      name: "requested.png",
      width: 64,
      height: 32,
      group: "group-id",
      pbrChannel: "normal",
      renderMode: "emissive",
      renderSides: "double",
    });

    expect(texture).toMatchObject({
      name: "requested.png",
      width: 64,
      height: 32,
      uv_width: 64,
      uv_height: 32,
      group: "group-id",
      pbr_channel: "normal",
      render_mode: "emissive",
      render_sides: "double",
    });
    expect(materialUpdates).toBe(1);
  });

  test("texture creation preserves source dimensions unless both overrides are explicit", () => {
    const natural = (createTextureParameters as any).parse({
      name: "natural.png",
      data: "D:\\textures\\natural.png",
    });
    expect(natural.width).toBeUndefined();
    expect(natural.height).toBeUndefined();

    expect((createTextureParameters as any).parse({ name: "blank.png" })).toMatchObject({
      name: "blank.png",
    });
    expect(() => (createTextureParameters as any).parse({
      name: "broken.png",
      data: "D:\\textures\\natural.png",
      width: 80,
    })).toThrow(/width.*height|height.*width/i);
  });

  test("deterministic shape geometry handles reverse rectangles and centered ellipses", () => {
    expect(getDeterministicShapeGeometry(
      "rectangle_h",
      { x: 8, y: 7 },
      { x: 3, y: 2 }
    )).toEqual({
      kind: "rectangle",
      x: 3,
      y: 2,
      width: 6,
      height: 6,
    });

    expect(getDeterministicShapeGeometry(
      "ellipse",
      { x: 10, y: 12 },
      { x: 13, y: 8 }
    )).toEqual({
      kind: "ellipse",
      centerX: 10.5,
      centerY: 12.5,
      radiusX: 3.5,
      radiusY: 4.5,
    });
  });

  test("project resolution scaling covers box, cube-face, and mesh UV layouts", () => {
    const boxUvCube = {
      box_uv: true,
      uv_offset: [3, 5],
      faces: { north: { uv: [1, 2, 3, 4] } },
    };
    const faceUvCube = {
      box_uv: false,
      faces: { north: { uv: [1, 2, 3, 4] } },
    };
    const mesh = {
      faces: {
        face: { uv: { a: [1, 2], b: [3, 4] } },
      },
    };

    scaleProjectElementUvs([boxUvCube, faceUvCube, mesh], 4, 2);

    expect(boxUvCube.uv_offset).toEqual([12, 10]);
    expect(boxUvCube.faces.north.uv).toEqual([1, 2, 3, 4]);
    expect(faceUvCube.faces.north.uv).toEqual([4, 4, 12, 8]);
    expect(mesh.faces.face.uv).toEqual({ a: [4, 4], b: [12, 8] });
  });

  test("fixed-length tool arrays avoid unsupported JSON Schema tuple items", () => {
    const vectorSchema = zodToJsonSchema(vec3(), { $refStrategy: "root" }) as {
      items?: unknown;
      minItems?: number;
      maxItems?: number;
    };
    const pixelSchema = (zodToJsonSchema as any)(applyTexturePixelsParameters, {
      $refStrategy: "root",
    }) as any;
    const rgbaItems = pixelSchema.properties.pixels.items.properties.rgba.items;

    expect(Array.isArray(vectorSchema.items)).toBe(false);
    expect(vectorSchema).toMatchObject({ minItems: 3, maxItems: 3 });
    expect(Array.isArray(rgbaItems)).toBe(false);
  });

  test("display tools use bounded slots and reject empty transform intents", () => {
    expect(displayToolDocs.map(({ name }) => name)).toEqual([
      "get_display_transform",
      "set_display_transform",
      "enter_display_mode",
    ]);
    expect(() => setDisplayTransformParameters.parse({
      slot: "invalid_slot",
      scale: [1, 1, 1],
    })).toThrow();

    const noChange = setDisplayTransformParameters.parse({ slot: "gui" });
    const scaleChange = setDisplayTransformParameters.parse({
      slot: "gui",
      scale: [1, 2, 1],
    });
    expect(hasDisplayTransformChange(noChange)).toBe(false);
    expect(hasDisplayTransformChange(scaleChange)).toBe(true);
  });
});
