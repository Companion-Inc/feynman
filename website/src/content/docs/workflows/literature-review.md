---
title: Literature Review
description: Run a structured literature review with consensus mapping, gap analysis, and lab/PI corpus mode.
section: Workflows
order: 2
---

The literature review workflow maps a field: what researchers agree on, where they disagree, and what remains open. When the input names a lab, PI, author, or lab website, `/lit` runs as a publication-corpus review instead: it resolves the identity, collects reachable publications, and maps research trajectories across them.

## Usage

From the REPL:

```
/lit Scaling laws for language model performance
```

From the CLI:

```bash
feynman lit "Scaling laws for language model performance"
feynman lit "Anthropic interpretability team"
```

## How it works

1. **Plan** -- Feynman writes the scope (key questions, source types, time period, expected sections, task ledger, verification log) to `outputs/.plans/<slug>.md`, summarizes it, and continues without waiting for confirmation unless you asked to review the plan.
2. **Gather** -- Wide sweeps use the `researcher` agent, which writes `<slug>-research-*.md` files; narrow topics are searched directly. For a lab or author, the lead agent first resolves the identity and writes a publication log to `notes/<slug>-publications.md` with titles, years, venues, URLs or DOIs, and gaps.
3. **Synthesize** -- Findings are separated into consensus, disagreements, and open questions, with suggested next experiments or reading when useful. For a lab or author, Feynman also identifies 3-5 research trajectories and the 3-5 papers that most changed the corpus direction, ranked by contrastive originality, methodology strength, and relationship to prior art rather than author prestige.
4. **Cite** -- The `verifier` agent adds inline citations and checks every source URL.
5. **Verify** -- The `reviewer` agent checks the cited draft for unsupported claims, logical gaps, and single-source critical findings. FATAL issues are fixed and re-checked; MAJOR issues go into Open Questions.
6. **Deliver** -- Feynman writes the review and its provenance record and checks that both exist on disk.

## Output

- `outputs/<slug>.md` -- the literature review, with Mermaid diagrams for taxonomies, method pipelines, or trajectory maps when the sources support them
- `outputs/<slug>.provenance.md` -- date, sources consulted, accepted, and rejected, verification status, and intermediate research files; for lab or author reviews, also the publication log path and unresolved corpus gaps

## When to use it

Use `/lit` at the start of a project to see what has already been done, when preparing a related-work section, or to understand a lab's or author's body of work.

For biomedical and clinical topics, see [Biomedical Literature Review](/docs/workflows/biomedical-literature-review) for research-only framing, evidence-type separation, and privacy boundaries.
