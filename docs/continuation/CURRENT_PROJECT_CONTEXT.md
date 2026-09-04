# Orders-app — current project continuation context

Updated: 2026-09-04
Branch for continuation context only: `context/project-continuation`

This file is the canonical continuation point for ChatGPT work on the project. It is intentionally kept off `main` so context updates do not trigger a Production Worker deploy.

## User workflow requirements

- For each practical patch, provide one ready-to-run Windows CMD command/file from the project root when local execution is needed.
- Keep continuation context updated in GitHub; do not send standalone context files to the user unless explicitly requested.
- Before Warehouse patches, audit related flows end-to-end rather than fixing only one screen.
- Arrival UI is frozen and must not be changed.
- Prefer measured, minimal, reversible changes; especially for D1 read-budget work.
- Avoid `wrangler d1 execute --file` for small release/repair SQL in this project. Use bounded `--command` statements when practical because the D1 import endpoint previously produced `D1_RESET_DO` behavior.

## Current release state

### main / Production Worker

Current validated R5.6 release commit:

`fd0f509912a2939c8e9f0b84a7093b82a1d47c60`

Release contents:
- migration `0066_v72_d1_read_budget_r5_finance_summary_indexes.sql`;
- four additive indexes;
- two truth-equivalent runtime predicate rewrites where NULL had already been semantically excluded;
- focused R5.6 regression coverage;
- exact cumulative Worker declaration allow-list update;
- migration safety allow-list update.

PR #9 was squash-merged into `main`.

GitHub -> Cloudflare Production deploy monitor run `33875914433` completed successfully.

### Production D1

Production database: `orders_db_prod`

R5.6 migration 0066 was applied successfully using one statement per `wrangler d1 execute --command` call. Branch2 was not targeted.

Confirmed Production indexes:

- `idx_payments_payment_date_order_amount`
- `idx_orders_current_debt_partial`
- `idx_order_items_pending_writeoff_status_order`
- `idx_order_items_workshop_order_quantity`

Successful Production D1 apply/verify workflow run: `33876464739`.

Representative measured Production rows_read for 2026-08-01..2026-09-04, immediately before vs immediately after migration 0066:

- payment-method summary: `1595 -> 1595`
- current debt: `1321 -> 12`
- pending stock writeoff: `5208 -> 2`
- Workshop grouped aggregate: `3317 -> 1736`

Corresponding reductions:

- payment summary: no measured rows_read reduction on this range;
- current debt: about 99.1%;
- pending writeoff: about 99.96%;
- Workshop aggregate: about 47.7%.

`EXPLAIN QUERY PLAN` confirmed the intended indexes were selected:

- payments: `SEARCH p USING INDEX idx_payments_payment_date_order_amount`
- current debt: `SEARCH orders USING INDEX idx_orders_current_debt_partial`
- pending writeoff: `SEARCH oi USING INDEX idx_order_items_pending_writeoff_status_order`
- Workshop aggregate: `SCAN order_items USING COVERING INDEX idx_order_items_workshop_order_quantity`

Important: do not claim the payment index reduced rows_read based on this measurement. It was selected by the planner but measured `1595 -> 1595`.

### Branch2

Branch2 was not changed by R5.6 and remained at:

`adec6098777bebe4709615e1256cc5dd468b444d`

## Exact read-only Production baseline after R5.6

Run `33877951817` measured the current Production database directly through Wrangler using SELECT-only statements. The measurement branch differed from the exact R5.6 release only by the one-shot measurement workflow. No D1 mutation, migration, Worker deploy, or Branch2 change occurred.

### Finance workspace — current month 2026-09-01..2026-09-04

Exact rows_read by SQL path:

- `finance_overview`: 32
- `finance_payment_methods`: 110
- `finance_day_rows`: 32
- `finance_returns`: 2
- `finance_exchanges`: 13
- `finance_closed_debt`: 48
- `finance_current_debt`: 12
- `finance_current_debt_top`: 48
- `finance_payment_by_day`: 118
- `finance_payment_operations`: 316
- `finance_early_payment_bridge`: 97
- `finance_payment_events`: 73

Total for these exact Finance `scope=finance` SQL paths: **901 rows_read**.

Largest current-month contributors:

1. payment operations: 316
2. payment-by-day: 118
3. payment-method summary: 110
4. early-payment bridge: 97
5. financial events: 73

At current-month scale there is no urgent single catastrophic Finance scan left.

### Finance workspace — 2026-08-01..2026-09-04 (35-day comparison window)

Exact rows_read by SQL path:

- `finance_overview`: 478
- `finance_payment_methods`: 1595
- `finance_day_rows`: 478
- `finance_returns`: 42
- `finance_exchanges`: 67
- `finance_closed_debt`: 833
- `finance_current_debt`: 12
- `finance_current_debt_top`: 48
- `finance_payment_by_day`: 1712
- `finance_payment_operations`: 4686
- `finance_early_payment_bridge`: 1456
- `finance_payment_events`: 1114

Total for these exact Finance `scope=finance` SQL paths: **12,521 rows_read**.

Largest 35-day contributors:

1. `finance_payment_operations`: **4,686**
2. `finance_payment_by_day`: **1,712**
3. `finance_payment_methods`: **1,595**
4. `finance_early_payment_bridge`: **1,456**
5. `finance_payment_events`: **1,114**
6. `finance_closed_debt`: **833**

This shows the remaining Finance read budget scales mainly with payment history / payment-operation traceability, not current debt anymore.

### Orders Summary active fallback SQL shapes

Exact current Production rows_read:

- active `orders_stats` including Workshop aggregate: **5,212**
- active `payment_stats`: **4,267**
- active `return_stats`: **63**

Combined fallback-stat total: **9,542 rows_read**.

This is the strongest measured R5.7 candidate. The active Orders Summary fallback is materially heavier than the current-month Finance workspace and is still dominated by the all-active order/payment aggregates.

Important runtime nuance: `listOrders` avoids these aggregate fallback queries when the first page is provably the complete filtered result (`offset=0` and returned rows < limit). The 9,542 measurement is therefore the exact cost of the fallback SQL shapes when pagination/truncation requires them, not a claim that every ordinary order-list request always pays this full amount.

### R5.6 current verification during the same baseline

- pending writeoff: **2 rows_read**
- full Workshop grouped aggregate: **1,736 rows_read**

These match the post-R5.6 state; no regression was observed.

## Safety state at R5.6 release

Immediately before the successful Production D1 apply:

- full `release:check` passed;
- `verify:db-safety` passed;
- focused R5.6 regression passed;
- TypeScript/build/dry-run gates passed as part of release check;
- migration 0066 was additive only;
- Arrival UI was unchanged;
- Production target identity was verified before D1 commands;
- the first one-shot D1 workflow attempt failed only in diagnostic `jq` formatting before any migration statement ran; the corrected second run performed and verified the mutation successfully.

The temporary R5.6 ops branch was reset back to the clean R5.6 release commit after the successful D1 run, so the one-shot mutation workflow is not left at the current branch tip.

## Order / Warehouse reliability state inherited into current release

Current release already contains the prior safety work, including:

- resumable order create/edit and browser idempotency;
- retry-safe order counters/reservations;
- controlled shortage/input failures;
- Workshop preflight;
- secondary read isolation;
- non-blocking shipping discrepancy behavior;
- order delete mobility with physical-truth freshness protection;
- return/exchange cancellation autonomy;
- manager-safe routine Warehouse operations;
- signed 12h admin session and server-owned actor headers;
- bounded D1 fan-out/mutation rowsets from Step 191E;
- daily Warehouse attention/context work from 192B2A*;
- movement picker UX from 192B2B.

## Next point

R5.6 is complete and should not be reopened without new evidence.

The exact post-release baseline now exists. The strongest R5.7 investigation target is **Orders Summary fallback**, especially:

- active `orders_stats` at 5,212 rows_read;
- active `payment_stats` at 4,267 rows_read.

Secondary R5.7 Finance targets, if needed after Orders Summary, are the wide-period payment-history paths:

- payment operations 4,686;
- payment-by-day 1,712;
- payment-method summary 1,595;
- early-payment bridge 1,456;
- financial events 1,114.

Preferred next action:

1. investigate query plans and cardinality for the two Orders Summary fallback aggregates;
2. prove any candidate index/query rewrite against a read-only Production snapshot or exact Production EXPLAIN/measurement;
3. preserve `completeOrderResult` semantics and all summary values exactly;
4. change nothing until a measurable reduction is demonstrated;
5. only then prepare R5.7 as a narrow release.
