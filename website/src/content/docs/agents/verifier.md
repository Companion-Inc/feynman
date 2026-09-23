---
title: Verifier
description: The verifier agent cross-checks claims against their cited sources.
section: Agents
order: 4
---

The verifier agent is responsible for fact-checking and validation. It cross-references claims against their cited sources, checks code implementations against paper descriptions, and flags unsupported or misattributed assertions.

## What it does

The verifier performs targeted checks on specific claims rather than reading documents end-to-end like the reviewer. It takes a claim and its cited source, retrieves the source, and determines whether the source actually supports the claim as stated. This catches misattributions (citing a paper that says something different), overstatements (claiming a stronger result than the source reports), and fabrications (claims with no basis in the cited source).

When checking code against papers, the verifier examines specific implementation details: hyperparameters, architecture configurations, training procedures, and evaluation metrics. It compares the paper's description to the code's actual behavior, noting discrepancies with exact file paths and line numbers.

## Verification process

The verifier follows a systematic process for each claim it checks:

1. **Retrieve the source** -- Fetch the cited paper, article, or code file
2. **Locate the relevant section** -- Find where the source addresses the claim
3. **Compare** -- Check whether the source supports the claim as stated
4. **Classify** -- Mark the claim as verified, unsupported, overstated, or contradicted
5. **Document** -- Record the evidence with source locations and short quotes only when needed

Before checking content, the verifier confirms each cited paper is the paper it claims to be: it looks up the DOI or arXiv ID in two indexes (arXiv or Crossref, plus OpenAlex or Semantic Scholar) and flags any title, year, or author mismatch instead of keeping the citation silently.

This process is traceable. Completed verification notes identify the specific passage or code that was checked, making it easy to audit the verifier's work.

## Confidence and limitations

The verifier assigns a confidence level to each verification. Claims that directly quote a source are verified with high confidence. Claims that paraphrase or interpret results are verified with moderate confidence, since reasonable interpretations can differ. Claims about the implications or significance of results are verified with lower confidence, since these involve judgment.

The verifier is honest about its limitations. When a claim cannot be verified because the source is behind a paywall, the code is not available, or the claim requires domain expertise beyond what the verifier can assess, it says so explicitly rather than guessing.

## Used by

The verifier agent is used by `/deepresearch` (final fact-checking pass), `/audit` (comparing paper claims to code), `/replicate` (verifying that the replication plan captures all necessary details), and non-trivial `/recipe` runs (checking the top recipe's key sources, dataset availability, and code paths). It serves as the quality control step that runs after the researcher and writer have produced their output.
