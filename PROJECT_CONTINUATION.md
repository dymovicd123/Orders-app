# Система заказов — continuation context

Updated: 2026-09-02 (Asia/Almaty)

## Current execution point

- Production/main baseline before the current promotion: `39fcdaa6d2e72d772206e8e6dfe057aad0fa576f` (Operational Autonomy R2).
- D1 Read Budget R3 was fully validated on safe branch. Exact validated source commit before cleanup: `abfb5ff289932c194e5d2122ab4dc5498bc904c0`.
- Full cumulative `npm run release:check`, database safety, clean production build and Wrangler `--dry-run` all passed. Permanent R3 regression also passed.
- Temporary R3 workflow/patcher/registrar/trigger files were removed after validation. Promote only the clean descendant of the validated source.
- Arrival UI (`Приход`) remains frozen: no visual/layout/form redesign.

## D1 Read Budget R3 — validated

Fresh D1 Insights on 2026-09-02 showed the remaining read budget was being spent mainly by Warehouse Attention and broad finance/report calculations.

R3 permanent behavior:

1. **Overview read isolation**
   - the overview screen now has a lightweight `/api/dashboard` loader;
   - it no longer needs the old full dashboard loader that also pulled orders/catalog/reference data just to render the overview.

2. **Finance workspace scope**
   - finance reads now distinguish `scope=finance` from the full Reports payload;
   - Finance skips report-only manager/product/city/day/lead/call-centre/plan/team datasets that its own UI does not use;
   - full Reports behavior remains available and unchanged for the Reports section;
   - full-report and finance-workspace caches are isolated by scope;
   - normal Finance navigation no longer forces an extra full report refresh and can reuse the scoped cache;
   - explicit refresh/mutation invalidation still forces a fresh read.

3. **Warehouse Attention detail de-duplication**
   - `details=1` no longer runs the full expensive summary catalog scan and then repeats the same unresolved-catalog work for detail rows;
   - the detail catalog query carries the exact grouped total via `COUNT(*) OVER()`;
   - shortage/lifecycle/stocktake counts remain exact through a smaller core summary query;
   - problem classification/business semantics are unchanged.

Permanent R3 files include:

- `scripts/test-d1-read-budget-r3.mjs`
- `scripts/d1-read-budget-r3-worker-manifest.json`
- the exact Step 190.6A cumulative preservation-chain extension for `listFinanceReports` and the historically 192B1-added `getWarehouseAttentionSummary` declaration.

No migration or D1 write is part of R3.

## D1 optimization history

### R1

Main commit: `414320141ae84e54ac8ddffcf87c67f39a858b59`.

- compact order handover list flags;
- indexed exact `ORD-...` lookup;
- safer small-result relation/stat reuse;
- permanent regression `scripts/test-d1-read-budget-r1.mjs`.

### R2

R2 introduced:

- compact all-active handover reads;
- compact Warehouse Attention summary handover path;
- indexed `ORD-...` prefix range;
- active catalog variant join instead of correlated lookup;
- preaggregated Team counters;
- clients `COUNT(*) OVER()` total;
- short Warehouse Attention frontend TTL/in-flight coalescing with forced invalidation after writes.

Permanent regression: `scripts/test-d1-read-budget-r2.mjs`.

### R3 measurement rule

After exact Production deployment, re-run fresh one-hour D1 Insights. Do not use the polluted rolling 24h profile to judge R3 immediately. Rank the next optimization only from post-deploy fresh traffic.

Do not blindly add indexes. First collect live query-plan / rows-read evidence for whatever remains at the top after R3.

## Branch2 — urgent sync state

User explicitly requested Branch2 be brought current; it has materially drifted.

Current old Branch2 HEAD before sync:

- `539195eec4796d75115e8add722fa9bb4b009405`
- date: 2026-08-29
- checkpoint: Arrival save reliability.

Comparison against pre-R3 main showed the histories diverged at `21c4f68a819441269978f9c674960601805453d9`: main had roughly 167 newer commits while Branch2 retained its own historical promotion/checkpoint commits. Do not simply force Branch2 to main without restoring environment-specific invariants.

### Confirmed Branch2 environment invariants

Branch2 is a separate Worker / D1 environment. Its old config says:

- Worker: `orders-app-branch2`
- D1 logical name: `orders_db_branch2`
- historical configured UUID: `40065052-854e-44b8-bcd5-251bdd488301`
- title marker: `Система заказов 2`

The historical UUID must NOT be trusted blindly: a direct read-only Cloudflare D1 API check against that UUID returned Cloudflare `7403`. A follow-up audit is resolving the live database by **name** through Wrangler before any schema action.

Branch2 also intentionally added an auth fallback guard in `verifySimpleAdminPassword`:

- when no stored hash exists but `app_settings.require_stored_admin_password = '1'`, do not fall back to the environment/default admin password.

Preserve that Branch2-specific safeguard unless a later explicit design decision replaces it.

The old two-line `worker/index.ts` delta was investigated: it merely removed the admin gate from GET `/api/inventory/cycle-counts`. Current main already contains that behavior, so it is not an extra Branch2-only delta that needs to be reapplied.

### Safe Branch2 sync procedure

1. Finish R3 main promotion and confirm the exact matching Production Cloudflare build.
2. Resolve the actual live `orders_db_branch2` identity by Cloudflare/Wrangler name, not the stale hard-coded UUID.
3. Read-only compare Branch2 `d1_migrations` / schema with the repository's 64 migration files.
4. Build Branch2 sync candidate from the new exact main SHA.
5. Restore only proven environment deltas:
   - Branch2 Worker/D1 config using the live resolved Branch2 database;
   - `Система заказов 2` title marker;
   - stored-admin-password-required fallback safeguard and its exact preservation registration.
6. Run full cumulative release gate, database safety, clean build and Wrangler dry-run against Branch2 config.
7. Apply only genuinely missing normal migrations if the read-only audit proves they are absent and applicable. Never copy Primary data and never create historical optional/audit tables merely to make environments look identical.
8. Preserve the old Branch2 head in a backup ref before rebasing/repointing the environment branch if history replacement is needed.
9. Push the exact validated Branch2 source and require `cloudflare-deploy/branch2` to confirm the matching SHA before calling Branch2 current.

## Operational Autonomy R2 — already Production baseline before R3

Routine deterministic operations are manager-safe; genuine master-data creation, ambiguity and destructive reversals remain admin-only.

Manager-safe includes routine stocktake/cycle-count paths, existing-SKU transfer/correction/writeoff, known existing-variant Arrival, unfinished stocktake continuation and active/unshipped Workshop order editing. Hidden Warehouse panel visibility blocker was fixed end-to-end.

Arrival visual workspace remained untouched.

## Order / warehouse reliability already established

- Order create/save separates critical writes from secondary readback/audit so a committed order cannot be falsely reported as unsaved because a follow-up diagnostic read failed.
- Structured stock-shortage handling, Workshop exclusion from warehouse shortage, unpaid-order support, payment validation and idempotency remain protected.
- No partial shipments; all-or-nothing model.
- Physical / Reserved / Available remain separate truths.
- Newer physical check/stocktake beats older inverse arithmetic.
- Known deterministic situations should self-resolve; unknown SKU/attribute/policy ambiguity may require admin.
- `СТАНДАРТ`/empty is valid, not automatically unknown.

## Exact erroneous duplicate F3A7

`ORD-20260829144801-F3A7DDC3`, order id `1242`, was already safely deleted. A post-Operational-Autonomy Production API read reconfirmed:

- `order_status=deleted`
- `shipping_status=not_sent`
- `workshop_status=cancelled`
- return #33 cancelled

Do not mutate this order again merely to verify it.

## Next optimization/audit after R3 + Branch2 sync

User expects a broader second system audit because the currently discovered D1 issues are likely only part of the problem. Audit the full chain:

- UI effects/render -> API fan-out;
- duplicate/in-flight/retry reads;
- endpoints loaded while their section is unopened;
- payload overfetch;
- Worker query fan-out;
- correlated subqueries/full scans/repeated aggregates;
- D1 indexes/query plans;
- real `rows_read`/`rows_written` by workflow;
- dashboard, orders, clients, team, workshop, finance, reports, warehouse, catalog/references;
- cache/invalidation correctness;
- exports;
- Cloudflare Worker/D1/storage/bundle cost.

A likely next candidate is the Reports section: it still obtains a broad full finance/report payload even though the user selects one report type. Measure after R3 before changing it.

## Project invariants / workflow

- Before every Warehouse patch, audit adjacent workflows and data-entry paths, not only one screen.
- After each meaningful step, update this continuation context.
- When local delivery is needed, user historically wants one Windows root command such as `.APPLY_STEP...cmd`.
- Production safety, exact environment isolation and idempotency take precedence over cosmetic convenience.
- Never mix Primary and Branch2 D1 bindings/data.
- Do not claim a deployment until the exact matching Cloudflare monitor succeeds.
