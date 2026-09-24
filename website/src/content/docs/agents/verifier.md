---
title: Verifier
description: The verifier agent adds inline citations and checks every source behind a draft.
section: Agents
order: 4
---

The verifier post-processes a draft: it anchors each factual claim to a source from the research files, checks that every source URL resolves and supports the claim, and removes what cannot be supported. Its definition lives in `.feynman/agents/verifier.md`.

## What it does

1. **Anchor claims** -- insert inline citations such as `[1]` after each factual claim, merging the numbering from multiple research files into one sequence.
2. **Verify URLs** -- fetch each source with `fetch_content`. Dead links and redirects to unrelated content are replaced with an alternative, such as an archived copy, or removed along with claims that depended only on them.
3. **Check meaning** -- a citation counts only if the source supports the specific number, quote, or conclusion attached to it.
4. **Check paper identity** -- look up each cited DOI or arXiv ID in two indexes (arXiv or Crossref, plus OpenAlex or Semantic Scholar) and flag any title, year, or first-author mismatch instead of keeping the citation silently.
5. **Audit results** -- scores, benchmarks, tables, figures, dataset sizes, and claims of improvement must map to a source URL, research note, raw artifact, or script. Anything that does not is removed or turned into a TODO.
6. **Build Sources** -- a numbered list at the end where every entry is cited at least once and every citation has an entry.

It does not use words like `verified` or `confirmed` unless the underlying evidence is present. When it removes material, it adds a short Removed Unsupported Claims section.

## Tools

The verifier runs with medium thinking and these tools: file and shell tools (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`), `web_search`, `fetch_content`, `get_search_content`, and `feynman_science_database_search`.

## Output

The verifier writes the complete cited document to the output path the workflow assigns. It keeps the draft's structure but may delete or soften unsupported claims.

## Used by

- `/deepresearch` -- cites the draft when researcher subagents were used, before the reviewer runs
- `/lit` -- cites the literature review before the reviewer checks it
- `/draft` -- cites the writer's draft
- `/compare` -- cites the final comparison matrix
- `/audit` -- verifies sources and adds citations for non-trivial audits
