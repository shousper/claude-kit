---
name: code-review
description: Use when verifying implementation work meets requirements, at review checkpoints or before integration
---

# Requesting Code Review

Use persistent reviewer teammates (within a team) or spawn a review team (standalone) to catch issues before they cascade.

**Core principle:** Review early, review often. Persistent reviewers accumulate codebase knowledge.

## When to Request Review

**Mandatory:**
- At batch boundaries in team-driven development (every 3 tasks by default)
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## Two Operating Modes

### Within an Existing Team

When called from team-dev or executing-plans, reviewers are already persistent teammates.

1. **Get the diff for review:**

   **For uncommitted work (default during implementation):**
   ```bash
   git diff main --stat    # summary of all changes
   git diff main           # full diff
   ```

   **For committed work (PR review mode):**
   ```bash
   git diff {BASE_SHA}..{HEAD_SHA} --stat
   git diff {BASE_SHA}..{HEAD_SHA}
   ```

2. **Create review tasks in the shared TaskList:**
   - Spec review → owner: spec-reviewer, blockedBy: implementation task
   - Quality review → owner: quality-reviewer, blockedBy: implementation task

3. **Send context via SendMessage:**
   - To spec-reviewer: requirements, implementer's report
   - To quality-reviewer: diff summary, description

4. **Both review in parallel** (read-only, no conflicts)

5. **Act on feedback:**
   - Fix Critical issues immediately
   - Fix Important issues before proceeding
   - Note Minor issues for later
   - Push back if reviewer is wrong (with reasoning)

### Standalone (Ad-Hoc Review)

When no team exists, create one:

1. Create review team via kit:team-orchestration
2. Spawn reviewer(s) — single general reviewer or parallel specialists
3. Assign review with context (description, requirements). For uncommitted work, provide reviewers with git diff output rather than commit SHAs
4. Collect findings, act on feedback
5. Shutdown team when review complete

## Specialist Parallel Review

For thorough reviews, spawn multiple specialist reviewers in parallel:
- Security reviewer
- Architecture reviewer
- Test coverage reviewer

All review simultaneously. Consolidate findings.

## Persistent Reviewer Benefits

Reviewers that persist across tasks:
- Remember patterns from earlier tasks
- Spot inconsistencies ("Task 1 used X, Task 3 uses Y")
- Track cumulative quality trajectory
- Catch cross-task architectural drift

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

## Integration

**Within team-dev:** Reviewers are persistent teammates — use existing team
**Standalone:** Create review team, shutdown after review
**Template:** `code-review/code-reviewer.md` for standalone reviewer prompt

## Scope and Recommended Focus

This skill's unique value is **plan-alignment review** (verifying implementation matches requirements and design intent) and **team-based review orchestration** (coordinating persistent or ad-hoc reviewer teammates). General code quality review — style, linting, best practices, vulnerability scanning — should be deferred to the official `code-review` and `pr-review-toolkit` plugins, which provide multi-agent pipelines and specialist depth purpose-built for those concerns.
