---
title: CLI Commands
description: Complete reference for all Feynman CLI commands and flags.
section: Reference
order: 1
---

This page covers the dedicated Feynman CLI commands and flags. Workflow commands like `feynman deepresearch` are also documented in the [Slash Commands](/docs/reference/slash-commands) reference since they map directly to REPL slash commands.

## Core commands

| Command | Description |
| --- | --- |
| `feynman` | Launch the interactive REPL |
| `feynman chat [prompt]` | Start chat explicitly, optionally with an initial prompt |
| `feynman help` | Show CLI help |
| `feynman setup` | Run the guided setup wizard |
| `feynman setup preview` | Install or verify preview dependencies |
| `feynman doctor` | Diagnose config, auth, Pi runtime, and preview dependencies |
| `feynman status` | Show the current setup summary (model, auth, packages) |

## Model management

| Command | Description |
| --- | --- |
| `feynman model list` | List available models in Pi auth storage |
| `feynman model login [id]` | Authenticate a model provider with OAuth or API-key setup |
| `feynman model logout [id]` | Clear stored auth for a model provider |
| `feynman model set <provider/model>` | Set the default approved research model for all sessions |

These commands manage your model provider configuration. The `model set` command updates `~/.feynman/agent/settings.json` with the new default. It accepts either `provider/model-name` or `provider:model-name`; run `feynman model list` first and choose an approved model ID from that output. For `feynman model login openrouter` over SSH or another headless session, paste the browser's final redirect URL or authorization code into Feynman when the loopback callback is unavailable, or set `OPENROUTER_API_KEY` before launch to use API-key authentication without OAuth. Running `feynman model login google` or `feynman model login amazon-bedrock` routes directly into the relevant API-key setup flow instead of requiring the interactive picker.

## AlphaXiv commands

| Command | Description |
| --- | --- |
| `feynman alpha login` | Sign in to alphaXiv |
| `feynman alpha logout` | Clear alphaXiv auth |
| `feynman alpha status` | Refresh expired alphaXiv credentials when possible and verify live auth status |
| `feynman alpha search "query"` | Search papers through Feynman's bundled alphaXiv client |
| `feynman alpha get <id-or-url>` | Fetch paper content and local annotations |
| `feynman alpha ask <id-or-url> "question"` | Ask a question about a paper |
| `feynman alpha code <github-url> [path]` | Inspect a paper repository |
| `feynman alpha annotate ...` | Read, write, list, or clear local paper notes |

AlphaXiv authentication enables Feynman to search and retrieve papers, access discussion threads, and pull citation metadata. Use `feynman alpha ...` for shell access so Feynman runs its bundled alphaXiv client.

## Package management

| Command | Description |
| --- | --- |
| `feynman packages list` | List supported optional research packages and their install status |
| `feynman packages install <preset>` | Install an optional package preset |
| `feynman update [package]` | Update optional Pi packages you installed, or one of them; core packages update with Feynman |

Use `feynman packages list` to see which optional research-continuity packages are available on your platform and which are already installed. The default install keeps only the research essentials in core, including `/btw` side conversations for steering while the main research agent is busy. Install optional presets one by one when they directly support an active research workflow.

## Utility commands

| Command | Description |
| --- | --- |
| `feynman search status` | Show Pi web-access status and config path |

## REPL hotkeys

Inside the interactive REPL, use `/hotkeys` to show the live keyboard map. The default reasoning controls are:

| Hotkey | Action |
| --- | --- |
| `Shift+Tab` | Cycle thinking/reasoning level |
| `Ctrl+T` | Toggle thinking block visibility |

## Workflow commands

All research workflow slash commands can also be invoked directly from the CLI:

```bash
feynman deepresearch "topic"
feynman lit "topic-or-lab"
feynman review artifact.md
feynman audit 2401.12345
feynman replicate "claim"
feynman recipe "fine-tune a small model for math reasoning"
feynman compare "topic"
feynman draft "topic"
```

These are equivalent to launching the REPL and typing the corresponding slash command.

## Flags

| Flag | Description |
| --- | --- |
| `--prompt "<text>"` | Run one prompt and exit (one-shot mode) |
| `--model <provider/model|provider:model>` | Force a specific approved research model for this session |
| `--thinking <level>` | Set thinking level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `--cwd <path>` | Set the working directory for all file operations |
| `--session-dir <path>` | Set the session storage directory |
| `--new-session` | Start a new persisted session |
| `--continue`, `-c` | Continue the most recent session (the default for an interactive launch) |
| `--resume`, `-r` | Pick a previous session to resume |
| `--session <path\|id>` | Open a specific session |
| `--fork <path\|id>` | Fork a session into a new one |
| `--no-session` | Use an in-memory session that is not persisted |
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
