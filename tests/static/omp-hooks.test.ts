import { describe, it, expect } from "bun:test";
import { homedir } from "os";
import { resolve } from "path";
import { collectEditedPath, buildFormatCommand, resolveStateDir, createHandlers, type ExecResult, type HookHandlerDeps } from "../../plugins/kit-omp/omp/hooks";

const PLUGIN_ROOT = "/plugin-root";

describe("collectEditedPath", () => {
  it("returns the path for a write tool result", () => {
    expect(collectEditedPath("write", { path: "/proj/a.go" })).toBe("/proj/a.go");
  });

  it("returns the path for an edit tool result", () => {
    expect(collectEditedPath("edit", { path: "/proj/b.rs" })).toBe("/proj/b.rs");
  });

  it("returns the path for an apply_patch tool result (edit's wire name in apply_patch mode)", () => {
    expect(collectEditedPath("apply_patch", { path: "/proj/c.ts" })).toBe("/proj/c.ts");
  });

  it("ignores reads — read is not a file-editing tool", () => {
    expect(collectEditedPath("read", { path: "/proj/a.go" })).toBeNull();
  });

  it("ignores unrelated tools (bash, grep, custom tools)", () => {
    expect(collectEditedPath("bash", { command: "ls" })).toBeNull();
    expect(collectEditedPath("grep", { pattern: "foo" })).toBeNull();
    expect(collectEditedPath("my_custom_tool", { path: "/proj/a.go" })).toBeNull();
  });

  it("returns null when input carries no path field", () => {
    expect(collectEditedPath("write", { content: "x" })).toBeNull();
  });

  it("returns null when input is undefined or null", () => {
    expect(collectEditedPath("write", undefined)).toBeNull();
    expect(collectEditedPath("write", null)).toBeNull();
  });

  it("returns null when path is present but not a non-empty string", () => {
    expect(collectEditedPath("write", { path: "" })).toBeNull();
    expect(collectEditedPath("write", { path: 42 as unknown as string })).toBeNull();
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
  execCalls: { command: string; args: string[] }[];
} {
  const sentMessages: string[] = [];
  const notifications: string[] = [];
  const execCalls: { command: string; args: string[] }[] = [];
  return {
    sentMessages,
    notifications,
    execCalls,
    exec: async (command, args) => {
      execCalls.push({ command, args });
      if (execImpl) return execImpl(command, args);
      return { stdout: "", stderr: "", code: 0 };
    },
    sendMessage: (text) => sentMessages.push(text),
    notify: (message) => notifications.push(message),
  };
}

const ctxFor = (sessionId: string, cwd = "/work") => ({ cwd, hasUI: true, sessionManager: { getSessionId: () => sessionId } });

describe("createHandlers: sessionStart", () => {
  it("sends the session-context script's stdout as next-turn context", async () => {
    const deps = fakeDeps(async () => ({ stdout: "  governance block  \n", stderr: "", code: 0 }));
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.sessionStart({}, ctxFor("S1"));

    expect(deps.sentMessages).toEqual(["governance block"]);
    expect(deps.execCalls).toEqual([{ command: resolve(PLUGIN_ROOT, "hooks/session-context.sh"), args: ["/work"] }]);
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

    expect(deps.execCalls).toEqual([{ command: resolve(PLUGIN_ROOT, "hooks/format-files.sh"), args: ["/proj/a.go"] }]);
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

    expect(deps.execCalls).toEqual([{ command: resolve(PLUGIN_ROOT, "hooks/format-files.sh"), args: ["/proj/a.go"] }]);
  });

  it("deduplicates repeated edits of the same file within a session", async () => {
    const deps = fakeDeps();
    const handlers = createHandlers(PLUGIN_ROOT, deps);

    await handlers.toolResult({ toolName: "write", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.toolResult({ toolName: "edit", input: { path: "/proj/a.go" }, isError: false }, ctxFor("S1"));
    await handlers.sessionStop({}, ctxFor("S1"));

    expect(deps.execCalls).toEqual([{ command: resolve(PLUGIN_ROOT, "hooks/format-files.sh"), args: ["/proj/a.go"] }]);
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

    expect(deps.execCalls).toEqual([{ command: resolve(PLUGIN_ROOT, "hooks/format-files.sh"), args: ["/proj/a.py"] }]);
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

    expect(deps.execCalls).toEqual([{ command: resolve(PLUGIN_ROOT, "hooks/format-files.sh"), args: ["/proj/a.go"] }]);
  });
});
