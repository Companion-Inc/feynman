---
title: Code Audit
description: Compare a paper's claims against its public codebase for reproducibility.
section: Workflows
order: 5
---

The code audit workflow compares a paper's claims against its public codebase and reports mismatches, omissions, and reproducibility risks.

## Usage

From the REPL:

```
/audit arxiv:2401.12345
```

```
/audit arxiv:2401.12345 https://github.com/org/repo
```

From the CLI:

```bash
feynman audit 2401.12345
```

Pass the paper, and the repository URL if you already know it.

## How it works

Feynman writes an audit plan (which paper, which repo, which claims to check) to `outputs/.plans/<slug>.md`, summarizes it, and continues without waiting for confirmation unless you asked to review the plan.

It then compares the paper's claimed methods, defaults, metrics, and data handling against the actual code. For non-trivial audits, the `researcher` agent gathers evidence and the `verifier` agent checks sources and adds inline citations.

## Output

One report at `outputs/<slug>-audit.md` that calls out:

- **Mismatches** -- where the code differs from what the paper describes
- **Missing code** -- described components with no implementation in the repo
- **Ambiguous defaults** -- settings the paper leaves unclear
- **Reproduction risks** -- anything likely to stop a faithful rerun

The report ends with a `Sources` section listing the paper and repository URLs.

## When to use it

Use `/audit` before building on a paper's results, before a replication, or to check your own paper against its code before release.
