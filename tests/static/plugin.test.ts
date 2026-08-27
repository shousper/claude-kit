import { describe, it, expect } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { ROOT, MARKETPLACE_DIR, OMP_MARKETPLACE_DIR, KIT_CLAUDE_ROOT, KIT_OMP_ROOT, STORIES_ROOT } from "../utils/paths";

interface MarketplacePlugin {
  name: string;
  version: string;
  source: string;
}

interface Marketplace {
  name: string;
  description: string;
  owner: Record<string, unknown>;
  plugins: MarketplacePlugin[];
}

function readMarketplace(dir: string): Marketplace {
  // Trusted local repo fixture; shape is asserted by the tests below.
  return JSON.parse(readFileSync(resolve(dir, "marketplace.json"), "utf-8")) as Marketplace;
}

function readPluginJson(root: string): Record<string, unknown> {
  const manifest = root === KIT_OMP_ROOT ? ".omp-plugin/plugin.json" : ".claude-plugin/plugin.json";
  return JSON.parse(readFileSync(resolve(root, manifest), "utf-8"));
}

const claudeMarketplace = readMarketplace(MARKETPLACE_DIR);
const ompMarketplace = readMarketplace(OMP_MARKETPLACE_DIR);

const CATALOGUES: Record<string, Marketplace> = {
  ".claude-plugin/marketplace.json": claudeMarketplace,
  ".omp-plugin/marketplace.json": ompMarketplace,
};

for (const [catalogueName, catalogue] of Object.entries(CATALOGUES)) {
  describe(catalogueName, () => {
    it("is valid JSON with required fields", () => {
      expect(typeof catalogue.name).toBe("string");
      expect(typeof catalogue.owner).toBe("object");
      expect(catalogue.owner).not.toBeNull();
      expect(Array.isArray(catalogue.plugins)).toBe(true);
      expect(catalogue.plugins.length).toBeGreaterThan(0);
    });

    it("each plugin entry has name, version, and source", () => {
      for (const plugin of catalogue.plugins) {
        expect(typeof plugin.name).toBe("string");
        expect(typeof plugin.version).toBe("string");
        expect(typeof plugin.source).toBe("string");
      }
    });

    it("every source path exists on disk", () => {
      for (const plugin of catalogue.plugins) {
        expect(existsSync(resolve(ROOT, plugin.source))).toBe(true);
      }
    });

    it("every referenced plugin has a readable plugin.json whose name agrees with the catalogue entry", () => {
      for (const plugin of catalogue.plugins) {
        const pluginJson = readPluginJson(resolve(ROOT, plugin.source));
        expect(pluginJson.name).toBe(plugin.name);
      }
    });
  });
}

describe("kit plugin dual-harness scoping", () => {
  it("both catalogues share the plugin name kit", () => {
    expect(claudeMarketplace.plugins.map((p) => p.name)).toContain("kit");
    expect(ompMarketplace.plugins.map((p) => p.name)).toContain("kit");
  });

  it("claude catalogue's kit entry resolves to plugins/kit-claude", () => {
    const entry = claudeMarketplace.plugins.find((p) => p.name === "kit");
    expect(entry?.source).toBe("./plugins/kit-claude");
    expect(resolve(ROOT, entry!.source)).toBe(KIT_CLAUDE_ROOT);
  });

  it("omp catalogue's kit entry resolves to plugins/kit-omp", () => {
    const entry = ompMarketplace.plugins.find((p) => p.name === "kit");
    expect(entry?.source).toBe("./plugins/kit-omp");
    expect(resolve(ROOT, entry!.source)).toBe(KIT_OMP_ROOT);
  });

  it("both catalogues point their kit entry at different directories", () => {
    const claudeEntry = claudeMarketplace.plugins.find((p) => p.name === "kit");
    const ompEntry = ompMarketplace.plugins.find((p) => p.name === "kit");
    expect(resolve(ROOT, claudeEntry!.source)).not.toBe(resolve(ROOT, ompEntry!.source));
  });

  it("both kit plugin.json files declare name kit, not a harness-specific name", () => {
    expect(readPluginJson(KIT_CLAUDE_ROOT).name).toBe("kit");
    expect(readPluginJson(KIT_OMP_ROOT).name).toBe("kit");
  });

  it("kit-omp carries no .claude-plugin manifest dir — Claude Code must never validate it", () => {
    expect(existsSync(resolve(KIT_OMP_ROOT, ".claude-plugin"))).toBe(false);
  });
});

describe("stories plugin", () => {
  it("is listed in both catalogues sourced from plugins/stories", () => {
    for (const catalogue of Object.values(CATALOGUES)) {
      const entry = catalogue.plugins.find((p) => p.name === "stories");
      expect(entry?.source).toBe("./plugins/stories");
      expect(resolve(ROOT, entry!.source)).toBe(STORIES_ROOT);
    }
  });
});
