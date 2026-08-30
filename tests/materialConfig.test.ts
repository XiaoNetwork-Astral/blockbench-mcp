import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import {
  applyMaterialChannelAssignments,
  assignTexturesToGroup,
  resolveMaterialConfigPath,
} from "@/lib/materialConfig";

function texture(uuid: string, group: string, channel: string) {
  return {
    uuid,
    name: uuid,
    group,
    pbr_channel: channel,
  };
}

describe("PBR material configuration", () => {
  test("replaces one channel without changing unrelated channels", () => {
    const oldNormal = texture("old-normal", "steel", "normal");
    const color = texture("color", "steel", "color");
    const nextNormal = texture("next-normal", "", "color");
    const result = applyMaterialChannelAssignments(
      "steel",
      [oldNormal, color, nextNormal],
      { normal: nextNormal }
    );

    expect(oldNormal.group).toBe("");
    expect(color).toMatchObject({ group: "steel", pbr_channel: "color" });
    expect(nextNormal).toMatchObject({ group: "steel", pbr_channel: "normal" });
    expect(result).toEqual({ assigned: { normal: "next-normal" }, detached: ["old-normal"] });
  });

  test("clears a channel for a uniform value", () => {
    const mer = texture("mer", "steel", "mer");
    expect(applyMaterialChannelAssignments("steel", [mer], { mer: null })).toEqual({
      assigned: {},
      detached: ["mer"],
    });
    expect(mer.group).toBe("");
  });

  test("does not call Texture.extend for channel-only changes", () => {
    const normal = {
      ...texture("normal", "", "color"),
      extend() {
        throw new Error("Blockbench Texture.extend touched unrelated layer state");
      },
    };
    expect(() => applyMaterialChannelAssignments("steel", [normal], { normal })).not.toThrow();
    expect(normal).toMatchObject({ group: "steel", pbr_channel: "normal" });
  });

  test("adds existing textures to a group without calling Texture.extend", () => {
    const textures = [
      { uuid: "color", group: "", extend: () => { throw new Error("extend must not run"); } },
      { uuid: "normal", group: "old", extend: () => { throw new Error("extend must not run"); } },
    ];

    expect(assignTexturesToGroup("material", textures)).toEqual(["color", "normal"]);
    expect(textures.map((texture) => texture.group)).toEqual(["material", "material"]);
  });

  test("resolves Windows config paths", () => {
    const pathApi = path.win32;
    const explicit = "D:\\output\\steel.texture_set.json";
    expect(resolveMaterialConfigPath({
      explicitPath: explicit,
      materialName: "Steel",
      pathApi,
    })).toBe(explicit);

    expect(resolveMaterialConfigPath({
      nativePath: ".texture_set.json",
      colorTexturePath: "textures\\katana.png",
      projectSavePath: "D:\\models\\katana.bbmodel",
      materialName: "Katana Steel",
      pathApi,
    })).toBe("D:\\models\\textures\\Katana Steel.texture_set.json");

    expect(resolveMaterialConfigPath({
      nativePath: ".texture_set.json",
      projectSavePath: "D:\\models\\katana.bbmodel",
      materialName: "Katana Steel",
      pathApi,
    })).toBe("D:\\models\\Katana Steel.texture_set.json");
  });

  test("resolves POSIX config paths", () => {
    const pathApi = path.posix;
    const explicit = "/output/steel.texture_set.json";
    expect(resolveMaterialConfigPath({
      explicitPath: explicit,
      materialName: "Steel",
      pathApi,
    })).toBe(explicit);

    expect(resolveMaterialConfigPath({
      nativePath: ".texture_set.json",
      colorTexturePath: "textures/katana.png",
      projectSavePath: "/models/katana.bbmodel",
      materialName: "Katana Steel",
      pathApi,
    })).toBe("/models/textures/Katana Steel.texture_set.json");

    expect(resolveMaterialConfigPath({
      nativePath: ".texture_set.json",
      projectSavePath: "/models/katana.bbmodel",
      materialName: "Katana Steel",
      pathApi,
    })).toBe("/models/Katana Steel.texture_set.json");
  });

  test("refuses relative explicit paths and unsaved ambiguous materials", () => {
    expect(() => resolveMaterialConfigPath({
      explicitPath: "steel.texture_set.json",
      materialName: "Steel",
      pathApi: path,
    })).toThrow("absolute");
    expect(() => resolveMaterialConfigPath({ materialName: "Steel", pathApi: path })).toThrow(
      "ambiguous"
    );
  });
});
