# Finance — current canonical context

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`
Status: **F1–F7 COMPLETE IN PRODUCTION; F8 COMPLETE ON BRANCH2, PRODUCTION PROMOTION NEXT.**

Production Finance F1–F7 product commit: `c59021021a02c6609938539aba4ba6d184cb4060`
Production F1–F7 Cloudflare deploy: `32880477956` — SUCCESS
Production F1–F7 GET-only acceptance: `32880805303` — SUCCESS
Finance F8 Branch2 commit: `af9582aaa7f57d040288fb8323bbd89a66b3de6a`
Finance F8 Branch2 Cloudflare deploy: `32885224931` — SUCCESS

This file is the canonical Finance resume point and supersedes older Finance roadmap wording where it conflicts.

## Safety / release rules

- `Приход` is frozen and Finance work must not change it.
- Git deploys must never auto-run D1 migrations/repair.
- Do not rewrite historical money facts to make unlike totals appear equal.
- Historical baseline/legacy ambiguity is shown only when the user explicitly selects an old period.
- `branch2` is staging; `main` is Production.
- Because `main` and `branch2` can diverge, promote only the exact reviewed Finance delta, never the whole Branch2 tree.

## Authoritative Finance semantics

### Date cohorts

- Sales/orders/products use **business order date** where stated.
- Incoming payments use **payment operation date**.
- Refunds use **refund operation date**.
- Different order/payment dates are not automatically an error.
- A debt close after the order date is a normal business operation.
- A proven backdated order entered later is informational trace, not arithmetic corruption.
- Primary payment before order date is review-worthy.
- For NEW orders after F1, primary payment is server-anchored to selected `orderDate`; a new supported create path cannot accidentally retain the physical entry date as primary payment date.

### Ordinary order payment types

Only:
1. `Первичная оплата`;
2. `Закрытие долга` — partial or full.

There is no current generic ordinary `Доплата`. `Доплата при обмене` is separate `exchange_extra`.
Historical ordinary `order_extra` is preserved as evidence, labelled `Закрытие долга (старый тип)`, and counted exactly once under debt-close semantics.

## F1 — forensic + late-order primary-date guard — COMPLETE / PRODUCTION

24-Aug forensic established:
- 14 orders with business date 24 Aug;
- sales **1,007,800 KZT**;
- received on those orders **967,800 KZT**;
- period debt **40,000 KZT** on `ORD-20260824121101-FA3AE6E6`;
- actual payments received 24 Aug **1,080,300 KZT**.

Cross-date contributors:
- `ORD-20260824110308-E2CE748F` — business date 22 Aug, primary 45,000 on 24 Aug;
- `ORD-20260824083328-9B614DAD` — business date 21 Aug, primary 45,000 on 24 Aug;
- `ORD-20260816074322-2445` — genuine debt close 22,500 on 24 Aug.

The two 45,000 rows were orders physically entered on 24 Aug with earlier business order dates. Root cause was the create form keeping today's initial payment date after `orderDate` was backdated. Fixed frontend + server-side: new-order primary payment follows selected order date. Existing historical data is not rewritten.

## F2 — selected-period traceability — COMPLETE / PRODUCTION

Permanent gate: `scripts/test-finance-f2-trace.mjs`.
Finance exposes order business/recorded timestamps, operation business/recorded timestamps, date relation/offset, immutable-event lineage/backfill status, trace code/severity/explanation and cross-date bridge data.
Return/exchange dates are explicit; missing dates are not silently replaced with order date. Cash first-activation boundary is preserved on future pause/resume.

## F3 — summary/day trace UX — COMPLETE / PRODUCTION

Permanent gate: `scripts/test-finance-f3-summary-ux.mjs`.
Current month is default. Historical baseline is opt-in through an explicitly older range. False blanket `Даты согласованы` logic was removed. Cross-date operations explain differences between order-date sales and operation-date cash.

## F4 — auditable money journal — COMPLETE / PRODUCTION

Permanent gate: `scripts/test-finance-f4-money-journal.mjs`.
`/api/finance/money-history` provides bounded/filterable immutable history, timestamps, lineage, trace state and direct order/history drilldowns. Mobile layout is covered.

## F5 — entry semantics — COMPLETE / PRODUCTION

Permanent gates:
- `scripts/test-finance-f5-entry-semantics.mjs`
- `scripts/test-finance-f5-adjacent-regression.mjs`

Important fixes:
- stale ordinary `extra` writes rejected server-side;
- editor and dedicated debt-close actions share `/api/payments` + critical-operation idempotency;
- forgotten primary is anchored to order business date; later money is debt close;
- generic order editing cannot rewrite complete persisted payment history;
- exchange extra stays isolated;
- legacy ordinary extra is counted exactly once as old debt-close semantics.

## F6 — broad self-check / adjacent defect audit — COMPLETE / PRODUCTION

Permanent gate: `scripts/test-finance-f6-release-audit.mjs`.

Real defects fixed during F6:
- logical order deletion could compensate cash while immutable money history lacked `payment_reversal`; now original payments stay as facts and idempotent `payment_reversal(reason=order_delete)` evidence is appended;
- strict product report confused business order date with record-creation wording;
- operation-date return total was mixed into an order-date product cohort;
- city aggregate displayed fake `—` client/manager cells instead of real distinct counts;
- misleading unused mixed-cohort `collectionRate` / `returnRate` were removed.

F6 gate reconciles payment operations vs methods vs kinds, current/legacy operation semantics, return/reversal evidence, debt-close paths, deletion reversals, cash source-key idempotency and mobile drilldowns.

## F7 — exact Production promotion — COMPLETE

F1–F6 were assembled on a fresh branch from then-current `main`, not by merging Branch2 wholesale. Main-based dry verification `32880117064` and persisted candidate verification `32880289305` both succeeded. Production squash commit: `c59021021a02c6609938539aba4ba6d184cb4060`. Matching Cloudflare run `32880477956` succeeded.

GET-only Production acceptance `32880805303` confirmed 24-Aug truth:
- sales 1,007,800;
- period debt 40,000;
- gross received 1,080,300;
- cross-date operations 3 / 112,500;
- ledger = methods = kinds = 1,080,300; difference 0;
- money journal 18 events / net 1,080,300;
- city client/manager counts present;
- dead mixed-cohort rates absent.

## F8 — unified reconciliation / neutral date semantics — COMPLETE ON BRANCH2

User visual acceptance found a presentation contradiction: the page said `Сверка сошлась` in a green block while a separate yellow panel immediately below showed ordinary cross-date operations such as debt closures. Arithmetic was correct, but visual hierarchy implied that normal date differences were problems.

Implemented Finance-only F8:
- arithmetic reconciliation and cross-date explanation are now one `Финансовая сверка` block;
- arithmetic status remains explicit as `Суммы сошлись` / actual difference;
- the same block shows neutral date context (`По датам: N операций`) and review count separately;
- the former yellow `Почему поступления и продажи периода могут отличаться` panel was removed; its exact-order table is embedded under `Операции по заказам другой даты`;
- text explicitly states that a cross-date operation is not a discrepancy by itself and that debt closure is ordinary;
- `Проверка дат и ввода` is blue/neutral when it contains only explanations and yellow only when `paymentTraceReview.length > 0`;
- `Закрытие долга` operation badge changed from warning-yellow to neutral gray;
- F3 and F6 regression gates were updated to enforce the new semantic presentation while preserving arithmetic reconciliation.

Verification:
- isolated final full release gate run `32884784520` — SUCCESS;
- cleaned feature diff contained exactly 4 files: Finance renderer, Finance CSS, F3 UX gate, F6 release gate;
- no migration, Warehouse or Arrival delta;
- squash to `branch2`: `af9582aaa7f57d040288fb8323bbd89a66b3de6a`;
- matching Branch2 Cloudflare deploy `32885224931` — SUCCESS.

## Exact next action

Promote F8 only to current Production `main` (last observed before promotion: `eb3b41b5c762f0368913ea47482550477b513aee`). Use a fresh main-based promotion branch. Apply only the exact four-file F8 delta, run the full `npm run release:check`, assert no migrations/Arrival/unrelated files, then squash to `main` and wait for matching Production Cloudflare SUCCESS. No D1 mutation is required.

After F8 Production deployment, user will visually verify the Finance page. Then resume Warehouse from `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md`, Phase 1A read-only return/exchange disposition audit.
