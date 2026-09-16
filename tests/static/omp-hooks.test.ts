import { describe, it, expect } from "bun:test";
import { homedir } from "os";
import { resolve } from "path";
import { collectEditedPaths, buildFormatCommand, resolveStateDir, createHandlers, type ExecOpts, type ExecResult, type HookHandlerDeps } from "../../plugins/kit-omp/omp/hooks";

const PLUGIN_ROOT = "/plugin-root";
const CWD = "/work";

describe("collectEditedPaths", () => {
  it("returns the path for a write tool result", () => {
    expect(collectEditedPaths("write", { path: "/proj/a.go" }, CWD)).toEqual(["/proj/a.go"]);
  });

  it("returns the path for an edit tool result", () => {
    expect(collectEditedPaths("edit", { path: "/proj/b.rs" }, CWD)).toEqual(["/proj/b.rs"]);
  });

  it("returns the path for an apply_patch tool result (edit's wire name in apply_patch mode)", () => {
    expect(collectEditedPaths("apply_patch", { path: "/proj/c.ts" }, CWD)).toEqual(["/proj/c.ts"]);
  });

  it("resolves a relative path against the session cwd, not the process cwd", () => {
    expect(collectEditedPaths("write", { path: "src/a.go" }, "/repo/.worktrees/st-1")).toEqual(["/repo/.worktrees/st-1/src/a.go"]);
  });

  it("reads every file of a multi-file hashline batch, deduplicated", () => {
    expect(collectEditedPaths("edit", { paths: ["a.go", "/abs/b.rs", "a.go"] }, CWD)).toEqual(["/work/a.go", "/abs/b.rs"]);
  });

  it("ignores reads — read is not a file-editing tool", () => {
    expect(collectEditedPaths("read", { path: "/proj/a.go" }, CWD)).toEqual([]);
  });

  it("ignores unrelated tools (bash, grep, custom tools)", () => {
    expect(collectEditedPaths("bash", { command: "ls" }, CWD)).toEqual([]);
    expect(collectEditedPaths("grep", { pattern: "foo" }, CWD)).toEqual([]);
    expect(collectEditedPaths("my_custom_tool", { path: "/proj/a.go" }, CWD)).toEqual([]);
  });

  it("returns nothing when input carries no path field", () => {
    expect(collectEditedPaths("write", { content: "x" }, CWD)).toEqual([]);
  });

  it("returns nothing when input is undefined or null", () => {
    expect(collectEditedPaths("write", undefined, CWD)).toEqual([]);
    expect(collectEditedPaths("write", null, CWD)).toEqual([]);
  });

  it("skips path entries that are not non-empty strings", () => {
    expect(collectEditedPaths("write", { path: "" }, CWD)).toEqual([]);
    expect(collectEditedPaths("write", { path: 42 as unknown as string }, CWD)).toEqual([]);
    expect(collectEditedPaths("edit", { paths: ["", 7, "/abs/ok.ts"] }, CWD)).toEqual(["/abs/ok.ts"]);
  });
});

describe("buildFormatCommand", () => {
  it("resolves the shared format-files.sh script under hooks/, followed by the file args", () => {
    const command = buildFormatCommand(PLUGIN_ROOT, ["/proj/a.go", "/proj/b.rs"]);
    expect(command).toEqual([resolve(PLUGIN_ROOT, "hooks/format-files.sh"), "/proj/a.go", "/proj/b.rs"]);
  });

  it("produces just the script path when there are no files", () => {
    expect(buildFormatCommand(PLUGIN_ROOT, [])).toEqual([resolve(PLUGIN_ROOT, "hooks/format-files.sh")]);
  });
});

describe("resolveStateDir", () => {
  it("uses KIT_STATE_DIR when set", () => {
    expect(resolveStateDir({ KIT_STATE_DIR: "/tmp/kit-state" })).toBe("/tmp/kit-state");
  });

  it("falls back to ~/.omp/kit/state when KIT_STATE_DIR is unset", () => {
    expect(resolveStateDir({})).toBe(resolve(homedir(), ".omp", "kit", "state"));
  });

  it("ignores an empty-string KIT_STATE_DIR and falls back", () => {
    expect(resolveStateDir({ KIT_STATE_DIR: "" })).toBe(resolve(homedir(), ".omp", "kit", "state"));
  });
});

// --- createHandlers: injected-deps behavior, no OMP runtime required -------

function fakeDeps(execImpl?: (command: string, args: string[]) => Promise<ExecResult>): HookHandlerDeps & {
  sentMessages: string[];
  notifications: string[];
  execCalls: { command: string; args: string[]; opts: ExecOpts }[];
} {
  const sentMessages: string[] = [];
  const notifications: string[] = [];
  const execCalls: { command: string; args: string[]; opts: ExecOpts }[] = [];
  return {
    sentMessages,
    notifications,
    execCalls,
    exec: async (command, args, opts) => {
      execCalls.push({ command, args, opts });
      if (execImpl) return execImpl(command, args);
      return { stdout: "", stderr: "", code: 0 };
    },
    sendMessage: (text) => sentMessages.push(text),
    notify: (message) => notifications.push(message),
  };
}

const formatCall = (cwd: string, ...files: string[]) => ({ command: resolve(PLUGIN_ROOT, "hooks/format-files.sh"), args: files, opts: { cwd } });

const ctxFor = (sessionId: string, cwd = "/work") => ({ cwd, hasUI: true, sessionManager: { getSessionId: () => sessionId } });

describe("createHandlers: sessionStart", () => {
  it("sends the session-context script's stdout as next-turn context", async () => {
    const deps = fakeDeps(async () => ({ stdout: "  governance block  \n", stderr: "", code: 0 }));
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.sessionStart({}, ctxFor("S1"));

    expect(deps.sentMessages).toEqual(["governance block"]);
    expect(deps.execCalls).toEqual([{ command: resolve(PLUGIN_ROOT, "hooks/session-context.sh"), args: ["/work"], opts: { cwd: "/work" } }]);
  });

  it("sends nothing when the script prints only whitespace", async () => {
    const deps = fakeDeps(async () => ({ stdout: "   \n", stderr: "", code: 0 }));
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.sessionStart({}, ctxFor("S1"));

    expect(deps.sentMessages).toEqual([]);
  });

  it("falls back to process.cwd() when ctx carries no cwd", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.sessionStart({});

    expect(deps.execCalls[0]?.args).toEqual([process.cwd()]);
  });

  it("swallows a throwing exec instead of propagating", async () => {
    const deps = fakeDeps(async () => {
      throw new Error("spawn failed");
    });
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await expect(handlers.sessionStart({}, ctxFor("S1"))).resolves.toBeUndefined();
    expect(deps.sentMessages).toEqual([]);
  });
});

describe("createHandlers: toolResult", () => {
  it("tracks an edited file from a successful write result", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([formatCall("/work", "/proj/a.go")]);
  });

  it("ignores a read tool result", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "read", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([]);
  });

  it("ignores an errored write result", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: true }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([]);
  });

  it("keeps separate sessions' edited files isolated", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.toolResult({ toolName: "write", input: { path: "/proj/b.go" }, isError: false }, ctxFor("S2"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([formatCall("/work", "/proj/a.go")]);
  });

  it("deduplicates repeated edits of the same file within a session", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.toolResult({ toolName: "edit", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([formatCall("/work", "/proj/a.go")]);
  });

  it("records a relative path against the session cwd and formats in that cwd", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);
    const worktree = "/repo/.worktrees/st-1";

    await handlers.toolResult({ toolName: "edit", input: { path: "src/a.go" }, isError: false }, ctxFor("S1", worktree));
    await handlers.sessionStop({}, ctxFor("S1", worktree));

    expect(deps.execCalls).toEqual([formatCall(worktree, `${worktree}/src/a.go`)]);
  });

  it("tracks every file of a multi-file hashline batch", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "edit", input: { paths: ["a.go", "b.rs"] }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([formatCall("/work", "/work/a.go", "/work/b.rs")]);
  });
});

describe("createHandlers: sessionStop clears the Set", () => {
  it("does not re-format the same files on a second stop with no new edits", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toHaveLength(1);
  });

  it("does nothing when nothing was edited", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([]);
  });

  it("surfaces the formatter's stdout summary via notify", async () => {
    const deps = fakeDeps(async () => ({ stdout: "formatted 1 file\n", stderr: "", code: 0 }));
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.notifications).toEqual(["formatted 1 file"]);
  });

  it("never notifies when the formatter prints nothing", async () => {
    const deps = fakeDeps(async () => ({ stdout: "", stderr: "", code: 0 }));
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.notifications).toEqual([]);
  });

  it("swallows a throwing exec, still clearing the Set, without propagating", async () => {
    const deps = fakeDeps(async () => {
      throw new Error("format-files.sh crashed");
    });
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await expect(handlers.sessionStop({}, ctxFor("S1"))).resolves.toBeUndefined();
    expect(deps.notifications).toEqual([]);

    // The Set was cleared despite the throw: a second stop makes no further exec call.
    deps.execCalls.length = 0;
    await handlers.sessionStop({}, ctxFor("S1"));
    expect(deps.execCalls).toEqual([]);
  });
});

describe("createHandlers: agentEnd", () => {
  it("flushes the same way sessionStop does", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "apply_patch", input: { path: "/proj/a.py" }, isError: false }, ctxFor("S1"));
    await handlers.agentEnd({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([formatCall("/work", "/proj/a.py")]);
  });

  it("clears the Set so a later sessionStop finds nothing left", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.agentEnd({}, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toHaveLength(1);
  });
});

describe("createHandlers: shared state across repeated calls", () => {
  it("persists edited files across separate createHandlers(...) calls given the same Map", async () => {
    const deps = fakeDeps();
    const shared = new Map<string, Set<string>>();

    await createHandlers(PLUGIN_ROOT, deps, shared).toolResult(
      { toolName: "write", input: { path: "/proj/a.go" }, isError: false },
      ctxFor("S1"),
    );
    await createHandlers(PLUGIN_ROOT, deps, shared).sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([formatCall("/work", "/proj/a.go")]);
  });
});
