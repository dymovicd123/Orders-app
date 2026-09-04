# Orders-app — current project continuation context

Updated: 2026-09-04
Branch for continuation context only: `context/project-continuation`

This file is the canonical continuation point for ChatGPT work on the project. It is intentionally kept off `main` so context-only updates do not trigger a Production Worker deploy.

## User workflow requirements

- Keep continuation context updated here in GitHub; do not send standalone context files to the user unless explicitly requested.
- When local execution is genuinely needed, provide one ready-to-run Windows CMD entry point from the project root.
- Before Warehouse patches, audit related flows end-to-end rather than fixing one isolated screen.
- Arrival UI is frozen and must not be changed.
- Prefer measured, narrow, reversible changes, especially for D1 read-budget work.
- For small D1 release/repair SQL, prefer bounded `wrangler d1 execute --command` statements rather than `--file`; this project previously hit `D1_RESET_DO` through the import endpoint.
- Branch2 must remain untouched unless it is explicitly targeted.

## Current Production release

Current Production/main remains **R5.8**:

`6256d003f2c3c15cb1b8e675f0c225a6732cdc68`

R5.8 reduced the exact default Finance workspace for `2026-09-01..2026-09-04` from **901 -> 673 rows_read** (−228 / ~25.3%) by deriving payment-method and payment-by-day aggregates from already-loaded payment operation rows. No D1 migration.

Branch2 remains:

`adec6098777bebe4709615e1256cc5dd468b444d`

## R5.9 — Orders pagination / repeated summary candidate

The user asked to continue after the August Orders forensic. Production data was measured SELECT-only; no Production mutation occurred.

### August baseline

For active orders dated `2026-08-01..2026-08-31`:

- matching orders: **432**
- page 1 list query: 299 rows_read
- page 2: 600
- page 3: 893
- page 4: 1,192
- page 5 (32 rows): 1,288
- page 1 relation reads: 3,652, including handover lineage 1,633
- page 2 relation reads: 2,074
- repeated August summary fallback: order_stats 1,405 + payment_stats 1,001 + return_stats 17 = **2,423 rows_read**
- approximate page-1 full request: 6,374 rows_read
- approximate page-2 full request: 5,097 rows_read

The expensive OFFSET behavior and repeated summary rescans are real. Handover is also heavy on page 1, but candidate rewrites tested for the full-stocktake lineage lookup were worse, so handover is deliberately not changed in R5.9.

### Candidate proof

Production SELECT-only candidate proof run `33891932455` showed exact same order-id sequences for sequential keyset pagination:

- page 2: **600 -> 313** rows_read
- page 3: **893 -> 297**
- page 4: **1,192 -> 312**
- page 5: **1,288 -> 106**

A deferred-join OFFSET rewrite was rejected because it was worse on early pages.

For page-only navigation, the exact period summary already loaded on page 1 can be reused. A count-only query returned the same `order_count=432` at **447 rows_read** versus the 2,423-row full fallback, a reduction of **1,976 / 81.6%** for the repeated summary step.

### R5.9 implementation branch

Candidate branch:

`safe/d1-read-budget-r5-9-orders-pagination-20260904`

Current clean candidate head after removing temporary implementation/gate workflows/helpers:

`793a80a06d5348114a140086964f3f1bbc1e3bb2`

Meaningful source changes relative R5.8:

- `worker/domains/orders-read.ts`
- `src/App.tsx`
- `scripts/test-d1-read-budget-r5-9.mjs`
- `scripts/d1-read-budget-r5-9-worker-manifest.json`
- `scripts/test-step1906a-worker-modularization.mjs`
- `package.json`

No migration.

Implementation semantics:

- legacy/direct API callers keep previous full behavior by default;
- optional internal `afterOrderDate` + `afterOrderId` cursor accelerates sequential Next-page reads while logical offset/page metadata stays unchanged;
- cursor affects only page selection, never aggregate filters;
- `includePeriodStats` defaults to true;
- on page-only UI navigation, when exact periodStats already exist, UI requests `includePeriodStats=0`; Worker performs exact count-only metadata and skips repeated totals/payment/return/workshop summary scans; frontend preserves the already-loaded exact periodStats;
- Previous navigation does not use a seek cursor, but can still reuse periodStats;
- filter/full reloads still request the full summary;
- no business arithmetic, order ordering (`order_date DESC, id DESC`), archive/status/date/search semantics, relations, handover logic, or UI pagination model is intentionally changed.

Focused candidate validation run `33892594355` passed:

- R5.9 focused static test
- typecheck
- build
- database safety

The first full release validation run `33892775303` stopped at the Step 190.6A declaration gate because `listOrders` had a new intentional body hash. This was an expected manifest-registration failure, not a runtime/business failure.

Exact Step190.6A-compatible declaration hash was then computed by run `33893089449`:

- prior accepted `listOrders`: `5ad5281e3f39c12cb03dcb6275d4003353c5b634568938194bfaf276315b9547`
- R5.9 candidate `listOrders`: `7ae4832900502fadfb3448e328a9caf1e8781802545b8dcca7dfa3f969f801ef`

`scripts/d1-read-budget-r5-9-worker-manifest.json` registers this exact transition, and the cumulative Step190.6A gate was extended through R5.9. The focused Step190.6A test passed after registration.

### Current next action

Rerun the complete release validation from clean candidate head `793a80a...`. If all gates pass, perform a final SELECT-only Production proof of the exact released SQL shapes and expected request reduction. Only then open/merge R5.9 to main and verify Cloudflare deploy. Do not change handover in this release.

## Inherited safety / business invariants

- Arrival UI remains frozen.
- Critical save: order + items + reserves + Workshop tasks are critical; audit/history/re-read/extras must not turn committed success into failure.
- Workshop items are excluded from normal Warehouse shortage checks.
- Partial shipping is not used; operational model is all-or-nothing.
- Preserve payment-date vs order-date financial semantics.
- Keep D1 read fan-out bounded and mutations bounded.
- Small Production D1 SQL should use `wrangler d1 execute --command`, not file-import.
- Branch2 is out of scope unless explicitly requested.
