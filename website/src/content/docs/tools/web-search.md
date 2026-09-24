---
title: Web Search
description: Web search and page retrieval in Feynman through pi-web-access.
section: Tools
order: 2
---

Feynman's web research tools come from the bundled [`pi-web-access`](https://github.com/nicobailon/pi-web-access) package. The lead agent, the researcher, and the verifier use them to find and read documentation, blog posts, news, repositories, and open-access papers alongside Feynman's paper databases.

## Tools

| Tool | Purpose |
| --- | --- |
| `web_search` | Search with one query or a `queries` batch. Supports `numResults`, `recencyFilter` (`day`, `week`, `month`, `year`), `domainFilter` (prefix a domain with `-` to exclude it), `provider`, and `includeContent` to fetch page text for the results |
| `fetch_content` | Fetch one or more URLs as readable Markdown. Handles web pages, PDFs, GitHub repos, issues, and pull requests, images, and videos. `mode: "raw"` returns the exact text body; `mode: "answer"` with a `prompt` answers a question from the page |
| `get_search_content` | Read stored results from an earlier search or fetch by `responseId`, paged with `offset` and `limit`, or search them with `findText` |
| `source_check` | Gather passages for a claim into an evidence artifact for manual review; it does not decide support on its own |

Fetched page bodies are stored for one hour in `~/.feynman/agent/web-search-cache/` so `get_search_content` can page through them without re-fetching.

## Default behavior

With no key and no configuration, `web_search` works through Exa's hosted MCP endpoint. In `auto` mode it tries a configured SearXNG endpoint first; when the active model uses `openai-codex`, it then tries Codex-backed OpenAI search; otherwise it tries Exa before OpenAI, then any other provider you have configured. Browser-cookie access for Gemini Web is off unless you opt in with `allowBrowserCookies`.

## Configuration

Check the current search configuration:

```bash
feynman search status
```

Set a provider, optionally saving its API key:

```bash
feynman search set exa <api-key>
feynman search set perplexity <api-key>
feynman search set gemini <api-key>
feynman search set auto
```

`feynman search set` supports `auto`, `exa`, `perplexity`, and `gemini`. It also sets the search `workflow` to `none` (raw results, no curator window) and turns browser-cookie access off. `feynman search clear` resets the provider to `auto` and keeps saved API keys.

For other providers (Brave, Tavily, Jina, Kagi, Parallel, SearXNG, DuckDuckGo, and more), multi-provider search with `provider: "all"`, fallback routes, proxies, and PDF extraction settings, edit `~/.feynman/agent/web-search.json` directly. The [pi-web-access README](https://github.com/nicobailon/pi-web-access#configuration) documents every field.

## Commands

| Command | Description |
| --- | --- |
| `/search` | Browse stored web search results from the current session |
| `/websearch [queries]` | Open the search curator and run searches yourself |
| `/curator [on\|off]` | Toggle the search curator workflow |
| `/google-account` | Show the Google account used for Gemini Web |

To turn one of these commands off, set `commands.<name>.enabled` to `false` in `web-search.json` (keys: `websearch`, `curator`, `search`, `google-account`).
