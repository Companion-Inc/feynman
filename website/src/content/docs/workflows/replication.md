---
title: Replication
description: Plan a replication of a paper's experiments and claims; execute only after choosing an environment.
section: Workflows
order: 5
---

The replication workflow builds a source-backed plan for reproducing published experiments, benchmark results, or specific claims. It can execute steps only after you choose an environment, and it records scripts, raw outputs, and checks before calling a result replicated.

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

You can point the workflow at a paper for a replication plan, or at a specific claim for a focused reproduction check.

## How it works

The replication workflow starts with the researcher agent reading the target paper and extracting the details that are actually stated: model architecture, hyperparameters, training schedule, dataset preparation, evaluation protocol, and hardware requirements. It cross-references those details against linked code or supplied code when available.

For ML training, fine-tuning, benchmark, or dataset-heavy targets, replication includes a recipe pass before execution planning. That pass links each claimed result to the exact dataset, method, hyperparameters, compute assumptions, metric, and code path that produced it. When a candidate uses Hugging Face resources, Feynman can inspect dataset metadata, splits, features, and small repo files through the [Hugging Face Hub tools](/docs/tools/hugging-face).

Next, the workflow generates a structured replication plan that breaks the experiment into discrete steps, estimates compute requirements when the source material supports that estimate, and identifies where the paper is underspecified. For each underspecified detail, it records the gap, the assumption needed to proceed, and how that assumption could affect divergence.

The plan also includes a risk assessment: which parts of the experiment are most likely to cause replication failure, what tolerance to expect for numerical results, and which claims are most sensitive to implementation details.

## Output format

The replication plan includes:

- **Requirements** -- Hardware, software, data, and estimated compute cost
- **Recipe Extraction** -- Dataset, method, hyperparameters, metric, code path, and verification status for ML-heavy targets
- **Step-by-step Plan** -- Ordered steps from environment setup through final evaluation
- **Underspecified Details** -- Where the paper leaves out information needed for replication
- **Risk Assessment** -- Which steps are most likely to cause divergence from reported results
- **Success Criteria** -- What results would constitute a successful replication

## Iterative execution

After generating the plan, Feynman asks where execution should happen: local, isolated environment, Docker, Modal or RunPod (if the `modal` or `runpodctl` CLI is installed), or plan-only. When execution is explicitly chosen, it helps implement and run the planned checks, saves notes/scripts/raw outputs/results, and compares observed results against the paper's reported values. A result is labeled replicated only when the planned checks actually pass.
