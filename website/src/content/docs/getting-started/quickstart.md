---
title: Quick Start
description: Start using Feynman for paper search, research workflows, and code-aware review.
section: Getting Started
order: 2
---

This guide assumes you have [installed Feynman](/docs/getting-started/installation) and run `feynman setup`.

## Launch the REPL

```bash
feynman
```

This opens an interactive session in the current directory. An interactive launch continues the most recent session for that directory; pass `--new-session` to start fresh. Type a research question and press Enter.

## Run a one-shot prompt

To get one answer without entering the REPL:

```bash
feynman --prompt "Summarize the key findings of Attention Is All You Need"
```

Feynman prints the response and exits.

## Start a deep research run

```bash
feynman
> /deepresearch What are the current approaches to mechanistic interpretability in LLMs?
```

Feynman first writes a plan to `outputs/.plans/<slug>.md` and asks you to confirm it. After you reply `yes`, it gathers evidence, delegating to researcher agents when the topic is broad enough, then drafts, verifies citations, and writes the final brief to `outputs/<slug>.md` with a `.provenance.md` sidecar.

## Find an ML training recipe

For applied ML work, use `/recipe` when you need a practical starting point rather than a broad literature survey:

```bash
feynman recipe "fine-tune a small model for math reasoning"
```

Feynman ranks candidate recipes by result quality and feasibility, checks datasets and implementation paths when possible, and writes the brief to `outputs/<slug>-recipe.md`.

## Work with files

Feynman reads and writes files in its working directory. Use `--cwd` to point it at a project folder:

```bash
feynman --cwd ~/papers
> /review arxiv:2301.07041
```

You can also reference local files directly in prompts.

## Explore commands

Type `/help` inside the REPL to see Feynman's commands. Every research workflow also runs directly from the shell:

```bash
feynman deepresearch "transformer architectures for protein folding"
```

See the [Slash Commands](/docs/reference/slash-commands) and [CLI Commands](/docs/reference/cli-commands) references.
