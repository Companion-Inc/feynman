---
title: Configuration
description: Understand Feynman's configuration files and environment variables.
section: Getting Started
order: 4
---

Feynman stores user-level configuration and state under `~/.feynman/`, created on first run. Set `FEYNMAN_HOME` to use `<FEYNMAN_HOME>/.feynman` instead.

## Directory structure

```
~/.feynman/
├── agent/                  # Pi agent dir (PI_CODING_AGENT_DIR)
│   ├── settings.json       # Default model, thinking level, packages
│   ├── auth.json           # Provider credentials (user-only permissions)
│   ├── models.json         # Custom and local providers
│   ├── web-search.json     # Web search provider and keys
│   ├── web-search-cache/   # Fetched pages, kept for one hour
│   ├── extensions/subagent/config.json  # Subagent runtime config
│   └── npm/                # Optional Pi packages from `feynman packages install`
├── sessions/               # Session transcripts (JSONL)
├── bin/                    # `feynman` shim used by child agents
└── .state/                 # Telemetry install ID and first-run notice state
```

`agent/settings.json` is the main configuration file. Feynman fills in missing defaults on every launch, and you can edit it by hand. The model fields look like:

```json
{
  "defaultProvider": "openai",
  "defaultModel": "gpt-5.6-terra",
  "defaultThinkingLevel": "medium"
}
```

## Model configuration

`defaultProvider` and `defaultModel` set the model used when you launch without `--model`. Only providers you have authenticated appear in `feynman model list`. To add a provider, sign in to it, then switch the default:

```bash
feynman model login anthropic
feynman model list
feynman model set anthropic/claude-opus-5-5
```

`feynman model login` with no provider shows the OAuth and API-key choices. `model set` accepts `provider/model` or `provider:model`. Pro-class model IDs are rejected here and in `--model`. See [Setup](/docs/getting-started/setup) for OAuth on headless machines, Amazon Bedrock, and local models.

## Web search configuration

Web search, page fetching, and PDF extraction come from the bundled `pi-web-access` package, configured in `~/.feynman/agent/web-search.json`. The default `auto` route works without keys through Exa and uses any other provider you have configured. Set a provider and key from the CLI:

```bash
feynman search status
feynman search set perplexity <api-key>   # or exa, gemini, auto
feynman search clear                      # back to auto, keys kept
```

Example config:

```json
{
  "provider": "auto",
  "exaApiKey": "exa_...",
  "perplexityApiKey": "pplx-...",
  "geminiApiKey": "AIza...",
  "datalabApiKey": "$DATALAB_API_KEY",
  "pdf": { "provider": "auto", "maxPages": 100 }
}
```

PDF extraction tries Datalab when its key is set, then Gemini, then local extraction, which needs no key. Browser-cookie access for Gemini Web is off by default; set `"allowBrowserCookies": true` to opt in. The [pi-web-access README](https://github.com/nicobailon/pi-web-access#readme) documents every provider and option.

## Subagent model overrides

The bundled subagents (`researcher`, `reviewer`, `writer`, `verifier`) inherit the main research model. To pin one to another model, use `/subagents` or set `subagents.agentOverrides.<name>.model` in `~/.feynman/agent/settings.json`; remove it to inherit again. Feynman sets `subagents.agentExcludeDirs` to `["~/.agents"]` so agent files there cannot replace the bundled agents.

The subagent runtime config at `~/.feynman/agent/extensions/subagent/config.json` defaults to background delegation on and missions and the fleet view off. Feynman fills in only missing values and leaves your changes alone.

## Thinking levels

`defaultThinkingLevel` sets how much the model reasons before responding: `off`, `minimal`, `low`, `medium` (default), `high`, `xhigh`, or `max`, subject to the active model's capabilities. Override it for one run:

```bash
feynman --thinking high
```

## Environment variables

Feynman reads these environment variables. `FEYNMAN_MODEL`, `FEYNMAN_THINKING`, and `FEYNMAN_SERVICE_TIER` override `settings.json` for that run. Feynman also loads a `.env` file from the current directory.

| Variable | Description |
| --- | --- |
| `FEYNMAN_MODEL` | Model to use instead of the default (same as `--model`) |
| `FEYNMAN_HOME` | Override the parent directory used to create `.feynman` (default parent: `~`) |
| `FEYNMAN_THINKING` | Thinking level (same as `--thinking`) |
| `FEYNMAN_SERVICE_TIER` | Request service tier (same as `--service-tier`) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `GEMINI_API_KEY` | Google Gemini API key |
| `DATALAB_API_KEY` | Optional Datalab key for layout-aware PDF-to-Markdown extraction |
| `AWS_PROFILE` | Preferred AWS profile for Amazon Bedrock |
| `EXA_API_KEY`, `PERPLEXITY_API_KEY`, `TAVILY_API_KEY`, ... | Web search provider keys read by pi-web-access |
| `OPENALEX_API_KEY` | Free OpenAlex key ([create one](https://openalex.org/settings/api)); without one, requests share a small anonymous daily budget |
| `SEMANTIC_SCHOLAR_API_KEY` | Optional free Semantic Scholar key ([request one](https://www.semanticscholar.org/product/api#api-key-form)) so searches use your own rate limit instead of the shared anonymous pool |
| `NCBI_API_KEY` | Optional NCBI E-utilities key; NCBI allows 10 requests per second with a key instead of 3 |
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
| `feynman_command_started`, `feynman_command_completed`, `feynman_command_failed` | Command and allow-listed subcommand, output mode, whether a prompt, model, service tier, or new-session flag was given, duration, exit code, error name and message hash |
| `feynman_session_started` | Why the session started (startup, resume, new, fork, reload), mode, model and provider name |
| `feynman_workflow_started` | Workflow name (`deepresearch`, `lit`, `review`, and so on; `chat` for anything else) |
| `feynman_workflow_completed` | Workflow name, status (`completed`, `error`, `aborted`), tool and subagent call counts, whether any file under `outputs/` or `papers/` was written (yes or no), duration |
| `feynman_tool_used` | Tool name, whether it failed, whether a subagent called it |
| `$ai_generation` | [PostHog LLM analytics](https://posthog.com/docs/llm-analytics/generations) metadata for each model response: model, provider, input, output, and cache token counts, latency, HTTP status, stop reason, error flag, and the Pi session ID as the trace ID. No `$ai_input` or `$ai_output_choices`. |

Every event also carries the Feynman version, Node.js version, platform, and CPU architecture.

Each send is tried once. The first network or ingest failure turns telemetry off for the rest of that process without printing anything; set `FEYNMAN_DEBUG=1` to see the single CLI diagnostic.

## Session storage

Sessions are saved as JSONL files in `~/.feynman/sessions/`. An interactive `feynman` launch continues the most recent session for the current directory. Session flags:

```bash
feynman --new-session                 # start a new session
feynman --resume                      # pick a previous session
feynman --session <path|id>           # open a specific session
feynman --fork <path|id>              # fork a session into a new one
feynman --no-session                  # in-memory session, not saved
feynman --export <session.jsonl> [out.html]   # export a session to HTML
feynman --session-dir <path>          # store sessions somewhere else
```

## Diagnostics

`feynman doctor` checks alphaXiv auth, the default model and authenticated providers, `models.json`, pandoc, web search config, and the Pi runtime, and prints next steps. `feynman status` prints a shorter summary.
