# Finance — current canonical context

Updated: 2026-08-25
Repository: `dymovicd123/Orders-app`
Active branch: `branch2`
Current verified Finance product commit before this context-only update: `f37137fed1f50f065c4e4e3fc8123153c55678fe`
Branch2 Cloudflare run for that product commit: `32866082942` — SUCCESS
Production/main: Finance F2–F5 are NOT yet promoted as one reviewed Finance release.
Status: F1–F5 COMPLETE on Branch2; F6 broad Finance regression/release audit is NEXT. Warehouse remains paused and unchanged.

This file is the canonical Finance resume point. It supersedes older Finance plan wording where this file conflicts. After every meaningful Finance audit/fix/gate/deploy/promotion, update this file.

## User goal

Finance must be self-explanatory and self-auditing. A normal user must be able to open a headline number or suspicious date and reach the exact order/money operation that produced it, without contacting the project owner. Do not force totals to look equal: preserve business truth and explain why values differ.

## Frozen safety rules

- `Приход` is frozen; Finance work must not change Arrival UI or behavior.
- No D1 mutation, migration or repair merely to make Finance totals look cleaner.
- Historical money facts are preserved; ambiguous legacy semantics are labelled, not guessed or rewritten.
- Push/deploy must never auto-apply D1 migrations/repair.
- `branch2` is staging/technical acceptance; `main` is Production.
- `main` and `branch2` are materially diverged. F7 must promote only the exact reviewed Finance diff onto current `main`; never replace `main` with the whole Branch2 tree.

## F1 — read-only forensic audit — COMPLETE

The 24-Aug discrepancy was explained without Production mutation.

Orders with business `order_date=2026-08-24`:
- 14 active/non-deleted orders;
- sales 1,007,800 KZT;
- received on those orders 967,800 KZT;
- 40,000 KZT unpaid on `ORD-20260824121101-FA3AE6E6`.

Cash received on 24 Aug totalled 1,080,300 KZT because it also included two 45,000 KZT primary payments on backdated orders physically entered on 24 Aug plus a genuine 22,500 KZT debt close. Payment-method, ledger and operation arithmetic reconciled.

Root cause found: a new-order draft could change `orderDate` while its first primary payment kept the physical entry date. The frontend and server now enforce for NEW orders: initial `primary.paymentDate = orderDate`. Existing historical payments are not normalized retroactively.

Verified Branch2 guard product commit: `104a9dffee5b8a044df65e8a1c03958d3bd20eef`; Branch2 deploy was SUCCESS.

## F2 — selected-period traceability / backend contract — COMPLETE

Verified feature commit: `7e3a8e5b355d07c3ad567adcb9ec5074d1cc7fd6` — `Add selected-period Finance traceability [finance-f2-patched]`.
Clean feature branch head after temporary runner cleanup: `c782a28bdb4654173ae8fe6c0be3b4a93efd2e41`.

Implemented and permanently regression-tested:
- payment-operation lineage includes order recorded time, immutable financial-event lineage/backfill state and derived trace classification;
- cross-date selected-period bridge exposes money whose operation date and order date differ;
- return and exchange now require explicit business date instead of silently falling back to order date;
- first cash activation boundary is preserved when auto-tracking is resumed;
- legacy baseline is identified as historical reconstruction rather than exact original user action.

Permanent gate: `scripts/test-finance-f2-trace.mjs`.
Worker hash evidence: `scripts/finance-f2-trace-worker-manifest.json`.

## F3 — Summary/day Finance UX — COMPLETE

Verified feature commit: `5d74258d25104aab39dbdb1d5e0526159418da0d` — `Add selected-period Finance review UX [finance-f3-patched]`.
Clean feature branch head after temporary runner cleanup: `4bd9bd48bd72b50d4c13e8fa19ccca262c6cdbe4`.

Implemented and permanently regression-tested:
- Finance opens on the current month;
- historical baseline does not pollute the normal current-period view and appears only when an older period is explicitly selected;
- false global green `Даты согласованы` semantics were removed;
- summary/day review uses trace severity rather than only `payment before order`;
- cross-date bridge explains why sales and cash for a selected period can differ;
- neutral `Проверка дат и ввода` workflow replaces misleading global claims.

Permanent gate: `scripts/test-finance-f3-summary-ux.mjs`.

## F4 — auditable money journal — COMPLETE

Verified feature commit: `1b5b9168b8ba174778ae2749ed49118f068375ff` — `Add auditable Finance money journal [finance-f4-patched]`.
Clean feature branch/base after runner cleanup: `415aba8431ccdb40e4e9c1bd66bf4e7989289e20`.

Implemented and permanently regression-tested:
- bounded money-history endpoint with independent flow/operation/trace filters;
- baseline/legacy history is opt-in only when an explicitly older period is selected;
- journal rows expose operation recorded time, order recorded time, source lineage, trace severity and explanation;
- direct `Открыть заказ` and `Денежная история` drill-downs;
- responsive/mobile money-journal presentation;
- Worker declaration delta pinned through `scripts/finance-f4-money-journal-worker-manifest.json`.

Permanent gate: `scripts/test-finance-f4-money-journal.mjs`.

## F5 — payment-entry semantics and prevention — COMPLETE on Branch2

### Authoritative business model

Ordinary order has only:
1. `Первичная оплата`;
2. `Закрытие долга` — partial or full.

There is NO current generic ordinary `Доплата`.
`Доплата при обмене` remains a separate exchange-only operation (`exchange_extra`).

### Implemented semantics

- Order editor exposes only explicit `Первичная оплата` and `Закрытие долга` actions.
- Generic ordinary `extra` is absent from current Finance UI, filters, daily tables and ordinary-order actions.
- A stale client trying to create ordinary `extra` through `/api/payments` is rejected server-side.
- Dedicated `Закрыть долг` and editor `Закрытие долга` use the same `/api/payments` path with `paymentKind='debt_close'`, shared validation, immutable financial events, cash handling and browser/server idempotency.
- Forgotten primary payment is anchored to the order business date on frontend and server. Money actually received later is a debt close.
- Persisted payment rows are immutable in the generic editor; ordinary order PATCH no longer carries/rewrite-all the payment collection.
- Historical ordinary `extra` rows are preserved and represented as `Закрытие долга (старый тип)` rather than deleted/reclassified in storage.
- Exchange extra remains distinct and continues through the exchange workflow.

### F5 verified commits/gates

Feature verified commit: `0f88ec084553e2a4246897191da6b8923912f80d` — `Align debt payments and remove ordinary extras [finance-f5-final]`.
Full feature workflow run: `32858371546` — SUCCESS.
Clean Branch2 squash: `1c26ecff52168c7b3a86230cd1502d53cd67d456`.

Permanent gates:
- `scripts/test-finance-f5-entry-semantics.mjs`
- `scripts/test-finance-f5-adjacent-regression.mjs`
- `scripts/finance-f5-business-semantics-worker-manifest.json`
- exact Finance F5 Worker deltas are chained through Step 190.6A; the global integrity gate was not weakened.

### F5 adjacent audit — two real defects found and fixed

After the first staging deployment, the required adjacent audit found:
1. backend `debtPaymentsTotal` already included legacy `order_extra`, while frontend added legacy ordinary extras a second time, so an old period could overstate the debt-close card;
2. the daily Finance table still exposed an obsolete separate `Доплаты заказов` column/bucket.

Both were fixed:
- no second legacy-extra addition;
- legacy `order_extra` folds exactly once into debt-close daily totals;
- obsolete `orderExtras` UI bucket/column removed;
- permanent F5 adjacent regression now explicitly forbids this double count and the obsolete UI wording.

Adjacent fix verified on isolated branch with workflow run `32865834151` — SUCCESS.
Clean Branch2 adjacent-fix squash: `f37137fed1f50f065c4e4e3fc8123153c55678fe`.
Final Branch2 Cloudflare deploy run: `32866082942` — SUCCESS.

No D1 mutation/migration/repair and no Arrival change were made by F5.

## Current Finance truth model

Do NOT treat every different date as an error. Classification combines operation kind, order business date, operation business date, recorded-at timestamps and immutable lineage.

- primary same-day → normal;
- primary before order → review;
- proven backdated order entered later with its primary payment at entry → explained info/history where applicable;
- future/later primary without proved create-lineage explanation → review;
- legacy baseline ambiguous → explain that original mutation semantics cannot be proven;
- debt_close after order → normal explicit debt closure;
- legacy ordinary `order_extra` → displayed under debt-close old-type semantics, exactly once;
- exchange_extra → distinct normal exchange operation;
- returns/refunds → operation-date facts;
- reversals/corrections → separate immutable evidence; never erase original history.

Every traceable money row should preserve/expose exact order, order date/recorded time, operation date/recorded time, operation kind, amount, method, manager/customer, date relation/offset, event reason/backfill/source lineage, trace state/explanation and drill-down actions.

## F6 — broad Finance self-check / release audit — NEXT

F6 is an audit/gate phase first, not a feature rewrite. Run on `branch2` before any Production promotion.

Required coverage:
- current month remains clean;
- legacy baseline/history appears only after explicitly selecting an older period;
- ordinary generic extra is absent from current UI/report/filter/actions;
- exchange extra remains distinct and visible;
- legacy ordinary `extra` is counted exactly once under debt-close semantics;
- primary-date rules and forgotten-primary anchoring remain enforced;
- both debt-close entry methods use the same server semantics;
- returns, exchanges, cancellation and reversal paths remain consistent;
- cash auto-tracking and immutable journal remain consistent;
- generic order editing cannot destructively rewrite old payment/cash history;
- summary/day/payment-method/manager totals reconcile mathematically from the same selected-period facts;
- cross-date selected-period bridge and trace/drill-down remain consistent;
- mobile/read-through Finance UX does not hide required audit information;
- full `npm run release:check` must pass.

Preferred implementation: add an aggregate permanent `scripts/test-finance-f6-release-audit.mjs`, wire it into `scripts/release-check.mjs`, run the entire gate on an isolated branch, clean temporary tooling, squash only the verified F6 test/gate diff into Branch2, wait for Cloudflare SUCCESS, then update this context again.

## F7 — exact Production promotion — AFTER F6

Current `main` last observed before F6: `9384a53d1b2247d11fbf0da7e3b8f11a4166d367`.
`main` and `branch2` have substantially diverged. Do NOT fast-forward/replace main with Branch2 and do NOT promote unrelated Warehouse/staging commits.

F7 procedure:
1. compute the exact reviewed Finance diff from the Finance baseline/current main;
2. construct/apply only Finance source/tests/manifests needed for F1–F6 onto the then-current `main`;
3. run full release gate against that exact Production tree;
4. deploy main;
5. wait for Production Cloudflare SUCCESS;
6. do final read-only Finance acceptance;
7. update this file on both relevant branches with Production commit/run and closure state.

## Exact next action

Start F6 now from current Branch2 Finance state. First inspect the existing F2–F5 permanent tests and Finance backend/UI contracts, then add the aggregate Finance release-audit gate covering cross-layer reconciliation and the F5 no-extra/no-double-count invariants. No Production mutation and no D1 mutation during F6.

## Warehouse resume point

Finance currently has priority. Warehouse is unchanged. After Finance is complete, resume `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md` at its current Phase 1A return/exchange disposition audit.
