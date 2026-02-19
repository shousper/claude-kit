---
name: github-work-summary
description: Use when the user asks for a summary of their GitHub activity, work log, contributions, or accomplishments over a time period. Triggers include phrases like "what did I work on", "work summary", "weekly update", "standup notes", or requests for activity across an organization.
---

# GitHub Work Summary

## Overview

Generates a comprehensive work summary from a user's GitHub activity (PRs, issues) for a specified time period and organization, using the `gh` CLI for data collection and parallel subagents for detail fetching.

## When to Use

- User asks "what did I do last week?" or similar
- User needs a weekly/monthly work summary or standup notes
- User wants to review contributions across an organization
- User needs to compile accomplishments for a performance review or report

**Not for:** Repository-level changelogs, release notes, or team-wide activity reports.

## Process

Copy this checklist and track progress:

```
Work Summary Progress:
- [ ] Step 1: Clarify parameters (period, org)
- [ ] Step 2: Run data collection script
- [ ] Step 3: Launch parallel subagents for detail fetching
- [ ] Step 4: Analyze contributions
- [ ] Step 5: Generate categorized summary
```

### Step 1: Clarify Parameters

Determine two inputs from your human partner's request:

| Parameter | Default | Examples |
|-----------|---------|---------|
| **Period** | "last week" | "this week", "last month", "last 14 days", "2026-01-01 to 2026-01-31" |
| **Organization** | Ask user | `"ethpandaops"`, `"*"` for all orgs |

If either is ambiguous, ask before proceeding.

### Step 2: Run Data Collection Script

Write the script below to a temp file and execute it:

```bash
python3 /tmp/gh_work_summary.py "<period>" "<org>" "<today_date>"
```

The script outputs JSON with all matching PRs and issues. Capture this output for Step 3.

**If the script fails:** Verify `gh` CLI is installed and authenticated (`gh auth status`). The user must be logged in.

### Step 3: Fetch Details with Parallel Subagents

**CRITICAL**: Launch ALL detail-fetching agents in a SINGLE message using multiple Task tool calls for maximum speed.

For each PR in the JSON output, create one subagent:
```bash
gh pr view <number> --repo <owner/repo> --json body,comments,author,commits
```

For each issue, create one subagent:
```bash
gh issue view <number> --repo <owner/repo> --json body,comments,author
```

Wait for all agents to complete before proceeding.

### Step 4: Analyze Contributions

For each item, determine your human partner's actual contribution:

| Activity Type | Include? | What to Extract |
|--------------|----------|----------------|
| PR authored by user | Yes | PR description, what was built/fixed/changed |
| Issue authored by user | Yes | Issue description, what was reported/documented |
| PR with user's commits | Yes | Commit descriptions, code contributions |
| PR user only reviewed | **No** | Skip entirely |
| PR/issue user only commented on | **No** | Skip entirely |

Focus on what your human partner **did**, not what happened around them.

### Step 5: Generate Summary

Organize by theme, not chronologically. Use this structure:

```markdown
# Work Summary: <start_date> to <end_date>

## Major Initiatives
- [theme name]: Built/Implemented/Designed X (PR #123, #124)

## Feature Development
- Built [feature] for [purpose] (PR #N - merged/open)

## Bug Fixes
- Fixed [issue] that caused [impact] (PR #N - merged)

## Infrastructure / DevOps
- [entry]

## Open Work
- [in-progress items with current status]
```

**Writing style:**
- Active voice, first person: "Built X", "Fixed Y", "Refactored Z"
- Include PR/issue numbers as links
- Note status: merged, open, closed
- Group related PRs under a single initiative
- Highlight key technical outcomes

## Data Collection Script

```python
#!/usr/bin/env python3
import json
import subprocess
import sys
from datetime import datetime, timedelta

def calculate_date_range(period_str, today_str):
    """Calculate start and end dates based on period description."""
    today = datetime.fromisoformat(today_str)

    if period_str in ["last week", "previous week"]:
        current_monday = today - timedelta(days=today.weekday())
        last_monday = current_monday - timedelta(days=7)
        last_sunday = last_monday + timedelta(days=6)
        return last_monday.date(), last_sunday.date()

    elif period_str == "this week":
        current_monday = today - timedelta(days=today.weekday())
        return current_monday.date(), today.date()

    elif period_str == "last month":
        first_of_month = today.replace(day=1)
        last_month_end = first_of_month - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return last_month_start, last_month_end

    elif "last" in period_str and "days" in period_str:
        parts = period_str.split()
        days = int(parts[1])
        start = today - timedelta(days=days)
        return start.date(), today.date()

    else:
        parts = period_str.split(" to ")
        if len(parts) == 2:
            return (datetime.fromisoformat(parts[0].strip()).date(),
                    datetime.fromisoformat(parts[1].strip()).date())
        raise ValueError(f"Unknown period: {period_str}")

def gh_search(query_type, query, start_date):
    """Run gh search command and return JSON results."""
    cmd = [
        "gh", "search", query_type,
        query,
        f"--updated=>={start_date}",
        "--json", "number,title,state,createdAt,updatedAt,repository,url",
        "--limit", "1000"
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error running gh search: {result.stderr}", file=sys.stderr)
        return []
    if not result.stdout.strip():
        return []
    return json.loads(result.stdout)

def filter_by_date_and_org(items, start_date, end_date, org):
    """Filter items to only include those in date range and org."""
    filtered = []
    for item in items:
        updated = datetime.fromisoformat(item["updatedAt"].replace("Z", "+00:00")).date()
        repo = item["repository"]["nameWithOwner"]
        if start_date <= updated <= end_date:
            if org == "*" or repo.startswith(f"{org}/"):
                filtered.append(item)
    return filtered

def main():
    if len(sys.argv) < 3:
        print("Usage: script.py <period> <org> [today_date]", file=sys.stderr)
        sys.exit(1)

    period = sys.argv[1]
    org = sys.argv[2]
    today = sys.argv[3] if len(sys.argv) > 3 else datetime.now().date().isoformat()

    start_date, end_date = calculate_date_range(period, today)

    org_display = "all orgs" if org == "*" else f"{org}/*"
    print(f"Fetching GitHub activity from {start_date} to {end_date} for {org_display}", file=sys.stderr)

    prs_authored = gh_search("prs", "--author=@me", start_date)
    prs_commented = gh_search("prs", "--commenter=@me", start_date)
    prs_reviewed = gh_search("prs", "--reviewed-by=@me", start_date)
    issues_created = gh_search("issues", "--author=@me", start_date)
    issues_assigned = gh_search("issues", "--assignee=@me", start_date)
    issues_commented = gh_search("issues", "--commenter=@me", start_date)

    all_prs = {pr["url"]: pr for pr in prs_authored + prs_commented + prs_reviewed}
    all_issues = {issue["url"]: issue for issue in issues_created + issues_assigned + issues_commented}

    prs = filter_by_date_and_org(list(all_prs.values()), start_date, end_date, org)
    issues = filter_by_date_and_org(list(all_issues.values()), start_date, end_date, org)

    output = {
        "period": {"start": str(start_date), "end": str(end_date)},
        "organization": org,
        "prs": prs,
        "issues": issues
    }

    print(json.dumps(output, indent=2))

if __name__ == "__main__":
    main()
```

## Date Calculation Reference

| Period | Meaning |
|--------|---------|
| "last week" | Previous completed Monday-Sunday (NOT last 7 days) |
| "this week" | Current Monday through today |
| "last month" | First through last day of previous month |
| "last N days" | N days ago through today |
| "YYYY-MM-DD to YYYY-MM-DD" | Explicit date range |

All dates use ISO 8601 format. Use `"*"` as org to include all organizations.

## Common Mistakes

| Mistake | Fix |
|---------|-----|
| Searching by `--created` instead of `--updated` | Always use `--updated` to capture work on existing PRs |
| Including items where user only reviewed/commented | Only include items where user authored or committed code |
| Fetching details sequentially | Launch ALL subagents in a single message for parallel execution |
| Missing items due to low limit | Always use `--limit 1000` |
| Confusing "last week" with "last 7 days" | "Last week" = most recent completed Mon-Sun |
| Writing passive summaries ("PR was merged") | Write active, first-person: "Built X", "Fixed Y" |
