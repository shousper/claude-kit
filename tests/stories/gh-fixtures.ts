/** Shapes returned by `gh pr list --json number,state,reviewDecision,mergeStateStatus,updatedAt,headRefName`. */
export function prListEntry(over: Record<string, unknown> = {}) {
  return {
    number: 12,
    state: "OPEN",
    reviewDecision: "",
    mergeStateStatus: "CLEAN",
    updatedAt: "2026-07-08T12:00:00Z",
    headRefName: "story/st-aaaa",
    ...over,
  };
}

/** Shape returned by `gh pr view <n> --json author,reviews,comments`. */
export function prDetail(over: Record<string, unknown> = {}) {
  return { author: { login: "me" }, reviews: [], comments: [], ...over };
}

export function review(over: Record<string, unknown> = {}) {
  return {
    author: { login: "reviewer" },
    state: "CHANGES_REQUESTED",
    body: "fix the null check",
    submittedAt: "2026-07-08T13:00:00Z",
    ...over,
  };
}

export function comment(over: Record<string, unknown> = {}) {
  return {
    author: { login: "reviewer" },
    body: "please add a test",
    createdAt: "2026-07-08T13:00:00Z",
    ...over,
  };
}
