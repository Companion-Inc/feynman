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

The one-line installer fetches the latest tagged release as a standalone bundle with its own Node.js runtime and verifies its SHA-256 before installing. To pin a version, pass it explicitly, for example `curl -fsSL https://feynman.is/install | bash -s -- 0.5.3`. Rerun the installer to upgrade; `feynman update` only updates optional Pi packages you installed.

**npm alternative** (uses your local Node.js `>=22.22.0`):

```bash
npm install -g @companion-ai/feynman
```

If you installed the interim `@advaitpaliwal/feynman` package, migrate once:

```bash
npm uninstall -g @advaitpaliwal/feynman
npm install -g @companion-ai/feynman
```

Then run `feynman setup` to sign in to a model provider. To use Feynman in an ACP editor such as Zed, run it through [pi-acp](https://github.com/svkozak/pi-acp): `"agent_servers": { "Feynman": { "command": "npx", "args": ["-y", "pi-acp"], "env": { "PI_ACP_PI_COMMAND": "feynman" } } }`. See the [installation guide](https://feynman.is/docs/getting-started/installation) for uninstalling and the [setup guide](https://feynman.is/docs/getting-started/setup) for local models (LM Studio, LiteLLM, Ollama, vLLM) and Amazon Bedrock.

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

That installs the skill library into `~/.codex/skills/feynman` for Codex. For other targets, pass a scope:

```bash
curl -fsSL https://feynman.is/install-skills | bash -s -- --codex     # ~/.codex/skills/feynman (default)
curl -fsSL https://feynman.is/install-skills | bash -s -- --repo      # .agents/skills/feynman in the current repo
curl -fsSL https://feynman.is/install-skills | bash -s -- --opencode  # .opencode/skills/feynman in the current repo
```

```powershell
& ([scriptblock]::Create((irm https://feynman.is/install-skills.ps1))) -Scope Codex     # or -Scope Repo, -Scope OpenCode
```

These installers download the bundled `skills/` and `prompts/` trees plus the repo guidance files referenced by those skills. They do not install the Feynman terminal, bundled Node runtime, auth storage, or Pi packages.

---

### What you type → what happens

```
$ feynman "what do we know about scaling laws"
→ Searches papers and the web, answers with cited sources

$ feynman deepresearch "mechanistic interpretability"
→ Plan-first investigation with parallel researchers, synthesis, and citation verification

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
| `/summarize <source>` | Summarize a paper, report, repo, or PDF without loading it raw into context |
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

- **[alphaXiv](https://www.alphaxiv.org/)** — paper search, Q&A, code reading, and annotations (via Feynman's `alpha` tools and `feynman alpha` command)
- **Literature databases** — read-only Semantic Scholar, OpenAlex, arXiv ID lookup, PubMed, Europe PMC full text, bioRxiv/medRxiv, and Crossref, with stable identifiers. Set the free `OPENALEX_API_KEY` ([create one](https://openalex.org/settings/api)) and optionally `SEMANTIC_SCHOLAR_API_KEY` ([request one](https://www.semanticscholar.org/product/api#api-key-form)) to use your own rate limits
- **[Hugging Face Hub](https://huggingface.co/docs/hub/api)** — dataset metadata, split/schema inspection, and small file reads from model, dataset, and Space repos
- **Web research** — search, page fetching, and PDF extraction through [pi-web-access](https://github.com/nicobailon/pi-web-access); Exa works without a key, and `feynman search set` configures Perplexity, Exa, or Gemini
- **Documents** — local PDF and office-document parsing through [pi-docparser](https://github.com/maxedapps/pi-docparser)
- **Compute** — Docker, plus Modal or RunPod when their CLIs are installed, for replication and experiment runs you explicitly approve

---

### How it works

Feynman runs on stock [Pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`). Its prompts, skills, agents, and research tools load as a Pi [package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md) alongside the bundled `pi-subagents`, `pi-web-access`, `pi-docparser`, and `pi-btw` packages. Paper search and analysis use [alphaXiv](https://www.alphaxiv.org/). Research claims link to papers, docs, or repos with direct URLs.

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

The bundled Pi packages are pinned and update with Feynman, not through `feynman update`. See the [package stack](https://feynman.is/docs/reference/package-stack) and [release notes](https://feynman.is/docs/reference/releases).

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
