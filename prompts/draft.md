---
description: Turn research findings into a polished paper-style draft with equations, sections, and explicit claims.
args: <topic>
section: Research Workflows
topLevelCli: true
---
Write a paper-style draft for: $@

Derive a short slug from the topic (lowercase, hyphens, no filler words, ≤5 words). Use this slug for all files in this run.

Requirements:
- Before writing, outline the draft structure: proposed title, sections, key claims to make, source material to draw from, and a verification log for the critical claims, figures, and calculations. Write the outline to `outputs/.plans/<slug>.md`. Briefly summarize the outline to the user and continue immediately. Do not ask for confirmation or wait for a proceed response unless the user explicitly requested outline review.
- Use the `writer` subagent when the draft should be produced from already-collected notes, then use the `verifier` subagent to add inline citations and verify sources.
- Include at minimum: title, abstract, problem statement, related work, method or synthesis, evidence or experiments, limitations, conclusion.
- Use clean Markdown with LaTeX where equations materially help.
- Follow the system prompt's provenance rules for all results, figures, charts, images, tables, benchmarks, and quantitative comparisons. If evidence is missing, leave a placeholder or proposed experimental plan instead of claiming an outcome.
- Use Markdown tables for quantitative comparisons and Mermaid for architectures and pipelines. Plot only source-backed data, and save the plotting script next to the draft. Every figure or table needs provenance.
- Before delivery, sweep the draft for any claim that sounds stronger than its support. Mark tentative results as tentative and remove unsupported numerics instead of letting the verifier discover them later.
- Save exactly one draft to `papers/<slug>.md`.
- End with a `Sources` appendix with direct URLs for all primary references.
