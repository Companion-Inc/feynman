# Research-quality evals

A small fixed eval for Feynman's research workflows. It runs `/lit` (or `/deepresearch`) on each question in `questions.jsonl`, then scores the artifacts with deterministic checks against arXiv, Crossref and doi.org. No LLM judge.

This directory is not in the npm package (`package.json` `files` does not list it).

## Rule

Run the eval before and after any change to prompts (`prompts/`, `.feynman/agents/`, `.feynman/SYSTEM.md`, `skills/`), tools, extensions, or the Pi version. Use the same model and question ids for both runs, and commit both result files with the change.

## Run

Build first (`npm ci && npm run build`). Each question gets a fresh temp workspace and its own `FEYNMAN_HOME`, so your real `~/.feynman` is never read or written. The model's provider comes from a `models.json` that is copied into each isolated home. Example for an OpenAI-compatible gateway (the key is read from the environment and never written to disk):

```json
{
  "providers": {
    "ferrylane-openai": {
      "baseUrl": "https://gateway.ferrylane.ai/v1",
      "api": "openai-responses",
      "apiKey": "$FERRYLANE_API_KEY",
      "models": [
        { "id": "gpt-5.6-terra", "reasoning": true, "input": ["text"], "contextWindow": 400000, "maxTokens": 64000 }
      ]
    }
  }
}
```

```sh
export FERRYLANE_API_KEY="$(cat ~/.ferrylane/api-key)"
node evals/run.mjs --model ferrylane-openai/gpt-5.6-terra --models-json /path/to/models.json \
  [--ids q01,q04] [--workflow lit|deepresearch] [--concurrency 2] [--timeout-min 45]
```

Built-in providers work the same way; pass their API key env var (for example `OPENAI_API_KEY`) and omit `--models-json`.

`--workflow deepresearch` sends one approval turn (`--continue`) after the plan gate. `--rescore evals/results/<file>.jsonl` re-scores the kept workdirs without rerunning Feynman, which is useful after a scorer change.

Output goes to `evals/results/<date>-<workflow>-<model>.jsonl` (one row per question: git SHA, dirty flag, Feynman version, scores, citation failures, usage, and the temp `workdir` holding the full workspace, session JSONL and `feynman.log`) and a `.md` summary table.

## Scores

| Column | Meaning |
|---|---|
| `done` | A final `outputs/<slug>.md` exists with its `outputs/<slug>.provenance.md` sidecar. |
| `cites` | Distinct arXiv IDs and DOIs in the final output. |
| `valid` | Share of those identifiers that resolve (arXiv API `id_list`; Crossref, falling back to the doi.org handle API for non-Crossref DOIs). Lookups that fail on the network are left out. Unresolvable IDs are listed in `unresolved`. |
| `title` | Among resolved IDs with a known title, the share whose resolved title is at least 60% present (by word tokens) on a line of the output that carries the ID. Low values flag IDs attached to the wrong paper; see `title_mismatch`. Bare links with no title also count as misses, so check the listed rows before calling something a hallucination. |
| `recall` | Share of the question's expected key papers that appear in the output, by any listed identifier or by exact normalized title. |
| `wall`, `tokens`, `cost` | Wall time for the whole run, and token and cost totals summed over every Pi session file in the isolated home and temp dir (parent and subagent sessions, deduplicated). Cost is 0 when the provider's `models.json` entry has no `cost` block. |

Treat a single run as noisy. Compare before and after on the same ids, and look at the listed failures rather than only the percentages.

## Questions

`questions.jsonl` has 12 questions, each with expected key papers and a `source`:

- `q01`–`q06`: the six queries from Feynman's paper-discovery search benchmark (test-time compute, speculative decoding, sparse autoencoders, CRISPR base editing, mixture of experts, RAG).
- `q07`–`q09`: verbatim questions from LitQA2 ([futurehouse/lab-bench](https://huggingface.co/datasets/futurehouse/lab-bench), CC-BY-SA-4.0). The key paper is the item's `sources` DOI. These three items are redistributed under CC-BY-SA-4.0 with that attribution.
- `q10`–`q12`: hand-authored topics outside ML and biology (econometrics, weather forecasting, cosmology) whose key papers are unambiguous.

Keep the set fixed. Adding or editing a question breaks comparison with earlier result files; if you must, bump the question id instead of reusing one.

Next lanes, not built yet: ScholarQA-CS2 (AstaBench) citation precision and recall for `/lit`, DeepResearch Bench FACT for `/deepresearch`, and SciCoQA's 92 real paper–code discrepancies for `/audit` recall.
