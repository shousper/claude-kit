import { describe, it, expect, afterEach } from "bun:test";
import { access, readdir, readFile, stat } from "fs/promises";
import { join } from "path";
import { createWorkspace, encodeCwd, type Workspace } from "./workspace-manager";

let workspaces: Workspace[] = [];

afterEach(async () => {
  for (const ws of workspaces) {
    await ws.cleanup();
  }
  workspaces = [];
});

async function exists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false);
}

describe("createWorkspace", () => {
  it("creates a workspace with fixture files and git repo", async () => {
    const ws = await createWorkspace();
    workspaces.push(ws);

    // Has workspace files
    expect(await exists(join(ws.cwd, "package.json"))).toBe(true);
    expect(await exists(join(ws.cwd, "src/index.ts"))).toBe(true);
    expect(await exists(join(ws.cwd, "src/auth/login.ts"))).toBe(true);
    expect(await exists(join(ws.cwd, "CLAUDE.md"))).toBe(true);

    // Has a git repo
    const gitStat = await stat(join(ws.cwd, ".git"));
    expect(gitStat.isDirectory()).toBe(true);

    // Strips nesting guard env vars
    expect(ws.env.CLAUDECODE).toBeUndefined();
    expect(ws.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    // Preserves normal env
    expect(ws.env.PATH).toBe(process.env.PATH);
    expect(ws.env.HOME).toBe(process.env.HOME);
    // Sets CLAUDE_CONFIG_DIR for isolation
    expect(ws.env.CLAUDE_CONFIG_DIR).toBe(ws.configDir);

    // No session by default
    expect(ws.sessionId).toBeUndefined();
  });

  it("installs OAuth credentials into the config dir", async () => {
    const ws = await createWorkspace();
    workspaces.push(ws);

    // .credentials.json exists with restricted permissions
    expect(await exists(join(ws.configDir, ".credentials.json"))).toBe(true);
    const credContent = await readFile(join(ws.configDir, ".credentials.json"), "utf-8");
    const creds = JSON.parse(credContent);
    expect(creds.claudeAiOauth).toBeDefined();
    expect(creds.claudeAiOauth.accessToken).toBeDefined();

    // .claude.json (account metadata) exists
    expect(await exists(join(ws.configDir, ".claude.json"))).toBe(true);
    const metaContent = await readFile(join(ws.configDir, ".claude.json"), "utf-8");
    const meta = JSON.parse(metaContent);
    expect(meta.oauthAccount).toBeDefined();
  });

  it("cleans up workspace and config dir", async () => {
    const ws = await createWorkspace({ session: "post-brainstorm" });
    const { cwd, configDir } = ws;

    expect(await exists(cwd)).toBe(true);
    expect(await exists(configDir)).toBe(true);

    await ws.cleanup();

    expect(await exists(cwd)).toBe(false);
    expect(await exists(configDir)).toBe(false);
  });

  it("installs a session fixture with placeholders replaced", async () => {
    const ws = await createWorkspace({ session: "post-brainstorm" });
    workspaces.push(ws);

    expect(ws.sessionId).toBeDefined();

    // Session file should exist in the config dir's project directory
    const projectDir = join(ws.configDir, "projects", encodeCwd(ws.cwd));
    const files = await readdir(projectDir);
    const sessionFile = files.find((f) => f.endsWith(".jsonl"));
    expect(sessionFile).toBe(`${ws.sessionId}.jsonl`);

    // Session content should have placeholders replaced
    const content = await readFile(join(projectDir, sessionFile!), "utf-8");
    expect(content).not.toContain("{{CWD}}");
    expect(content).not.toContain("{{SESSION_ID}}");
    expect(content).not.toContain("{{UUID_");
    expect(content).toContain(ws.cwd);
    expect(content).toContain(ws.sessionId!);
  });

  it("installs mid-session fixture", async () => {
    const ws = await createWorkspace({ session: "mid-session" });
    workspaces.push(ws);
    expect(ws.sessionId).toBeDefined();

    const projectDir = join(ws.configDir, "projects", encodeCwd(ws.cwd));
    const files = await readdir(projectDir);
    expect(files.some((f) => f.endsWith(".jsonl"))).toBe(true);
  });

  it("creates a workspace from a named variant", async () => {
    const ws = await createWorkspace({ workspace: "go" });
    workspaces.push(ws);

    expect(await exists(join(ws.cwd, "go.mod"))).toBe(true);
    expect(await exists(join(ws.cwd, "cmd/server/main.go"))).toBe(true);
    expect(await exists(join(ws.cwd, "CLAUDE.md"))).toBe(true);
    // Should NOT have default workspace files
    expect(await exists(join(ws.cwd, "package.json"))).toBe(false);
  });

  it("encodes cwd path like Claude CLI does", async () => {
    const ws = await createWorkspace({ session: "post-brainstorm" });
    workspaces.push(ws);

    const encoded = encodeCwd(ws.cwd);
    const projectDir = join(ws.configDir, "projects", encoded);
    expect(await exists(projectDir)).toBe(true);

    // Encoded dir starts with - and contains only alphanumeric + dashes
    expect(encoded).toMatch(/^-/);
    expect(encoded).toMatch(/^[a-zA-Z0-9-]+$/);
  });
});
