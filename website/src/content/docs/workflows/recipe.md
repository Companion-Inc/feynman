---
title: ML Training Recipe
description: Find ranked, implementable ML training recipes backed by papers, datasets, docs, and code.
section: Workflows
order: 7
---

The recipe workflow turns a training or fine-tuning goal into a ranked set of implementable recipes. It is designed for ML engineering questions where the useful answer is not just "what papers exist?" but "which dataset, method, hyperparameters, code path, and checks should I try first?"

The recipe-shaped output is borrowed from Hugging Face's [`ml-intern`](https://github.com/huggingface/ml-intern).

## Usage

From the REPL:

```
/recipe "fine-tune a small model for math reasoning"
```

From the CLI:

```bash
feynman recipe "fine-tune a small model for math reasoning"
```

You can use `/recipe` for tasks such as choosing an SFT dataset, reproducing a benchmark setup, selecting a practical training method, or turning a paper into an implementation plan.

## How it works

The workflow writes a plan to `outputs/.plans/<slug>-recipe.md` and continues automatically. Broad tasks use the `researcher` agent for the paper and code sweep; narrow tasks are researched directly. Research starts from evidence of results, not from example scripts alone.

For each candidate, Feynman links the reported result to the recipe that produced it: dataset, split/schema, method, hyperparameters, compute assumptions, benchmark, and implementation code. Datasets are checked for availability, splits, and format; anything not directly checked is marked `unverified`. For the top-ranked recipe, key source URLs and dataset and code availability are verified before delivery, or labeled `blocked` or `unverified`.

## Hugging Face grounding

When a candidate uses a Hugging Face dataset or repository, Feynman inspects it with read-only Hub tools:

- `hf_dataset_info` checks dataset metadata, tags, access status, card data, features, and splits.
- `hf_repo_files` lists files in model, dataset, and Space repos.
- `hf_repo_read_file` reads small text files such as dataset cards, configs, examples, and scripts.

These tools use public Hub endpoints by default and use `HF_TOKEN` or `HUGGINGFACE_HUB_TOKEN` when present for private or gated resources.

## Output

Research notes go to `outputs/.drafts/<slug>-recipe-research.md`. The final brief is `outputs/<slug>-recipe.md`, with a provenance sidecar at `outputs/<slug>-recipe.provenance.md`.

The brief includes:

- **Recommendation** -- The one recipe to try first and why
- **Ranked recipe table** -- Candidate recipes with paper/source, result, dataset, method, hyperparameters, compute, code/docs, and verification status
- **Dataset notes** -- Schema, splits, size, license/access constraints, and unchecked gaps
- **Implementation plan** -- Minimal steps to run the top recipe
- **Known gaps** -- Missing code, inaccessible data, unclear hyperparameters, benchmark mismatch, or unverified assumptions
- **Sources** -- URLs for every paper, repo, dataset, and doc page used

Feynman does not call a recipe state of the art, replicated, or production-ready unless the checks support it.
