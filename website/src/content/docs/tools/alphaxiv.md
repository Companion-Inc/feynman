---
title: AlphaXiv
description: Search and read arXiv papers through Feynman's alphaXiv integration.
section: Tools
order: 1
---

Feynman bundles an alphaXiv client (`@companion-ai/alpha-hub`) for searching arXiv papers, reading AI-generated paper reports or full text, asking questions about a paper, and reading a paper's linked code. alphaXiv covers arXiv papers; DOI-only papers are read through web fetch or Europe PMC instead.

## Authentication

Sign in during `feynman setup` or at any time:

```bash
feynman alpha login
```

Check your authentication status:

```bash
feynman alpha status
```

## Agent tools

| Tool | Purpose |
| --- | --- |
| `alpha_search` | Search papers. Modes: `semantic` (default), `keyword`, `agentic`, `both`, `all` |
| `alpha_get_paper` | Fetch a paper's AI-generated report, or raw full text with `fullText`, plus any local annotation. `section` or `sections` return only abstract, introduction, methodology, experiments, results, discussion, limitations, or conclusion when detectable |
| `alpha_ask_paper` | Ask a targeted question about a paper's PDF |
| `alpha_read_code` | Read files from a paper's GitHub repository; `/` gives an overview |
| `alpha_annotate_paper` | Write or clear a local note on a paper |
| `alpha_list_annotations` | List local paper notes |

The lead agent calls these tools directly. The bundled researcher agent does not load them; it runs `feynman alpha ...` through its shell instead, after checking `feynman alpha status`.

## CLI

The same client is available from the terminal:

```bash
feynman alpha search "scaling laws"
feynman alpha get 2401.12345
feynman alpha ask 2401.12345 "What optimizer did they use?"
feynman alpha code https://github.com/org/repo src/model.py
```

## Storage

The alphaXiv client keeps its login state and local paper annotations under `~/.ahub`, separate from Feynman's `~/.feynman` directory. Remove `~/.ahub` to clear them during uninstall.

## Without AlphaXiv

Feynman works without an alphaXiv login. Paper discovery then goes through `feynman_science_database_search` (Semantic Scholar, OpenAlex, arXiv ID lookup, PubMed, Europe PMC, bioRxiv/medRxiv, Crossref) and web search, and full text comes from `fetch_content` on arXiv or open-access pages.
