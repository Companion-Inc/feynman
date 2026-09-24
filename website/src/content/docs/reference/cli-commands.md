---
title: CLI Commands
description: Complete reference for all Feynman CLI commands and flags.
section: Reference
order: 1
---

This page covers the Feynman CLI commands and flags. `feynman help` prints the same list. Workflow commands like `feynman deepresearch` map directly to the REPL [slash commands](/docs/reference/slash-commands).

## Core commands

| Command | Description |
| --- | --- |
| `feynman` | Launch the interactive REPL |
| `feynman chat [prompt]` | Start chat explicitly, optionally with an initial prompt |
| `feynman help` | Show CLI help |
| `feynman setup` | Run the guided setup wizard |
| `feynman setup preview` | Install or verify pandoc |
| `feynman doctor` | Diagnose config, auth, Pi runtime, and preview dependencies |
| `feynman status` | Show the current setup summary (model, auth, alphaXiv, web access, service tier, telemetry) |

## Model management

| Command | Description |
| --- | --- |
| `feynman model list` | List available models in Pi auth storage |
| `feynman model login [id]` | Authenticate a model provider with OAuth or API-key setup |
| `feynman model logout [id]` | Clear stored auth for a model provider |
| `feynman model set <provider/model>` | Set the default approved research model for all sessions |
| `feynman model tier [value]` | View or set the request service tier override |

The `model set` command updates `~/.feynman/agent/settings.json` with the new default. It accepts either `provider/model-name` or `provider:model-name`; run `feynman model list` first and choose a model ID from that output. `feynman model login <id>` goes straight to API-key setup for API-key providers such as `google`, `amazon-bedrock`, and `openrouter`. For OAuth logins in SSH or other headless sessions, paste the final redirect URL into Feynman when the browser runs on another machine.

## AlphaXiv commands

| Command | Description |
| --- | --- |
| `feynman alpha login` | Sign in to alphaXiv |
| `feynman alpha logout` | Clear alphaXiv auth |
| `feynman alpha status` | Check alphaXiv auth status |
| `feynman alpha search "query"` | Search papers through Feynman's bundled alphaXiv client |
| `feynman alpha get <id-or-url>` | Fetch paper content and local annotations |
| `feynman alpha ask <id-or-url> "question"` | Ask a question about a paper |
| `feynman alpha code <github-url> [path]` | Inspect a paper repository |
| `feynman alpha annotate ...` | Read, write, list, or clear local paper notes |

Use `feynman alpha ...` rather than a global `alpha` binary so the bundled client runs. See [AlphaXiv](/docs/tools/alphaxiv).

## Package management

| Command | Description |
| --- | --- |
| `feynman packages list` | Show core packages and optional package presets |
| `feynman packages install <preset>` | Install an optional package preset |
| `feynman update [package]` | Update optional Pi packages you installed, or one of them; core packages update with Feynman |

See [Package Stack](/docs/reference/package-stack) for the core packages and optional presets.

## Web search

| Command | Description |
| --- | --- |
| `feynman search status` | Show Pi web-access status and config path |
| `feynman search set <provider> [api-key]` | Set the web search provider (`auto`, `exa`, `perplexity`, or `gemini`) and optionally save its API key |
| `feynman search clear` | Reset the web search provider to `auto` while keeping API keys |

See [Web Search](/docs/tools/web-search).

## REPL hotkeys

Inside the interactive REPL, use `/hotkeys` to show the live keyboard map. The default reasoning controls are:

| Hotkey | Action |
| --- | --- |
| `Shift+Tab` | Cycle thinking/reasoning level |
| `Ctrl+T` | Collapse or expand thinking blocks |

## Workflow commands

Every workflow prompt can also be run directly from the CLI:

```bash
feynman deepresearch "topic"
feynman lit "topic-or-lab"
feynman review artifact.md
feynman audit 2401.12345
feynman replicate "claim"
feynman recipe "fine-tune a small model for math reasoning"
feynman compare "topic"
feynman draft "topic"
feynman autoresearch "idea"
feynman summarize paper.pdf
feynman log
```

These are equivalent to launching the REPL and typing the corresponding slash command.

## Flags

| Flag | Description |
| --- | --- |
| `--prompt "<text>"` | Run one prompt and exit (one-shot mode) |
| `--model <provider/model\|provider:model>` | Force a specific approved research model for this session |
| `--service-tier <tier>` | Override the request service tier for this run |
| `--thinking <level>` | Set thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--cwd <path>` | Set the working directory for tools |
| `--session-dir <path>` | Set the session storage directory |
| `--new-session` | Start a new persisted session |
| `--continue`, `-c` | Continue the most recent session (the default for an interactive launch) |
| `--resume`, `-r` | Pick a previous session to resume |
| `--session <path\|id>` | Open a specific session |
| `--fork <path\|id>` | Fork a session into a new one |
| `--no-session` | Use an in-memory session that is not persisted |
| `--no-themes` | Skip theme loading (passed by ACP adapters such as pi-acp) |
| `--export <session.jsonl> [out.html]` | Export a session file to HTML and exit |
| `--alpha-login` | Sign in to alphaXiv and exit |
| `--alpha-logout` | Clear alphaXiv auth and exit |
| `--alpha-status` | Show alphaXiv auth status and exit |
| `--doctor` | Alias for `feynman doctor` |
| `--setup-preview` | Alias for `feynman setup preview` |

When stdin is not a terminal, `--prompt` and workflow commands do not read it, so an idle pipe from a parent process cannot stall the run. Pipe text without `--prompt` to send it as the prompt, for example `git diff | feynman --no-session`.

Use the standard `--` delimiter before an interactive prompt that starts with
a dash, so Pi treats it as research text rather than another option:

```bash
feynman -- "- summarize the strongest evidence first"
```

For one-shot mode, attach a dash-leading value directly to `--prompt`:

```bash
feynman --prompt="- summarize the strongest evidence first"
```
