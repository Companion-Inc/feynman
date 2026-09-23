---
description: Plan a replication workflow for a paper, claim, or benchmark; execute only after an explicit environment choice.
args: <paper>
section: Research Workflows
topLevelCli: true
---
## Tool Discipline (Read First)

Tool names are literal. Use only tools visible in the current tool set.

- Search with `web_search`; do not call `search_web`, `google_search`, `google:search`, `search_google`, or `WebSearch`.
- Fetch URLs with `fetch_content`; do not call bare `fetch`, `WebFetch`, `read_url_content`, or pass an array as `url`. Use `urls` for multiple URLs when the tool supports it.
- Use visible Feynman alpha tools such as `alpha_search` when present. For shell access, call `feynman alpha ...`; do not call the user's bare global `alpha` binary.
- To ask the user a question, write plain chat text and wait for the next user message. Do not call `ask_user_question`, `ask_user`, `ask_followup_question`, or `user_choice`.
- Do not use `Task` as an agent dispatcher. Use only the visible `subagent` tool when it exists.
- If a tool returns `Tool not found` or `Invalid URL`, do not retry the same invalid call. Map to a canonical visible tool and valid arguments, or record the capability as blocked.

Design a replication plan for: $@

## Workflow

1. **Extract** — Use the `researcher` subagent to pull implementation details from the target paper and any linked code. If `CHANGELOG.md` exists, read the most recent relevant entries before planning or resuming.
2. **Recipe pass** — For ML training, fine-tuning, benchmark, or dataset-heavy targets, perform a recipe extraction before execution planning. Link each claimed result to the exact dataset, method, hyperparameters, compute assumptions, metric, and code path that produced it. Validate dataset availability/schema when possible and mark unchecked details as `unverified` instead of assuming they are usable.
3. **Plan** — Determine what code, datasets, metrics, and environment are needed. Be explicit about what is verified, what is inferred, what is still missing, and which checks or test oracles will be used to decide whether the replication succeeded.
4. **Environment** — Before running anything, ask the user where to execute:
   - **Local** — run in the current working directory
   - **Virtual environment** — create an isolated venv/conda env first
   - **Docker** — run experiment code inside an isolated Docker container
   - **Modal** — only if the user has the `modal` CLI installed and set up: write a Modal-decorated Python script and run it with `modal run <script.py>`. Best for burst GPU jobs that don't need persistent state.
   - **RunPod** — only if the user has the `runpodctl` CLI installed and `RUNPOD_API_KEY` set: provision a GPU pod, then SSH in to run and use `runpodctl` to transfer files and stop the pod. Best for long-running experiments or when you need SSH access and persistent storage.
   - **Plan only** — produce the replication plan without executing
5. **Execute** — If the user chose an execution environment, implement and run the replication steps there. Save notes, scripts, raw outputs, and results to disk in a reproducible layout. Do not call the outcome replicated unless the planned checks actually passed.
6. **Log** — For multi-step or resumable replication work, append concise entries to `CHANGELOG.md` after meaningful progress, failed attempts, major verification outcomes, and before stopping. Record the active objective, what changed, what was checked, and the next step.
7. **Report** — End with a `Sources` section containing paper, dataset, documentation, and repository URLs.

Do not install packages, run training, or execute experiments without confirming the execution environment first.
