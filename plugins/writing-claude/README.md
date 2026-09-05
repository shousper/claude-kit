# writing (Claude Code)

Installs a developer-documentation writing voice as an output style that keeps Claude Code's coding instructions and applies automatically while the plugin is enabled, the `writing-docs` skill for documentation work, and an advisory Vale lint on documentation files you write or edit.

Install from the repository marketplace: `/plugin install writing@shousper-kit`.

The lint hook runs only when `vale` is on your PATH (`brew install vale`). It never blocks a write; it adds a short summary of findings to the tool result.
