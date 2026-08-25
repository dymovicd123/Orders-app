# Finance — current canonical context

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`
Status: Finance transparency project ACTIVE; Warehouse paused without changes. Late-order primary-payment date guard is VERIFIED and deployed on `branch2`; not yet promoted to `main`/Production.
Priority rule: this file is the canonical Finance resume point. `FINANCE_FORENSIC_2026-08-25.md` contains detailed 24-Aug evidence.

## User goal

Finance must be self-explanatory and self-auditing. A normal user must be able to open any headline number or suspicious date and reach the exact ORD/order/money operation that produced it, without contacting the project owner. Do not force totals to look equal: preserve business truth and expose why values differ.

After every meaningful audit/fix/gate/deploy, update this file.

## F1 READ-ONLY AUDIT — COMPLETE

No Production D1 write, migration, repair, order edit, payment edit, return edit or cash mutation was made during the audit. Production evidence was read through existing APIs from a temporary forensic branch.

### 24-Aug incident — proven

Orders with business `order_date=2026-08-24`:
- 14 active/non-deleted orders;
- full sales value 1,007,800 KZT;
- received on those orders 967,800 KZT;
- 40,000 KZT unpaid on `ORD-20260824121101-FA3AE6E6` (45,000 total / 5,000 paid).

Cash received on 24 Aug:
- 967,800 KZT on 24-Aug-dated orders;
- 45,000 KZT on backdated `ORD-20260824110308-E2CE748F` (business order date 22 Aug);
- 45,000 KZT on backdated `ORD-20260824083328-9B614DAD` (business order date 21 Aug);
- 22,500 KZT genuine `debt_close` on `ORD-20260816074322-2445`.

Total received 24 Aug = 1,080,300 KZT. Method totals also equal 1,080,300; arithmetic is correct.

The two 45,000 rows are NOT debt closures. Both orders were physically entered into the system on 24 Aug, with an earlier business order date, and their payment events were created in the same create request (`eventType=order_payment`, `reason=order_create`).

Root cause before the guard: create-order initialized both order date and first payment date to today. Changing only the order date left the already-created primary payment on the physical entry day. This root cause is now prevented in `branch2`; see the verified guard section below.

### Production audit 2026-01-01..2026-08-25

- orders: 1,146
- sales by order date: 67,590,113 KZT
- gross received: 67,057,613 KZT
- returns: 1,056,850 KZT
- net cash: 66,000,763 KZT
- current debt: 532,500 KZT across 10 orders
- payment operations: 1,295
- ledger total = payment-method total = payment-kind total = 67,057,613 KZT; difference 0.

Date relations by current operation kind:
- order_payment: 1,159 same-day, 4 after-order, 2 before-order
- debt_close: 121 after-order, 2 same-day
- order_extra: 5 same-day
- exchange_extra: 2 after-order

Current backend already computes `before_order / same_day / after_order` and `dateOffsetDays`, but `paymentDateAnomalies` includes ONLY `before_order`. Frontend repeats this and shows green `Даты согласованы` when there are no early payments. Therefore later primary payments/backdated entries are technically known but deliberately hidden from the user's review flow.

Two early rows currently surfaced:
- `ORD-20260727145030-3762`: order 27 Jul, payment 26 Jul, -1 day, 2,000 KZT.
- `ORD-20260713120541-5619`: business order date 10 Jul, payment 9 Jul, -1 day, 25,000 KZT.

Four later `order_payment` rows were investigated:
1. `ORD-20260824110308-E2CE748F`: +2d, 45,000; proven backdated order entered 24 Aug in same create request.
2. `ORD-20260824083328-9B614DAD`: +3d, 45,000; same lineage.
3. `ORD-20260815191304-7791`: business order 15 Aug, 108,000 primary dated 16 Aug; payment stored at order-creation timestamp, but immutable event is historical `baseline/isBackfill=true`. Treat as explicit future-dated historical fact, not automatic corruption.
4. `ORD-20260710-180328-2415`: business order 10 Jul, 22,500 primary 10 Jul plus another 5,000 primary 19 Jul. Both surviving rows were recorded/backfilled later; second has an additional-charge-like comment. Original semantics cannot be proven. Legacy `primary` alone is not reliable semantic proof.

Migration 0058 intentionally created `financial_events` as a trustworthy baseline of surviving historical state and marked historical reconstructions `reason=baseline`, `is_backfill=1`. New UI must state when original mutation lineage is unavailable.

## F1 write-path findings

### Order create
Payments are embedded in create. Modern writes create both `payments` and append-only `financial_events`. First draft payment defaults to `primary`.

### VERIFIED root-cause guard — late-entered new orders

User-defined invariant: when a manager enters a new order late/backdated, the initial `primary` payment belongs to the selected business order date, not to the day the form happens to be filled in.

Implemented and verified on `branch2`:
1. Frontend create form: changing `orderDate` automatically synchronizes every `primary` payment row in the NEW-order draft to the selected order date.
2. Additional new-order payment rows already start from the current selected `orderDate`.
3. Server `createOrder` independently enforces the same invariant in both fresh-create planning and the legacy in-flight create-resume bridge: `primary.paymentDate = orderDate`.
4. Therefore a stale browser/mobile client cannot re-create the old bug merely by sending today's explicit primary payment date with a backdated new order.
5. Non-primary operations are not rewritten by this rule.
6. Existing-order editing deliberately remains outside this rule: historical payment dates are preserved and are not normalized back to the order date.

Regression coverage was added to Step 192B2A4 create/save integrity tests, and the exact `createOrder` Worker body delta is pinned through `scripts/finance-order-date-sync-worker-manifest.json` in the Step 190.6A modularization hash chain. No global Worker integrity protection was weakened.

Verification:
- full `npm run release:check` PASSED on the isolated patch branch;
- verified source was fast-forwarded to `branch2`;
- Cloudflare deploy monitor for `branch2` commit `104a9dffee5b8a044df65e8a1c03958d3bd20eef` completed SUCCESS.

Production/main has NOT yet been changed by this guard. Promote only after the planned Branch2/visual acceptance point unless explicitly decided otherwise.

### Order edit
If payment rows change, server first writes reversal events, removes old payment rows, then writes corrected rows/events. This is a strong audit foundation: corrections are not silently erased from money history.

### CURRENT ambiguity bug in admin editor
`OrderEditorSection` does not show payment kind. `+ Оплата` calls `createEmptyEditorPayment(current.orderDate)`, which silently creates `paymentKind='primary'`. Therefore an admin can currently add a later payment that semantically might be a debt close or extra, while the stored type becomes another primary. This must be fixed; generic editor must not create hidden operation semantics.

### Debt closure
The separate `/api/payments` path supports explicit kind. Current Debt UI explicitly sends `debt_close`, so modern debt closures are correctly typed.

### Return
Frontend defaults return date to today. Server currently falls back to the original order date if client date is missing. That hidden fallback can manufacture a historical refund date and must be hardened. Return/refund and cancellation already produce append-only refund/reversal financial events.

### Exchange
Frontend defaults exchange date to today. Server has the same bad missing-date fallback to order date. Extra payment is explicitly `extra` / `exchange_extra`; refund is explicitly `exchange_refund`; cancellation produces reversal events. Legitimate later exchange/debt events are not date errors.

## Cash-register audit

Cash is a separate physical ledger with source links:
- payment: `payment:<payment_id>`
- return: `return:<return_id>`
- payment reversal: `payment-reversal:<payment_id>`
- return reversal: `return-reversal:<return_id>`
- exchange relabels linked payment/return cash rows.

Production current state at audit:
- initialized=true, autoTrackingEnabled=true
- `initializedAt=2026-08-11T11:46:57.928Z`
- current `activatedAt=2026-08-25T09:50:19.481Z`
- current cycle started `2026-08-12 13:46:11`
- current-cycle totalIn 158,000 / totalOut 158,000 / balance 0
- previous closed cycle: totalIn 653,000 / totalOut 653,000 / closing balance 0.

Important new defect: `setCashAutoTracking(true)` overwrites `activated_at` every time tracking is re-enabled. Production proves the semantic mismatch because current cash ledger contains automatic payment entries dated 15–19 Aug even though current `activatedAt` says 25 Aug. The trigger uses `activated_at` as a backlog boundary. Therefore `activatedAt` cannot currently be presented or used as immutable 'first activation' truth after pause/resume.

Design decision for fix: preserve the original activation boundary (do not overwrite it on resume), and treat pause/resume/cycle boundaries separately. Historical Production `activatedAt` has already lost its original value, so no destructive repair should be guessed; audit UI must derive/report what can actually be proven from ledger/cycle data.

## Reports architecture

`Финансы` and `Отчёты` render the same `FinanceReportResponse` through separate components. We will implement ONE richer server truth/trace contract:
- `Финансы` = interactive drill-down/self-audit;
- `Отчёты` = strict/export representation of the same facts.
No duplicate business logic.

## Frozen trace model for implementation

Do NOT treat every different date as an error. Classification must combine operation type, business dates, recorded-at timestamps and lineage.

Required trace classes/severity concepts:
- primary same-day → normal
- primary before order → review/warning
- historical/backfilled order entered later with primary payment at entry → explain explicitly; review/info
- future-dated primary chosen/recorded at order entry → explicit info/review
- primary recorded later → review
- legacy baseline ambiguous → explain that original mutation lineage is unavailable
- debt_close after order → normal, explicit debt closure
- order_extra / exchange_extra → normal when explicitly linked
- return/refund → normal by operation date
- late `recorded-at` lag → visible fact, not automatically corruption
- reversals/corrections → show their original related operation.

For NEW orders after the verified date-sync guard, an ordinary `order_create` primary payment with a different business date should be treated as especially suspicious/impossible under the supported write path, because the server now normalizes it to `orderDate`.

Every traceable money row must expose:
- exact ORD and order id
- order business date
- order recorded-at timestamp
- operation business date
- operation recorded-at timestamp
- payment/operation kind
- amount and method
- manager/customer
- date relation/offset
- immutable event reason/backfill status when available
- trace code/severity/title/explanation
- direct `Открыть заказ`
- direct `Денежная история`.

## Remaining implementation plan

### F2 — backend/contract traceability (NEXT)
- enrich payment-operation contract with `orderCreatedAt`, event lineage/backfill and derived trace classification;
- add cross-date period bridge data so no contributor is invisible;
- harden return/exchange missing-date fallback;
- preserve original cash activation boundary on future pause/resume;
- add only additive indexes/migration if required for cheap lineage lookups.

### F3 — Summary/day UX
- replace false-green `Даты согласованы` with honest `Проверка дат и ввода`;
- show review/info categories and exact operations;
- headline/day drill-down;
- sales-vs-cash bridge and debt bridge.

### F4 — Money journal/audit UX
Search/filter by ORD, dates, operation kind and trace state. Show all timestamps and direct order/money-history actions.

### F5 — Entry-time prevention
- DONE on Branch2: backdating a NEW order synchronizes/enforces primary payment date = selected order date on both frontend and server;
- remaining: admin editor must expose/require correct meaning for new payment rows rather than hidden primary;
- remaining: return/exchange operation dates must not silently fall back to order date.

### F6 — Finance self-check
- arithmetic reconciliation;
- date/lineage review;
- order ledger vs current payments/returns;
- event/reversal consistency;
- eligible cash financial events vs cash-register source links, respecting cycle/tracking history;
- missing/duplicate linkage checks.

### F7 — gates
Regression tests → `branch2` → Cloudflare Branch2 success → visual acceptance → `main` promotion → Production success.

## Exact next action

Resume F2 from current `branch2` (which now includes the verified late-order payment-date guard). First F2 patch remains backend/contract traceability: enrich `FinancePaymentOperation` with order-recorded/event-lineage fields and derive honest trace categories; add a small additive index migration if needed. Keep the new create invariant in all F2 classification logic. Run full `release:check` before moving further. No Production mutation during this step.

## Warehouse resume point

Finance currently has priority by explicit user request. Warehouse is unchanged. After Finance is complete, resume `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` at Phase 1A: read-only Workshop-origin client return/exchange disposition audit.
