---
name: finish-branch
description: Finalizes a development branch by verifying tests pass, then presenting four completion options (merge locally, draft PR, keep as-is, or discard). Use when implementation is done, a feature branch is ready to ship, work needs to be merged or a PR created, or the user says "finish", "wrap up", "ship it", or "done with this branch". DO NOT TRIGGER when tests are still being written or implementation is incomplete.
---

# Finishing a Development Branch

## Overview

Guide completion of development work by presenting clear options and handling chosen workflow.

**Core principle:** Verify tests -> Present options -> Execute choice.

**Announce at start:** "I'm using the finish-branch skill to complete this work."

## The Process

### Step 1: Verify Tests

**Before presenting options, verify tests pass:**

```bash
# Run project's test suite
npm test / cargo test / pytest / go test ./...
```

**If tests fail:**
```
Tests failing (<N> failures). Must fix before completing:

[Show failures]

Cannot proceed with merge/PR until tests pass.
```

Stop. Don't proceed to Step 2.

**If tests pass:** Continue to Step 2.

### Step 2: Determine Base Branch

Identify the base branch (typically `main` or `master`). If uncertain, ask: "This branch split from main -- is that correct?"

### Step 3: Present Options

Present exactly these 4 options:

```
Implementation complete. What would you like to do?

1. Merge back to <base-branch> locally
2. Commit, push, and create a draft Pull Request
3. Keep the branch as-is (I'll handle it later)
4. Discard this work

Which option?
```

**Don't add explanation** — keep options concise.

### Step 4: Execute Choice

#### Option 1: Merge Locally

Your human partner should run `/commit` first to commit their changes.

**Staging guidance:**
- Do NOT stage `docs/plans/*.md` (design docs, implementation plans)

**If in a worktree:**
```bash
# Get the main working tree path
main_tree=$(git worktree list --porcelain | head -1 | sed 's/worktree //')

# Navigate to main working tree
cd "$main_tree"

# Pull latest and merge
git pull --autostash
git merge <feature-branch>

# Verify tests
<test command>
```

**If on a regular branch:**
```bash
git checkout <base-branch>
git pull --autostash
git merge <feature-branch>
<test command>
git branch -d <feature-branch>
```

#### Option 2: Commit, Push, and Create Draft PR

**Staging guidance:**
- Stage all implementation files (source, tests, configs)
- Do NOT stage `docs/plans/*.md` (design docs, implementation plans)
- If unclear what to stage, show `git status` and ask your human partner

The user may run `/commit` themselves to handle staging and committing. If they say "commit staged changes", trust their staging decisions.

If your human partner hasn't committed yet:
```bash
# Show what would be staged
git status

# Let user confirm staging, or user runs /commit
```

After committing:
```bash
# Push branch
git push -u origin <feature-branch>

# Create draft PR
# REQUIRED SUB-SKILL: Use kit:create-pr
```

Invoke kit:create-pr which creates a draft PR by default. If your human partner explicitly requests "ready for review", pass that intent to kit:create-pr.

#### Option 3: Keep As-Is

Report: "Keeping branch <name>. Worktree preserved at <path>."

#### Option 4: Discard

**Confirm first:**
```
This will permanently delete:
- Branch <name>
- All commits: <commit-list>

Type 'discard' to confirm.
```

Wait for exact confirmation.

If confirmed:
- **In a worktree:** Use kit:worktree-cleanup to remove the worktree and delete the branch
- **On a regular branch:**
  ```bash
  git checkout <base-branch>
  git branch -D <feature-branch>
  ```

### Worktree Cleanup

**No automatic worktree cleanup for any option.**

After completing the chosen option, note:
"When you're ready to clean up the worktree, use kit:worktree-cleanup."

## Quick Reference

| Option | Commit | Push | Draft PR | Cleanup Worktree |
|--------|--------|------|----------|------------------|
| 1. Merge locally | user | - | - | manual (later) |
| 2. Draft PR | user | yes | yes | manual (later) |
| 3. Keep as-is | - | - | - | manual (later) |
| 4. Discard | - | - | - | manual (later) |

## Common Mistakes

**Skipping test verification**
- **Problem:** Merge broken code, create failing PR
- **Fix:** Always verify tests before offering options

**Open-ended questions**
- **Problem:** "What should I do next?" -> ambiguous
- **Fix:** Present exactly 4 structured options

**Staging planning documents**
- **Problem:** Design docs and implementation plans enter git history
- **Fix:** Never stage `docs/plans/*.md`

**Auto-cleaning worktree**
- **Problem:** Remove worktree when review feedback may require more work
- **Fix:** Never auto-cleanup. User triggers kit:worktree-cleanup when ready.

**No confirmation for discard**
- **Problem:** Accidentally delete work
- **Fix:** Require typed "discard" confirmation

## Red Flags

**Never:**
- Proceed with failing tests
- Merge without verifying tests on result
- Delete work without confirmation
- Force-push without explicit request
- Automatically clean up worktrees
- Stage `docs/plans/*.md` files

**Always:**
- Verify tests before offering options
- Present exactly 4 options
- Get typed confirmation for Option 4
- Let user control staging and committing
- Create PRs as drafts by default

## Integration

**Called by:**
- **team-dev** — After your human partner chooses "Finish the branch"

**Invokes:**
- **kit:create-pr** — For Option 2 (draft PR creation)

**Pairs with:**
- **kit:worktree-cleanup** — User-triggered cleanup after finishing
