---
name: code-review
description: Use when completing tasks, implementing major features, or before merging to verify work meets requirements
---

# Requesting Code Review

Use persistent reviewer teammates (within a team) or spawn a review team (standalone) to catch issues before they cascade.

**Core principle:** Review early, review often. Persistent reviewers accumulate codebase knowledge.

## When to Request Review

**Mandatory:**
- After each task in team-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## Two Operating Modes

### Within an Existing Team

When called from team-dev or executing-plans, reviewers are already persistent teammates.

1. **Get git SHAs:**
   ```bash
   BASE_SHA=$(git rev-parse HEAD~1)  # or appropriate base
   HEAD_SHA=$(git rev-parse HEAD)
   ```

2. **Create review tasks in the shared TaskList:**
   - Spec review → owner: spec-reviewer, blockedBy: implementation task
   - Quality review → owner: quality-reviewer, blockedBy: implementation task

3. **Send context via SendMessage:**
   - To spec-reviewer: requirements, implementer's report
   - To quality-reviewer: BASE_SHA, HEAD_SHA, description

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
3. Assign review with context (SHAs, description, requirements)
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
