Generate a comprehensive work summary from GitHub activity for a specified time period and organization.

## Instructions

1. **Run the data collection script**: Execute the embedded Python script below to:
   - Calculate the correct date range based on user's request
   - Fetch ALL GitHub activity using `gh` CLI
   - Filter results to ONLY include items within the date range
   - Filter to the specified organization
   - Output a JSON file with all relevant PRs and issues

2. **Launch parallel subagents to fetch detailed information**:
   - **CRITICAL**: Use multiple Task tool calls IN A SINGLE MESSAGE to launch parallel general-purpose agents
   - Create one agent per PR/issue to fetch details concurrently for maximum speed
   - Each agent should run: `gh pr view <number> --repo <owner/repo> --json body,comments,author` (or `gh issue view` for issues)
   - Wait for all agents to complete before proceeding to summary generation
   - This parallelization is essential for fast execution

3. **Identify the user's specific contributions** from the fetched data:
   - **For authored PRs**: Extract the PR description to understand what the user built/fixed/changed
   - **For authored issues**: Extract the issue description to understand what the user reported/documented
   - **For commented PRs/issues**: ONLY include if the user made meaningful commits to that PR (check author field)
   - **Exclude**: PRs where the user only reviewed or commented without contributing code
   - Focus on what the user actually DID, not just what happened in the PR/issue

4. **Generate comprehensive work summary** organized by:
   - Major initiatives (group related PRs/issues by theme)
   - Infrastructure work
   - Feature development
   - Bug fixes
   - Open vs closed work
   - **Format each entry to clearly show the user's contribution**: "Built X", "Fixed Y", "Implemented Z", "Refactored A"

5. **Summary format**:
   - Use bullet points and clear categorization
   - Start each entry with what YOU did (active voice, first person perspective)
   - Include PR/issue numbers and links where relevant
   - Highlight key accomplishments and technical outcomes
   - Note cross-references between related work
   - Include status (merged, open, closed)
   - Extract meaningful context from YOUR descriptions and comments

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
        # Most recent completed Monday-Sunday
        current_monday = today - timedelta(days=today.weekday())
        last_monday = current_monday - timedelta(days=7)
        last_sunday = last_monday + timedelta(days=6)
        return last_monday.date(), last_sunday.date()

    elif period_str == "this week":
        # Current Monday through today
        current_monday = today - timedelta(days=today.weekday())
        return current_monday.date(), today.date()

    elif period_str == "last month":
        # First day of previous month through last day
        first_of_month = today.replace(day=1)
        last_month_end = first_of_month - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return last_month_start, last_month_end

    elif "last" in period_str and "days" in period_str:
        # "last N days" or "last 7 days"
        parts = period_str.split()
        days = int(parts[1])
        start = today - timedelta(days=days)
        return start.date(), today.date()

    else:
        # Try to parse as date range "YYYY-MM-DD to YYYY-MM-DD"
        parts = period_str.split(" to ")
        if len(parts) == 2:
            start = datetime.fromisoformat(parts[0].strip()).date()
            end = datetime.fromisoformat(parts[1].strip()).date()
            return start, end
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
        print("Usage: script.py <period> <org> <today_date>")
        sys.exit(1)

    period = sys.argv[1]
    org = sys.argv[2]
    today = sys.argv[3] if len(sys.argv) > 3 else datetime.now().date().isoformat()

    start_date, end_date = calculate_date_range(period, today)

    org_display = "all orgs" if org == "*" else f"{org}/*"
    print(f"Fetching GitHub activity from {start_date} to {end_date} for {org_display}", file=sys.stderr)

    # Fetch all activity
    prs_authored = gh_search("prs", "--author=@me", start_date)
    prs_commented = gh_search("prs", "--commenter=@me", start_date)
    prs_reviewed = gh_search("prs", "--reviewed-by=@me", start_date)
    issues_created = gh_search("issues", "--author=@me", start_date)
    issues_assigned = gh_search("issues", "--assignee=@me", start_date)
    issues_commented = gh_search("issues", "--commenter=@me", start_date)

    # Filter and deduplicate
    all_prs = {pr["url"]: pr for pr in prs_authored + prs_commented + prs_reviewed}
    all_issues = {issue["url"]: issue for issue in issues_created + issues_assigned + issues_commented}

    prs = filter_by_date_and_org(list(all_prs.values()), start_date, end_date, org)
    issues = filter_by_date_and_org(list(all_issues.values()), start_date, end_date, org)

    # Output results
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

## Important Notes

- **CRITICAL**: Only include items where updatedAt falls within the date range (start_date <= updatedAt <= end_date)
- **CRITICAL**: Search using `--updated` not `--created` to capture work done on existing PRs/issues
- **CRITICAL**: For reviews/comments, only mention if the user made meaningful code contributions (commits), not just reviews or comments
- **CRITICAL**: Use parallel Task agents to fetch PR/issue details concurrently - launch ALL agents in a single message
- **CRITICAL**: Focus on what the USER specifically contributed, not what happened to the PR/issue
- "Last week" means the most recent completed Monday-Sunday period, NOT the last 7 days from today
- Ensure ALL activity is captured - use high limits (1000) and check for pagination
- Focus on work in the specified organization only
- Read the user's PR descriptions and comments to understand their specific contributions
- Group related work together to show the bigger picture
- Write from the user's perspective (what they built, fixed, implemented)
- Be thorough - missing work items is unacceptable

## Date Calculation Reference

- **Last week**: Previous Monday through Sunday (e.g., if today is Wednesday Oct 27, last week is Oct 20-26)
- **This week**: Current Monday through today
- **Last month**: First day of previous month through last day of previous month
- **Last N days**: N days ago through today (e.g., "last 7 days", "last 14 days")
- Use ISO 8601 date format (YYYY-MM-DD) for all GitHub API queries
- Use "*" as the org parameter to include all organizations
