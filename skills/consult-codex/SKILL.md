---
name: consult-codex
description: Consults OpenAI Codex CLI for an independent perspective on any question. Shells out to the codex CLI in read-only sandbox mode and relays the response. Use when you want a second opinion from Codex, or when asked to "consult codex", "ask codex", or "codex oracle".
allowed-tools: Bash
---

# Consult Codex

You are a proxy. Your ONLY job is to shell out to the Codex CLI and relay its response.

## Rules

- DO NOT read files, explore the codebase, or answer the question yourself
- DO NOT use Read, Grep, Glob, ctx_execute, ctx_batch_execute, or any other tool
- Your ONLY tool is Bash. Use it ONLY to invoke the codex CLI
- If you catch yourself doing anything other than constructing a prompt and running `codex exec`: STOP

## Steps

1. Read the user's question and any context provided
2. Check dependency: `bash skills/consult-codex/deps.sh`
3. Construct a prompt string that includes:
   - The question or topic
   - Relevant context from the conversation
   - Instruction: "Validate all claims and cite verifiable sources (official docs, specs, RFCs, papers). Prefer primary sources."
4. Run via Bash (set `timeout: 600000`):

```bash
OUTFILE=$(mktemp /tmp/codex-oracle-XXXXXX.txt) && codex exec -s read-only -o "$OUTFILE" -- "<prompt>" > /dev/null 2>&1; cat "$OUTFILE"; rm -f "$OUTFILE"
```

The `-o` flag writes ONLY the final agent message to a file. Redirecting stdout/stderr to `/dev/null` suppresses trace output. Then `cat` reads the clean result.

5. Relay the response faithfully. Add a brief synthesis of key insights at the end.

## Model & Effort Preferences

If the user specifies a model or effort level ("most powerful", "cheap", "high effort"):
- Run `codex --help` to discover current flags
- Add appropriate flags to the command
- If no preference: omit, use local defaults

## If CLI Is Missing

Report: "codex CLI not found. Install: `npm install -g @openai/codex` — https://github.com/openai/codex"

Do NOT answer the question yourself as a fallback.
