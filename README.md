<p align="center">
  <a href="https://feynman.is">
    <img src="assets/hero.png" alt="Feynman CLI" width="800" />
  </a>
</p>
<p align="center">The open source AI research agent.</p>
<p align="center">
  <a href="https://feynman.is/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-feynman.is-0d9668?style=flat-square" /></a>
  <a href="https://github.com/Companion-Inc/feynman/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/Companion-Inc/feynman?style=flat-square" /></a>
</p>

---

### Installation

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install | bash
```

**Windows (PowerShell):**

```powershell
irm https://feynman.is/install.ps1 | iex
```

The one-line installer fetches the latest tagged release. To pin a version, pass it explicitly, for example `curl -fsSL https://feynman.is/install | bash -s -- 0.2.35`.

The installer downloads a standalone native bundle with its own pinned Node.js runtime and verifies the release SHA-256 before replacing an existing installation.

To upgrade the standalone app later, rerun the installer. `feynman update` only refreshes optional Pi packages you installed; Pi and the core packages update with Feynman itself.

To uninstall the standalone app, remove the launcher and runtime bundle, then optionally remove `~/.feynman` if you also want to delete settings, sessions, and installed package state. If you also want to delete alphaXiv login state, remove `~/.ahub`. See the installation guide for platform-specific paths.

**npm alternative** (uses your local Node.js runtime):

```bash
npm install -g @companion-ai/feynman
```

To update an npm installation, run `npm install -g @companion-ai/feynman@latest`.

If you installed the interim `@advaitpaliwal/feynman` package (0.3.48), migrate once:

```bash
npm uninstall -g @advaitpaliwal/feynman
npm install -g @companion-ai/feynman
```

The command remains `feynman`; the native install commands above are unchanged. See the [installation guide](https://feynman.is/docs/getting-started/installation) for Node.js requirements and uninstall instructions.

Local models are supported through the setup flow. For LM Studio, run `feynman setup`, choose `LM Studio`, and keep the default `http://localhost:1234/v1` unless you changed the server port. For LiteLLM, choose `LiteLLM Proxy` and keep the default `http://localhost:4000/v1`. For Ollama or vLLM, choose `Custom provider (baseUrl + API key)`, use `openai-completions`, and point it at the local `/v1` endpoint.

To authenticate another hosted provider, run `feynman model login <provider>`. GitHub Copilot sign-in retries model discovery once when GitHub rate-limits the request. OpenRouter login opens an OAuth page and listens for a local callback; over SSH or in another headless environment, paste the browser's final redirect URL or authorization code into Feynman's prompt, or set `OPENROUTER_API_KEY` before launch to use API-key authentication without OAuth.

### Skills Only

If you want just the research skills without the full terminal app:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash
```

**Windows (PowerShell):**

```powershell
irm https://feynman.is/install-skills.ps1 | iex
```

That installs the skill library into `~/.codex/skills/feynman` for Codex. You can also name the Codex target explicitly:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --codex
```

**Windows (PowerShell):**

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Codex
```

For a repo-local Claude/agent install instead:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --repo
```

**Windows (PowerShell):**

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Repo
```

That installs into `.agents/skills/feynman` under the current repository.

For an OpenCode project-local install instead:

**macOS / Linux:**

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --opencode
```

**Windows (PowerShell):**

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope OpenCode
```

That installs into `.opencode/skills/feynman` under the current repository.

These installers download the bundled `skills/` and `prompts/` trees plus the repo guidance files referenced by those skills. They do not install the Feynman terminal, bundled Node runtime, auth storage, or Pi packages.

---

### What you type → what happens

```
$ feynman "what do we know about scaling laws"
→ Searches papers and web, produces a cited research brief

$ feynman -- "- summarize the strongest evidence first"
→ Preserves a research prompt that begins with a dash instead of parsing it as a CLI option

$ feynman --prompt="- summarize the strongest evidence first"
→ Runs a dash-leading research prompt once and exits

$ feynman deepresearch "mechanistic interpretability"
→ Multi-agent investigation with parallel researchers, synthesis, verification

$ feynman lit "RLHF alternatives"
→ Literature review with consensus, disagreements, open questions, and lab/PI corpus mode when the input names a research group

$ feynman audit 2401.12345
→ Compares paper claims against the public codebase

$ feynman replicate "chain-of-thought improves math"
→ Plans replication checks and runs them only after an explicit environment choice

$ feynman recipe "fine-tune a small model for math reasoning"
→ Finds ranked, implementable ML training recipes from papers, datasets, docs, and code
```

---

### Workflows

Ask naturally or use slash commands as shortcuts.

| Command | What it does |
| --- | --- |
| `/deepresearch <topic>` | Source-heavy multi-agent investigation |
| `/lit <topic-or-lab>` | Literature review from paper search and primary sources; lab/PI inputs map publication trajectories and originality-ranked papers |
| `/review <artifact>` | Research review with severity and revision plan |
| `/audit <item>` | Paper vs. codebase mismatch audit |
| `/replicate <paper>` | Plan replication checks; execute only after choosing an environment |
| `/recipe <task-or-paper>` | Ranked ML training recipes with dataset, method, code, and verification status |
| `/compare <topic>` | Source comparison matrix |
| `/draft <topic>` | Paper-style draft from research findings |
| `/autoresearch <idea>` | Bounded experiment loop with benchmark evidence |
| `/btw <question>` | Side conversation while the main research agent is busy, with optional handoff back into the main thread |
| `/outputs` | Browse all research artifacts |

---

### Agents

Four bundled research agents, invoked by workflow prompts when decomposition helps.

- **Researcher** — gather evidence across papers, web, repos, docs
- **Reviewer** — internal research critique with severity-graded feedback
- **Writer** — structured drafts from research notes
- **Verifier** — inline citations, source URL verification, dead link cleanup

---

### Skills & Tools

- **[AlphaXiv](https://www.alphaxiv.org/)** — paper search, Q&A, code reading, annotations (via Feynman's `alpha` tools and `feynman alpha` command)
- **Literature databases** — read-only Semantic Scholar (citation-sorted search that surfaces seminal papers), OpenAlex (keyword and semantic search, citation graphs, authors, venues, OA status), arXiv ID lookup, PubMed (metadata, PMID/PMCID/DOI conversion, related articles, citation matching, copyright checks, PMC full-text routing), Europe PMC open-access full-text sections, bioRxiv/medRxiv preprints, and Crossref DOI metadata, with stable identifiers and endpoint provenance. Set the free `OPENALEX_API_KEY` ([create one](https://openalex.org/settings/api)) and optionally `SEMANTIC_SCHOLAR_API_KEY` ([request one](https://www.semanticscholar.org/product/api#api-key-form)) so searches use your own rate limits
- **[Hugging Face Hub](https://huggingface.co/docs/hub/api)** — dataset metadata, split/schema inspection, and small file reads from model, dataset, and Space repos
- **Web research** — multi-provider search, explicit proxy routing, bounded GitHub issue/PR documents, raw or question-grounded page retrieval, direct images, external fetched-content caching, stored-page passage lookup, and auditable source text; tools, commands, images, PDFs, and browser cookies remain independently gated
- **Session search** — indexed recall across prior research sessions
- **Observability** — opt-out PostHog usage metadata for CLI commands, research workflows, tools, and model calls (see [Telemetry](#telemetry))
- **Research execution options** — Docker, plus Modal or RunPod when their CLIs are installed, for explicitly chosen replication, benchmark, or dataset-heavy experiment runs; not service deployment or generic cloud administration

---

### How it works

Built on [Pi](https://github.com/badlogic/pi-mono) for the agent runtime, [alphaXiv](https://www.alphaxiv.org/) for paper search and analysis, and CLI tools for compute and execution. Runtime resources follow Pi's documented package model for [packages](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/packages.md), [extensions](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md), and [skills](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md). Hugging Face inspection uses the public [Hub API endpoints](https://huggingface.co/docs/hub/api) and `HF_TOKEN` / `HUGGINGFACE_HUB_TOKEN` environment variables documented by [`huggingface_hub`](https://huggingface.co/docs/huggingface_hub/main/en/package_reference/environment_variables). The ML recipe workflow was informed by the open-source [Hugging Face `ml-intern`](https://github.com/huggingface/ml-intern) research-agent repo, but is implemented as native Feynman prompts, skills, and read-only tools. Research outputs are source-grounded — research claims link to papers, docs, or repos with direct URLs.

---

### Telemetry

Feynman sends anonymous usage telemetry to PostHog by default and prints a one-time notice on first run. It sends commands, workflow names and outcomes, tool names, model and provider names, token counts, latency, and error flags under a random install ID. It never sends prompts, model output, paper content, file paths, or tool arguments. Set `FEYNMAN_TELEMETRY=off` (or `DO_NOT_TRACK=1`) to disable it; `feynman status` shows the current setting. The full event list is in the [configuration docs](https://feynman.is/docs/getting-started/configuration#telemetry).

---

### Star History

<a href="https://www.star-history.com/?repos=Companion-Inc%2Ffeynman&type=date&legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Companion-Inc/feynman&type=date&theme=dark&legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Companion-Inc/feynman&type=date&legend=top-left" />
    <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Companion-Inc/feynman&type=date&legend=top-left" />
  </picture>
</a>

---

The bundled research runtime is updated as a coordinated set, including Pi, Alpha Hub's `alpha-mcp`, document parsing, web research, and subagents. See the [package stack](https://feynman.is/docs/reference/package-stack) and [release notes](https://feynman.is/docs/reference/releases) for versions and upgrade details.

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contributor guide.

```bash
git clone https://github.com/Companion-Inc/feynman.git
cd feynman
nvm use || nvm install
npm install
npm test
npm run typecheck
npm run build
```

[Docs](https://feynman.is/docs) · [Release Notes](RELEASES.md) · [MIT License](LICENSE)
