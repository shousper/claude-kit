import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { ROOT } from "../utils/paths";

const README = readFileSync(resolve(ROOT, "README.md"), "utf-8");

const RETIRED = [
  "gofmt.sh", "rustfmt.sh", "eslint.sh", "typescript.sh",
  "clippy.sh", "cargo-check.sh", "hcl-record.sh", "hcl-fmt.sh",
];

describe("README.md hooks documentation", () => {
  it("documents the unified pipeline scripts", () => {
    expect(README).toContain("record.sh");
    expect(README).toContain("format-on-stop.sh");
  });

  it("does not reference any retired per-edit script", () => {
    for (const dead of RETIRED) {
      expect(README).not.toContain(dead);
    }
  });
});
