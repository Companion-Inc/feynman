---
title: Slash Commands
description: Complete reference for REPL slash commands.
section: Reference
order: 2
---

Slash commands are available inside the Feynman REPL. They map to research workflows, project utilities, and commands from the bundled Pi packages. Type `/help` inside the REPL for Feynman's grouped command list.

## Research workflows

| Command | Description |
| --- | --- |
| `/deepresearch <topic>` | Run a thorough, source-heavy investigation and produce a research brief with inline citations |
| `/lit <topic-or-lab-or-author>` | Run a literature review on a topic, lab, PI, or author |
| `/review <artifact>` | Run an internal research critique with likely objections, severity, and a concrete revision plan |
| `/audit <item>` | Compare a paper's claims against its public codebase for mismatches, omissions, and reproducibility risks |
| `/replicate <paper>` | Plan a replication workflow for a paper, claim, or benchmark; execute only after an explicit environment choice |
| `/recipe <task-or-paper>` | Find ranked, implementable ML training recipes backed by papers, datasets, docs, and code |
| `/compare <topic>` | Compare multiple sources and produce a matrix of agreements, disagreements, and confidence |
| `/draft <topic>` | Turn research findings into a paper-style draft |
| `/autoresearch <idea>` | Run a bounded experiment loop against a benchmark, keeping what works |
| `/summarize <source>` | Summarize a paper, report, README, local artifact, or PDF with the source kept on disk instead of in context |

Workflow prompts can call the bundled agents (researcher, reviewer, writer, verifier) through Pi's `subagent` tool when delegation helps; narrow tasks stay lead-owned.

## Project and session

| Command | Description |
| --- | --- |
| `/log` | Write a durable session log with completed work, findings, open questions, and next steps |
| `/help` | Show grouped Feynman commands and prefill the editor with a selected command |
| `/init` | Bootstrap `AGENTS.md` and session-log folders for a research project |
| `/outputs` | Browse all research artifacts (papers, outputs, experiments, notes) |
| `/tools` | Browse public research tools with their source and parameter summary |
| `/service-tier` | View or set the provider service tier override for supported models |

## Package commands

| Command | Package | Description |
| --- | --- | --- |
| `/btw <question>` | `pi-btw` | Ask a side question while the main research agent is busy |
| `/search` | `pi-web-access` | Browse stored web search results from the current session |
| `/websearch [queries]` | `pi-web-access` | Open the search curator to run and review searches yourself |
| `/curator [on\|off]` | `pi-web-access` | Toggle the search curator workflow |
| `/subagents` | `pi-subagents` | Inspect configured agents |
| `/run <agent> [task] [--bg] [--fork]` | `pi-subagents` | Run one agent |
| `/hotkeys`, `/new`, `/quit` | Pi | Show keyboard shortcuts, start a new session, quit |

## Research delegation

The current runtime does not provide `/chain` or `/parallel` commands. Research workflows call `subagent` directly for one child or use `workflowScript` for parallel or sequential work:

```json
{
  "workflowScript": "return await runs.all([{key:'papers',agent:'researcher',task:'Read outputs/.plans/<slug>-papers.md.',output:'<slug>-research-papers.md'},{key:'web',agent:'researcher',task:'Read outputs/.plans/<slug>-web.md.',output:'<slug>-research-web.md'}]);",
  "async": true,
  "globalConcurrencyLimit": 4
}
```

For sequential work, await `runs.run(key, {agent, task, output})` before starting the next step. Legacy top-level `tasks`, `chain`, and `parallel` inputs are rejected. `runs.all` returns an ordered array, including ordinary child failures; inspect each result's `ok` and returned output references.

An async launch receipt is not completion: consume the result and verify child output paths before synthesis or dependent review. Ordinary background subagents notify their parent; `bg_wait` is for background work without a native completion notification.

## Running workflows from the CLI

Every research workflow can also be run from the command line, for example `feynman deepresearch "topic"`. See [CLI Commands](/docs/reference/cli-commands#workflow-commands).
