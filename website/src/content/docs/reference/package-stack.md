---
title: Package Stack
description: Core and optional Pi packages bundled with Feynman.
section: Reference
order: 3
---

Feynman is built on stock Pi and uses curated Pi packages for its capabilities. Feynman itself is a Pi package: its `package.json` `pi` manifest declares its extension, prompts, skills, theme, and subagent definitions. Feynman launches Pi with `PI_CODING_AGENT_DIR=~/.feynman/agent` and lists itself and its core packages in `~/.feynman/agent/settings.json` as local-path packages, so subagents load the same tools as the main session.

Feynman also ships a local research extension that registers project-specific tools such as AlphaXiv wrappers, Feynman commands, and read-only Hugging Face Hub inspection. Those extension tools are bundled with Feynman itself rather than installed as separate Pi packages. Pi runtime observability is provided by the bundled `pi-otel` package, pointed at PostHog through the standard `OTEL_EXPORTER_OTLP_ENDPOINT`, and configured for metadata-only spans by default. CLI and Pi spans use PostHog distributed tracing and are queryable from `posthog.trace_spans`.

This page follows Pi's upstream docs for [packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md), [extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), and [skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md). Feynman adds its own package presets and bundled research extension on top of that model.

## Core packages

These are npm dependencies of Feynman, installed with it and loaded unmodified from its install directory. They provide the foundation for research workflows while Pi owns the underlying runtime, RPC transport, provider model, and package loader.

| Package | Purpose |
| --- | --- |
| `@companion-ai/alpha-hub` | alphaXiv client library behind Feynman's `alpha_*` tools and `feynman alpha` |
| `pi-subagents` | Parallel agent spawning for literature gathering and task decomposition. Powers the multi-agent workflows |
| `pi-btw` | Side conversations while the main research agent is busy, including `/btw` follow-ups, custom-provider continuity, and handoff back into the main thread |
| `pi-docparser` | Parse PDFs, Office documents, spreadsheets, and images through bounded, isolated native workers |
| `pi-web-access` | Multi-provider web search, explicit proxy routing, bounded GitHub issue/PR documents, raw and page-grounded retrieval, Defuddle fallback, private external fetched-page caching, stored-page passage lookup, registration gates, bounded summary generation, optional layout-aware PDF extraction, and direct image/media retrieval |
| `pi-otel` | OpenTelemetry spans for Pi sessions, model calls, turns, and tool usage, exported without prompt or tool payload content |

They update when you upgrade Feynman. You do not need to install them individually.

## Bundled research extension

| Tool group | Purpose |
| --- | --- |
| AlphaXiv tools | Search papers, fetch paper reports, ask paper questions, read linked code, and manage annotations |
| Hugging Face Hub tools | Inspect dataset metadata, features, splits, access status, and small files from model, dataset, and Space repos |
| Feynman commands | `/help`, `/outputs`, `/init`, `/feynman-model`, `/service-tier`, and discovery helpers |

## Optional packages

Install on demand with `feynman packages install <preset>`. These extend Feynman with capabilities that not every user needs.

| Package | Preset | Purpose |
| --- | --- | --- |
| `@samfp/pi-memory` | `memory` | Pi-managed preference and correction memory for research-session continuity |
| `@luxusai/pi-hindsight` | `hindsight` | Hindsight-backed research-continuity memory. Requires a Hindsight server or Hindsight Cloud account |
| `@kaiserlich-dev/pi-session-search` | `session-search` | Indexed recall for prior research-session transcripts. Available through Node.js 22.x while its sqlite dependency is native-bound |

## Installing and managing packages

List supported optional research packages and their install status:

```bash
feynman packages list
```

Install a specific optional preset:

```bash
feynman packages install session-search
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

Pinned versions stay pinned. Core packages are skipped because they ship with Feynman; to update them, upgrade Feynman itself (rerun the installer from the [Installation guide](/docs/getting-started/installation), or `npm install -g @companion-ai/feynman@latest`).

## Runtime versions

Feynman depends on Pi `^0.87.1`, pi-subagents `^0.71.0`, pi-web-access `^0.31.0`, pi-btw `^0.6.0`, pi-docparser `^4.0.0`, pi-otel `^0.3.0`, and Alpha Hub 0.1.6, and does not modify any of them on disk. LiteParse is held at 2.14.3 and pi-otel's OpenTelemetry dependencies at their patched releases through npm overrides. Feynman publishes an `npm-shrinkwrap.json`, the same way Pi does, so every npm install gets exactly the dependency tree that was tested. Every release is checked by booting the installed CLI in Pi RPC mode on Linux, macOS, and Windows.
