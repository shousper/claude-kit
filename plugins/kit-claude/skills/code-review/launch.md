# Launching code-review on Claude Code

Claude Code's launch mechanic for step 3 ("Launch it") of the code-review process. The review workflow always runs in the background — you're notified on completion. Match this shape exactly:

```
Workflow({
  scriptPath: "<base>/review.workflow.js",
  args: { diffRef, reviewDims, ledger }
})
```

- If `scriptPath` rejects a bundled path, read the file and pass its contents as inline `script` instead.

## Model & Effort

`review.workflow.js` pins per-dimension `model`/`effort` in its default `reviewDims`: quality, security, and architecture run on Opus (xhigh); correctness and tests run on Sonnet (high). Pass a custom `reviewDims` to change this.

## Handling the result

The completion payload (task notification, `TaskOutput`, or a saved output file) is a harness **envelope**: `{ summary, agentCount, logs, result, workflowProgress, totalTokens, totalToolCalls }`. The workflow's own return value — `{ diffRef, findings }` — lives at **`.result`**. Read `findings` from `.result.findings` on the FIRST extraction. There is no top-level `findings`; a script that reads top-level keys gets undefineds and wastes a probe "discovering" `.result`.
