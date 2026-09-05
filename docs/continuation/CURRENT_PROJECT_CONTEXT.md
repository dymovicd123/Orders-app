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

## Current Production release — R5.10

Current `main` / Production code:

`7da7e555d306d5e7f47f1afecf5a8927d5bfb136`

Release: PR #14, `R5.10: reduce Workshop variant enrichment reads`, squash-merged 2026-09-05.

Cloudflare Production deploy:
- monitor run `33952346035`
- job `101269367145`
- result `success`
- Worker `orders-app`
- immutable Worker tag `66404f6fa2ad454998068e7dd7600edb`
- Cloudflare build UUID `8791b8a9-2699-4251-8c9c-3abd0b27d69a`
- exact release SHA `7da7e555d306d5e7f47f1afecf5a8927d5bfb136`
- build `status=stopped`, `outcome=success`

R5.10 has no D1 migration. Arrival UI was not touched. Stock, reserves, payment, return, issuing and Workshop status business semantics were not changed.

Exact release diff from the preceding main tree is five files:
- `package.json`
- `scripts/d1-read-budget-r5-10-worker-manifest.json`
- `scripts/test-d1-read-budget-r5-10.mjs`
- `scripts/test-step1906a-worker-modularization.mjs`
- `worker/domains/workshop.ts`

Temporary build/proof helper files were removed from the release branch before PR. Temporary R5.10 ops branches were reset to the clean release SHA after verification.

Branch2 remains out of scope and was not intentionally changed by R5.10. Last known exact Branch2 SHA remains `adec6098777bebe4709615e1256cc5dd468b444d` unless separately reverified.

## R5.10 — Workshop read optimization

### Problem

`enrichWorkshopTaskRowsFromOrderItems` used a correlated `catalog_variants` fallback per linked Workshop item. This is correct but expensive on large Workshop reads, especially now that the full historical backlog is intentionally visible.

### Implementation

For `directItemIds.length >= 20`, large Workshop enrichment now resolves historical variant-less rows set-wise:
- load `order_items` with direct variant metadata;
- collect product IDs only for rows whose `variant_id` is null;
- load candidate `catalog_variants` once for those products;
- preserve the legacy fallback priority `is_active DESC, sort_order ASC, id ASC` and the same color/size matching semantics in memory.

For small flows below the threshold, the exact legacy correlated SQL remains. This deliberately protects one-item status/relink/mutation flows from catalog fan-out. The later ambiguous legacy task matcher is unchanged.

### Production proof

Exact SELECT-only proof on 80 live Workshop items:
- legacy correlated fallback: `2967 rows_read`
- set-based resolver: `1035 rows_read`
- saving: `1932 rows_read`
- reduction: about `65.1%`
- missing-variant products: `15`
- candidate variants: `846`
- raw item read: `160`
- candidate variant read: `875`
- complete result equivalence passed
- all D1 proof calls enforced `rows_written=0`, `changed_db=false`

Initial proof run: `33951270314`, job `101266442409`, success.

### Exact Worker gate

R5.10 is accepted by the cumulative Step 190.6A declaration gate through an exact SHA-256 delta for `enrichWorkshopTaskRowsFromOrderItems`:
- before: `1851daa7279ff837011e507fe41fdd9a2615ad42ecd6a3a3c7a8fb021b302e2a`
- after: `3bd7cf0851a6125c21812d65b45c37fd7fcb6ceb52c773eedb87fc5ed7c09638`

The gate was not bypassed or weakened. Earlier candidate runs failed safely until the exact cumulative R5.10 allow-list was added.

### Final validation

Validation branch run:
- run `33952261760`
- job `101269138538`
- result `success`

Passed:
- focused R5.10 regression
- full cumulative `npm run release:check`
- DB safety
- TypeScript typecheck
- production build
- lint with warnings only, 0 errors
- Wrangler deploy dry-run
- fresh Production read-only equivalence/budget proof

Step 190.6A passed with 35 Worker TS files, 509 preserved declarations and 0 import cycles. DB safety preserved 69 migration files and found no D1 mutation command in package scripts.

### Post-deploy verification

Post-deploy run:
- run `33952451906`
- job `101269652295`
- result `success`

Verified exact Production identity:
- Worker tag `66404f6fa2ad454998068e7dd7600edb`
- build UUID `8791b8a9-2699-4251-8c9c-3abd0b27d69a`
- release SHA `7da7e555d306d5e7f47f1afecf5a8927d5bfb136`

Fresh post-deploy SELECT-only control:
- legacy baseline `2967 rows_read`
- set-based total `1035 rows_read`
- `R510_POSTDEPLOY_READONLY_OK`

Therefore the measured reduction survived the real Production deployment.

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

The average rows per read request on Sep 5 was still broadly similar to some previous days, so usage volume matters. Use identical-query before/after measurements to prove optimization effects rather than aggregate dashboard totals alone.

## Next optimization point — R5.11 candidate

R5.10 is complete and live. The next preferred target is **fresh read-only Production profiling of order search**, especially 1–2 character searches. Generic searches of length >=3 already use the R5.3 trigram/FTS path, while short queries intentionally retain legacy semantics and may still be expensive.

Before changing code:
- measure representative short searches and their actual rows_read;
- inspect current query planner/index usage;
- preserve `ORD`/external-id search behavior and short-search compatibility;
- prove any alternative SQL returns the same order IDs before implementation;
- do not touch Warehouse Attention merely because it is potentially expensive; its physical-truth logic is higher risk and needs its own precise measured audit.

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
