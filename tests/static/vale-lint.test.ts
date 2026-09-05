import { describe, it, expect } from "bun:test";
import { mkdtemp, writeFile, rm, cp, realpath } from "fs/promises";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { runNeutralScript } from "../utils/hook-workspace";
import { ROOT, WRITING_HOOKS_DIR } from "../utils/paths";

const HAS_VALE = Bun.which("vale") !== null;
const FIXTURES = resolve(ROOT, "tests/fixtures/vale");
const lint = (args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) =>
  runNeutralScript("vale-lint.sh", { dir: WRITING_HOOKS_DIR, args, ...opts });

async function git(cwd: string, ...args: string[]): Promise<void> {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "ignore", stderr: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  if ((await proc.exited) !== 0) throw new Error(`git ${args.join(" ")} failed`);
}

describe("vale-lint.sh", () => {
  it("is silent for non-documentation files and missing files", async () => {
    expect((await lint([resolve(ROOT, "package.json")])).stdout).toBe("");
    expect((await lint([resolve(FIXTURES, "missing.md")])).stdout).toBe("");
  });

  it("exits 0 even when it has nothing to do", async () => {
    expect((await lint([])).exitCode).toBe(0);
  });

  describe.skipIf(!HAS_VALE)("with vale installed", () => {
    it("prints nothing for clean prose", async () => {
      const r = await lint([resolve(FIXTURES, "clean.md")]);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("");
    });

    it("prints a grouped, capped summary without the style prefix", async () => {
      const r = await lint([resolve(FIXTURES, "bad.md")], { cwd: FIXTURES });
      const lines = r.stdout.trimEnd().split("\n");
      expect(lines[0]).toMatch(/^vale: \d+ findings in bad\.md$/);
      expect(r.stdout).toMatch(/^  Exclamation x\d+  line \d+ "/m);
      expect(r.stdout).toMatch(/^  \+\d+ more findings across \d+ rules$/m);
      expect(r.stdout).not.toContain("Writing.");
      expect(lines.filter((l) => /^  [A-Za-z]+ x\d+/.test(l)).length).toBeLessThanOrEqual(6);
      expect(lines.length).toBeLessThanOrEqual(14);
    });

    it("in edit mode reports only lines that changed since HEAD", async () => {
      const dir = await mkdtemp(join(tmpdir(), "vale-edit-")).then(realpath);
      const file = join(dir, "doc.md");
      try {
        await git(dir, "init");
        await cp(resolve(FIXTURES, "bad.md"), file);
        await git(dir, "add", ".");
        await git(dir, "commit", "-m", "legacy", "--no-gpg-sign");
        await writeFile(file, `${await Bun.file(file).text()}\nThe migration will simply run overnight.\n`);
        const r = await lint([file, "edit"], { cwd: dir });
        expect(r.stdout).toMatch(/^vale: \d+ findings in doc\.md$/m);
        expect(r.stdout).not.toContain("Exclamation");
        expect(r.stdout).toMatch(/Will|WordList/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("in edit mode prints nothing when the tracked file has no changes", async () => {
      const dir = await mkdtemp(join(tmpdir(), "vale-noop-")).then(realpath);
      const file = join(dir, "doc.md");
      try {
        await git(dir, "init");
        await cp(resolve(FIXTURES, "bad.md"), file);
        await git(dir, "add", ".");
        await git(dir, "commit", "-m", "legacy", "--no-gpg-sign");
        expect((await lint([file, "edit"], { cwd: dir })).stdout.trim()).toBe("");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
