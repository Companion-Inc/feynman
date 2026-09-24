---
title: Autoresearch
description: Start a bounded research experiment loop that iteratively optimizes against a benchmark.
section: Workflows
order: 10
---

The autoresearch workflow runs a bounded experiment loop: change something, run a benchmark, record the result, and keep or revert the change. It is for model, retrieval, prompt, architecture, or dataset experiments where the feedback signal is an explicit metric.

## Usage

From the REPL:

```
/autoresearch Optimize prompt engineering strategies for math reasoning on GSM8K
```

From the CLI:

```bash
feynman autoresearch "Optimize prompt engineering strategies for math reasoning on GSM8K"
```

Subcommands:

- `/autoresearch <text>` -- start or resume the loop
- `/autoresearch off` -- stop the loop and keep its data
- `/autoresearch clear` -- delete all loop state and start fresh

## How it works

1. **Gather** -- If `autoresearch.md` and `autoresearch.jsonl` already exist, Feynman asks whether to resume or start fresh. Otherwise it asks for what to optimize, the benchmark command, the metric name, unit, and direction, the files in scope, and a maximum iteration count (default 20).
2. **Environment** -- Feynman asks where to run: local, a new git branch, a virtual environment, Docker, Modal (if the `modal` CLI is set up), or RunPod (if `runpodctl` is installed and `RUNPOD_API_KEY` is set).
3. **Confirm** -- Feynman shows the target, benchmark, files, environment, and iteration limit, and does not start until you approve.
4. **Run** -- Feynman creates `autoresearch.md`, `autoresearch.jsonl`, and `autoresearch.sh`, runs the baseline, then loops: edit, run the benchmark, log the result and decision, compare against the baseline, and keep, revert, or record the failed hypothesis. The loop continues until you interrupt it or the iteration limit is reached.

After the baseline and at meaningful milestones, Feynman appends a short entry to `CHANGELOG.md` with what changed, the observed metric, what failed, and the next step.

## Output

The loop state lives in `autoresearch.md`, `autoresearch.jsonl`, and `autoresearch.sh` in the workspace. When reporting results, Feynman lists every configuration tried (kept, reverted, and failed) with its metric and describes how the result varies across settings and seeds, rather than claiming an effect from the single best run.

## When to use it

Use `/autoresearch` for hyperparameter searches, prompt-strategy evaluation, architecture or retrieval tuning, and dataset or benchmark ablations. To answer a specific question from sources, use `/deepresearch` instead.
