# Orders-app — current project continuation context

Updated: 2026-09-05
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
- D1 reads were near the daily limit on 2026-09-04. Avoid broad Production forensics unless needed; exact PK/indexed checks are acceptable for an operational incident when they materially improve safety.

## Current Production code

Current `main` / Production code is:

`a008abf1d875fa19d0b60e0091b7c364a2536529`

This is PR #13, `Fix Workshop backlog visibility and restore flow`, squash-merged after the Asem Workshop incident.

Cloudflare deploy monitor:
- run `33950107977`
- job `101263149804`
- result `success`
- Worker `orders-app`
- immutable Worker tag `66404f6fa2ad454998068e7dd7600edb`
- Cloudflare build UUID `b815ab12-b7b4-4453-ba36-a8cad762d5bb`
- exact build status `stopped`, outcome `success`

PR #13 has no D1 migration and no Worker declaration/body change. Exact main diff from the prior tree is five files only:
- `package.json`
- `scripts/test-workshop-backlog-visibility-r1.mjs`
- `src/App.tsx`
- `src/app/types.ts`
- `src/features/sections/WorkshopSection.tsx`

Arrival UI was not touched. Branch2 remains:

`adec6098777bebe4709615e1256cc5dd468b444d`

Historical note: R5.9 release tree was introduced by PR #12 at `6985093f7ee377b7d52b8716184b26f4fd6a1ac6`. Later, an accidental temporary root file `noop` produced two no-op main history commits (`6c6bdffd...`, `d9b17803...`) with zero net changed files. Do not rewrite main merely to remove those history commits.

## 2026-09-05 Workshop incident — Asem / Saida / 31.08

User reported a Workshop item accidentally marked `Готово`, then staff could not find it to return it to active. Identifying data supplied by user: manager Саида, customer Асем, phone +7 777 696 0065, order date 31.08.

A deliberately narrow Production forensic used one SELECT-only workflow:
- run `33949512112`
- job `101261502354`
- 54 rows_read total
- rows_written=0, changed_db=false

Exact Production object found:
- order id `1269`
- external id `ORD-20260831114645-9B02389A`
- order date `2026-08-31`
- manager `САИДА`
- phone_normalized `87776960065`
- order status `active`
- shipping status `not_sent`
- before repair workshop_status `ready`

Exact order item:
- item id `3165`
- product `БАЯН СҰЛУ ШАПАН`
- gender `ЖЕН`
- color `СВЕТЛО-БЕЖЕВЫЙ`
- material `КАШЕМИР`
- length `СТАНДАРТ`
- size `46`
- quantity `1`
- `source_type='warehouse'`
- `is_workshop=1`
- `stock_writeoff_status='workshop'`

Exact Workshop task:
- task id `1800`
- order_item_id `3165`
- status before repair `done`
- urgent `1`
- due date `2026-09-03`
- comment `оюы тұмар болу керек`
- mistaken ready action recorded at `2026-09-05T05:22:52Z`

### Root cause

The user suspected `Готово`/`Вернуть` had changed the item source from Workshop to Warehouse. Current data and code show that did **not** happen in this incident.

The schema has a legacy dual representation:
- `order_items.source_type` is constrained to only `warehouse|boutique` by the original schema;
- Workshop identity is canonicalized by `is_workshop=1` plus Workshop task/stock status;
- `orders-write.ts` intentionally stores `source_type='warehouse'` for Workshop order items because the column cannot store `workshop`;
- API/UI maps an item with `is_workshop=1` back to Workshop semantics;
- current `updateWorkshopTask` changes task status and can repair `is_workshop/stock_writeoff_status`, but does not write `source_type`.

Therefore `source_type='warehouse'` on item 3165 is not evidence of conversion. A new regression now explicitly forbids Workshop ready/restore logic from rewriting `source_type`.

The actual bug was visibility across the month boundary:
- Workshop UI defaulted to current month (September);
- the order belongs to 31 August;
- the same date range was applied to Active and Done queues;
- after task 1800 was marked done, it disappeared from September Done;
- simply restoring it to active would also have left an August task invisible in September Active.

### Production repair of the exact task

Task 1800 was restored through the normal Worker business API, not direct D1 mutation:

`PATCH /api/workshop/1800`

with `status=active` and exact `orderItemId=3165`.

Repair workflow:
- run `33950242034`
- job `101263515811`
- result `success`

Safety guard before mutation was an exact indexed read costing **2 rows_read** and confirmed task 1800 was still `done`, linked to order 1269 / item 3165.

Business API returned:
- `ok=true`
- `changed=true`
- task 1800 status `active`
- `previousStatus='done'`
- preservedOrderItemId `3165`

Post-repair exact verification cost **3 rows_read** and confirmed:
- task 1800 `active`
- order 1269 `workshop_status='in_workshop'`
- item 3165 `is_workshop=1`
- item 3165 `stock_writeoff_status='workshop'`
- legacy `source_type='warehouse'` unchanged, as intended by schema

The temporary repair and forensic branches were reset to clean main after use so one-shot workflow files are not left at their tips.

### PR #13 behavior

Workshop operational queue now defaults to all dates rather than current month. UI adds explicit `Все` period option. Switching Active/Urgent/Done no longer silently forces an empty/all-date range back to current month. `Готовые` switches to newest-first so an accidental `Готово` is easy to find and undo. Active/Urgent remain oldest-first to preserve backlog priority. Invoice is the only view that converts all/empty dates to a bounded current-month range, preventing oversized invoice loads.

Validation before merge:
- run `33949904503`
- job `101262579416`
- result `success`
- focused Workshop regression passed
- `npm run release:check` passed
- `npm run verify:db-safety` passed
- `npm run typecheck` passed
- `npm run build` passed
- `npm run lint` passed

Two earlier candidate validation attempts failed safely before commit and revealed guard issues, not runtime bugs: one attempted Worker-body change violated Step1906A hash gate, so Worker change was removed; one exceeded the App controller line budget by two lines, so the frontend change was compacted. Final candidate passed all gates.

## R5.9 performance result

For active August orders `2026-08-01..2026-08-31`, final pre-release SELECT-only proof showed:
- page 2: 600 -> 313 rows_read (-47.8%)
- page 3: 893 -> 297 (-66.7%)
- page 4: 1,192 -> 312 (-73.8%)
- page 5: 1,288 -> 106 (-91.8%)
- repeated period summary: 2,423 -> 447 rows_read (-81.6%)
- exact order count: 432
- keyset page external_id sequences exactly matched OFFSET baseline.

R5.9 uses an internal `(order_date,id)` seek cursor only for sequential Next navigation while keeping visible offset/page semantics. Later page-only navigation can reuse exact page-1 periodStats and request count-only metadata. Legacy/direct API callers retain full periodStats by default.

## R5.8 / R5.7 inherited optimizations

R5.8 Finance default workspace `2026-09-01..2026-09-04` was reduced 901 -> 673 rows_read by deriving payment-method and payment-by-day aggregates from already-loaded payment operation rows.

R5.7 Orders Summary reuses `orders.received_amount` only inside its proven active/no-date boundary. Date-filtered, archive/non-active and legacy callers retain the exact payments query.

## Code-only post-R5.9 audit — 2026-09-04

Audit run `33896192244` / job `101099283468` succeeded with no Production D1 access. Typecheck, build, lint, R5.7/R5.8/R5.9 regressions, Worker declaration gate, frontend modularization, type/API boundary, runtime SQL syntax and DB-safety all passed.

### Remaining low-severity R5.9 issues for later

1. `worker/domains/orders-read.ts` can intentionally return `periodStats: null` for `includePeriodStats=0`, while `src/app/types.ts` still declares `periodStats?: OrderPeriodStats` rather than `OrderPeriodStats | null`. Current runtime is safe but the type contract is inaccurate.
2. A very fast Next click inside the filter debounce window can combine an old page cursor/summary with newly edited filters until the scheduled page-1 reload corrects it. Preferred future fix: bind page reuse to an applied-filter fingerprint or invalidate reuse immediately on filter change.
3. Concurrent writes between keyset page loads can make page rows and freshly counted total metadata describe slightly different snapshots. Treat as a multi-user consistency risk, not a confirmed Production failure.

## Next action

The Asem Workshop incident is repaired and PR #13 is live. Do not run more broad Production profiling just for this incident.

Next normal technical work can return to the narrow R5.9 contract/filter-pagination cleanup, then after D1 budget is comfortable run a fresh measured profile before choosing any R5.10 optimization target.

## Inherited safety / business invariants

- Arrival UI remains frozen.
- Critical save: order + items + reserves + Workshop tasks are critical; audit/history/re-read/extras must not turn committed success into failure.
- Workshop items are excluded from normal Warehouse shortage checks.
- Partial shipping is not used; operational model is all-or-nothing.
- Preserve payment-date vs order-date financial semantics.
- Keep D1 read fan-out bounded and mutations bounded.
- Small Production D1 SQL should use `wrangler d1 execute --command`, not file-import.
- Branch2 is out of scope unless explicitly requested.
