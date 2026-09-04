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

### main / Production Worker

Current Production release is **R5.8**:

`6256d003f2c3c15cb1b8e675f0c225a6732cdc68`

PR #11 (`R5.8: reduce Finance duplicate D1 reads`) was squash-merged into `main`.

GitHub -> Cloudflare deploy monitor run `33887966913` completed successfully for this exact main commit.

R5.8 has **no D1 migration**. It changes only the Finance read path plus its exact Worker modularization allow-list/regression coverage.

### Branch2

Branch2 remains unchanged at:

`adec6098777bebe4709615e1256cc5dd468b444d`

## R5.8 — Finance duplicate-read removal

### Problem measured before the patch

For the default Finance workspace (`scope=finance`) and period `2026-09-01..2026-09-04`, Production executed 12 D1 SQL paths totaling **901 rows_read**:

- overview: 32
- payment methods: 110
- order days: 32
- returns: 2
- exchanges: 13
- closed debts: 48
- current debt: 12
- current debt top: 48
- payment by day: 118
- payment operations: 316
- before-order/outside-period bridge: 97
- financial events: 73

The Finance response already loaded every payment operation with payment date, raw method and amount, yet separately queried:

1. payment-method totals/counts — 110 rows_read;
2. payment-method-by-day totals — 118 rows_read.

Those two aggregates were therefore duplicate reads of information already present in `paymentOperationRows`.

### Exact semantic proof before release

Production read-only proof established:

- 35 payments in the selected period;
- payment total: 1,559,941;
- 5 canonical payment methods;
- 13 date × method buckets.

Deriving `paymentMethods` and `paymentMethodsByDay` from the already-loaded payment rows produced the same values as the existing SQL aggregates.

A first strict JSON-shape proof caught a subtle compatibility issue: values were equal but object insertion/order inside day-method buckets could differ because old SQL ordered raw methods before canonical merging. The candidate was corrected to preserve the old SQL ordering semantics exactly: date ASC, aggregate total DESC, raw payment method ASC with SQLite NULL-first behavior, then canonical merge.

Final Production SELECT-only shape proof run `33887225887` reported:

- `methods_exact=true`
- `days_exact=true`
- `R58_FINANCE_EXACT_SHAPE_OK`

This ordering fix is important; do not simplify it back to merely iterating raw payment rows unless an equivalent exact-order proof is repeated.

### Released implementation

In `worker/domains/finance-reports.ts`:

- standalone payment-method aggregate is skipped only when `financeWorkspaceOnly` is true;
- standalone payment-by-day aggregate is skipped only when `financeWorkspaceOnly` is true;
- Finance derives both structures from `rawPaymentOperationRows`;
- non-Finance/admin report behavior retains the previous SQL aggregate paths;
- payment operations themselves still use the same rows and financial lineage logic;
- no financial arithmetic, debt, return, exchange or event semantics changed.

Regression coverage:

- `scripts/test-d1-read-budget-r5-8.mjs`
- `scripts/d1-read-budget-r5-8-worker-manifest.json`
- Step 190.6A cumulative Worker hash gate was extended through R5.8.

R5.8 `listFinanceReports` exact Worker declaration hash transition:

- before: `65b778f6f3e0c482b974f98671afcef0a65151745b5273abe4332d735006c976`
- after: `8930c9659c15a61e333394404fa6db196bbe1e5cb427af4bede2c21034e7e9ab`

### Full release validation

After registering the R5.8 Worker declaration delta, full candidate validation run `33887801540` passed:

- `release:check`
- `verify:db-safety`
- typecheck
- build
- Wrangler deploy dry-run

The earlier failed validation was only the Step 190.6A manifest gate correctly noticing the new `listFinanceReports` declaration before the R5.8 hash delta had been registered; it was not a runtime/business failure.

### Exact Production postdeploy measurement

After successful Cloudflare deploy, SELECT-only Production verification run `33888269466` measured the ten D1 calls that remain in `scope=finance` for `2026-09-01..2026-09-04`:

- overview: 32
- order days: 32
- returns: 2
- exchanges: 13
- closed debts: 48
- current debt: 12
- current debt top: 48
- payment operations: 316
- before-order/outside-period bridge: 97
- financial events: 73

Total: **673 rows_read**.

So the measured default Finance path moved exactly:

**901 -> 673 rows_read**

Reduction: **228 rows_read / about 25.3%**.

The two removed duplicate SQL paths were exactly the previous 110 + 118 rows_read. No D1 mutation occurred during this verification.

Important financial invariant confirmed while investigating R5.8: for `2026-09-01..2026-09-04`, `SUM(orders.received_amount)` for orders dated in the period was 1,494,941 while actual payments dated in the period totaled 1,559,941 — a 65,000 difference. Therefore payment-date reports must continue to be based on payment rows; do not replace them with order-level `received_amount` aggregates.

Temporary R5.8 diagnostic/validation branches were force-reset to the clean Production main commit after use so one-shot workflows are not left at their tips.

## R5.7 — Orders Summary fallback optimization

Previous Production release R5.7 was:

`0ad57910d95a8b3fa8411faf01008b5b62990014`

R5.7 reduced the measured active Orders Summary fallback SQL total from:

**9,542 -> 3,802 rows_read**

with exact summary values preserved and no D1 migration.

Before R5.7 the fallback components were:

- active `orders_stats`: 5,212
- active `payment_stats`: 4,267
- active `return_stats`: 63

Important runtime nuance remains: the fallback aggregates are not paid on every order-list request. `listOrders` uses `completeOrderResult = offset === 0 && orders.length < limit`; when the first page proves the filtered result is complete, it derives summary values from already-loaded page/relation data instead of running fallback summary scans.

### September Orders-page measurement limitation

A post-R5.7 investigation initially profiled the default `2026-09-01..2026-09-04` Orders page. It contained only **32 active orders**, below the default 100-row page limit, so it did **not** exercise realistic pagination/fallback behavior.

For those 32 orders, the reproduced read path was roughly 1,360 rows_read and a tested micro-rewrite on the handover/stock-check query saved only 5 rows (`566 -> 561`), which is not worth a release.

The user explicitly pointed out that the Orders page should instead be profiled with **August orders** so pagination/fallback and a larger relation set are actually exercised. This is now the next planned investigation after Finance R5.8.

## R5.6 — Production D1 indexes still in force

R5.6 commit:

`fd0f509912a2939c8e9f0b84a7093b82a1d47c60`

Migration `0066_v72_d1_read_budget_r5_finance_summary_indexes.sql` added:

- `idx_payments_payment_date_order_amount`
- `idx_orders_current_debt_partial`
- `idx_order_items_pending_writeoff_status_order`
- `idx_order_items_workshop_order_quantity`

Representative Production before -> after R5.6 measurements for `2026-08-01..2026-09-04`:

- payment-method summary: `1595 -> 1595` (index selected but no measured rows_read reduction; never overclaim this)
- current debt: `1321 -> 12`
- pending stock writeoff: `5208 -> 2`
- Workshop grouped aggregate: `3317 -> 1736`

R5.8 did not change these indexes.

## Wide-period Finance reference baseline

Before R5.8, exact `scope=finance` measurement for `2026-08-01..2026-09-04` totaled **12,521 rows_read**:

- overview 478
- payment methods 1,595
- order days 478
- returns 42
- exchanges 67
- closed debt 833
- current debt 12
- current debt top 48
- payment by day 1,712
- payment operations 4,686
- early-payment bridge 1,456
- financial events 1,114

Because R5.8 removes the two duplicate aggregate queries only in Finance scope, the comparable theoretical total on an unchanged snapshot would be 12,521 - 1,595 - 1,712 = **9,214 rows_read**. Do not call that an exact postdeploy 35-day measurement unless it is measured again; only the current-period 901 -> 673 result was remeasured postdeploy.

Remaining wide-range Finance cost is dominated by payment operation history / traceability, especially payment operations, early-payment bridge and financial events. Further Finance work should be measured before changing anything.

## Inherited business / reliability invariants

Current main still includes prior safety work, including:

- resumable order create/edit and browser idempotency;
- retry-safe order counters/reservations;
- controlled shortage/input failures;
- Workshop preflight;
- secondary read isolation so auxiliary reads do not turn committed saves into false failures;
- non-blocking shipping discrepancy behavior;
- order-delete mobility with physical-truth freshness protection;
- return/exchange cancellation autonomy;
- manager-safe routine Warehouse operations;
- signed 12-hour admin session and server-owned actor headers;
- bounded D1 fan-out/mutation rowsets from Step 191E;
- daily Warehouse attention/context work from 192B2A*;
- movement picker UX from 192B2B.

Critical order-save principle: order + items + reserves + Workshop tasks are critical; audit/history/re-read/extras must not make an already committed successful save appear failed.

Workshop items remain outside normal Warehouse shortage checks. Partial shipping is not used; operational model is all-or-nothing.

## Next point

**R5.8 Finance is complete and deployed. Do not reopen it without new evidence.**

Next task requested by the user: perform an exact **August Orders-page / Orders Summary read-only Production forensic**, rather than relying on the small September page.

Recommended next investigation:

1. reproduce the actual Orders list filter for August (preferably `2026-08-01..2026-08-31`) with default page limit 100;
2. count matching active orders and confirm whether pagination/fallback is genuinely triggered;
3. measure the page query and each relation/handover query for the first page;
4. measure the R5.7 fallback summary SQL in the same August filter, including orders/payment/return components;
5. profile page 2 or another realistic offset if August exceeds 100 rows;
6. inspect EXPLAIN/query plans only after identifying the largest remaining contributors;
7. preserve `completeOrderResult`, archive/status/date/search semantics and summary values exactly;
8. do not prepare R5.9 until a candidate shows a meaningful Production read reduction.

Branch2 remains out of scope unless the user explicitly asks otherwise.
