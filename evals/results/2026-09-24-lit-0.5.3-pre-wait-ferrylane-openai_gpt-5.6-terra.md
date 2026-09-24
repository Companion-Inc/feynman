# 2026-09-24-lit-0.5.3-pre-wait-ferrylane-openai_gpt-5.6-terra

Trimmed 0.5.3 prompts, before the `bg_wait` rule was added to SYSTEM.md. Terra q04 ended its turn while the reviewer was still running, so no final provenance file was written. Opus 5.5 q04 and q07 ended with "The model refused to complete the request"; the published 0.5.2 gets the same refusal on `/lit CRISPR base editing`. q01 citation validity was re-scored after a transient lookup failure.

| id | done | cites | valid | title | recall | wall | tokens | cost |
|---|---|---|---|---|---|---|---|---|
| q01 | yes | 16 | 100% | 100% | 100% | 833s | 2853354 | $0 |
| q04 | no | 0 | - | - | 0% | 516s | 3968890 | $0 |
| q07 | yes | 4 | 100% | 100% | 100% | 677s | 3136939 | $0 |
| q10 | yes | 8 | 100% | 100% | 100% | 698s | 4114633 | $0 |
| **all** | 75% | 28 | 100% | 100% | 75% | 2724s | 14073816 | $0.00 |
