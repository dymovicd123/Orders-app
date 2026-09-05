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
- The user considers the current performance pass complete after R5.11 unless a future concrete performance problem appears. Do not drift into endless optimization; next work is Warehouse redesign after the user supplies the things they dislike about it.

## Current Production release — R5.11

Current `main` / Production code:

`cdb46e63ed856a7f8e441bbea084b0553f1483d5`

Parent: R5.10 `7da7e555d306d5e7f47f1afecf5a8927d5bfb136`.

Release: PR #15, `R5.11: avoid unused full catalog load on ordinary dashboard refresh`, squash-merged 2026-09-05.

Cloudflare Production deploy:
- monitor run `33954258033`
- job `101274570362`
- result `success`
- Worker `orders-app`
- immutable Worker tag `66404f6fa2ad454998068e7dd7600edb`
- Cloudflare build UUID `a5db592c-2962-478d-99e9-727632a4539f`
- exact release SHA `cdb46e63ed856a7f8e441bbea084b0553f1483d5`
- build `status=stopped`, `outcome=success`

Post-deploy verification:
- run `33954333990`
- job `101274773698`
- result `success`
- checked exact `main` release SHA
- checked exact Cloudflare build UUID, branch `main`, release SHA, stopped/success outcome
- focused R5.11 regression passed
- DB safety passed
- TypeScript passed

R5.11 has no Worker/D1 SQL change and no migration. Arrival UI was not touched. Stock, reserves, payment, return, exchange, shipping, issuing and Workshop business semantics were not changed.

Exact release diff from R5.10 is four files:
- `src/App.tsx`
- `package.json`
- `scripts/test-d1-read-budget-r5-11.mjs`
- `scripts/test-d1-read-budget-r4.mjs`

Temporary R5.11 ops branches were reset to the clean release SHA after verification:
- `ops/r5-11-full-validation-20260905`
- `ops/r5-11-short-search-profile-20260905`
- `ops/r5-11-postdeploy-verify-20260905`

The validated pre-squash safe branch may remain for audit history: `safe/d1-read-budget-r5-11-lazy-catalog-20260905`.

Branch2 remains out of scope and was not intentionally changed by R5.11. Last known exact Branch2 SHA remains `adec6098777bebe4709615e1256cc5dd468b444d` unless separately reverified.

## R5.11 — final clean read-budget win

### Problem

`loadDashboard()` unconditionally refreshed both reference dictionaries and the full catalog, so a fresh ordinary Orders list/overview session paid for all catalog variants even when that screen did not need product picking.

Production SELECT-only measurement of one full catalog fetch:
- products: `70 rows_read` / 68 rows
- variants: `1226 rows_read` / 1226 rows
- product aliases: `14 rows_read` / 6 rows
- value aliases: `8 rows_read` / 4 rows
- total: **`1318 rows_read`**

### Implementation

The generic dashboard/list refresh now keeps `loadReferencesData(...)` but does not call `loadCatalogData(...)`.

Full catalog loading remains explicit for product-aware screens:
- Orders: create, edit, exchange
- Warehouse: movement, stocktake, catalog

Exchange was explicitly added to the Orders catalog-loading gate because `applyExchangeProductPick()` is catalog-backed. This prevents a performance optimization from silently degrading the exchange picker.

The saving is primarily a cold/fresh-session and forced-refresh saving; frontend caching means it should not be described as 1318 rows saved on every filter click.

### Validation

First validation run `33954061589`, job `101274036490`, failed safely only because the old R4 static regression expected the exact historical create/edit-only condition. The app behavior itself was intentional. The R4 gate was updated cumulatively to require the new exact product-aware create/edit/exchange condition; no old invariant was removed.

Final validation:
- run `33954130678`
- job `101274225375`
- result `success`

Passed:
- focused R5.11 regression
- full cumulative `npm run release:check`
- DB safety
- TypeScript
- production build
- lint
- Wrangler deploy dry-run

Known unrelated CI warnings remain: npm reports 6 dependency vulnerabilities (4 moderate, 2 high), and GitHub Actions reports Node action deprecation warnings.

## R5.11 candidates deliberately rejected

The final optimization pass also tested several plausible changes against live Production data and rejected them when they were worse or too small to justify semantic risk.

### Short order search rewrites — rejected

SELECT-only run `33952785829`, job `101270544376`, success. Exact result equivalence passed, but the set-based candidate was substantially worse for representative 1–2 character searches:
- `А`: current full `3893`, candidate `14014`; current page `301`, candidate `14014`
- `СА`: `7360 -> 11609`; page `619 -> 11609`
- `46`: `9549 -> 10007`; page `2631 -> 10007`
- `77`: `7842 -> 11176`; page `1340 -> 11176`
- `O` / `OR`: `3878 -> 14014`; page `301 -> 14014`

A page+summary window candidate was also worse for most probes; only `46` improved (`13226 -> 11535`, ~12.8%), not enough for a mode-specific rewrite.

Decision: preserve the current short-search path.

### Warehouse Attention rewrites — rejected for now

Measured ordinary Attention components:
- summary: `2645 rows_read`
- compact handover flags: `1235 rows_read`
- combined ordinary full Attention load: about `3880 rows_read`

Summary split:
- catalog: `1492`
- shortage/reserve: `954`
- intake: `197`
- lifecycle total: `2`
- stocktake: `0`

Cached `inventory_stock.reserved_quantity` shortage candidate returned the exact same 8 problem keys and current Production had 0 cache-vs-active-reservation mismatches, but cost only improved `954 -> 897` (57 rows). Rejected because the saving is not worth changing the source used by Warehouse truth logic.

Catalog-attention alternatives were exact but worse or neutral:
- operational-first rewrite `1492 -> 2067`
- recency rewrite `1492 -> 1492`

Handover raw timestamp ordering was proven safe on current ISO-Z Production timestamps and exact-equivalent for 16 rows / 15 review-needed, but only improved `1235 -> 1178` (57 rows, ~4.6%). Rejected as a micro-optimization in high-risk physical-truth logic.

This is an intentional stopping point: do not keep chipping at Warehouse Attention merely for small D1 savings. Future changes there should be driven by the Warehouse functional redesign and then measured as part of that work.

## Previous Production release — R5.10

R5.10 release SHA:
`7da7e555d306d5e7f47f1afecf5a8927d5bfb136`

Release: PR #14, `R5.10: reduce Workshop variant enrichment reads`, squash-merged 2026-09-05.

Cloudflare Production deploy:
- monitor run `33952346035`
- job `101269367145`
- result `success`
- Worker `orders-app`
- immutable Worker tag `66404f6fa2ad454998068e7dd7600edb`
- Cloudflare build UUID `8791b8a9-2699-4251-8c9c-3abd0b27d69a`

R5.10 has no D1 migration. Arrival UI was not touched. Stock, reserves, payment, return, issuing and Workshop status business semantics were not changed.

## R5.10 — Workshop read optimization

`enrichWorkshopTaskRowsFromOrderItems` used a correlated `catalog_variants` fallback per linked Workshop item. For `directItemIds.length >= 20`, large Workshop enrichment now resolves historical variant-less rows set-wise while preserving the legacy fallback priority `is_active DESC, sort_order ASC, id ASC` and color/size matching semantics. Small flows retain the exact legacy correlated SQL.

Exact SELECT-only proof on 80 live Workshop items:
- legacy correlated fallback: `2967 rows_read`
- set-based resolver: `1035 rows_read`
- saving: `1932 rows_read`
- reduction: about `65.1%`
- complete result equivalence passed

Initial proof run: `33951270314`, job `101266442409`, success.

Final validation:
- run `33952261760`
- job `101269138538`
- result `success`

Post-deploy verification:
- run `33952451906`
- job `101269652295`
- result `success`
- fresh post-deploy control remained `2967 -> 1035 rows_read`

## 2026-09-05 Workshop backlog incident — inherited context

PR #13, main predecessor `a008abf1d875fa19d0b60e0091b7c364a2536529`, fixed an operational visibility bug where old Workshop tasks could disappear when the UI defaulted to the current month. `Готовые` now opens newest-first, active backlog remains discoverable across dates, and invoice stays bounded.

The exact Asem/Saida task was restored through normal Worker business API, not direct D1 mutation. The incident also established that legacy `order_items.source_type='warehouse'` is not evidence of conversion out of Workshop: Workshop identity is represented by `is_workshop=1` plus Workshop task/stock status because the old schema constrains `source_type` to warehouse/boutique.

Do not reintroduce month-boundary hiding or rewrite Workshop `source_type` during ready/restore operations.

## R5.9 — Orders pagination

R5.9 introduced internal `(order_date,id)` seek pagination for sequential Next navigation while preserving visible page/offset semantics and legacy API defaults. Later page-only navigation can reuse exact page-1 periodStats and request count-only metadata.

Measured active-August proof:
- page 2: `600 -> 313 rows_read` (-47.8%)
- page 3: `893 -> 297` (-66.7%)
- page 4: `1192 -> 312` (-73.8%)
- page 5: `1288 -> 106` (-91.8%)
- repeated period summary: `2423 -> 447 rows_read` (-81.6%)
- exact order count: 432
- keyset page external_id sequences exactly matched OFFSET baseline

Remaining low-severity R5.9 cleanup candidates:
1. Worker may return `periodStats: null` for `includePeriodStats=0` while the shared TypeScript contract is less explicit about null.
2. Very fast Next during the filter debounce window can temporarily combine an old cursor/summary with newly edited filters until page-1 reload; preferred fix is an applied-filter fingerprint or immediate reuse invalidation.
3. Concurrent writes can make page rows and freshly counted metadata describe slightly different snapshots; treat as multi-user consistency risk, not confirmed Production failure.

Do not reopen these merely to continue optimization; handle them only if they become relevant to a concrete functional bug or future work.

## R5.8 / R5.7 inherited performance work

R5.8 reduced the default Finance workspace for 2026-09-01..2026-09-04 from `901 -> 673 rows_read` by deriving payment-method and payment-by-day aggregates from already-loaded payment operation rows. Current-month Finance queries were rechecked during R5.10 profiling and were no longer the leading read hotspot.

R5.7 reduced ordinary active/no-date Orders Summary fallback from `9542 -> 3802 rows_read` (~60.15%). It reuses `orders.received_amount` only inside its proven active/no-date boundary. Date-filtered, archive/non-active and legacy callers retain exact payment aggregation semantics.

## Interpreting current Cloudflare rows-read totals

The unusually low 2026-09-05 total is a combination of real optimizations and lower/partial-day usage. Do not attribute the entire low daily number to optimization.

Prior observed daily totals around this period were roughly:
- Sep 1: 12.6M
- Sep 2: 5.0M
- Sep 3: 3.46M
- Sep 4: 5.04M
- Sep 5 was still a partial day during the conversation

Use identical-query before/after measurements to prove optimization effects rather than aggregate dashboard totals alone.

## Next functional point — Warehouse redesign

The performance pass is deliberately closed with R5.11. Do **not** invent R5.12 optimization work simply because more SQL can theoretically be tuned.

The user plans to send a detailed list of what currently bothers them about Warehouse. Once received:
- first capture all complaints/requirements without prematurely patching one screen;
- audit the related Warehouse flows end-to-end: overview, Attention, movement, stocktake/revision, catalog, reservations, handover/issuing, returns from Workshop, order save/shortage interaction, manager/admin permissions, small-screen UX and D1 cost;
- separate usability problems from physical-truth/business-rule problems;
- preserve the existing physical/reservation truth unless there is a clearly justified redesign;
- produce a coherent change plan, then implement in bounded steps;
- Arrival remains frozen.

Known Warehouse direction from prior work that still matters:
- managers should be able to operate Warehouse without permanent admin intervention;
- interface should be simple and task-oriented, not a technical state dump;
- unknown product/attribute cases require controlled review, while known valid return/intake cases should be as automatic as safely possible;
- stale pre-revision facts must not silently overwrite fresher physical truth;
- different problem classes in Attention should remain visually separated;
- distinguish “in orders but not in stock” from unresolved catalog/intake questions;
- show useful order context for affected items;
- movement/variant selection has historically been overloaded and hard to search;
- catalog presentation still has cleanup/UX debt;
- do not overcomplicate the model merely to reconstruct where an item might have been historically.

## Inherited safety / business invariants

- Arrival UI remains frozen.
- Critical save: order + items + reserves + Workshop tasks are critical; audit/history/re-read/extras must not turn committed success into failure.
- Workshop items are excluded from normal Warehouse shortage checks.
- Partial shipping is not used; operational model is all-or-nothing.
- Preserve payment-date vs order-date financial semantics.
- Keep D1 read fan-out bounded and mutations bounded.
- Preserve <=6 parallel read calls and <=100 bind/query parameters where applicable.
- Small Production D1 SQL should use `wrangler d1 execute --command`, not file-import.
- Branch2 is out of scope unless explicitly requested.
