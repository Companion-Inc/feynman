---
title: Research Review
description: Run an internal research critique with severity-graded feedback.
section: Workflows
order: 4
---

The review workflow runs an internal research critique of a paper, draft, or other research artifact. It is not an external peer review or a publication decision; it finds methodology, evidence, clarity, and reproducibility issues before you trust or revise the work.

## Usage

From the REPL:

```
/review arxiv:2401.12345
```

```
/review ~/papers/my-draft.pdf
```

From the CLI:

```bash
feynman review arxiv:2401.12345
feynman review my-draft.md
```

Pass an arXiv ID, a URL, or a local file path.

## How it works

Feynman writes a plan to `outputs/.plans/<slug>-review-plan.md` with the artifact, the review criteria (novelty, empirical rigor, baselines, reproducibility, claims validity, figures and tables, metrics, related work, writing quality), and the checks needed. It then continues without waiting for confirmation unless you asked to review the plan first.

Feynman reads local files directly, parses PDFs with the available document tools, and fetches arXiv IDs and URLs. It inspects linked code, datasets, supplements, or citations when they are reachable and matter to the review. Evidence notes go to `outputs/.drafts/<slug>-review-evidence.md` before the final review is written.

For large artifacts, Feynman can delegate to the `researcher` and `reviewer` agents; smaller artifacts are reviewed directly.

If a PDF cannot be parsed or a source is unavailable, Feynman still writes the review, marks the affected sections `Verification: BLOCKED`, and keeps blocked checks separate from actual weaknesses in the work.

## Output

One review at `outputs/<slug>-review.md` with:

- **Summary Assessment**
- **Strengths**
- **Critical Issues**
- **Major Issues**
- **Minor Issues**
- **Reproducibility and Verification**
- **Inline Annotations** -- tied to sections, claims, figures, or tables where possible
- **Recommendation**
- **Sources**

## Customization

Focus the review in your prompt, for example "focus on the statistical methodology" or "check the claims in Section 4 against the experimental results."
