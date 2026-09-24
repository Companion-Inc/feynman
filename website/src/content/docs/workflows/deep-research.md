---
title: Deep Research
description: Run a thorough, multi-agent investigation that produces a cited research brief.
section: Workflows
order: 1
---

Deep research investigates a topic and produces a research brief with inline citations and a provenance record. Broad topics use parallel researcher agents; narrow explainers stay with the lead agent and direct searches.

## Usage

From the REPL:

```
/deepresearch What are the current approaches to mechanistic interpretability in LLMs?
```

From the CLI:

```bash
feynman deepresearch "What are the current approaches to mechanistic interpretability in LLMs?"
```

`/deepresearch` stops after writing its plan and waits for you to reply "yes" or request changes. Nothing is searched, fetched, or drafted before you approve.

## How it works

1. **Plan** -- Feynman writes `outputs/.plans/<slug>.md` with key questions, evidence needed, a scale decision, a task ledger, a verification log, and a decision log, then asks for confirmation.
2. **Scale** -- Narrow questions and "what is X" explainers use direct search by the lead agent (at least three distinct queries). Comparisons of 2-3 items use 2 `researcher` agents, broad surveys 3-4, and complex multi-domain topics 4-6.
3. **Gather** -- Researchers run in parallel, each writing its findings to a file. Feynman prefers abstracts, HTML pages, official docs, and paper metadata, and reads full text only for the few papers the conclusions depend on. Failed or missing research is recorded in the plan rather than assumed to exist.
4. **Draft** -- The lead agent writes the draft itself and removes or downgrades any claim that does not map to a source, note, or artifact.
5. **Cite** -- When researchers were used, the `verifier` agent adds inline citations and checks every URL. In direct-search runs, the lead agent does this itself.
6. **Review** -- When researchers were used, the `reviewer` agent checks the cited draft for unsupported claims, logical gaps, single-source critical claims, and overstated confidence; FATAL issues are fixed and re-reviewed before delivery. In direct-search runs, the lead agent writes the review itself.
7. **Deliver** -- The final brief and its provenance sidecar are written, and Feynman checks that every required file exists before responding.

If a tool or source fails after approval, the run continues in degraded mode and still writes a final output marked `Verification: BLOCKED` or `PASS WITH NOTES`.

## Output

| File | Contents |
| --- | --- |
| `outputs/.plans/<slug>.md` | Plan, task ledger, verification log |
| `outputs/.drafts/<slug>-draft.md` | Uncited draft |
| `outputs/.drafts/<slug>-cited.md` | Draft with inline citations and Sources |
| `outputs/.drafts/<slug>-revised.md` | Written only when review fixes need a full rewrite |
| `outputs/<slug>.md` (or `papers/<slug>.md` for paper-style drafts) | Final brief |
| `<slug>.provenance.md` next to the final brief | Date, sources consulted/accepted/rejected, verification status, research files |

The brief contains an executive summary, findings organized by question or theme, evidence-backed caveats and disagreements, open questions, and a Sources section.

## Customization

Steer the run in your prompt. Narrow topics produce focused briefs; broad topics produce survey-style overviews. Constraints such as "focus on papers from 2025" or "only consider empirical results" narrow the search. Ask for comprehensive coverage if you want researcher agents on a topic that would otherwise be treated as a simple explainer.
