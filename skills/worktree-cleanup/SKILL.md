---
name: worktree-cleanup
description: Use when done with a git worktree and ready to clean it up — removes worktree, updates mainline branch, handles uncommitted changes gracefully
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

### Step 2.5: Ensure Not Inside Target Worktree

```bash
# Check if current directory is inside the worktree being removed
current=$(pwd)
if [[ "$current" == "<worktree-path>"* ]]; then
    # Switch to the main working tree
    main_tree=$(git worktree list --porcelain | head -1 | sed 's/worktree //')
    cd "$main_tree"
fi
```

Inform your human partner if switching directories: "Switching to main working tree at `<path>` before removal."

### Step 3: Remove Worktree

```bash
git worktree remove <worktree-path>
```

If removal fails (e.g., locked), try:
```bash
git worktree remove --force <worktree-path>
```

Only use `--force` after informing your human partner.

If the worktree directory was manually deleted (not via `git worktree remove`), the worktree metadata will be stale. Clean it up with:
```bash
git worktree prune
```

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
- Remove a worktree while cwd is inside it (Step 2.5 handles this — always `cd` out first)

**Always:**
- Check for uncommitted changes before removal
- Confirm destructive operations
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
