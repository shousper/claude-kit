import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { KIT_ROOT, MARKETPLACE_DIR, STORIES_ROOT } from "../utils/paths";

const marketplaceJson = JSON.parse(
  readFileSync(resolve(MARKETPLACE_DIR, "marketplace.json"), "utf-8"),
);

const PLUGINS: Record<string, string> = { kit: KIT_ROOT, stories: STORIES_ROOT };

for (const [name, root] of Object.entries(PLUGINS)) {
  describe(`${name} plugin.json`, () => {
    const pluginJson = JSON.parse(
      readFileSync(resolve(root, ".claude-plugin/plugin.json"), "utf-8"),
    );

    it("is valid JSON with required fields", () => {
      expect(typeof pluginJson.name).toBe("string");
      expect(typeof pluginJson.description).toBe("string");
      expect(typeof pluginJson.version).toBe("string");
      expect(typeof pluginJson.author).toBe("object");
      expect(pluginJson.author).not.toBeNull();
    });

    it("version is semver", () => {
      expect(pluginJson.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("has license", () => {
      expect(typeof pluginJson.license).toBe("string");
      expect(pluginJson.license.length).toBeGreaterThan(0);
    });

    it("name matches its plugins/ directory", () => {
      expect(pluginJson.name).toBe(name);
    });

    it("marketplace entry agrees on name and version", () => {
      const entry = marketplaceJson.plugins.find((p: any) => p.name === pluginJson.name);
      expect(entry).toBeDefined();
      expect(entry.version).toBe(pluginJson.version);
    });
  });
}

describe("marketplace.json", () => {
  it("is valid JSON with required fields", () => {
    expect(typeof marketplaceJson.name).toBe("string");
    expect(typeof marketplaceJson.description).toBe("string");
    expect(typeof marketplaceJson.owner).toBe("object");
    expect(marketplaceJson.owner).not.toBeNull();
    expect(Array.isArray(marketplaceJson.plugins)).toBe(true);
  });

  it("each plugin entry has name, version, and source", () => {
    for (const plugin of marketplaceJson.plugins) {
      expect(typeof plugin.name).toBe("string");
      expect(typeof plugin.version).toBe("string");
      expect(typeof plugin.source).toBe("string");
    }
  });

  it("lists exactly kit and stories, sourced from plugins/", () => {
    expect(marketplaceJson.plugins.map((p: any) => p.name).sort()).toEqual(["kit", "stories"]);
    for (const plugin of marketplaceJson.plugins) {
      expect(plugin.source).toBe(`./plugins/${plugin.name}`);
    }
  });
});
