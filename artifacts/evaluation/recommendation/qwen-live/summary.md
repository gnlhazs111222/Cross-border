# Recommendation evaluation: qwen-live

Date: 2026-09-08T08:53:03.521Z

Small synthetic demo evaluation, not a statistical benchmark or sales forecast.

Cases: 2; rank-labelled: 2; real calls in this run: 2.

| Metric | Value |
| --- | ---: |
| Top1 Accuracy | 100.0% |
| Hit@3 | 100.0% |
| NDCG@3 | 0.9062 |
| Invalid Candidate Rate | 0.0% |
| Unsupported Reason Rate (limited checks) | 0.0% |

Paired rule baseline on the same cases: Top1 100.0%, Hit@3 100.0%, NDCG@3 1.0000.

Hit@3 means a preferred Top1 appears in the returned Top3. Empty cases are excluded from ranking metrics and checked separately. Rates describe validated/fallback outputs; they do not prove raw model output is always valid.

| Case | Preferred Top1 | Actual Top1 | Mode |
| --- | --- | --- | --- |
| classic-black-500 | LM-KT-BTL-001-BLK-500 | LM-KT-BTL-001-BLK-500 | qwen |
| explicit-straw | LM-KT-BTL-002-BLK-500 | LM-KT-BTL-002-BLK-500 | qwen |
