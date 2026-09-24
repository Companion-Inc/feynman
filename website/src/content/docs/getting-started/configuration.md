---
title: Configuration
description: Understand Feynman's configuration files and environment variables.
section: Getting Started
order: 4
---

Feynman stores user-level configuration and state under `~/.feynman/`. This directory is created on first run and contains the Pi agent profile, model settings, authentication state, session history, web-search routing, memory state, command shims, and installed user packages.

## Directory structure

```
~/.feynman/
├── agent/              # Pi agent dir (PI_CODING_AGENT_DIR)
│   ├── settings.json   # Core model and runtime configuration
│   ├── auth.json       # Provider auth metadata and API-key references
│   ├── web-search.json # Web-search routing config
│   ├── web-search-cache/ # Private one-hour fetched-page cache
│   └── npm/            # Optional Pi packages installed with `feynman packages install`
├── sessions/           # Persisted conversation history
├── memory/             # Feynman memory storage
├── bin/                # Feynman command shim used by child agents
└── .state/             # Bootstrap and telemetry state
```

The `agent/settings.json` file is the primary configuration file. It is created by `feynman setup` and can be edited manually. A typical configuration looks like:

```json
{
  "defaultProvider": "openai",
  "defaultModel": "<approved-model-id-from-model-list>",
  "defaultThinkingLevel": "medium"
}
```

## Model configuration

The `defaultProvider` and `defaultModel` fields set which model is used when you launch Feynman without the `--model` flag. You can change them via the CLI:

```bash
feynman model list
feynman model set <provider>/<model-id>
```

To see all models you have configured:

```bash
feynman model list
```

Only authenticated/configured providers appear in `feynman model list`. If you only see OpenAI models, it usually means only OpenAI auth is configured so far.

To add another provider, authenticate it first:

```bash
feynman model login anthropic
feynman model login openrouter
feynman model login google
feynman model login amazon-bedrock
```

Then switch the default model:

```bash
feynman model list
feynman model set <provider>/<model-id>
```

The `model set` command accepts both `provider/model` and `provider:model` formats. Feynman rejects premium Pro-class model IDs here and in `--model`. Exact DeepSeek V4 Pro IDs remain available because the model name does not identify a premium service tier. `feynman model login openrouter` opens the OAuth authorization page. If a remote or headless session cannot receive the loopback callback, copy the browser's final redirect URL or authorization code back into Feynman's prompt to finish sign-in. As an alternative, set `OPENROUTER_API_KEY` before launching Feynman to use API-key authentication without the OAuth flow. `feynman model login google` opens the API-key flow directly, while `feynman model login amazon-bedrock` verifies the AWS credential chain that Pi uses for Bedrock access.

## Web search configuration

Research workflows use `~/.feynman/agent/web-search.json` for web-search routing. The default `auto` route uses configured API-backed providers, including Exa, Jina, Perplexity, and Gemini API. It does not read Chromium or Chrome cookies, so it should not trigger a macOS Keychain prompt.

Example:

```json
{
  "provider": "auto",
  "searchProvider": "auto",
  "exaApiKey": "exa_...",
  "jinaApiKey": "jina_...",
  "perplexityApiKey": "pplx-...",
  "geminiApiKey": "AIza...",
  "openaiSearchProviders": ["openai-codex", "openai"],
  "datalabApiKey": "$DATALAB_API_KEY",
  "pdf": {
    "enabled": true,
    "provider": "auto",
    "maxPages": 100,
    "datalabMode": "balanced",
    "datalabTimeoutMs": 120000
  },
  "summaryGenerationDeadlineMs": 30000,
  "image": { "enabled": true }
}
```

Gemini Web browser-cookie access is disabled by default. To opt into it, set `"allowBrowserCookies": true` in `web-search.json`. On Windows, this can read Chrome or Edge `v10` cookies through current-user DPAPI; Chromium `v20` app-bound cookies are unsupported and fail closed. API-backed search is recommended for `/deepresearch`.

PDF extraction uses Datalab when its key is present, then Gemini, then local PDF.js. The local parser remains available without a key. `pdf.maxPages` bounds every tier and defaults to `100`.

`openaiSearchProviders` sets the ordered Pi provider IDs considered for OpenAI-compatible `web_search`; it defaults to `["openai-codex", "openai"]`.

Full fetched pages live in `~/.feynman/agent/web-search-cache/` for one hour. Session files store bounded metadata and a cache reference, not page bodies.

`tools`, `commands`, `image`, and `pdf` entries can disable individual web features. Feynman's stored-results command key is `web-results`, while `/search` remains research-session search. `summaryGenerationDeadlineMs` defaults to 30 seconds and caps one summary attempt at 10 minutes.

## Subagent model overrides

The subagent runtime has a separate config at `~/.feynman/agent/extensions/subagent/config.json`. When relocated, it uses `extensions/subagent/config.json` under the directory containing the active agent `settings.json`. Feynman fills only missing research defaults:

```json
{
  "missions": { "enabled": false },
  "fleetView": false,
  "asyncByDefault": true
}
```

Existing custom values and unrelated settings are preserved. Malformed JSON, a non-object config, or invalid types for these defaults stop normalization without replacing the config. Automatic mission creation and Fleet UI therefore remain off for a fresh research setup; background delegation stays on.

Feynman's bundled subagents inherit the main research model. Change the main model with Pi's `/model`. To pin one subagent to another model, use pi-subagents' `/subagents` or set `subagents.agentOverrides.<name>.model` in `~/.feynman/agent/settings.json`; remove it to inherit again. Feynman also sets `subagents.agentExcludeDirs` to `["~/.agents"]` so agent files there cannot silently replace the bundled `researcher`, `reviewer`, `writer`, and `verifier`.

## Thinking levels

The `thinkingLevel` field controls how much reasoning the model does before responding. Available levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`, subject to the active model's capabilities. Higher levels produce more thorough analysis at the cost of latency and token usage. You can override per-session:

```bash
feynman --thinking high
```

## Environment variables

Feynman respects the following environment variables, which take precedence over `settings.json`:

| Variable | Description |
| --- | --- |
| `FEYNMAN_MODEL` | Override the default with an approved research model |
| `FEYNMAN_HOME` | Override the parent directory used to create `.feynman` (default parent: `~`) |
| `FEYNMAN_FETCH_CACHE_DIR` | Override the project-local directory used for `fetch_content` PDF scratch Markdown |
| `FEYNMAN_THINKING` | Override the thinking level |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `DATALAB_API_KEY` | Optional Datalab key for layout-aware PDF-to-Markdown extraction |
| `AWS_PROFILE` | Preferred AWS profile for Amazon Bedrock |
| `TAVILY_API_KEY` | Tavily web search API key |
| `SERPER_API_KEY` | Serper web search API key |
| `OPENALEX_API_KEY` | Free OpenAlex key ([create one](https://openalex.org/settings/api)); sent as the `api_key` query parameter. OpenAlex has required keys for regular use since February 2026, and anonymous requests share a small daily budget |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional free Semantic Scholar key ([request one](https://www.semanticscholar.org/product/api#api-key-form)); sent as `x-api-key` so literature searches use your own rate limit instead of the shared anonymous pool |
| `NCBI_API_KEY` | Optional NCBI E-utilities key; raises the paced request budget from 3 to 10 requests per second |
| `NCBI_MIN_REQUEST_GAP_MS` | Override the minimum delay between NCBI request starts; defaults to 500 ms anonymously and 125 ms with a key |
| `FEYNMAN_TELEMETRY` | Set to `off` to disable all Feynman telemetry (`DO_NOT_TRACK=1` also works) |
| `FEYNMAN_POSTHOG_HOST` | Override the PostHog ingest host |
| `FEYNMAN_POSTHOG_PROJECT_ID` | Override the PostHog project ID used in telemetry metadata |
| `FEYNMAN_POSTHOG_KEY` | Override the PostHog project token |

## Telemetry

Feynman collects anonymous usage telemetry by default and prints a one-time notice the first time it runs. Telemetry goes to Feynman's PostHog project under a random install ID stored in `~/.feynman/.state/telemetry.json`. Person profiles and GeoIP lookup are off.

Feynman never sends prompts, model output, paper or document content, file paths, tool arguments, or tool results. Error messages are sent only as a short hash.

To opt out, set either variable in your shell profile:

```bash
export FEYNMAN_TELEMETRY=off
export DO_NOT_TRACK=1
```

`feynman status` shows whether telemetry is on.

What is sent:

| Event | Properties |
|-------|------------|
| `feynman_command_started`, `feynman_command_completed`, `feynman_command_failed` | Command and allow-listed subcommand, output mode, whether a prompt, model, or service tier flag was given, duration, exit code, error name and message hash |
| `feynman_session_started` | Why the session started (startup, resume, new, fork, reload), mode, model and provider name |
| `feynman_workflow_started` | Workflow name (`deepresearch`, `lit`, `review`, and so on; `chat` for anything else) |
| `feynman_workflow_completed` | Workflow name, status (`completed`, `error`, `aborted`), tool and subagent call counts, whether any file under `outputs/` or `papers/` was written (yes or no), duration |
| `feynman_tool_used` | Tool name, whether it failed, whether a subagent called it |
| `$ai_generation` | [PostHog LLM analytics](https://posthog.com/docs/llm-analytics/generations) metadata for each model response: model, provider, input, output, and cache token counts, latency, HTTP status, stop reason, error flag, and the Pi session ID as the trace ID. No `$ai_input` or `$ai_output_choices`. |

Every event also carries the Feynman version, Node.js version, platform, and CPU architecture.

Each send is tried once. The first network or ingest failure turns telemetry off for the rest of that process without printing anything; set `FEYNMAN_DEBUG=1` to see the single CLI diagnostic.

## Session storage

Each conversation is persisted as a JSON file in `~/.feynman/sessions/`. To start a fresh session:

```bash
feynman --new-session
```

An interactive `feynman` launch continues the most recent session for the current project. Pi's own session flags pass through unchanged:

```bash
feynman --resume                      # pick a previous session
feynman --session <path|id>           # open a specific session
feynman --fork <path|id>              # fork a session into a new one
feynman --no-session                  # in-memory session, not persisted
feynman --export <session.jsonl> [out.html]   # export a session to HTML
```

To point sessions at a different directory (useful for per-project session isolation):

```bash
feynman --session-dir ~/myproject/.feynman/sessions
```

## Diagnostics

Run `feynman doctor` to verify your configuration is valid, check authentication status for all configured providers, and detect missing optional dependencies. The doctor command outputs a checklist showing what is working and what needs attention.
