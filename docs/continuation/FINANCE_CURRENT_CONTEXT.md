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

Two early primary rows currently caught by old checker:

- `ORD-20260727145030-3762`: order 27 Jul, payment 26 Jul, -1 day, 2,000 KZT.
- `ORD-20260713120541-5619`: order 10 Jul, payment 9 Jul, -1 day, 25,000 KZT.

Important: `after_order` is not itself an error. Almost all debt closures are naturally after the order. New checking must be operation-kind-aware and lineage-aware.

## F1 lineage classification — later primary payments

Four `order_payment after_order` rows were inspected.

### Backdated orders entered later — proven current-style lineage

1. `ORD-20260824110308-E2CE748F`: business order date 22 Aug, primary payment 24 Aug, +2 days, 45,000 KZT. The order itself was physically created 24 Aug and the financial event has `reason=order_create`. This is a backdated business order entered on 24 Aug with its primary payment in the same create request.
2. `ORD-20260824083328-9B614DAD`: business order date 21 Aug, primary payment 24 Aug, +3 days, 45,000 KZT. Same lineage: order physically created 24 Aug; financial event `reason=order_create`.

These are not debt closures. The create form initializes both order and first payment to today; changing only `orderDate` leaves the payment date unchanged.

### Future-dated primary payment in legacy baseline

3. `ORD-20260815191304-7791` / order id 1040:
- business order date 15 Aug;
- one payment 108,000 KZT, Kaspi Pay, `primary`, payment date 16 Aug;
- payment stored `createdAt=2026-08-15T19:13:04.358Z`, matching the order-creation timestamp track;
- immutable event is `order_payment`, `reason=baseline`, `isBackfill=true`.

This looks like a primary payment recorded with the order but assigned a next-day business payment date. It must be surfaced as an explicit date/entry fact, not automatically declared corruption.

### Ambiguous legacy additional payment stored as primary

4. `ORD-20260710-180328-2415` / order id 554:
- business order date 10 Jul;
- payment 22,500 KZT on 10 Jul, Kaspi Pay, `primary`;
- second payment 5,000 KZT on 19 Jul, Terminal, also `primary`;
- second payment has a comment suggesting an additional charge related to size, but the exact intended semantics cannot be proven from current state;
- both payment rows have stored `createdAt=2026-08-03T11:13:23.575Z`;
- both immutable financial events are `reason=baseline`, `isBackfill=true`.

Migration 0058 explicitly reconstructed `financial_events` from already-existing payment state and marked those rows as baseline/backfill. Therefore legacy baseline rows do not provide full original mutation lineage. The new audit must be honest about this and must not blindly trust legacy `payment_kind=primary` as semantic proof.

## Current write-path audit findings

### Order create

Payments are embedded in order creation. Payment date/method/amount/kind are normalized and `buildPaymentAndMoneyEventStatements` writes both the payment row and immutable event. Current create draft defaults the first row to `paymentKind=primary`.

### Order edit

The editor compares normalized items/payments. If payments change, it:
1. writes reversal events for the old payments via `removeOrderPaymentsWithMoneyEvents`;
2. deletes/replaces old payment rows;
3. inserts the corrected payment set with new immutable events under order-edit lineage.

This is a strong base for a trace UI: corrections are already represented as events rather than silently overwriting history.

### Separate payment endpoint / debt closure

`POST /api/payments` supports explicit `paymentKind`. The current frontend use found during audit is the Debt workflow, and it explicitly sends `paymentKind='debt_close'`. Therefore modern debt closure is not silently normalized to primary.

`normalizePaymentKind` still defaults unknown/missing type to `primary`, so server-side contract hardening is still desirable: callers that are supposed to be non-primary must never omit the type.

### Returns

Current frontend `createReturnDraft` defaults `returnDate` to today. However server `createReturn` falls back to the order's business date when `returnDate` is missing. That fallback can hide a client omission by manufacturing a historical refund date. New finance hardening should require/derive an explicit current business date instead of silently reusing `order_date`.

Refunds write append-only `order_refund` financial events with the return date and request timestamp. Cancellation writes `refund_reversal`.

### Exchanges

Current frontend exchange draft defaults `exchangeDate` to today. Server `createExchange` also currently falls back to the order date when exchange date is missing; this has the same hidden-date problem and should be hardened.

Exchange extra payment is explicitly stored as `paymentKind='extra'`, `eventType='exchange_extra'`, reason `exchange_created`. Exchange refund is explicitly `exchange_refund`. These are legitimate later-than-order events and must not be treated as date errors.

### Cash register

Cash is a separate physical ledger driven by D1 triggers after explicit activation.
- cash payment row link: `payment:<payment_id>`;
- cash refund row link: `return:<return_id>`;
- payment delete/edit reversal: `payment-reversal:<payment_id>`;
- return cancel reversal: `return-reversal:<return_id>`;
- exchange links relabel the corresponding payment/return cash rows.

The triggers intentionally avoid replaying old primary payments into the cash opening balance while still tracking post-activation debt/extra payments. This means Finance self-check can and should compare cash-method financial events with linked cash-register entries, while respecting activation/cycle boundaries.

## Architectural gaps found so far

1. The same selected date range is applied independently to `orders.order_date` and `payments.payment_date`. Cross-boundary operations can therefore disappear from the currently viewed side of the report even though they explain the difference.
2. Payment rows expose `createdAt` but not explicit `orderCreatedAt` in the report contract. This prevents the UI from cleanly distinguishing backdated order entry from a genuinely later payment.
3. Headline totals and daily totals are not first-class drill-downs to the exact contributing orders/operations.
4. Daily cash rows do not visibly bridge: payments on same-date orders vs payments on orders of other dates vs debt closures vs extras/exchange extras vs returns.
5. Current debt is a current-state metric while sales/cash are period-flow metrics; there is no visible opening-debt → new debt → debt closed → current debt bridge.
6. The current `Даты согласованы` success message can be false reassurance because it ignores later primary payments and late-recorded historical operations.
7. `money-history` already provides immutable `financial_events` with event type/reason/comment/backfill marker and should be the deepest audit trail, but summary/payment views do not connect users to it strongly enough.
8. Legacy baseline rows can preserve old/ambiguous payment kinds. Audit classification must incorporate baseline status and lineage, not only `payment_kind`.
9. Return/exchange server date fallbacks can manufacture the order date when the client omits the operation date.
10. Cash register has strong source links, but Finance currently does not expose a self-check that reconciles those links.

## Design principle for the fix

Do not classify every date difference as an error. Use richer trace categories and severity:

- primary before order → warning/review;
- same-day primary → normal;
- backdated order entered later with primary payment at entry time → explain explicitly, possibly review if unconfirmed;
- future-dated primary chosen at order creation → explicit info/warning, not silently green;
- primary recorded later/backfilled → review unless lineage proves intended historical entry;
- legacy baseline ambiguous → explain that original mutation lineage is unavailable and show all surviving facts;
- debt close after order → normal and labeled as debt closure;
- extras/exchange extras after order → normal when tied to their event;
- operation recorded later than its business date → show `recorded at` lag, not necessarily error.

Every row must expose an ORD link / exact order, business date, payment date, recorded-at timestamp, operation type, amount, method, manager, and explanation.

## Planned implementation stages

F1. Complete read-only/write-path audit:
- audit frontend order-edit payment UX and exact payment-kind preservation;
- finish return/exchange cancellation/reversal edge cases;
- verify cash-register linkage invariants and reporting boundaries;
- inspect report/export duplication so the new truth model is not implemented inconsistently twice.

F2. Financial traceability contract/backend:
- expose `orderCreatedAt`, event/backfill lineage, richer derived trace classification;
- add period bridge data so cross-date contributors are never invisible;
- harden missing-date fallbacks for return/exchange;
- preserve raw operation lineage and immutable event references.

F3. Summary/day UX:
- replace misleading `Даты согласованы` with an honest date/input audit;
- add drill-down from every headline/day amount to exact contributing records;
- show sales-vs-cash bridge and debt bridge.

F4. Payment journal / audit UX:
- searchable/filterable table with ORD, order date, order recorded-at, payment date, payment recorded-at, kind, relation, trace status, manager/customer, direct open-order and money-history actions.

F5. Entry-time prevention:
- when a new order date changes, safely sync an untouched default payment date or explicitly confirm the mismatch;
- require explicit operation dates for return/exchange paths instead of silently substituting order date;
- never forbid legitimate different dates, but never allow them to remain invisible.

F6. Finance self-check tab/invariants:
- arithmetic reconciliation;
- date/lineage anomalies;
- order ledger vs payments/returns;
- event/reversal consistency;
- cash-register consistency for eligible cash movements;
- missing/duplicate linkage checks.

F7. Regression tests, Branch 2 gate, visual acceptance, then Production promotion.

## Current exact next action

Finish F1 static audit of frontend order-edit payments, return/exchange cancellation paths, cash-report boundaries, and duplicate Reports-vs-Finance rendering. Then freeze the trace categories/API contract and begin F2 implementation on `branch2`. Update this file immediately after that intermediate result.

## Warehouse resume point

Finance work temporarily has priority by user request. Warehouse state is unchanged. When Finance is complete, resume from `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md`, Phase 1A read-only audit of Workshop-origin client return/exchange disposition.
