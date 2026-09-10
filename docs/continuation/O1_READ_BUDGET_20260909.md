# O1 — measured read-budget optimization

Started: 2026-09-09. Updated: 2026-09-10, Asia/Qyzylorda.
Base: main f49249753676f75885afc37694b1453105ed76aa.
Branch: codex/o1-read-budget.

## Scope and status

O1 is independent of Warehouse W. W is paused for discussion, NOT completed.
Implementation is local; production publication must be recorded explicitly after deployment.
Migration 0067 adds three indexes only; it has not yet been applied remotely. No production writes, Branch2 changes, Arrival redesign or stock/handover arithmetic changes so far.

## Implemented

1. listPlans builds payment/return totals per day once within the full periods of the selected overlapping plans. Each plan reuses these bounded aggregates. Return totals are not recomputed separately for fact and return columns. Manager attribution, deleted orders, cancelled returns, null status, period inclusivity, negative department facts and salary calculations retain their old semantics.
2. API client shares only identical unfinished plain GETs within the same browser hook instance and access role. Each consumer gets an independent response body. Custom request options/signals/Request objects bypass sharing. Mutations invalidate flights at both start and completion; reads during mutations do not share. Rejected/completed reads are removed. Retry, idempotency and existing error handling remain in the underlying transport.
3. Explicit refresh still forces fresh catalogue/reference/stock reads. No new TTL or stale-data optimization introduced.
4. All eight report types now request an opt-in `reportType`. Each executes only its own queries (payments 3; managers 8; products 3; cities 6; returns 2; debts 2; leads/Call Centre only their auxiliary loader). Former full request executes 28 base SQL queries plus four auxiliary report loaders. Full/default API and Finance workspace contracts remain unchanged. Existing formulas, date rules and selected report/export DOM are retained; responses carry their report type and mismatching content is hidden during switching.
5. Finance cache keys include report type. Force bypasses hook-level in-flight sharing. Invalidation clears flights and advances request IDs; an old request cannot repaint or repopulate a newer cache. No longer reuse a partial report in the Finance workspace.
6. Additive migration 0067 accelerates exchange `payment_id` lookup, normalized chronological stock-check ordering and exact SKU/session stocktake exclusion. No timestamp string comparison replaces chronological semantics.

## Measurements

Production D1 SELECT-only paired comparisons, unchanged data and all result fields equal:

| Period / query | Before rows_read | After rows_read | Result rows |
| --- | ---: | ---: | ---: |
| August 2026 manager plans | 4403 | 1996 | 9 |
| August 2026 department plans | 1612 | 1115 | 2 |
| September 2026 manager plans (empty) | 25 | 27 | 0 |
| September 2026 department plans (empty) | 7 | 9 | 0 |

Combined August pair: 6015 -> 3111, 48.3% fewer reads. Empty scopes add two reads per query. Zero production rows written. This is not a 48.3% reduction for the entire application/account.
Concurrent-read test: two simultaneous equivalent calls execute one underlying read; after completion a new call reads again. Production hit rate still requires post-deployment traffic measurement.

Expanded SELECT-only benchmark, August 2026, before new indexes: former 28 base report SQL queries total **44850** reads. This excludes auxiliary plans/team/leads/call-centre, so it is a conservative baseline for the former full report request. Exact SQL selected by the new runtime:

| Report | SQL queries | Rows read | Reduction vs base full request |
| --- | ---: | ---: | ---: |
| Payments | 3 | 3128 | 93.0% |
| Managers | 8 | 16817 | 62.5% |
| Products | 3 | 7211 | 83.9% |
| Cities | 6 | 10351 | 76.9% |
| Returns | 2 | 130 | 99.7% |
| Debt closures | 2 | 1759 | 96.1% |

Index baseline: compact handover page (fixed 80-order scope) 3141 reads / 39 rows; all-active compact handover 3742 / 51; manager payment/day aggregate 6689 / 107. Index after-comparison awaits rollout. Script `scripts/measure-o1-d1.mjs` performs only SELECT, stores counters/SQL-result hashes (not row payloads) in ignored `_o1-evidence/`, refuses to overwrite baseline evidence. Do not infer zero cost for leads/Call Centre: their auxiliary loaders still execute.

## Validation

`scripts/test-o1-read-budget.mjs` compares actual SQL to frozen pre-O1 SQL on SQLite fixtures: overlapping plans, manager override/fallback, null/cancelled return status, deleted orders, inclusive bounds, empty plans, missing manager and negative fact values. It also exercises GET response independence, role separation, mutation barriers, retries after rejection and no completed cache.
The cumulative release gate runs O1 tests. Exact Worker/API transport preservation deltas are registered; historical checks remain active. The module-count allowance increases by one small helper; the source-byte and built bundle budgets stay unchanged.
Final local validation: `npm run release:check` completed with exit code 0, including all chained regressions through W8.4, O1 behavior/SQL tests, database safety, TypeScript, clean production build, bundle budget and Wrangler `deploy --dry-run`. The dry-run did not publish anything. `npm run lint` completed with exit code 0 and existing warnings. No browser interaction acceptance or post-deployment traffic measurement has been performed for O1.

## Continuation checkpoint — 2026-09-10

New `test-o1-report-scopes.mjs` compares all displayed report fields/totals against pre-O1 full response on SQLite fixtures, for three periods including an empty one; it enforces SQL counts, full/Finance fallback parity and all three index plans. `test-o1-finance-read-races.mjs` exercises actual hook code with deterministic React/fetch harness: sharing, cache separation, out-of-order writes, force, summary invalidation and failure retry. Both pass. Final expanded gate result is recorded below; production index measurements and publication await approval.

Additional acceptance: React server rendering of the actual report renderer is byte-identical between full and scoped responses for all eight reports and all fixture periods, including the export/print subtree. Final expanded `npm run release:check` passed uninterrupted with exit code 0 after adapting legacy R3/R5.8 shape assertions to the additional report gate without weakening Finance exclusions. This includes O1 tests, all historical regressions through W8.4, 70-migration database safety, TypeScript, clean build, unchanged byte budgets and Wrangler dry-run. Lint exits 0 with pre-existing warnings. Publication approval requested; no index applied remotely and no deploy yet.

Rejected experiment: materializing `active_reservations` in compact handover increased D1 reads from 3525 to 10185 for the measured 80-order scope, with identical results. It was NOT applied to runtime.

## Remaining work / acceptance boundary

- Do not declare the entire read-budget problem solved by O1 or promise a safe Free-tier load for Branch2.
- After publication approval, apply migration 0067, finish measured index comparison for historical handover list flags and payment aggregation, publish the validated application and record exact deployment. Handover rules stay unchanged.
- Broad inventory loads on form entry remain; safely narrowing them requires preserving all form choices and fresh save-time validation.
- After deployment compare a clean post-deploy interval with similar traffic, using rows_read * frequency and actual GET coalescing opportunities. Rolling 24-hour insights mix old and new versions.
- Paid tier is not a substitute for efficient queries; Branch2 publication/sync remains separate.
