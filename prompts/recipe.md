---
description: Find ranked, implementable ML training recipes backed by papers, datasets, docs, and code.
args: <task-or-paper>
section: Research Workflows
topLevelCli: true
---
Find implementable ML training recipes for: $@

Derive a short slug from the task (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

## Required artifacts

- `outputs/.plans/<slug>-recipe.md`
- `outputs/.drafts/<slug>-recipe-research.md`
- `outputs/<slug>-recipe.md`
- `outputs/<slug>-recipe.provenance.md`

## Workflow

1. **Plan** — Write `outputs/.plans/<slug>-recipe.md` with the target task, benchmark or desired behavior, candidate source types, feasibility constraints, and a task ledger. Continue automatically after writing the plan.
2. **Research** — Use the `researcher` subagent when the task needs a broad paper/code sweep. For narrow tasks, gather evidence directly. The research must start from evidence of results, not from example scripts alone.
3. **Recipe extraction** — For each promising approach, link the observed result to the exact recipe that produced it. A useful entry has: paper or report, benchmark/result, dataset, training method, key hyperparameters, compute assumptions, implementation code path, and current docs.
4. **Dataset validation** — Check whether each dataset is available, what splits/columns it exposes, and whether the format matches the method. Use `hf_dataset_info` for Hugging Face datasets when available. If schema or availability was not directly checked, mark it `unverified`; do not imply it is usable.
5. **Implementation grounding** — Find working code or official docs for the chosen training path. Use `hf_repo_files` and `hf_repo_read_file` for relevant Hugging Face Hub repos. Prefer current official docs and actively maintained repos. Record exact file paths, function names, class names, and command patterns when available.
6. **Synthesis** — Write `outputs/.drafts/<slug>-recipe-research.md` first, then promote a concise final ranked brief to `outputs/<slug>-recipe.md`.
7. **Verification** — For any recipe you rank first, verify the key source URLs and the dataset/code availability before final delivery. If a source, dataset, or code path cannot be checked, keep it in the brief only with an explicit `blocked` or `unverified` label.
8. **Provenance** — Write `outputs/<slug>-recipe.provenance.md` with date, sources consulted, sources accepted/rejected, verification status, and artifact paths.

## Required final shape

The final brief must include:

- **Recommendation:** the one recipe to try first and why.
- **Ranked recipe table:** one row per candidate with paper/source, result, dataset, method, hyperparameters, compute, code/docs, and verification status.
- **Dataset notes:** schema, split, size, license/access constraints when checked.
- **Implementation plan:** minimal steps to run the top recipe.
- **Known gaps:** missing code, inaccessible data, unclear hyperparameters, or benchmark mismatch.
- **Sources:** URLs for every paper, repo, dataset, and doc page used.

Do not claim a method is state of the art, replicated, or production-ready unless the underlying checks prove it. Use `verified`, `unverified`, `blocked`, and `inferred` precisely.
