# Orders-app — current project continuation context

Updated: 2026-09-04
Branch for continuation context only: `context/project-continuation`

This file is the canonical continuation point for ChatGPT work on the project. It is intentionally kept off `main` so context-only updates do not trigger a Production Worker deploy.

## User workflow requirements

- Keep continuation context updated here in GitHub; do not send standalone context files unless explicitly requested.
- When local execution is genuinely needed, provide one ready-to-run Windows CMD entry point from the project root.
- Before Warehouse patches, audit related flows end-to-end rather than fixing one isolated screen.
- Arrival UI is frozen and must not be changed.
- Prefer measured, narrow, reversible changes, especially for D1 read-budget work.
- For small D1 release/repair SQL, prefer bounded `wrangler d1 execute --command` statements rather than `--file`; this project previously hit `D1_RESET_DO` through the import endpoint.
- Branch2 must remain untouched unless explicitly targeted.

## Current Production release

Current `main` / Production Worker release is **R5.8**:

`6256d003f2c3c15cb1b8e675f0c225a6732cdc68`

PR #11 (`R5.8: reduce Finance duplicate D1 reads`) was squash-merged. Cloudflare deploy monitor run `33887966913` succeeded for this exact commit.

R5.8 has **no D1 migration**. Branch2 remains unchanged at:

`adec6098777bebe4709615e1256cc5dd468b444d`

## R5.8 Finance result

For `scope=finance`, R5.8 skips two duplicate D1 aggregates and derives them from already-loaded payment-operation rows:

- payment-method totals/counts;
- payment-method-by-day totals.

Non-Finance report paths retain their old SQL. Exact response values and ordering were proven, including the old raw-method ordering before canonical merge.

Full candidate validation run `33887801540` passed `release:check`, DB safety, typecheck, build and Wrangler dry-run.

Postdeploy SELECT-only Production verification run `33888269466` measured `2026-09-01..2026-09-04`:

- overview 32
- order days 32
- returns 2
- exchanges 13
- closed debts 48
- current debt 12
- current debt top 48
- payment operations 316
- before-order/outside-period bridge 97
- financial events 73

Total: **673 rows_read**, down from **901**, a reduction of **228 / about 25.3%**.

Important invariant: payment-date reports must stay based on payment rows. For `2026-09-01..2026-09-04`, orders created in the period had `SUM(received_amount)=1,494,941`, while payments dated in the period totaled `1,559,941`; those are different business scopes, not interchangeable totals.

## R5.7 Orders Summary baseline

Previous release R5.7 was `0ad57910d95a8b3fa8411faf01008b5b62990014`.

It reduced the all-active Orders Summary fallback from **9,542 -> 3,802 rows_read** without a D1 migration by:

- replacing the old materialized Workshop aggregate with a correlated lookup using the Workshop index;
- folding `received_amount` into the orders scan;
- for active/no-date UI requests with `includePaymentCount=0`, reusing verified order-level received totals instead of re-reading all payments.

Date-filtered Orders views intentionally retain exact payment queries because payment-date semantics differ from order-date semantics.

`listOrders` still uses:

`completeOrderResult = offset === 0 && orders.length < limit`

Only a first page that is provably the complete filtered result can derive the summary from page/relation data. Paginated results use fallback summary SQL.

## Exact August Orders-page Production forensic — completed

User explicitly requested profiling the Orders page with August data rather than the small September page. This was completed against exact R5.8 Production source and `orders_db_prod` using SELECT-only Wrangler calls.

Successful run: **`33890364720`** (job `101080264024`).

Filter reproduced active August semantics:

- `order_status NOT IN ('deleted','archived')`
- `order_date >= '2026-08-01'`
- `order_date <= '2026-08-31'`
- default page size 100
- sort `order_date DESC, id DESC`

No D1 write, migration, deploy or Branch2 change occurred.

A first diagnostic run `33890102225` stopped safely because the one-shot workflow quoted SQLite JSON paths incorrectly inside a heredoc. It had performed reads only; no mutation occurred. The corrected v2 run completed successfully. The temporary forensic branch was reset back to clean Production `main` after measurement.

### August cardinality and pagination

Exact active August order count: **432**.

Page-query rows_read by offset:

- page 1, offset 0: **299**, 100 rows
- page 2, offset 100: **600**, 100 rows
- page 3, offset 200: **893**, 100 rows
- page 4, offset 300: **1,192**, 100 rows
- page 5, offset 400: **1,288**, 32 rows

This is clear evidence that the current OFFSET pagination becomes progressively more expensive as the user moves deeper into a month.

Order ranges:

- page 1: `ORD-20260831175655-863380F0` .. `ORD-20260826111244-66A7F1A8`
- page 2: `ORD-20260826092715-121C8677` .. `ORD-20260818144904-4528`
- page 3: `ORD-20260818144326-8030` .. `ORD-20260811114924-8213`
- page 4: `ORD-20260811113803-5159` .. `ORD-20260803135516-9458`
- page 5: `ORD-20260803133802-8602` .. `ORD-20260801063555-3130`

Even page 5 still uses fallback summaries because `offset > 0`, despite returning only 32 rows. That is correct under the current API contract but means every August page re-runs period summaries.

### Exact August fallback summary cost

For the same August filter:

- `order_stats`: **1,405 rows_read**
- `payment_stats`: **1,001**
- `return_stats`: **17**
- total fallback: **2,423 rows_read**

Summary values:

- order_count: 432
- total_amount: 23,261,100
- `orders.received_amount` for August-created orders: 23,105,600
- debt_amount: 155,500
- workshop_units: 684
- payments dated in August: 485 payments / 23,210,600
- returns dated in August: 8 / 308,000

Do **not** treat the 23,105,600 vs 23,210,600 difference as a bug without further evidence. The first is scoped by order date; the second by payment date. `listOrders` intentionally applies payment date to payment statistics when date filters are active.

### Page 1 relation cost (100 orders, chunks 80 + 20)

Chunk 1 (80 orders):

- items: 871 rows_read / 205 result rows
- payments: 326 / 83
- returns: 34 / 0
- workshop tasks: 378 / 125
- compact handover flags: **1,392 / 14**

Chunk 2 (20 orders):

- items: 213 / 46
- payments: 82 / 21
- returns: 34 / 0
- workshop tasks: 81 / 26
- compact handover flags: **241 / 2**

Total page-1 relations: **3,652 rows_read**.

Page query + relations: **3,951**.

Page 1 plus date-filtered fallback summaries: approximately **6,374 rows_read** across the exact SQL paths reproduced by the forensic.

The largest surprising page-1 relation hotspot is compact handover: **1,633 rows_read for 16 returned rows**. This path computes physical-truth lineage through active reservations, stock checks, stocktakes and handover reviews. It is data-dependent and must not be simplified without proving identical review flags.

### Page 2 relation cost

Chunk 1:

- items 727 / 162
- payments 336 / 88
- returns 34 / 0
- workshop tasks 442 / 152
- compact handover 80 / 0

Chunk 2:

- items 196 / 45
- payments 86 / 23
- returns 34 / 1
- workshop tasks 119 / 42
- compact handover 20 / 0

Total page-2 relations: **2,074 rows_read**.

Page query + relations: **2,674**.

Page 2 plus date-filtered fallback summaries: approximately **5,097 rows_read**.

The handover difference is highly data-dependent: page 1 had active reservation/lineage work, while page 2 returned no compact handover rows and paid only 100 rows_read for that path.

## Strongest next Orders optimization candidates

No new Orders patch has been released from the August forensic yet. The evidence now supports three concrete candidate investigations, in this order:

1. **OFFSET pagination** — prove a deferred-join or cursor/keyset candidate against all five August pages while preserving exact `order_date DESC, id DESC` ordering and existing API/UI navigation semantics. Do not replace `offset` blindly; backward/forward navigation and `hasPrevious` must remain correct.
2. **Compact handover flags on page 1** — inspect query plans/index coverage for `inventory_stock_checks`, `inventory_stocktake_sessions` and `inventory_handover_reviews`; prove any rewrite returns exactly the same `stock_handover_review_needed` and `stock_handover_has_active_items` flags. Physical-truth/freshness semantics are safety-critical.
3. **Date-filtered fallback summaries** — 2,423 rows_read are repeated on every August page. First try query/index improvements. A client/server summary cache is possible later, but only with explicit freshness/invalidation semantics; do not introduce a materialized business summary casually.

Items and Workshop relation reads are also substantial, but they return large amounts of rendered order data and are not yet proven waste.

## R5.6 indexes still in force

R5.6 migration 0066 added:

- `idx_payments_payment_date_order_amount`
- `idx_orders_current_debt_partial`
- `idx_order_items_pending_writeoff_status_order`
- `idx_order_items_workshop_order_quantity`

Representative Production before -> after R5.6:

- payment-method summary `1595 -> 1595` (planner used the index, but no rows_read reduction; never overclaim it)
- current debt `1321 -> 12`
- pending writeoff `5208 -> 2`
- Workshop grouped aggregate `3317 -> 1736`

## D1 / release safety

Production D1: `orders_db_prod`, UUID `17e68a41-1d58-4a36-8a63-47c3e32443c4`.

Preserve project limits:

- bounded mutation rowsets;
- at most 6 parallel read calls;
- <=100 bind/query parameters;
- avoid long compound SELECTs;
- existing capacity policy 60/100/300 and 60-line bind budget.

For forensics/proof stages: SELECT-only Production reads. No mutation until a candidate has a measured benefit and full release gates are ready.

## Inherited business / reliability invariants

Current main retains:

- resumable order create/edit and browser idempotency;
- retry-safe counters/reservations;
- controlled shortage/input failures;
- Workshop preflight;
- secondary read isolation;
- non-blocking shipping discrepancy behavior;
- order-delete mobility with physical-truth freshness protection;
- return/exchange cancellation autonomy;
- manager-safe routine Warehouse operations;
- signed 12-hour admin session and server-owned actor headers;
- bounded D1 fan-out/mutation from Step 191E;
- daily Warehouse attention/context from 192B2A*;
- movement-picker UX from 192B2B.

Critical save invariant: order + items + reserves + Workshop tasks are critical; auxiliary audit/history/re-read work must not make an already committed successful save appear failed.

Workshop items remain outside normal Warehouse shortage checks. Partial shipping is not used; model is all-or-nothing.

## Next point

**R5.8 Finance is complete. August Orders forensic is also complete.**

Do not release another Orders read-budget patch merely from intuition. Next action should be a read-only candidate proof, starting with pagination and compact handover because the August data finally exposed their real cost. Only prepare the next narrow release after an exact Production-equivalent candidate shows a meaningful reduction with identical result/order/flags.
