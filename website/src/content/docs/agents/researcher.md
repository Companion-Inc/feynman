---
title: Researcher
description: The researcher agent gathers primary evidence from papers, web sources, repos, and datasets.
section: Agents
order: 1
---

The researcher is Feynman's evidence-gathering subagent. It searches paper databases and the web, reads the most relevant sources, and writes an evidence file that the lead agent synthesizes. Its definition lives in `.feynman/agents/researcher.md`.

## What it does

The researcher receives a task brief from a workflow, searches broadly, then narrows using the terminology and names it finds. It runs 2–4 reworded queries for each question and merges the results instead of trusting one query's ranking.

For broad deep research and literature review tasks, workflow prompts can run several researchers in parallel through one async `workflowScript` using `await runs.all([{key, agent, task, output}, ...])`, each covering a different angle. The lead agent consumes the ordered results and verifies the declared output files before synthesis. Narrow tasks skip the researcher and stay lead-owned.

## Tools

The researcher runs with high thinking and these tools: file and shell tools (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`), `web_search`, `fetch_content`, `get_search_content`, `feynman_science_database_search`, and the Hugging Face tools `hf_dataset_info`, `hf_repo_files`, and `hf_repo_read_file`. It does not load the `alpha_*` tools; it uses `feynman alpha search` through the shell when alphaXiv is logged in.

## Source routing

| Need | First choice | Then |
| --- | --- | --- |
| General ML/CS papers | Semantic Scholar (citation-sorted) | `feynman alpha search` when logged in |
| Biomedical papers | PubMed, then Europe PMC for open-access full-text sections | Semantic Scholar for citation counts |
| Citation graph | OpenAlex citations and references | Semantic Scholar citation counts |
| Conceptual or recent work keyword search misses | OpenAlex semantic search | Semantic Scholar by relevance |
| Web, docs, repos, grey literature | `web_search` | `fetch_content` on the best results |
| Known paper ID | arXiv ID or Crossref DOI lookup | `fetch_content` on `arxiv.org/html/<id>` |

## Output

The researcher writes to the output path the workflow assigns. The file contains an evidence table with stable numeric source IDs and at least five entries, findings that cite those IDs inline, a numbered Sources list with direct URLs, and a Coverage Status section listing what was checked, what remains uncertain, and any tasks it could not complete. It returns a one-line summary to the lead agent rather than the full findings.

Every source needs a checkable URL, and the researcher labels inferences separately from claims it read directly.

For ML training, replication, benchmark, or dataset tasks, it organizes findings as ranked recipes: reported result, dataset (size, split, access, schema if checked), method and hyperparameters, compute, implementation code paths, and a verification status of `verified`, `unverified`, `blocked`, or `inferred`. A dataset is not described as usable unless its availability and format were checked.

## Used by

Workflows that can delegate to the researcher: `/deepresearch`, `/lit`, `/review`, `/audit`, `/replicate`, `/recipe`, `/compare`, and `/summarize` (one researcher per chunk for very large sources).
