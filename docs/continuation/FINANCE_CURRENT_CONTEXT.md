# Finance — current canonical context

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`
Active staging branch: `branch2`
Current verified Finance Branch2 product commit: `3404604c744723cb7abe09bd9ebcd529c15e8727`
Branch2 Cloudflare deploy run: `32879336620` — SUCCESS
Production/main last observed before F7: `9384a53d1b2247d11fbf0da7e3b8f11a4166d367`
Status: F1–F6 COMPLETE on Branch2. F7 exact Production promotion is NEXT. Warehouse remains paused and unchanged.

This file is the canonical Finance resume point. It supersedes older Finance-plan wording where this file conflicts. Update it after every meaningful Finance audit/fix/gate/deploy/promotion.

## User goal

Finance must be self-explanatory and self-auditing. A normal user must be able to open a headline number or suspicious date and reach the exact order/money operation that produced it. Do not force unlike totals to look equal: preserve business truth and explain different time semantics.

## Frozen safety rules

- `Приход` is frozen; Finance work must not change Arrival UI or behavior.
- No D1 mutation, migration or repair merely to make Finance totals look cleaner.
- Historical money facts are preserved; ambiguous legacy semantics are labelled, not guessed or rewritten.
- Push/deploy must never auto-apply D1 migrations/repair.
- `branch2` is staging/technical acceptance; `main` is Production.
- `main` and `branch2` are materially diverged. F7 must promote only the exact reviewed Finance delta onto current `main`; never replace/merge the whole Branch2 tree.

## F1 — read-only forensic + late-order primary-date guard — COMPLETE

24-Aug Production forensic explained the client discrepancy without mutation:
- 14 orders with business `order_date=2026-08-24`;
- sales 1,007,800 KZT;
- received on those orders 967,800 KZT;
- 40,000 KZT unpaid on `ORD-20260824121101-FA3AE6E6`;
- actual cash received 24 Aug = 1,080,300 KZT because it additionally contained two 45,000 payments on older/backdated orders and one 22,500 debt close.

Root cause found and guarded: for NEW orders the initial primary payment follows the selected order business date. Existing historical payments are not rewritten retroactively.
Verified Branch2 product lineage includes `d79f4b68b0b7248c889956eb5b6bf48564ccb4e9`; context record `cc25e6d946b43dc7fd27a38215a762119680d55d`.

## F2 — selected-period traceability — COMPLETE

Verified feature commit: `7e3a8e5b355d07c3ad567adcb9ec5074d1cc7fd6`.
Permanent gate: `scripts/test-finance-f2-trace.mjs`.
Worker manifest: `scripts/finance-f2-trace-worker-manifest.json`.

Implemented:
- payment-operation lineage and trace classification;
- cross-date bridge for money whose operation date differs from order date;
- explicit return/exchange business dates;
- immutable first cash activation boundary;
- legacy baseline identified as reconstructed history rather than exact original action.

## F3 — Summary/day Finance UX — COMPLETE

Verified feature commit: `5d74258d25104aab39dbdb1d5e0526159418da0d`.
Permanent gate: `scripts/test-finance-f3-summary-ux.mjs`.

Implemented:
- current month is the normal opening range;
- historical baseline is hidden from normal current-period view and appears only for explicitly older ranges;
- false global-green date claims removed;
- day review uses trace severity;
- cross-date bridge visibly explains why period sales and period cash may differ.

## F4 — auditable money journal — COMPLETE

Verified feature commit: `1b5b9168b8ba174778ae2749ed49118f068375ff`.
Permanent gate: `scripts/test-finance-f4-money-journal.mjs`.
Worker manifest: `scripts/finance-f4-money-journal-worker-manifest.json`.

Implemented:
- bounded money-history endpoint with independent flow/operation/trace filters;
- historical baseline opt-in only for older periods;
- operation/order recorded timestamps, source lineage, trace severity/explanation;
- direct order/money-history drilldowns;
- responsive/mobile journal UX.

## F5 — current payment-entry business semantics — COMPLETE

Authoritative ordinary-order model:
1. `Первичная оплата`;
2. `Закрытие долга` — partial or full.

There is NO current generic ordinary `Доплата`. `Доплата при обмене` remains distinct (`exchange_extra`).

Branch2 product commits:
- `1c26ecff52168c7b3a86230cd1502d53cd67d456` — main F5 semantics;
- `f37137fed1f50f065c4e4e3fc8123153c55678fe` — adjacent legacy debt aggregation fix.
Final F5 Branch2 Cloudflare run: `32866082942` — SUCCESS.

Permanent gates/manifests:
- `scripts/test-finance-f5-entry-semantics.mjs`
- `scripts/test-finance-f5-adjacent-regression.mjs`
- `scripts/finance-f5-business-semantics-worker-manifest.json`

Important F5 corrections:
- stale ordinary-extra write rejected server-side;
- dedicated debt-close and editor debt-close share `/api/payments` and idempotency;
- forgotten primary is anchored to order business date; later money is debt close;
- generic order editing cannot rewrite persisted payment history;
- historical ordinary `extra` is preserved and shown as `Закрытие долга (старый тип)`;
- legacy ordinary extra is counted exactly once under debt-close semantics, not double-counted by frontend;
- obsolete current `Доплаты заказов` daily bucket/column removed.

## F6 — broad Finance self-check / release hardening — COMPLETE on Branch2

Final Branch2 squash: `3404604c744723cb7abe09bd9ebcd529c15e8727` — `Finance F6 release hardening`.
Branch2 Cloudflare deploy run: `32879336620` — SUCCESS.
Latest isolated full verification before merge: workflow `32879065294` — SUCCESS.
No D1 mutation/migration/repair and no Arrival change.

### Real defect: deleted order could diverge between cash and immutable money history

Audit found a real cross-ledger defect: logical order deletion caused the cash-register trigger to compensate payments, while immutable `financial_events` could remain without an explicit `payment_reversal`. Cash and money history could therefore disagree.

Fixed semantics:
- logical deletion preserves original `payments` rows as historical facts;
- deletion appends idempotent `payment_reversal` events with `reason=order_delete`;
- stale clients cannot reinterpret deletion as a rewrite of the whole payment collection;
- cash keeps its separate source-keyed `order-cancel:*` compensation path;
- retry/lost-response cannot duplicate reversal evidence.

Permanent manifest: `scripts/finance-f6-delete-money-history-worker-manifest.json`.

### Adjacent strict-report defects found and fixed

The F6 adjacent audit also found misleading/incomplete report behavior:
- product report said orders were “created” in the period although the cohort is business `order_date`;
- product report mixed an operation-date return total into an order-date product cohort;
- aggregate city report rendered `Клиентов` / `Менеджеров` as `—` rather than real data;
- payment-report empty-state wording incorrectly referred to “selected orders” instead of selected operation period.

Fixed:
- wording now distinguishes business order date from recorded-at semantics;
- cross-cohort return metric removed from product report;
- city aggregate calculates `COUNT(DISTINCT customer_id)` and `COUNT(DISTINCT manager_id)` and renders real counts;
- strict report labels explicitly state their actual cohort/date semantics.

Permanent manifest: `scripts/finance-f6-report-semantics-worker-manifest.json`.

### Dead misleading metrics removed

Read-only audit proved `collectionRate` and `returnRate` were unused except API/type declarations. They divided operation-date received/returns by order-date sales, so they did not describe one coherent cohort and could produce misleading percentages. Both fields were removed from backend and frontend contract and permanently regression-guarded.

Permanent manifest: `scripts/finance-f6-dead-metrics-worker-manifest.json`.

### Permanent F6 release gate

`scripts/test-finance-f6-release-audit.mjs` is wired into `scripts/release-check.mjs` and covers:
- selected-period traceability and cross-date bridge;
- no current ordinary generic extra;
- exchange-extra isolation;
- legacy ordinary extra exactly once under debt-close semantics;
- payment kind/method/manager arithmetic reconciliation;
- returns, refunds and reversal evidence;
- shared/idempotent debt-close paths;
- logical-delete payment reversal + preserved payment history;
- cash source-key idempotency and activation boundary;
- mobile audit/drilldown availability;
- synthetic SQLite accounting fixture;
- absence of mixed-cohort dead rates.

F6 passed the complete project release gate, including F2–F6, all retained 189/190/191/192 regressions, DB safety, TypeScript, production Vite build, bundle budget, Wrangler dry-run against Branch2 binding, and stocktake functional acceptance.

## Current Finance truth model

Do NOT treat every different date as an error.
- sales/order/product cohorts use business order date where stated;
- cash/payment/refund cohorts use actual operation date where stated;
- primary same-day is normal;
- primary before order is review;
- proven backdated order entered later may be explained historical info;
- debt close after order is a normal explicit debt closure;
- legacy ordinary `order_extra` is old debt-close semantics, exactly once;
- `exchange_extra` remains separate;
- returns/refunds use operation date;
- corrections/reversals are separate immutable evidence and never erase original history.

## F7 — exact Production promotion — NEXT

Current `main` last observed: `9384a53d1b2247d11fbf0da7e3b8f11a4166d367`.
`main` and `branch2` are substantially diverged. Direct branch merge/fast-forward is forbidden for F7.

Required procedure:
1. start a fresh promotion branch from the then-current `main`;
2. verify whether F1/date-sync is already present in main before applying anything;
3. inspect the exact final Finance F2–F6 commits and apply only their functional/test/manifest deltas, not temporary runner/helper commits and not unrelated Branch2 files;
4. fail closed on conflicts — never auto-resolve shared files with `theirs`;
5. regenerate/adapt Worker declaration manifests if main declaration baselines differ; do not blindly transplant Branch2 hashes;
6. run full `npm run release:check` against the exact main-based tree;
7. review final diff to ensure no Warehouse/Arrival/D1/config drift;
8. promote only reviewed Finance diff to `main`;
9. wait for Production Cloudflare SUCCESS;
10. perform final read-only Finance acceptance and update this file on both branches.

## Exact next action

Begin F7 read-only construction now. First compare the final F1–F6 Finance patches against current `main` and identify conflicts/baseline differences. Then create a fresh main-based promotion branch and apply only compatible reviewed Finance deltas. Do not mutate Production/D1 during construction.

## Warehouse resume point

Finance currently has priority. Warehouse is unchanged. After Finance is fully promoted and accepted in Production, resume `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` at Phase 1A return/exchange disposition audit.
