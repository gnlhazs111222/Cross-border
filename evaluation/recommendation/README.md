# Recommendation demo evaluation

This directory contains 12 frozen synthetic cases in `cases.json`. The tasks, candidates, preferred Top1 sets, acceptable alternatives, graded relevance labels and notes were specified before real Qwen runs. Labels are independent of the ranking implementation; they are not external expert annotations or evidence about real sales outcomes.

Cases cover the classic black 500ml no-straw brief, explicit straw preference, large capacity, compact capacity, light colors, confirmed package contents, glass material, conflicting priorities, no perfect match, close finish alternatives, no eligible products and a simulated profit threshold. Expected labels are checked against hard eligibility before evaluation.

## Commands

```bash
npm run eval:recommendation
npm run eval:recommendation -- --provider rule
npm run eval:recommendation -- --provider qwen-mock
```

These commands make zero real model calls. `qwen-mock` feeds deterministic rule examples through the Qwen provider/schema/authorization pipeline. Its ranking metrics are not evidence of real Qwen quality.

Explicit live subset, only after local checks pass:

```bash
RECOMMENDATION_PROVIDER=qwen AI_LIVE_ENABLED=true NODE_TLS_REJECT_UNAUTHORIZED=1 npm run eval:recommendation -- --provider qwen-live --limit 2
```

Use `--case classic-black-500,explicit-straw` to select cases, `--limit` to limit the subset and `--output` to choose the output directory. A live invocation is limited to four cases; this A-line development verification enforces an eight-call cumulative recommendation budget in its own SQLite copy. It reuses already-recorded successful live cases instead of automatically repeating them. Running all cases live is a separate future decision, not part of the default command.

Live evaluation creates a dedicated local evaluation account and synthetic catalog through server-owned fixture setup, then calls the normal authenticated task/recommendation API. The model never sees expected labels. Optional enhanced fixture facts are established using the existing Mock Analyze and manual confirmation APIs; no vision model is involved. Neither the default Demo user's catalog nor the main worktree database is overwritten.

## Metrics

- **Top1 Accuracy:** predicted first SKU is in the manually specified preferred Top1 set.
- **Hit@3:** at least one preferred Top1 SKU appears in the returned first three.
- **NDCG@3:** graded relevance gain `(2^grade - 1) / log2(rank + 1)`, normalized by the ideal graded top three.
- **Invalid Candidate Rate:** unknown/hard-excluded or repeated returned SKUs divided by returned SKUs.
- **Unsupported Reason Rate:** a limited independent audit of direct color/capacity/straw claims and selected prohibited claims in `matchedReasons`; it is not a general NLP fact checker.

The no-candidate case is checked separately and excluded from ranking-metric denominators. Metrics describe the validated or fallback outputs delivered by the pipeline. A zero invalid rate does not prove the raw model never attempted an invalid output. Live reports retain fallback mode/reason and token usage and include a paired rule baseline on the exact same case subset.

Reports are written under `artifacts/evaluation/recommendation/{rule,qwen-mock,qwen-live}/summary.{json,md}`. Per-case records retain expected labels, actual ranked candidates, scores, explanations, exclusions, mode, latency and usage when available. No API key or complete sensitive prompt is written.

The default 12-case rule result is Top1 9/11 (81.8%), Hit@3 11/11 (100%), NDCG@3 0.9491, invalid candidates 0 and limited unsupported-reason checks 0. One empty case is correctly empty. The two rule errors are explicit priority handling with no perfect match and a preference for a confirmed matte finish. The rule baseline is deliberately documented as limited, not tuned to make all hand-authored labels pass.

This is a small synthetic demo evaluation. The limited live subset checks connectivity and behavior, not statistical significance or general recommendation superiority.
