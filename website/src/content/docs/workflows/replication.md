---
title: Replication
description: Plan a replication of a paper's experiments and claims; execute only after choosing an environment.
section: Workflows
order: 6
---

The replication workflow builds a source-backed plan for reproducing a paper, benchmark result, or specific claim. It executes only after you choose an environment, and it does not call a result replicated unless the planned checks pass.

## Usage

From the REPL:

```
/replicate arxiv:2401.12345
```

```
/replicate "The claim that sparse attention achieves 95% of dense attention quality at 60% compute"
```

From the CLI:

```bash
feynman replicate "paper or claim"
```

## How it works

1. **Extract** -- The `researcher` agent pulls implementation details from the paper and any linked code. If `CHANGELOG.md` exists, Feynman reads its recent entries first.
2. **Recipe pass** -- For ML training, fine-tuning, benchmark, or dataset-heavy targets, each claimed result is linked to the exact dataset, method, hyperparameters, compute assumptions, metric, and code path that produced it. Dataset availability and schema are checked when possible (see [Hugging Face Hub](/docs/tools/hugging-face)); unchecked details are marked `unverified`.
3. **Plan** -- Feynman lists the code, datasets, metrics, and environment needed, separates what is verified, inferred, and missing, and names the checks that will decide whether the replication succeeded.
4. **Environment** -- Feynman asks where to execute: local, a virtual environment, Docker, Modal (if the `modal` CLI is set up), RunPod (if `runpodctl` is installed and `RUNPOD_API_KEY` is set), or plan only. Nothing is installed or run before you choose.
5. **Execute** -- In the chosen environment, Feynman implements and runs the steps and saves notes, scripts, raw outputs, and results to disk.
6. **Log** -- For multi-step or resumable work, Feynman appends entries to `CHANGELOG.md` after progress, failed attempts, and verification outcomes.
7. **Report** -- The result ends with a `Sources` section listing paper, dataset, documentation, and repository URLs.

## When to use it

Use `/replicate` before building on a result you have not seen reproduced, or to test one specific claim. Choose "plan only" to get the replication plan without running anything.
