# Finance — current canonical context

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`
Priority: this file is the canonical resume point for the current Finance transparency/audit work. `FINANCE_FORENSIC_2026-08-25.md` remains the detailed evidence file for the 24-Aug investigation.

## User goal

Make Finance self-explanatory and self-auditing so ordinary users can reconcile every headline number to concrete orders and money operations without asking the project owner. The interface must not hide date mismatches or legitimate cross-date flows. It must distinguish normal late operations (for example debt closure) from cases that really need attention.

Do not change arithmetic merely to make numbers look equal. Preserve business truth and expose the lineage.

## Proven starting incident — 2026-08-24

Production data reconciles exactly. The apparent discrepancy came from three different concepts being shown near each other without enough lineage:

- orders dated 24 Aug total 1,007,800 KZT;
- 967,800 KZT was actually received on those 24-Aug-dated orders;
- one 24-Aug order has 40,000 KZT unpaid debt (`ORD-20260824121101-FA3AE6E6`);
- two backdated orders were physically entered on 24 Aug but given business order dates 22/21 Aug and primary payments dated 24 Aug: `ORD-20260824110308-E2CE748F` and `ORD-20260824083328-9B614DAD`, 45,000 KZT each;
- one genuine debt closure of 22,500 KZT occurred on 24 Aug for `ORD-20260816074322-2445`.

The two 45,000 payments are not debt closures. Their immutable financial events are `order_payment` with reason `order_create`.

Create-order UX currently initializes order date and first payment date to today. Changing the order date later does not sync the already-created payment date, so backdated order entry can silently retain today's payment date.

## Static audit finding — current date checker is asymmetric

Backend already derives three relations for every payment operation:

- `before_order`
- `same_day`
- `after_order`

and also calculates `dateOffsetDays`.

However `paymentDateAnomalies` includes only `before_order`. Frontend mirrors this and the green `Даты согласованы` / warning logic treats only earlier-than-order payment as a date issue. Therefore later primary payments/backdated-order primary payments are known to the system but hidden from the user's date-check workflow.

This is a product/observability defect, not a calculation defect.

## Read-only Production audit — 2026-01-01 through 2026-08-25

No D1 write/migration/repair was performed. Data was read through existing Production API from a temporary forensic GitHub Actions branch.

Overview:

- orders: 1,146
- sales by order date: 67,590,113 KZT
- gross received: 67,057,613 KZT
- returns: 1,056,850 KZT
- net cash: 66,000,763 KZT
- current debt: 532,500 KZT across 10 orders
- payment operations: 1,295
- reconciliation ledger = methods = kinds = 67,057,613 KZT; difference 0

Payment date relations by kind:

- `order_payment`: 1,159 same-day, 4 after-order, 2 before-order
- `debt_close`: 121 after-order, 2 same-day
- `order_extra`: 5 same-day
- `exchange_extra`: 2 after-order

The current UI flags only the 2 `order_payment before_order` rows. It does not surface the 4 `order_payment after_order` rows as cases to understand/review.

The four later primary/order-payment rows are:

1. `ORD-20260824110308-E2CE748F`: order date 22 Aug, payment 24 Aug, +2 days, 45,000 KZT; proven backdated order entered on 24 Aug with payment in same create request.
2. `ORD-20260824083328-9B614DAD`: order date 21 Aug, payment 24 Aug, +3 days, 45,000 KZT; proven backdated order entered on 24 Aug with payment in same create request.
3. `ORD-20260815191304-7791`: order date 15 Aug, payment date 16 Aug, +1 day, 108,000 KZT, payment row created at order creation time on 15 Aug. Needs lineage classification; likely deliberate future-dated primary payment but must be proven before labeling.
4. `ORD-20260710-180328-2415`: order date 10 Jul, payment date 19 Jul, +9 days, 5,000 KZT, payment row created 3 Aug. Needs deeper lineage; this is a stronger review candidate because record creation is much later than both business dates.

Two early primary rows currently caught by old checker:

- `ORD-20260727145030-3762`: order 27 Jul, payment 26 Jul, -1 day, 2,000 KZT.
- `ORD-20260713120541-5619`: order 10 Jul, payment 9 Jul, -1 day, 25,000 KZT.

Important: `after_order` is not itself an error. Almost all debt closures are naturally after the order. New checking must be operation-kind-aware and lineage-aware.

## Architectural gaps found so far

1. The same selected date range is applied independently to `orders.order_date` and `payments.payment_date`. Cross-boundary operations can therefore disappear from the currently viewed side of the report even though they explain the difference.
2. Payment rows expose `createdAt` but not explicit `orderCreatedAt` in the report contract. This prevents the UI from cleanly distinguishing backdated order entry from a genuinely later payment.
3. Headline totals and daily totals are not first-class drill-downs to the exact contributing orders/operations.
4. Daily cash rows do not visibly bridge: payments on same-date orders vs payments on orders of other dates vs debt closures vs extras/exchange extras vs returns.
5. Current debt is a current-state metric while sales/cash are period-flow metrics; there is no visible opening-debt → new debt → debt closed → current debt bridge.
6. The current `Даты согласованы` success message can be false reassurance because it ignores later primary payments and late-recorded historical operations.
7. `money-history` already provides immutable `financial_events` with event type/reason/comment/backfill marker and should be the deepest audit trail, but summary/payment views do not connect users to it strongly enough.
8. Payment-kind normalization defaults missing/unknown values to `primary`; all write callers must be audited so a generic/manual payment cannot silently become a misleading primary payment.
9. Return/exchange money dates, order editing reversals, and cash-register mirroring still require a full audit before implementation.

## Design principle for the fix

Do not classify every date difference as an error. Use richer trace categories and severity:

- primary before order → warning/review;
- same-day primary → normal;
- backdated order entered later with primary payment at entry time → explain explicitly, possibly review if unconfirmed;
- future-dated primary chosen at order creation → explicit info/warning, not silently green;
- primary recorded later/backfilled → review unless lineage proves intended historical entry;
- debt close after order → normal and labeled as debt closure;
- extras/exchange extras after order → normal when tied to their event;
- operation recorded later than its business date → show `recorded at` lag, not necessarily error.

Every row must expose an ORD link / exact order, business date, payment date, recorded-at timestamp, operation type, amount, method, manager, and explanation.

## Planned implementation stages

F1. Complete read-only lineage/write-path audit:
- classify the two remaining later primary rows;
- audit every payment creation/edit path;
- audit return/exchange event dates and reversals;
- audit cash-register linkage and financial-event consistency.

F2. Financial traceability contract/backend:
- expose `orderCreatedAt` and richer derived trace classification;
- add period bridge data so cross-date contributors are never invisible;
- preserve raw operation lineage and immutable event references.

F3. Summary/day UX:
- replace misleading `Даты согласованы` with an honest date/input audit;
- add drill-down from every headline/day amount to exact contributing records;
- show sales-vs-cash bridge and debt bridge.

F4. Payment journal / audit UX:
- searchable/filterable table with ORD, order date, payment date, recorded-at, kind, relation, trace status, manager/customer, direct open-order and money-history actions.

F5. Entry-time prevention:
- when a new order date changes, safely sync an untouched default payment date or explicitly confirm the mismatch;
- never forbid legitimate different dates, but never allow them to remain invisible.

F6. Finance self-check tab/invariants:
- arithmetic reconciliation;
- date/lineage anomalies;
- order ledger vs payments/returns;
- event/reversal consistency;
- cash-register consistency for cash movements;
- missing/duplicate linkage checks.

F7. Regression tests, Branch 2 gate, visual acceptance, then Production promotion.

## Current exact next action

Continue F1 read-only audit: inspect full order + immutable money history for `ORD-20260815191304-7791` and `ORD-20260710-180328-2415`, then audit all payment write callers. Update this file immediately after that intermediate result.

## Warehouse resume point

Finance work temporarily has priority by user request. Warehouse state is unchanged. When Finance is complete, resume from `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md`, Phase 1A read-only audit of Workshop-origin client return/exchange disposition.
