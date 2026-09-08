# Recommendation evaluation: qwen-mock

Date: 2026-09-08T09:17:40.506Z

Mock pipeline validation only; not evidence of Qwen ranking quality.

Cases: 12; rank-labelled: 11; real calls in this run: 0.

| Metric | Value |
| --- | ---: |
| Top1 Accuracy | 81.8% |
| Hit@3 | 100.0% |
| NDCG@3 | 0.9491 |
| Invalid Candidate Rate | 0.0% |
| Unsupported Reason Rate (limited checks) | 0.0% |

Hit@3 means a preferred Top1 appears in the returned Top3. Empty cases are excluded from ranking metrics and checked separately. Rates describe validated/fallback outputs; they do not prove raw model output is always valid.

| Case | Preferred Top1 | Actual Top1 | Mode |
| --- | --- | --- | --- |
| classic-black-500 | LM-KT-BTL-001-BLK-500 | LM-KT-BTL-001-BLK-500 | qwen |
| explicit-straw | LM-KT-BTL-002-BLK-500 | LM-KT-BTL-002-BLK-500 | qwen |
| large-capacity | LARGE-1000 | LARGE-1000 | qwen |
| small-commuter | COMMUTER-350 | COMMUTER-350 | qwen |
| light-color | LM-KT-BTL-004-WHT-500, WHITE-500 | LM-KT-BTL-004-WHT-500 | qwen |
| confirmed-package | PACK-CONFIRMED | PACK-CONFIRMED | qwen |
| glass-material | GLASS-500 | GLASS-500 | qwen |
| priority-conflict | STRAW-750 | STRAW-750 | qwen |
| no-perfect-match | LM-KT-BTL-001-BLK-500 | BLACK-350-STRAW | qwen |
| close-finish-preference | ZZZ-MATTE | AAA-GLOSS | qwen |
| no-eligible-products | none | none | rule |
| demo-profit-threshold | LM-KT-BTL-001-BLK-500 | LM-KT-BTL-001-BLK-500 | qwen |
