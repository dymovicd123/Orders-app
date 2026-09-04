# Orders-app — current project continuation context

Updated: 2026-09-04
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
- Evening 2026-09-04: Production D1 daily read budget is near exhaustion. Do **not** run Production D1 SELECT/profile/insights until the next reset unless the user explicitly authorizes it. GitHub/source/static checks are allowed.

## Current Production code

R5.9 release tree was introduced by PR #12 at:

`6985093f7ee377b7d52b8716184b26f4fd6a1ac6`

R5.9 Cloudflare deploy monitor run `33894745462` completed successfully.

During the later code-only audit, an accidental temporary root file `noop` was created on `main` and immediately removed. This produced two no-op history commits:

- `6c6bdfffd5f2217f75cc56aa43508476a9d1c1c9` — temporary file added;
- `d9b17803fb63244722def8020741be1d961c4a81` — temporary file removed.

Current GitHub `main` HEAD is therefore `d9b17803...`, but compare `6985093... -> d9b17803...` has **zero changed files**. The current code tree is exactly the R5.9 release tree. Cloudflare deploy monitor runs for the two no-op commits also completed successfully (`33896074560`, `33896101257`). They did not run D1 queries.

Do not rewrite/reset main merely to remove these history commits; that would create unnecessary deploy churn.

Branch2 remains:

`adec6098777bebe4709615e1256cc5dd468b444d`

R5.8/R5.9 have no D1 migrations.

## R5.9 performance result

For active August orders `2026-08-01..2026-08-31`, final pre-release SELECT-only proof showed:

- page 2: **600 -> 313 rows_read** (−47.8%)
- page 3: **893 -> 297** (−66.7%)
- page 4: **1,192 -> 312** (−73.8%)
- page 5: **1,288 -> 106** (−91.8%)
- repeated period summary: **2,423 -> 447 rows_read** (−81.6%)
- exact order count: 432
- keyset page `external_id` sequences exactly matched OFFSET baseline.

R5.9 uses an internal `(order_date,id)` seek cursor only for sequential Next navigation, while keeping visible offset/page semantics. Later page-only navigation can reuse exact page-1 periodStats and request count-only metadata. Legacy/direct API callers retain full periodStats by default.

## R5.8 / R5.7 inherited optimizations

R5.8 Finance default workspace `2026-09-01..2026-09-04` was reduced **901 -> 673 rows_read** by deriving payment-method and payment-by-day aggregates from already-loaded payment operation rows. Static review confirms the derived source uses the same payment-date and non-deleted-order population as the removed standalone aggregates.

R5.7 Orders Summary reuses `orders.received_amount` only inside its proven active/no-date boundary. Date-filtered, archive/non-active and legacy callers retain the exact payments query.

## Code-only post-R5.9 audit — 2026-09-04 evening

Because D1 limits are near exhaustion, this audit deliberately made **no Production D1/Cloudflare database calls**.

Temporary code-audit branch:
`ops/r5-9-code-audit-20260904`

Audit run:
- GitHub Actions run `33896192244`
- job `101099283468`
- result: **success**

Passed without D1 access:
- `npm run typecheck`
- `npm run build`
- `npm run lint`
- R5.7 focused regression
- R5.8 focused regression
- R5.9 focused regression
- Step 190.6A Worker declaration gate
- Step 190.6B frontend modularization gate
- Step 190.6E type/API boundary gate
- runtime SQL syntax static test
- `npm run verify:db-safety`

Therefore no compile/build/lint/static-regression failure is currently present from R5.7–R5.9.

### Confirmed low-severity contract defect

`worker/domains/orders-read.ts` intentionally returns:

`periodStats: null`

when R5.9 `includePeriodStats=0` is used. But `src/app/types.ts` currently declares:

`periodStats?: OrderPeriodStats`

instead of `periodStats?: OrderPeriodStats | null`.

The current UI is runtime-safe because it checks `if (ordersData.periodStats)` before using the object and preserves previous stats during page reuse. This is **not currently a crash or data-corruption bug**, but the TypeScript API contract is inaccurate and should be corrected in the next narrow code patch.

### R5.9 filter/pagination race risk

Orders filter changes are debounce-loaded after roughly 120 ms (380 ms for text search). During that debounce interval the old page rows/stats remain displayed and `busy` is still false. A very fast click on **Next** can therefore derive an R5.9 cursor from the old rows while passing the newly edited filters and can also request `includePeriodStats=0` using the old summary.

The scheduled page-1 filter reload normally corrects the view shortly afterward, so this is expected to be transient and does not mutate data. Still, it is a real UI consistency race introduced/worsened by cursor+summary reuse. Preferred fix: tie cursor/periodStats reuse to an exact applied-filter fingerprint (or invalidate page reuse immediately when filters change), rather than relying on debounce timing.

### Concurrent-write pagination consistency risk

R5.9 keyset page rows are anchored to the prior page cursor, but later-page `totalCount/hasMore` are freshly counted. If another user inserts/deletes matching orders between page loads, page contents and fresh total metadata can temporarily describe different snapshots. Reused page-1 periodStats can likewise become stale during the paging session.

No runtime reproduction was attempted tonight because it would consume D1 reads. Treat this as a multi-user consistency risk, not a confirmed Production failure. A future fix should avoid adding a new database read merely to version the snapshot; prefer frontend/session snapshot metadata if practical.

## Next action after D1 reset

1. First fix/audit the small R5.9 contract and filter-pagination race in a code-only narrow patch, with no business-model changes.
2. After the daily D1 reset, run a fresh Production read-only profile/insights only if the user confirms the budget is available.
3. Re-measure remaining hotspots before choosing R5.10; do not use stale pre-R5.9 costs as final priority evidence.
4. Do not change Warehouse/handover logic merely for performance without a separate end-to-end warehouse audit.

## Inherited safety / business invariants

- Arrival UI remains frozen.
- Critical save: order + items + reserves + Workshop tasks are critical; audit/history/re-read/extras must not turn committed success into failure.
- Workshop items are excluded from normal Warehouse shortage checks.
- Partial shipping is not used; operational model is all-or-nothing.
- Preserve payment-date vs order-date financial semantics.
- Keep D1 read fan-out bounded and mutations bounded.
- Small Production D1 SQL should use `wrangler d1 execute --command`, not file-import.
- Branch2 is out of scope unless explicitly requested.
