#!/bin/bash
# Check if codex CLI is available
if ! command -v codex &> /dev/null; then
  echo "ERROR: codex CLI not found."
  echo "Install: npm install -g @openai/codex"
  echo "Docs: https://github.com/openai/codex"
  exit 1
fi
echo "codex CLI found: $(command -v codex)"
