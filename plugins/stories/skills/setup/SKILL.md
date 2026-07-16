---
name: setup
description: Interactive onboarding that turns a repo into a story-workflow project — merge-mode choice, verification gates with test-runner detection, gitignore wiring, optional project-specific reviewer personas. Use when asked to "set up the story workflow", "adopt stories", "story init", "install the story board", or when stories:plan / stories:work is wanted but .claude/story-workflow.json does not exist yet. DO NOT TRIGGER when .claude/story-workflow.json already exists (use stories:plan to file work, stories:work to execute it), for creating individual stories, or for project scaffolding unrelated to the story workflow.
---

# Story Workflow Setup

An interview, then `story init` writes everything. Never hand-write `.claude/story-workflow.json` — the CLI owns the format.

**Core principle:** every answer becomes committed config; the gates you define here are what `story done` will enforce forever after. Get them runnable, not aspirational.

## Preflight

1. If `.claude/story-workflow.json` exists, this is reconfiguration — show the current config and confirm with your human partner before overwriting anything.
2. Confirm you are at the root of a git repository (`git rev-parse --show-toplevel`). The board, worktrees, and locks are all repo-relative.

## Interview

One topic at a time. Propose detected defaults; the human confirms or corrects.

### 1. Merge mode

| Mode | Who integrates | When to pick |
|---|---|---|
| `self` | The agent merges `story/st-<id>` into main when gates pass | Solo, high trust, fastest iteration |
| `local` | Story parks in-review; human reviews the worktree and merges locally | Solo, human wants eyes on every change |
| `pr` | Push branch + GitHub PR; humans review/merge on GitHub | Teams ("multiplayer") |

If `pr`, probe before accepting the answer:

```bash
gh auth status                                              # must be logged in
git remote get-url origin                                   # must have a remote
gh repo view --json viewerPermission -q .viewerPermission   # must be WRITE or ADMIN
```

Any probe fails → report exactly which one and what it said, and offer `local` as the fallback. Never configure `pr` mode on hope.

### 2. Gates

Detect the test runner from signature files and PROPOSE a `test` command gate:

| Signal | Proposed gate command |
|---|---|
| `bun.lock` / `bun.lockb` | `bun test` |
| `pnpm-lock.yaml` | `pnpm test` |
| `yarn.lock` | `yarn test` |
| `package-lock.json` | `npm test` |
| `Cargo.toml` | `cargo test` |
| `go.mod` | `go test ./...` |
| `pyproject.toml` / `pytest.ini` | `pytest` |
| `Justfile` | inspect `just --list` for test/check recipes |

**Run the proposed command once, now.** A gate that does not pass (or at least run) on the current tree is misconfigured — fix the command, or flag the broken baseline to the human before proceeding.

Then offer optional gates:

- `e2e` — if `playwright.config.*` exists, propose `npx playwright test` as a command gate.
- `visual` — a review gate: a capture command (screenshot script, `just screenshot`, a playwright capture) plus a persona (bundled `visual-reviewer`, or a generated one). Offer only when the project has a UI.
- `lint` / `build` — if the project has obvious commands and the human wants them enforced per story.

Map type defaults: `feature` / `bug` / `chore` → `["test"]`; add a `ui` type mapping to `["test", "visual"]` only if a visual gate was defined.

Budgets: propose the defaults (`maxIterations: 10`, `maxFixRoundsPerStory: 3`); change only on request.

### 3. Optional: project-specific personas

Offer to analyze the project (README, stack, domain) and generate reviewer personas into `.claude/agents/` — an api-contract-reviewer for a service, an art-director for a game. Model them on the bundled templates in stories:work's `references/agents/` directory: inputs are the story file path + evidence paths; output is a single `VERDICT: pass|fail` line plus notes. A gate's `persona` field names the file; `.claude/agents/<name>` wins over bundled templates.

Skip freely — the bundled `qa-reviewer` and `visual-reviewer` cover most projects.

## Apply

1. Assemble the config object and write it to a scratch file, then run `story init --config <file>`. The CLI writes `.claude/story-workflow.json`, scaffolds `stories/` + `stories/archive/`, and prints what it created. Config shape:

   ```json
   {
     "version": 1,
     "storiesDir": "stories",
     "merge": "self",
     "gates": {
       "test":   { "kind": "command", "run": "bun test" },
       "visual": { "kind": "review",  "capture": "just screenshot", "persona": "visual-reviewer" }
     },
     "defaults": { "feature": ["test"], "bug": ["test"], "chore": ["test"] },
     "gateLock": true,
     "budgets": { "maxIterations": 10, "maxFixRoundsPerStory": 3 }
   }
   ```

2. Ensure `.gitignore` contains each of these four lines exactly (append the missing ones; nothing else):

   ```
   .worktrees/
   .claude/*.local.*
   .claude/locks/
   .claude/story-evidence/
   ```

3. Verify: `story doctor` reports a clean board; `cat .claude/story-workflow.json` matches the approved answers.

4. Remind the human to commit `.claude/story-workflow.json` and the `stories/` scaffold — the committed marker is what activates the hooks for every session in this repo. **Same-machine assumption is hard:** parallel workers coordinate through file locks; workers on other machines or network filesystems are not supported.

## Handoff

Setup ends with exactly one of:

- A spec or design exists → invoke stories:plan to decompose it into stories. Do NOT invoke any other skill.
- Nothing to plan yet → stop. Tell the human: file work later with stories:plan; execute with stories:work.

## Red Flags

**Never:**

- Write `.claude/story-workflow.json` by hand — always through `story init`.
- Configure a gate command you have not executed successfully at least once.
- Configure `pr` mode with failing `gh` probes.
- Invent gates the project cannot support (no UI → no visual gate).
- Skip the gitignore entries — loop state and locks must never be committed.
