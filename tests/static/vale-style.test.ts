import { describe, it, expect } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { parse as parseYaml } from "yaml";
import { WRITING_VALE_DIR } from "../utils/paths";

const INI = resolve(WRITING_VALE_DIR, ".vale.ini");
const STYLE_DIR = resolve(WRITING_VALE_DIR, "styles/Writing");
const ini = existsSync(INI) ? readFileSync(INI, "utf-8") : "";
const rules = existsSync(STYLE_DIR) ? readdirSync(STYLE_DIR).filter((f) => f.endsWith(".yml")) : [];

describe("shared/writing/vale", () => {
  it("declares the vendored style and a warning floor", () => {
    expect(ini).toMatch(/^StylesPath = styles$/m);
    expect(ini).toMatch(/^MinAlertLevel = warning$/m);
    expect(ini).toMatch(/^BasedOnStyles = Writing$/m);
  });

  it("tunes the rules the design names", () => {
    for (const line of ["Writing.Acronyms = NO", "Writing.Quotes = warning", "Writing.Timeless = warning", "Writing.ExcessiveClaims = warning"]) {
      expect(ini).toContain(line);
    }
  });

  it("vendors the full rule set, every file parseable with a message", () => {
    expect(rules.length).toBeGreaterThanOrEqual(30);
    for (const file of rules) {
      const rule = parseYaml(readFileSync(resolve(STYLE_DIR, file), "utf-8")) as Record<string, unknown>;
      expect(typeof rule.extends, `${file} extends`).toBe("string");
      expect(typeof rule.message, `${file} message`).toBe("string");
    }
  });

  it("keeps the rules named after the design", () => {
    for (const name of ["EmDash", "Exclamation", "We", "Will", "WordList", "Timeless", "ExcessiveClaims", "Passive", "Headings"]) {
      expect(rules, `${name}.yml`).toContain(`${name}.yml`);
    }
  });

  it("carries attribution", () => {
    const notice = readFileSync(resolve(WRITING_VALE_DIR, "NOTICE.md"), "utf-8");
    expect(notice).toContain("MIT");
    expect(notice).toContain("CC BY 4.0");
  });
});
