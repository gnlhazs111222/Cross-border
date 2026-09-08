# Qwen Review Implementation Plan

> Execute the approved B plan task by task; use tests before implementation and independent review before completion.

**Goal:** Deliver an independent semantic reviewer, honest evaluation assets, and a version-bound web review flow.

**Architecture:** Keep offline/template rules unchanged. Explicit Qwen review uses authoritative server facts, bounded structured output and local hard checks. Persist a review attempt before network I/O; revalidate facts, task and listing before finalizing. Read/publish paths never call Qwen.

**Tech Stack:** TypeScript, Zod, Fastify, Prisma SQLite, React, node:test, Playwright.

**Spec:** `docs/B_REVIEW_SCOPE.md`; approved order: dataset → provider → paired evaluation → UI integration.

## Constraints

- Node >=22.12; no new dependencies, no keys in output, no automatically enabled live review.
- Dataset labels authored by AI must be disclosed as provisional, not human annotations.
- Preserve A recommendation, Listing generation, offline demo and server authorization behavior.
- No model result may overrule a local hard block; R002 remains only in legacy rules mode.

## Tasks

- [x] Dataset and metrics: `evaluation/review/` and literal confusion-matrix tests. Prepare 48 provisional cases, independent labels and dev/holdout split; runner never forwards labels, reports failures/abstentions separately. Test `summarize` on explicit TP/FP/FN/TN cases then run rule baseline.
- [x] Provider: `shared/review.ts`, `server/providers/qwenReview.ts`, `server/prompts/review-v1.ts`, `server/tests/semantic-review.test.ts`. Test legal paraphrase, hard blocking before network, valid quote/reference checks, failure sanitization and unconfirmed/internal input exclusion. Run `node --import tsx --test server/tests/semantic-review.test.ts` red then green.
- [x] Persistence/service: extend ReviewResult metadata through additive migration; add service integration tests for passed paraphrase, failures invalidating prior approval, no network on GET/publish, duplicate attempts and mid-call fact/task/listing changes. Use existing endpoint/version body; add REVIEW_PROVIDER=rules|qwen default rules. Execute tests against temporary SQLite, never the user's database.
- [x] UI: add explicit mode/status/problem location/metadata display, manual-review and failure states, keep fix/re-review workflow. Add browser tests with declared fixtures; no live calls.
- [x] Validate: typecheck, server suite, build, offline build, meaningful browser coverage, rule baseline and limited explicit live smoke (max 4 calls initially) with sanitized report. Do not tune prompt against holdout outcomes.
- [x] Independent code review, resolve findings, record exact validation and limits in `docs/B_REVIEW_IMPLEMENTATION.md` and update scope status. Leave changes on B branch without commit/push.

## Verification commands (PowerShell)

```powershell
$env:PATH = "$env:TEMP\prismlaunch-runtime\node-v22.14.0-win-x64;$env:PATH"
$env:NODE_ENV = 'test'
$env:AI_LIVE_ENABLED = 'false'
$env:BAILIAN_API_KEY = ''
node --import tsx --test server/tests/*.test.ts
npm.cmd run typecheck
npm.cmd run build
```

Live evaluation is a separate command using backend configuration, never part of automated tests. Success on provisional synthetic cases is not a claim of real-world compliance or independently human-validated quality.
