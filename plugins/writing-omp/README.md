# writing (OMP)

Installs a developer-documentation writing voice as an always-apply rule, the `writing-docs` skill for documentation work, and an advisory Vale lint on documentation files you write or edit.

Install from the repository marketplace: `omp plugin install writing@shousper-kit`.

The lint hook runs only when `vale` is on your PATH (`brew install vale`). It never blocks a write; it appends a short summary of findings to the tool result.
