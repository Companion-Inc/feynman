---
title: Draft Writing
description: Generate a paper-style draft from research findings and session context.
section: Workflows
order: 9
---

The draft writing workflow turns research findings into a paper-style draft with sections, explicit claims, and equations where they help. It is a natural follow-up to `/deepresearch` or `/lit`.

## Usage

From the REPL:

```
/draft A survey of retrieval-augmented generation techniques
```

From the CLI:

```bash
feynman draft "A survey of retrieval-augmented generation techniques"
```

## How it works

Feynman writes an outline to `outputs/.plans/<slug>.md` with the proposed title, sections, key claims, source material, and a verification log for critical claims, figures, and calculations. It summarizes the outline and continues without waiting for confirmation unless you asked to review it.

When the draft can be built from notes already collected, the `writer` agent produces it and the `verifier` agent then adds inline citations and checks sources. Before delivery, Feynman sweeps the draft for claims stronger than their support, marks tentative results as tentative, and removes unsupported numbers.

Drafts follow Feynman's provenance rules: missing results, figures, tables, or benchmarks become labeled placeholders or proposed experiments, not plausible-looking data. Plots use only source-backed data, and the plotting script is saved next to the draft.

## Output

One draft at `papers/<slug>.md` in Markdown, with LaTeX for equations, Markdown tables for quantitative comparisons, and Mermaid for architectures and pipelines. It includes at minimum:

- Title and abstract
- Problem statement
- Related work
- Method or synthesis
- Evidence or experiments
- Limitations
- Conclusion
- A `Sources` appendix with direct URLs for all primary references

## Iteration

Ask Feynman to revise specific sections, add detail, or restructure the argument. To render the draft as HTML or PDF, see [Preview](/docs/tools/preview).
