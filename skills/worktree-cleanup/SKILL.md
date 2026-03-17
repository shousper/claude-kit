---
name: worktree-cleanup
description: Removes git worktrees safely, cleans up associated branches, and pulls latest mainline after removal. Use when finished with a worktree, done with a branch, cleaning up after a merge or PR, abandoning work in a worktree, or when "git worktree list" shows stale entries. Checks for uncommitted changes, verifies no open PRs before branch deletion, and handles force-removal of locked worktrees.
---

# Worktree Cleanup

## Overview

Clean up a git worktree after work is complete (merged, PR created, or abandoned). Updates the mainline branch so local state is current.

**Core principle:** User-triggered only. Never automatic.

## The Process

### Step 1: List Worktrees

```bash
git worktree list
```

If multiple worktrees exist (beyond the main working tree), present the list and ask which to clean up.

If only one non-main worktree exists, confirm: "Remove worktree at `<path>`?"

### Step 2: Check for Uncommitted Changes

```bash
git -C <worktree-path> status --porcelain
```

If dirty:
- Show the uncommitted files
- Ask: "This worktree has uncommitted changes. Proceed with removal? (Changes will be lost)"
- Require explicit confirmation

### Step 3: Remove Worktree

⚠️ **CRITICAL — cd before removal:** You MUST determine the main working tree path and `cd` to it BEFORE running any removal command. Always chain the `cd` and removal in the SAME Bash call using `&&`. Never run them as separate Bash tool calls — shell CWD persists between calls, but a deleted CWD will brick every subsequent command.

First, capture the main working tree path from Step 1's output (the first entry in `git worktree list`).

Then remove:
```bash
cd <main-working-tree> && git worktree remove <worktree-path>
```

If removal fails (e.g., locked or dirty), try with `--force` after informing your human partner:
```bash
cd <main-working-tree> && git worktree remove --force <worktree-path>
```

If the worktree directory was already manually deleted from disk, clean up stale metadata:
```bash
cd <main-working-tree> && git worktree prune
```

### Recovery: Dead CWD

If any Bash command fails with `Path "..." does not exist`, your shell CWD has been deleted from disk. **Do NOT retry the same command.** You MUST prefix your next command with an absolute `cd`:

```bash
cd <main-working-tree> && git worktree prune && git worktree list
```

The main working tree path (first entry from Step 1) is always valid. Use that. Retrying without the `cd` prefix will fail infinitely.

### Step 4: Clean Up Branch (Optional)

If the worktree's branch has been merged or your human partner chose "discard":
```bash
git branch -d <branch-name>   # safe delete (only if merged)
```

If not merged and user wants to delete:
```bash
git branch -D <branch-name>   # force delete — confirm first
```

Check for open PRs before deleting:
```bash
gh pr list --head <branch-name> --state open --json number --jq 'length'
```

If the result is non-zero, skip branch deletion — the branch is still needed for the open PR.

### Step 5: Update Mainline

Determine the mainline branch:
```bash
git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'
```

Fallback: check for `main` then `master`.

If currently on mainline:
```bash
git pull --autostash
```

If `--autostash` fails or there are staged changes:
```bash
git stash
git pull --ff-only
git stash pop
```

If pull can't fast-forward: inform your human partner. Do not force-merge or rebase without asking.

If NOT on mainline: offer to switch.
```
Would you like to switch to <mainline> and pull latest?
```

## Red Flags

**Never:**
- Auto-cleanup worktrees (always user-triggered)
- Force-delete branches without confirmation
- Force-merge or rebase mainline without asking
- Run `git worktree remove` without `cd <main-tree> &&` prefix in the same command
- Retry a failed Bash command without first `cd`-ing to a valid absolute path — if you get "Path does not exist", your CWD is gone

**Always:**
- Check for uncommitted changes before removal
- Confirm destructive operations
- Chain `cd <main-working-tree> &&` before every removal/prune command
- Handle pull failures gracefully (inform, don't force)

## Quick Reference

| Command | Purpose |
|---|---|
| `git worktree list` | List all worktrees |
| `git -C <path> status --porcelain` | Check for uncommitted changes |
| `git worktree remove <path>` | Remove a worktree |
| `git worktree remove --force <path>` | Force-remove (locked/dirty worktree) |
| `git worktree prune` | Clean up stale worktree metadata |
| `git branch -d <branch>` | Safe-delete merged branch |
| `git branch -D <branch>` | Force-delete unmerged branch |
| `gh pr list --head <branch> --state open --json number --jq 'length'` | Check for open PRs on branch |

## Integration

**Pairs with:**
- **finish-branch** — called after finishing, at user's discretion
- **git-worktrees** — cleans up what that skill creates
