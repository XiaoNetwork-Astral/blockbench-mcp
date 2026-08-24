import { describe, expect, test } from "bun:test";
import { translations } from "@/ui/i18n";

function placeholders(value: string): string[] {
  return [...value.matchAll(/%\d+/g)].map((match) => match[0]).sort();
}

describe("plugin translations", () => {
  test("keeps every supported language complete and placeholder-compatible", () => {
    const englishKeys = Object.keys(translations.en).sort();
    expect(englishKeys.length).toBeGreaterThan(0);

    for (const [language, strings] of Object.entries(translations)) {
      expect(Object.keys(strings).sort(), language).toEqual(englishKeys);
      for (const key of englishKeys) {
        expect(strings[key].trim().length, `${language}:${key}`).toBeGreaterThan(0);
        expect(placeholders(strings[key]), `${language}:${key}`).toEqual(
          placeholders(translations.en[key])
        );
      }
    }
  });

  test("localizes the project read-only warning", () => {
    expect(translations.en["mcp.project.read_only"]).toBe("Project is read-only");
    expect(translations.de["mcp.project.read_only"]).not.toBe(
      translations.en["mcp.project.read_only"]
    );
    expect(translations.ja["mcp.project.read_only"]).not.toBe(
      translations.en["mcp.project.read_only"]
    );
    expect(translations.zh["mcp.project.read_only"]).not.toBe(
      translations.en["mcp.project.read_only"]
    );
  });

  test("does not retain removed legacy UI strings", () => {
    for (const strings of Object.values(translations)) {
      expect(strings).not.toHaveProperty("mcp.panel.sessions");
      expect(strings).not.toHaveProperty("mcp.settings.prompt_cdn_name");
      expect(strings).not.toHaveProperty("mcp.dialog.result_title");
      expect(strings).not.toHaveProperty("mcp.settings.temporary_directory_name");
    }
  });
});
