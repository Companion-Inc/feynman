---
title: Package Stack
description: Core and optional Pi packages bundled with Feynman.
section: Reference
order: 3
---

Feynman is built on stock Pi and uses curated Pi packages for its capabilities. Feynman itself is a Pi package: its `package.json` `pi` manifest declares its extension, prompts, skills, theme, and subagent definitions. Feynman launches Pi with `PI_CODING_AGENT_DIR=~/.feynman/agent` and lists itself and its core packages in `~/.feynman/agent/settings.json` as local-path packages, so subagents load the same tools as the main session.

See Pi's upstream docs for [packages](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md), [extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), and [skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md).

## Core packages

These are npm dependencies of Feynman, installed with it and loaded unmodified from its install directory.

| Package | Purpose |
| --- | --- |
| `pi-subagents` | The `subagent` tool, `/subagents`, and `/run`; powers delegated and parallel research runs |
| `pi-web-access` | `web_search`, `source_check`, `fetch_content`, and `get_search_content` for web search and page, PDF, and GitHub retrieval |
| `pi-docparser` | `document_parse`, `document_search`, and `document_screenshot` for local PDFs, Office documents, spreadsheets, and images |
| `pi-btw` | `/btw` side conversations while the main research agent is busy |
| `@companion-ai/alpha-hub` | alphaXiv client library behind Feynman's `alpha_*` tools and `feynman alpha` |

They update when you upgrade Feynman. You do not need to install them individually.

## Bundled research extension

Feynman's own extension registers these tools and commands:

| Group | Contents |
| --- | --- |
| AlphaXiv tools | `alpha_search`, `alpha_get_paper`, `alpha_ask_paper`, `alpha_read_code`, `alpha_annotate_paper`, `alpha_list_annotations` |
| Science database search | `feynman_science_database_search` over Semantic Scholar, OpenAlex, arXiv IDs, PubMed, Europe PMC, bioRxiv/medRxiv, and Crossref |
| Hugging Face Hub tools | `hf_dataset_info`, `hf_repo_files`, `hf_repo_read_file` |
| Commands | `/help`, `/init`, `/outputs`, `/tools`, `/service-tier` |

## Optional packages

Install on demand with `feynman packages install <preset>`.

| Package | Preset | Purpose |
| --- | --- | --- |
| `@samfp/pi-memory` | `memory` | Preference and correction memory across sessions |
| `@luxusai/pi-hindsight` | `hindsight` | Hindsight-backed long-term memory. Requires a Hindsight server or Hindsight Cloud account |

To search past Feynman sessions without a package, search the session files directly:

```bash
rg -n "protein folding" ~/.feynman/sessions
```

## Installing and managing packages

List core packages and optional presets:

```bash
feynman packages list
```

Install a specific optional preset:

```bash
feynman packages install memory
```

## Updating packages

Update the optional packages you installed, through Pi's own `pi update --extensions`:

```bash
feynman update
```

Update one package, by preset name or Pi package source:

```bash
feynman update memory
```

Core packages are not touched by `feynman update` because they ship with Feynman; to update them, upgrade Feynman itself (rerun the installer from the [Installation guide](/docs/getting-started/installation), or `npm install -g @companion-ai/feynman@latest`).

## Runtime versions

Feynman 0.5.3 runs Pi 0.87.1 with pi-subagents 0.71.0, pi-web-access 0.31.0, pi-docparser 4.0.0, pi-btw 0.6.0, and Alpha Hub 0.1.6 as ordinary npm dependencies, and does not modify any of them on disk. Every release is checked by booting the installed CLI in Pi RPC mode on Linux, macOS, and Windows.
