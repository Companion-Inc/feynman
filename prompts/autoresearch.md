---
description: Bounded research experiment loop - try hypotheses, measure benchmark evidence, keep what works, discard what doesn't, repeat.
args: <idea>
section: Research Workflows
topLevelCli: true
---
Start an autoresearch optimization loop for: $@

This command runs a bounded foreground research experiment loop using the visible tools in this session.

## Step 1: Gather

If `autoresearch.md` and `autoresearch.jsonl` already exist, ask the user if they want to resume or start fresh.
If `CHANGELOG.md` exists, read the most recent relevant entries before resuming.

Otherwise, collect the following from the user before doing anything else:
- What to optimize (model accuracy, retrieval quality, training loss, ablation score, evaluation latency, etc.)
- The benchmark command to run
- The metric name, unit, and direction (lower/higher is better)
- Files in scope for changes
- Maximum number of iterations (default: 20)

## Step 2: Environment

Ask the user where to run:
- **Local** — run in the current working directory
- **New git branch** — create a branch so main stays clean
- **Virtual environment** — create an isolated venv/conda env first
- **Docker** — run experiment code inside an isolated Docker container
- **Modal** — only if the user has the `modal` CLI installed and set up: write Modal-decorated scripts and execute with `modal run`. Best for GPU-heavy benchmarks with no persistent state between iterations.
- **RunPod** — only if the user has the `runpodctl` CLI installed and `RUNPOD_API_KEY` set: provision a GPU pod and run iterations there over SSH. Best for experiments needing persistent state, large datasets, or SSH access between iterations.

Do not proceed without a clear answer.

## Step 3: Confirm

Present the full plan to the user before starting:

```
Optimization target: [metric] ([direction])
Benchmark command:   [command]
Files in scope:      [files]
Environment:         [chosen environment]
Max iterations:      [N]
```

Ask the user to confirm. Do not start the loop without explicit approval.

## Step 4: Run

Initialize the session: create `autoresearch.md`, `autoresearch.jsonl`, `autoresearch.sh`, run the baseline, and start looping.

Each iteration: edit -> run the benchmark -> log the benchmark result, evidence, and decision -> compare against the baseline -> keep the change, revert it, or record the failed hypothesis -> repeat. Do not stop unless interrupted or `maxIterations` is reached.
After the baseline and after meaningful iteration milestones, append a concise entry to `CHANGELOG.md` summarizing what changed, what metric result was observed, what failed, and the next step.

When reporting results, include every configuration tried from `autoresearch.jsonl` (kept, reverted, and failed) with its metric. Do not claim an effect from the single most favorable setting; state how the result varies across all tried settings and seeds.

## Subcommands

- `/autoresearch <text>` — start or resume the loop
- `/autoresearch off` — stop the loop, keep data
- `/autoresearch clear` — delete all state and start fresh
