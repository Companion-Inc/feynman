---
title: Reviewer
description: The reviewer agent critiques research artifacts with severity-graded findings.
section: Agents
order: 2
---

The reviewer applies skeptical but fair internal research scrutiny to papers, drafts, and research artifacts. It does not predict venue acceptance; it produces a critique and a revision plan. Its definition lives in `.feynman/agents/reviewer.md`.

## What it does

The reviewer checks novelty, clarity, empirical rigor, and reproducibility. It looks for missing or weak baselines, missing ablations, evaluation mismatches, benchmark leakage, insufficient statistical evidence, claims that outrun the experiments, sections left over from earlier drafts, notation drift, and "verified" statements that do not show the check behind them. It keeps looking after the first major problem.

When a workflow frames the task as a verification pass, the reviewer acts as an adversarial auditor: a citation attached to a claim is not enough if the source does not support its exact wording.

## Output

The reviewer writes two parts to the output path the workflow assigns:

1. **Structured review** -- summary, strengths, weaknesses graded **FATAL**, **MAJOR**, or **MINOR**, questions for the authors, a verdict with an overall confidence score, and a prioritized revision plan.
2. **Inline annotations** -- exact quotes from the artifact, each tied to a weakness or question ID from the structured review.

Every weakness must point to a specific passage or section. The review ends with a Sources section for anything it inspected.

## Used by

- `/review` -- the main critique pass on larger artifacts
- `/deepresearch` -- reviews the cited brief after the verifier finishes, when researcher subagents were used
- `/lit` -- checks the cited review for unsupported claims, logical gaps, and single-source critical findings

Workflows fix FATAL issues before delivery and record MAJOR issues as open questions.
