---
name: create-pr
description: Creates a GitHub pull request for the current branch using the gh CLI. Use when asked to create a PR, open a pull request, submit changes for review, or push and create a PR. Defaults to draft, detects and fills repo PR templates, auto-detects the base branch, and supports 'ready for review' override. DO NOT TRIGGER for reviewing existing PRs or commenting on PRs.
---

# Create Pull Request

## Overview

Create a pull request for the current branch. Defaults to draft so the author can review on GitHub before marking ready.

**Core principle:** Draft by default. The author controls when a PR is ready for review.

## The Process

### Step 1: Check Prerequisites

```bash
# Verify gh CLI is available and authenticated
command -v gh >/dev/null 2>&1 || echo "GitHub CLI (gh) not installed"
gh auth status 2>/dev/null || echo "Not authenticated with gh"

# Detect default branch
base=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')
base=${base:-main}
git log "origin/$base..HEAD" --oneline

# Verify branch is pushed
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null
```

If branch is not pushed:
```bash
git push -u origin $(git branch --show-current)
```

### Step 2: Detect PR Template

```bash
# Check common template locations
ls .github/PULL_REQUEST_TEMPLATE.md 2>/dev/null
ls .github/PULL_REQUEST_TEMPLATE/ 2>/dev/null
ls docs/PULL_REQUEST_TEMPLATE.md 2>/dev/null
ls PULL_REQUEST_TEMPLATE.md 2>/dev/null
```

If template exists: read it, fill out all sections from diff and commit history.
If no template: examine recent merged PRs for conventions (`gh pr list --state merged --limit 5`).

### Step 3: Create the PR

**Default (draft):**
```bash
gh pr create --draft --title "<title>" --body "<body>"
```

**If your human partner explicitly requests "ready for review":**
```bash
gh pr create --title "<title>" --body "<body>"
```

### PR Content

- **Title:** Short (under 70 chars), describes the change
- **Body:** If using template, fill all sections. If no template:
  ```
  ## Summary
  <2-3 bullets of what changed and why>

  ## Test Plan
  - [ ] <verification steps>
  ```

## Draft Override

Your human partner can request a non-draft PR by saying:
- "ready for review"
- "skip draft"
- "mark it ready"
- "not a draft"

In these cases, omit the `--draft` flag.

## Common Mistakes

- **Hardcoding `main` as the base branch** — always detect the default branch dynamically; some repos use `master`, `develop`, or other names.
- **Creating the PR before pushing the branch** — `gh pr create` will fail if the branch doesn't exist on the remote.
- **Skipping the PR template** — if the repo has one, fill it out completely. Reviewers expect it.
- **Writing vague titles** — "Update code" or "Fix stuff" tells reviewers nothing. Describe the actual change.
- **Forgetting `--draft`** — the default is draft for a reason. Only omit when your human partner explicitly asks.

## Integration

**Called by:**
- **finish-branch** (Option 2) — after committing and pushing
- User directly by asking to create a PR (triggers via description match)

**References:**
- Installed `/commit` command for staging and committing
