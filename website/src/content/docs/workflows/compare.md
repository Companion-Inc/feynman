---
title: Source Comparison
description: Compare multiple sources and produce an agreement/disagreement matrix.
section: Workflows
order: 8
---

The source comparison workflow puts papers, articles, or documents side by side and produces a source-grounded matrix of where they agree, disagree, and remain uncertain.

## Usage

From the REPL:

```
/compare "sparse attention methods for long-context language models"
```

```
/compare arxiv:2401.12345 arxiv:2402.67890 arxiv:2403.11111
```

From the CLI:

```bash
feynman compare "topic or list of sources"
```

Give a topic and let Feynman find the sources, or list the specific papers and documents to compare.

## How it works

Feynman writes a comparison plan (sources, dimensions to evaluate, output structure) to `outputs/.plans/<slug>.md`, summarizes it, and continues without waiting for confirmation unless you asked to review the plan.

When the comparison set is broad, the `researcher` agent gathers source material. The `verifier` agent then checks sources and adds inline citations to the final matrix.

## Output

One comparison at `outputs/<slug>-comparison.md` containing:

- **Comparison matrix** -- source, key claim, evidence type, caveats, and confidence for each source
- **Agreement, disagreement, and uncertainty** -- kept clearly separate
- **Tables and diagrams** -- a Markdown table for quantitative metrics and a Mermaid diagram for method or architecture comparisons when the sources support the structure
- **Sources** -- direct URLs for every source used

## When to use it

Use `/compare` when results in the literature conflict, when choosing between competing approaches to the same problem, or when writing a related-work section that must characterize a debate accurately.
