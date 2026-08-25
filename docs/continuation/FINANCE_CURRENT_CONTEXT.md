# Finance — current canonical context

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`
Status: **FINANCE F1–F7 COMPLETE IN PRODUCTION**. Warehouse may resume from its canonical Phase 1A checkpoint.

Production Finance release commit: `c59021021a02c6609938539aba4ba6d184cb4060`
Production Cloudflare deploy monitor: `32880477956` — SUCCESS
Production read-only acceptance: `32880805303` — SUCCESS
Verified Branch2 F6 product commit: `3404604c744723cb7abe09bd9ebcd529c15e8727`
Branch2 F6 Cloudflare deploy: `32879336620` — SUCCESS

This file is the canonical Finance resume point and supersedes older Finance roadmap wording where it conflicts.

## Safety / release facts

- `Приход` remained frozen and unchanged.
- No Finance migration was added.
- No D1 repair, data rewrite or direct Production D1 mutation was used for this release.
- Production construction used Wrangler `--dry-run` only before merge.
- Final Production acceptance used **GET-only Worker APIs**; no POST/PATCH/DELETE.
- Historical money facts were preserved; legacy ambiguity is labelled rather than guessed or rewritten.
- `main` and `branch2` were substantially diverged, so Production was NOT made by merging Branch2 wholesale.

## F1 — 24-Aug forensic + late-order primary-date guard — COMPLETE

The original client discrepancy was proven without mutation.

For business date `2026-08-24`:
- 14 orders;
- sales by order business date: **1,007,800 KZT**;
- received on those 14 orders: **967,800 KZT**;
- period debt: **40,000 KZT**, entirely from `ORD-20260824121101-FA3AE6E6` (45,000 total / 5,000 received);
- actual money received on 24 Aug: **1,080,300 KZT**.

Why cash exceeded received-on-24-Aug-orders:
- 45,000 payment on a backdated order with business date 22 Aug: `ORD-20260824110308-E2CE748F`;
- 45,000 payment on a backdated order with business date 21 Aug: `ORD-20260824083328-9B614DAD`;
- 22,500 genuine debt close for 16-Aug order: `ORD-20260816074322-2445`.

The two 45,000 rows are primary payments created together with orders that were physically entered on 24 Aug but assigned earlier business order dates. They are not debt closures.

Root cause fixed: for NEW orders the initial primary payment follows selected business `orderDate`; server independently enforces the same rule. Existing historical payment dates are not rewritten.

## F2 — selected-period traceability — COMPLETE

Permanent gate: `scripts/test-finance-f2-trace.mjs`.
Worker manifest: `scripts/finance-f2-trace-worker-manifest.json`.

Finance now exposes:
- order business date and order recorded-at timestamp;
- payment operation date and recorded-at timestamp;
- date relation/offset;
- immutable-event lineage / backfill status where available;
- trace code, severity, title and explanation;
- cross-date bridge for money in the selected operation period whose order belongs to another business date.

Return/exchange business dates are explicit rather than silently falling back to the order date. The first cash auto-tracking activation boundary is no longer overwritten on pause/resume.

## F3 — Summary/day UX — COMPLETE

Permanent gate: `scripts/test-finance-f3-summary-ux.mjs`.

- current month is the normal opening period;
- old reconstructed baseline is hidden from normal current-period view and only exposed for explicitly historical ranges;
- false blanket `Даты согласованы` logic was removed;
- cross-date operations explain why sales and incoming money can differ without implying corruption.

## F4 — auditable money journal — COMPLETE

Permanent gate: `scripts/test-finance-f4-money-journal.mjs`.
Worker manifest: `scripts/finance-f4-money-journal-worker-manifest.json`.

`/api/finance/money-history` provides bounded/filterable immutable money history with operation/order timestamps, lineage, trace state, source references and direct drilldown support. Mobile/responsive presentation is covered.

## F5 — payment-entry business semantics — COMPLETE

Authoritative ordinary-order payment model:
1. `Первичная оплата`;
2. `Закрытие долга` — partial or full.

There is **no current generic ordinary `Доплата`**. `Доплата при обмене` remains a distinct `exchange_extra` operation.

Permanent gates/manifests:
- `scripts/test-finance-f5-entry-semantics.mjs`
- `scripts/test-finance-f5-adjacent-regression.mjs`
- `scripts/finance-f5-business-semantics-worker-manifest.json`

Important invariants:
- stale ordinary-extra writes are rejected server-side;
- editor and dedicated debt-close flows share `/api/payments` and critical-operation idempotency;
- generic order edits do not rewrite complete persisted payment history;
- legacy ordinary `order_extra` remains historical evidence but is labelled `Закрытие долга (старый тип)` and counted exactly once under debt-close semantics;
- exchange extra stays isolated.

## F6 — broad self-check / adjacent defect audit — COMPLETE

Permanent aggregate gate: `scripts/test-finance-f6-release-audit.mjs`, wired into `scripts/release-check.mjs`.

### Fixed real cross-ledger deletion defect

Before F6, logical order deletion could compensate the cash ledger while immutable `financial_events` lacked an explicit payment reversal.

Now:
- original payment rows remain historical facts;
- logical delete appends idempotent `payment_reversal` with `reason=order_delete`;
- stale clients cannot reinterpret delete as full payment-list rewrite;
- cash keeps its own source-keyed `order-cancel:*` compensation;
- retry/lost-response cannot duplicate reversal evidence.

Manifest: `scripts/finance-f6-delete-money-history-worker-manifest.json`.

### Fixed strict-report defects / unfinished fields

- product report wording now says business order date rather than misleading “created in period”;
- operation-date return total is no longer mixed into an order-date product cohort;
- city aggregate now calculates and renders real distinct `clients` and `managers` counts rather than `—` placeholders;
- payment-report empty states refer to the selected operation period, not “selected orders”.

Manifest: `scripts/finance-f6-report-semantics-worker-manifest.json`.

### Removed misleading dead metrics

`collectionRate` and `returnRate` were unused and mixed operation-date cash/returns with order-date sales. They had no coherent cohort and could generate misleading percentages. Both were removed from backend/frontend contracts and regression-guarded.

Manifest: `scripts/finance-f6-dead-metrics-worker-manifest.json`.

## F7 — exact Production promotion — COMPLETE

Production was assembled on a fresh branch from then-current `main` `9384a53d1b2247d11fbf0da7e3b8f11a4166d367`.

Reviewed Finance F1–F6 deltas were applied in order. All seven product commits cherry-picked onto the fresh main-based tree **without conflicts**. One permanent F2 regression file was missing from its final feature commit because it had been created during preparation; only that reviewed file was copied from verified Branch2 and its exact Git blob hash `e892dde38e38a858c530683ad5e030ffa072123f` was asserted.

Dry Production candidate verification run `32880117064` — SUCCESS:
- F2–F6 Finance gates passed;
- all retained 189/190/191/192 gates passed;
- DB safety passed;
- TypeScript passed;
- Production Vite build passed;
- bundle budget passed;
- stocktake functional acceptance passed;
- Wrangler `--dry-run` built `orders_app` with `env.DB (orders_db_prod)`;
- no migration or Arrival delta.

Persisted candidate verification run `32880289305` — SUCCESS. A hard allow-list confirmed exactly 28 reviewed Finance/Finance-adjacent files and no temporary workflow in the final candidate.

PR #2 was squash-merged to Production as:
`c59021021a02c6609938539aba4ba6d184cb4060`.

Matching Production Cloudflare run `32880477956` — SUCCESS.

## Final live Production acceptance — PASS

GET-only acceptance workflow `32880805303` ran against the deployed `orders-app` Worker.

For 24 Aug the live API still returns the exact forensic truth:
- order count: **14**;
- sales: **1,007,800**;
- period debt: **40,000**;
- gross received: **1,080,300**;
- order payments: **1,057,800**;
- debt closes: **22,500**;
- cross-date operations: **3 / 112,500**.

Independent reconciliation:
- payment-operation ledger total = **1,080,300**;
- payment-method total = **1,080,300**;
- payment-kind total = **1,080,300**;
- difference = **0**;
- `consistency.ok = true`.

Money journal for 24 Aug:
- 18 events;
- total in **1,080,300**;
- total out 0;
- net **1,080,300**;
- trace/event contract present.

Live cross-date rows correctly expose:
- `ORD-20260816074322-2445` — 22,500 debt close, 8 days after order;
- `ORD-20260824110308-E2CE748F` — 45,000 primary, business order date 22 Aug, trace `backdated_order_entry`;
- `ORD-20260824083328-9B614DAD` — 45,000 primary, business order date 21 Aug, trace `backdated_order_entry`.

City aggregate live response now contains real `clients` and `managers` fields. `collectionRate`/`returnRate` are absent as intended. Historical `order_extra`, if present, is required to use the old-debt-close label.

Cash register GET also passed. Its current balance/today totals are live current-state values and may change with normal business activity; they are not expected to equal the historical 24-Aug report. Likewise `currentDebt` is explicitly current-state and can change independently of a selected historical period.

## Current Finance truth model

Do not treat different dates as automatically erroneous:
- sales/order/product cohorts use business order date where stated;
- cash/payment/refund cohorts use actual operation date where stated;
- primary same-day is normal;
- primary before order is review;
- proven backdated order entered later is explainable historical info;
- debt close after order is normal;
- legacy ordinary `order_extra` is old debt-close semantics exactly once;
- `exchange_extra` remains separate;
- returns/refunds use operation date;
- corrections/reversals append evidence and do not erase the original operation.

## Finance next action

No planned Finance implementation remains from F1–F7. Do not reopen arithmetic or rewrite historical data merely because sales-by-order-date and cash-by-operation-date differ.

If a new Finance complaint appears, first reproduce it read-only against the exact selected period and trace the headline to `paymentOperations` / money history before changing formulas.

## Project next action

Resume Warehouse from `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md`, **Phase 1A read-only cross-workflow audit of Workshop-origin client return/exchange disposition**. Finance is no longer the blocker.
