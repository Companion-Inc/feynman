---
description: Run a thorough, source-heavy investigation on a topic and produce a durable research brief with inline citations.
args: <topic>
section: Research Workflows
topLevelCli: true
---
Run deep research for: $@

## Required Artifacts

Derive a short slug from the topic: lowercase, hyphenated, no filler words, at most 5 words.

Every run must leave these files on disk:
- `outputs/.plans/<slug>.md`
- `outputs/.drafts/<slug>-draft.md`
- `outputs/.drafts/<slug>-cited.md`
- `outputs/<slug>.md` or `papers/<slug>.md`
- `outputs/<slug>.provenance.md` or `papers/<slug>.provenance.md`

Before the plan is approved, only the plan file may exist; do not create placeholder drafts, final outputs, or provenance files. After the user approves the plan, if any capability fails, continue in degraded mode and still write a blocked or partial final output and provenance sidecar. Never end with chat-only output after plan approval. Never end with only an explanation in chat after plan approval. Use `Verification: BLOCKED` when verification could not be completed.

## Step 1: Plan

Create `outputs/.plans/<slug>.md` immediately. The plan must include:
- Key questions
- Evidence needed
- Scale decision
- Task ledger
- Verification log
- Decision log

Make the scale decision before assigning owners in the plan. If the topic is a narrow "what is X" explainer, the plan must use lead-owned direct search tasks only; do not allocate researcher subagents in the task ledger.

After writing the plan, stop and ask for explicit confirmation before gathering evidence. Summarize the plan briefly and ask:

`Proceed with this deep research plan? Reply "yes" to continue, or tell me what to change.`

Do not run searches, fetch sources, spawn subagents, draft, cite, review, or deliver final artifacts until the user confirms. If the user requests changes, update `outputs/.plans/<slug>.md` first, then ask for confirmation again.

## Step 2: Scale

Use direct search for:
- Single fact or narrow question, including "what is X" explainers
- Work you can answer with 3-10 tool calls

For "what is X" explainer topics, you MUST NOT spawn researcher subagents unless the user explicitly asks for comprehensive coverage, current landscape, benchmarks, or production deployment.
Do not inflate a simple explainer into a multi-agent survey.

Use subagents only when decomposition clearly helps:
- Direct comparison of 2-3 items: 2 `researcher` subagents
- Broad survey or multi-faceted topic: 3-4 `researcher` subagents
- Complex multi-domain research: 4-6 `researcher` subagents

## Step 3: Gather Evidence

Prefer abstracts, HTML pages, official docs, and paper metadata. Read full text only for the few papers the conclusions depend on.

If direct search was chosen:
- Skip researcher spawning entirely.
- Search and fetch sources yourself.
- Use multiple search terms/angles before drafting. Minimum: 3 distinct queries for direct-mode research, covering definition/history, mechanism/formula, and current usage/comparison when relevant.
- Record the exact search terms used in `outputs/.drafts/<slug>-research-direct.md`.
- Write notes to `outputs/.drafts/<slug>-research-direct.md`.
- Continue to synthesis.

If subagents were chosen:
- Write a per-researcher brief first, such as `outputs/.plans/<slug>-T1.md`.
- Keep `subagent` tool-call JSON small and valid.
- Do not place multi-paragraph instructions inside the `subagent` JSON.
- Use only supported `subagent` keys. Do not add extra keys such as `artifacts` unless the tool schema explicitly exposes them.
- Use one async `workflowScript` with `await runs.all(...)` for parallel evidence gathering. Each item needs a unique stable `key`, plus its agent, short task, and output path. Set `globalConcurrencyLimit: 4` on the outer call.
- Read the ordered result array and record each child's `ok`, error, and returned output/artifact paths. Ordinary child failures are collected by `runs.all`; validation or infrastructure failure can still fail the workflow. Do not assume every output exists.
- Prefer broad guidance such as "use paper search and web search"; if a PDF parser or paper fetch fails, the researcher must continue from metadata, abstracts, and web sources and mark PDF parsing as blocked.

Example shape:

```json
{
  "workflowScript": "return await runs.all([{key:'web',agent:'researcher',task:'Read outputs/.plans/<slug>-T1.md and write <slug>-research-web.md.',output:'<slug>-research-web.md'},{key:'papers',agent:'researcher',task:'Read outputs/.plans/<slug>-T2.md and write <slug>-research-papers.md.',output:'<slug>-research-papers.md'}]);",
  "async": true,
  "globalConcurrencyLimit": 4
}
```

Continue independent work after launch, then consume completion results before synthesis. Use the returned output references to locate managed child files; verify them on disk and copy them to the planned research paths when necessary. After evidence gathering, update the plan ledger and verification log. If research failed, record exactly what failed and proceed with a blocked or partial draft.

## Step 4: Draft

Write the report yourself. Do not delegate synthesis.

Save to `outputs/.drafts/<slug>-draft.md`.

Include:
- Executive summary
- Findings organized by question/theme
- Evidence-backed caveats and disagreements
- Open questions
- No invented sources, results, figures, benchmarks, images, charts, or tables

Before citation, sweep the draft:
- Every critical claim, number, figure, table, or benchmark must map to a source URL, research note, raw artifact path, or command/script output.
- Remove or downgrade unsupported claims.
- Mark inferences as inferences.

## Step 5: Cite

If direct search/no researcher subagents was chosen:
- Do citation yourself.
- Verify reachable HTML/doc URLs with available fetch/search tools.
- Copy or rewrite `outputs/.drafts/<slug>-draft.md` to `outputs/.drafts/<slug>-cited.md` with inline citations and a Sources section.
- Do not spawn the `verifier` subagent for simple direct-search runs.

If researcher subagents were used, run the `verifier` agent after the draft exists. This step is mandatory and must complete before any reviewer runs. Do not run the `verifier` and `reviewer` in the same parallel `subagent` call.

Use this shape:

```json
{
  "agent": "verifier",
  "async": true,
  "task": "Add inline citations to outputs/.drafts/<slug>-draft.md using the research files as source material. Verify every URL. Write the complete cited brief to outputs/.drafts/<slug>-cited.md.",
  "output": "outputs/.drafts/<slug>-cited.md"
}
```

Wait for the verifier's completion result before review, not merely the async launch receipt. Verify on disk that `outputs/.drafts/<slug>-cited.md` exists. If managed output routing wrote elsewhere, use the returned output reference to find the cited file and move or copy it to `outputs/.drafts/<slug>-cited.md`.

## Step 6: Review

If direct search/no researcher subagents was chosen:
- Review the cited draft yourself.
- Write `outputs/.drafts/<slug>-verification.md` with FATAL / MAJOR / MINOR findings and the checks performed.
- Fix FATAL issues before delivery.
- Do not spawn the `reviewer` subagent for simple direct-search runs.

If researcher subagents were used, only after `outputs/.drafts/<slug>-cited.md` exists, run the `reviewer` agent against it.

Use this shape:

```json
{
  "agent": "reviewer",
  "async": true,
  "task": "Verify outputs/.drafts/<slug>-cited.md. Flag unsupported claims, logical gaps, single-source critical claims, and overstated confidence. This is a verification pass, not a peer review.",
  "output": "<slug>-verification.md"
}
```

Consume the review completion result and locate its returned output before proceeding. If the reviewer flags FATAL issues, fix them before delivery and run one more review pass. Note MAJOR issues in Open Questions. Accept MINOR issues.

When applying reviewer fixes, do not issue one giant `edit` tool call with many replacements. Use small localized edits only for 1-3 simple corrections. For section rewrites, table rewrites, or more than 3 substantive fixes, read the cited draft and write a corrected full file to `outputs/.drafts/<slug>-revised.md` instead.

The final candidate is `outputs/.drafts/<slug>-revised.md` if it exists; otherwise it is `outputs/.drafts/<slug>-cited.md`.

## Step 7: Deliver

Copy the final candidate to:
- `papers/<slug>.md` for paper-style drafts
- `outputs/<slug>.md` for everything else

Write provenance next to it as `<slug>.provenance.md`:

```markdown
# Provenance: [topic]

- **Date:** [date]
- **Rounds:** [number of research rounds]
- **Sources consulted:** [count and/or list]
- **Sources accepted:** [count and/or list]
- **Sources rejected:** [dead, unverifiable, or removed]
- **Verification:** [PASS / PASS WITH NOTES / BLOCKED]
- **Plan:** outputs/.plans/<slug>.md
- **Research files:** [files used]
```

Before responding, verify on disk that all required artifacts exist. If verification could not be completed, set `Verification: BLOCKED` or `PASS WITH NOTES` and list the missing checks.

Final response should be brief: link the final file, provenance file, and any blocked checks.
