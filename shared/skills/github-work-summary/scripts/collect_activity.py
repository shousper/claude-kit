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
