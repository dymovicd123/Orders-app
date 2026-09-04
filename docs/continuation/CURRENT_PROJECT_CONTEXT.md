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

Current Production/main is **R5.9**:

`6985093f7ee377b7d52b8716184b26f4fd6a1ac6`

PR #12 (`R5.9: reduce Orders pagination D1 reads`) was squash-merged to main. The Cloudflare deploy monitor matched this exact main commit and completed successfully:

- GitHub Actions deploy monitor run: `33894745462`
- job: `101094641164`
- result: success
- Worker target: `orders-app`

R5.9 has **no D1 migration**. The final proof and release did not mutate Production D1. Branch2 was not changed and remains:

`adec6098777bebe4709615e1256cc5dd468b444d`

## R5.9 — Orders pagination / repeated summary

R5.9 addresses the cost of wide-period Orders pagination and repeated period-summary rescans without changing order/business semantics.

### Final implementation semantics

- sequential **Next** navigation may send an internal `afterOrderDate` + `afterOrderId` seek cursor;
- visible offset/page semantics remain unchanged;
- cursor affects only page row selection, never aggregate filters;
- order sequence remains `order_date DESC, id DESC`;
- `includePeriodStats` defaults to true, so legacy/direct API callers keep the previous full response contract;
- when the UI already owns the exact period summary from page 1, later page-only navigation sends `includePeriodStats=0`;
- Worker then refreshes exact `totalCount/hasMore` using count-only metadata and skips repeated order/payment/return/workshop totals;
- frontend preserves the previously loaded exact `periodStats` when the Worker intentionally omits them;
- Previous-page navigation does not use a seek cursor, but may still reuse periodStats;
- filter changes/full reloads still request the full summary;
- no financial arithmetic, archive/status/date/search semantics, relation loading, Warehouse/handover logic, Arrival UI, or shipping behavior was intentionally changed.

### Release files relative to R5.8

Exact R5.8 -> R5.9 diff contained only these six files:

- `worker/domains/orders-read.ts`
- `src/App.tsx`
- `scripts/test-d1-read-budget-r5-9.mjs`
- `scripts/d1-read-budget-r5-9-worker-manifest.json`
- `scripts/test-step1906a-worker-modularization.mjs`
- `package.json`

No temporary workflows or helper scripts were present in the release diff.

The clean pre-merge candidate tree was:

`ef610ab83055dc1326b0f8336da0957f9b72504d`

Exact `listOrders` declaration hash registered for R5.9:

`7ae4832900502fadfb3448e328a9caf1e8781802545b8dcca7dfa3f969f801ef`

### Full release validation

Final full validation run:

- run: `33894195668`
- job: `101092839993`
- result: success

Passed gates:

- `npm run release:check`
- `npm run verify:db-safety`
- `npm run typecheck`
- `npm run build`
- `npx wrangler deploy --dry-run`

Step 190.6A cumulative Worker declaration gate passed with the explicit R5.9 `listOrders` manifest. Step 190.6B also passed after the R5.9-only App additions were compacted back under the established 7,000-line controller budget; this was formatting/structure only, not a semantic change.

### Final exact Production read-only proof

Final proof used exact clean candidate `ef610ab...` plus one temporary SELECT-only workflow.

- proof run: `33894451727`
- job: `101093683359`
- result: success
- Production database: `orders_db_prod`
- period: active orders `2026-08-01..2026-08-31`
- all statements verified `rows_written=0` and `changed_db=false`

Exact baseline OFFSET page reads versus R5.9 seek candidate:

- page 2: **600 -> 313 rows_read** (−287 / **47.8%**)
- page 3: **893 -> 297** (−596 / **66.7%**)
- page 4: **1,192 -> 312** (−880 / **73.8%**)
- page 5: **1,288 -> 106** (−1,182 / **91.8%**)

For pages 2–5, the candidate returned the exact same `external_id` sequence as the baseline page.

Repeated August summary components were:

- order summary: 1,405 rows_read
- payment summary: 1,001
- return summary: 17
- full repeated summary total: **2,423 rows_read**
- count-only page metadata: **447 rows_read**
- exact order count on both paths: **432**
- repeated-summary reduction: **1,976 rows_read / 81.6%**

Final proof marker: `R59_FINAL_OK`.

The temporary proof and validation branches were reset back to the clean candidate after their successful runs so their one-shot workflow files are not left at branch tips.

## Prior R5.8 / R5.7 / R5.6 read-budget facts

R5.8 reduced the exact default Finance workspace for `2026-09-01..2026-09-04` from **901 -> 673 rows_read** (−228 / ~25.3%) by deriving payment-method and payment-by-day aggregates from already-loaded payment operation rows. No D1 migration.

R5.7 reduced the Orders Summary fallback and established `received_amount` reuse only where exact Production equivalence had been proved.

R5.6 Production improvements included:

- current debt: **1,321 -> 12 rows_read**
- pending stock writeoff: **5,208 -> 2**
- workshop grouped aggregate: **3,317 -> 1,736**
- payment-method summary selected its new index but remained **1,595 -> 1,595**, so do not overclaim that index.

## Current next action

R5.9 is released and closed. Do not change it retroactively without new evidence.

Next technical stage should begin with a fresh Production SELECT-only profile after R5.9, then choose R5.10 from measured remaining hotspots. Prior wide-window Finance candidates worth rechecking include:

- payment operations: ~4,686 rows_read over 35 days
- payment-by-day: ~1,712
- payment methods: ~1,595
- early-payment bridge: ~1,456
- payment events: ~1,114

Do not assume these remain the highest practical cost after R5.9; remeasure first and prioritize actual frequently used paths. Avoid materialized/cached summary write-path complexity unless simpler read/query improvements fail.

## Inherited safety / business invariants

- Arrival UI remains frozen.
- Critical save: order + items + reserves + Workshop tasks are critical; audit/history/re-read/extras must not turn committed success into failure.
- Workshop items are excluded from normal Warehouse shortage checks.
- Partial shipping is not used; operational model is all-or-nothing.
- Preserve payment-date vs order-date financial semantics.
- Keep D1 read fan-out bounded and mutations bounded.
- Small Production D1 SQL should use `wrangler d1 execute --command`, not file-import.
- Branch2 is out of scope unless explicitly requested.
