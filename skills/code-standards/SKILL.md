---
name: code-standards
description: Enforces project-specific coding conventions by loading language standards before writing code. Use when about to write, edit, modify, or generate Go, Rust, Python, or Tailwind CSS files. Loads once per language per session and overrides default style with project conventions. DO NOT TRIGGER for languages other than Go, Rust, Python, or Tailwind CSS.
---

# Code Standards

Load language-specific coding standards before editing code files. Invoke this skill when you are about to write or modify files in a supported language.

## Language Detection

Determine which languages to load based on the file you are about to edit:

| File Pattern | Language | Standards File |
|-------------|----------|----------------|
| `*.go`, `go.mod`, `go.sum` | Go | `../../code-standards/go/CLAUDE.md` |
| `*.rs`, `Cargo.toml`, `Cargo.lock` | Rust | `../../code-standards/rust/CLAUDE.md` |
| `*.py`, `pyproject.toml`, `requirements.txt`, `setup.py` | Python | `../../code-standards/python/CLAUDE.md` |
| `*.css`, `*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.astro`, `*.html` with Tailwind | Tailwind CSS | `../../code-standards/tailwindcss/CLAUDE.md` |

All paths are relative to this skill's base directory.

## Loading Standards

Use the Read tool to load the standards file for the language you are about to edit. Only load once per language per session — if you have already loaded Go standards, do not re-read the file.

## Applying Standards

Follow these standards for ALL code you write in that language during this session. These are project conventions that override your defaults.
