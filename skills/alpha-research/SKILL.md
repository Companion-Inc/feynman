---
name: alpha-research
description: Search, read, and query research papers via Feynman's alphaXiv-backed alpha tools. Use when the user asks about academic papers, wants to find research on a topic, needs to read a specific paper, ask questions about a paper, inspect a paper's code repository, or manage paper annotations.
---

# Alpha Research CLI

Use visible Feynman alpha tools when they are available. For shell commands, use `feynman alpha ...`; do not call the user's bare global `alpha` binary because it can be stale.

## Commands

| Command | Description |
|---------|-------------|
| `feynman alpha search "<query>"` | Search papers. Prefer `--mode semantic` by default; use `--mode keyword` only for exact-term lookup and `--mode agentic` for broader retrieval. |
| `feynman alpha get <arxiv-id-or-url>` | Fetch paper content and any local annotation |
| `feynman alpha get --full-text <arxiv-id>` | Get raw full text instead of AI report |
| `feynman alpha ask <arxiv-id> "<question>"` | Ask a question about a paper's PDF |
| `feynman alpha code <github-url> [path]` | Read files from a paper's GitHub repo. Use `/` for overview |
| `feynman alpha annotate <paper-id> "<note>"` | Save a persistent annotation on a paper |
| `feynman alpha annotate --clear <paper-id>` | Remove an annotation |
| `feynman alpha annotate --list` | List all annotations |

## Auth

Run `feynman alpha login` to authenticate with alphaXiv. Check status with `feynman alpha status`.

## Examples

```bash
feynman alpha search "transformer scaling laws"
feynman alpha search --mode agentic "efficient attention mechanisms for long context"
feynman alpha get 2106.09685
feynman alpha ask 2106.09685 "What optimizer did they use?"
feynman alpha code https://github.com/karpathy/nanoGPT src/model.py
feynman alpha annotate 2106.09685 "Key paper on LoRA - revisit for adapter comparison"
```

## When to use

- Academic paper search, reading, Q&A → Feynman alpha tools or `feynman alpha`
- Current topics (products, releases, docs) → web search tools
- Mixed topics → combine both
