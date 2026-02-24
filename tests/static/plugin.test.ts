import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { PLUGIN_DIR } from "../utils/paths";

const pluginJson = JSON.parse(readFileSync(resolve(PLUGIN_DIR, "plugin.json"), "utf-8"));
const marketplaceJson = JSON.parse(readFileSync(resolve(PLUGIN_DIR, "marketplace.json"), "utf-8"));

describe("plugin.json", () => {
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
});

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
});

describe("version consistency", () => {
  it("plugin.json and marketplace.json agree on name and version", () => {
    const matchingPlugin = marketplaceJson.plugins.find((p: any) => p.name === pluginJson.name);
    expect(matchingPlugin).toBeDefined();
    expect(matchingPlugin.version).toBe(pluginJson.version);
  });
});
