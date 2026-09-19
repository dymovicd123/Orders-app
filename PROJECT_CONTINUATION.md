# Система заказов — continuation context

Updated: 2026-09-19 (Asia/Qyzylorda)

## Current priority — Stage02 transactional stock truth

- Canonical design: `docs/continuation/STAGE02_PHASE2_STOCK_TRUTH_MODEL_20260919.md`; canonical Warehouse continuation: `docs/continuation/WAREHOUSE_CURRENT_CONTEXT.md`.
- The old “self-healing / Smart Daily Stock” assumption is superseded for Stage02. Operational possession proves only the concrete units being handled; it never becomes an absolute SKU count. Only explicit counting/correction workflows may replace Physical.
- Phase2A is complete: shared `stock_resolution_required`, bounded outbound semantics, append-only `inventory_operation_evidence`, migration 0071.
- Phase2B is complete in Branch2 and Production: final shipping shortage asks only whether the concrete shipped units are physically present; Physical is bounded at zero and unexplained outbound is evidence, not a fake stock check.
- Baseline before current Phase2C: Branch2 `d7ef267a3581dcb8a2781b16b82ae2889b5698fd`; Production/main `f7a6f7240bcaf3c73e7568d7b9b33d98d87b8ac5`. Migration 0071 is already applied to both D1 environments.
- Current implementation branch: `w-stage02-phase2c-early-handover-20260919`. Goal: apply the same bounded possession resolver to early `issue_now` while keeping `still_here / issued_before_checkpoint` lineage questions separate.
- Next: Phase2D transfer/writeoff, then Phase2E Attention dependency removal + Stage02 acceptance.
- **User release gate:** finish remaining Stage02 in `branch2`; then the user will inspect all Stage02 changes and send objections. Do not promote Phase2C+ to Production before that inspection.
- Arrival remains frozen. Never mix Primary and Branch2 D1. Update all continuation context after every meaningful Stage02 code/CI/merge/deploy step.

## Current priority — Operational Autonomy R3

- PR #31 `Fix safe correction of posted order payments` is complete and live. It was squash-merged to `main` as `6653e0ab4f438dca6832eb233624faed5a01602a`.
- Full GitHub Quality check run `34486738784` passed, including the cumulative regression gate and application build. Exact Cloudflare deploy monitor run `34486914530` also completed successfully for `main`.
- Posted ordinary payments can now be corrected in place without changing `payment_id`: date, amount, method, semantic kind (`primary` / `debt_close`) and comment. The path has stale-editor/CAS protection, append-only finance reversal + replacement, delta-only cash correction, corrected order received/debt totals and request idempotency. Exchange-linked extras remain owned by the exchange flow.
- The release also refreshed stale 189C/F5 expectations and explicitly registered the accepted Worker/frontend source deltas in the 1906A/1906B structural preservation gates. No migration was required; Arrival and Branch2 were not changed.
- User's current product rule: legitimate day-to-day business corrections must be executable by staff through the application without developer intervention. Safety must come from explicit correction/reversal flows, current-state validation, audit history and idempotency — not from leaving a valid business state with no supported action.
- Remaining high-priority autonomy gaps found in current `main`: (1) only one active return per order; (2) an existing return blocks a later exchange; (3) debt closing after a return is blocked without a normal self-service continuation; (4) a mistakenly recorded `sent`/handover fact lacks a natural keep-the-order correction path; (5) exchange-linked payment/date/amount corrections appear to require cancel/recreate rather than a dedicated audited correction.
- Physical/financial truth must NOT be weakened to remove these blockers. The target is safe correction without developer intervention while preserving history.
- Separate maintainability issue: cumulative exact-source hash/manifest/line-count gates are too source-shape-sensitive. PR #31 proved they can reject an intentional safe behavior change. Gradually prefer semantic behavior/idempotency/reconciliation tests; keep exact hashes only for deliberately frozen artifacts such as the current Arrival UI.
- Role/access boundaries remain a separate product-policy review: Operational Autonomy R2 already made many routine operations manager-safe, while Step 190.0 access/auth is still explicitly deferred pending client agreement.
- Detailed audit and proposed order: `docs/continuation/OPERATIONAL_AUTONOMY_AUDIT_20260910.md`. Final payment-correction context: `docs/continuation/ORDER_EDIT_SAFE_PAYMENT_CORRECTIONS_20260910.md`.
- Working branch for the next autonomy work is `operational-autonomy-r3`, based on the exact Production commit above. Do not merge context-only changes merely to trigger another Production build; carry them with the next validated runtime fix.

## Prior completed priority — O1

- User explicitly paused Warehouse W work for further product discussion. W is NOT complete; do not infer closure from the historical W8 UI checkpoint.
- O1 is the separate D1 read-cost optimization step, based on production Query Insights, not a Warehouse redesign.
- Baseline: main `f49249753676f75885afc37694b1453105ed76aa`; implementation branch `codex/o1-read-budget`.
- O1 changes: bounded daily payment/return aggregation for manager/department plans; browser-local in-flight GET coalescing with mutation barriers. No completed-response cache added; explicit refresh semantics preserved.
- O1 continuation: all eight report types now opt into only their required SQL; legacy full and Finance workspace responses remain unchanged. Report cache keys include report type; invalidation/force prevent older flights from refilling caches. Added migration 0067: exchange-payment lookup, normalized stock-check chronology, exact SKU/stocktake lookup indexes (additive, no business-row changes).
- Final expanded `npm run release:check` passed uninterrupted (exit 0), including O1 parity/race/index tests, all historical regressions through W8.4, TypeScript, clean build, byte budgets and Wrangler dry-run. Lint passed with existing warnings. Full report/export DOM parity holds for all eight report types. GitHub Quality check run 34472578988 also passed.
- Production SELECT-only benchmark (August, before new indexes): 28 base report queries cost 44850 reads, excluding auxiliary plans/team/leads/call-centre. Selected reports: payments 3128, managers 16817, products 7211, cities 10351, returns 130, debts 1759. This is workflow cost, not an account-wide percentage.
- User explicitly authorized PUBLIC code/context publication and primary rollout. O1 is deployed via PR #29, main merge `90750f25e491b1ba5c47b9b13d8dbdb75084caeb`; exact `cloudflare-deploy/main` status is success (run 34472769192). Worker version `44538eca-dfac-4541-b60e-2aee823acc9f`, deployed at 2026-09-10 11:44:07 UTC, serves 100%.
- Migration 0067 was applied only to `orders_db_prod` and registered in `d1_migrations`; all three indexes verified. IMPORTANT: the legacy migration journal otherwise records only 0001, so do NOT run blanket remote `migrations apply`; historical migrations appear pending despite existing schema. Business rows and Branch2 were not changed.
- Production before/after SELECT benchmark: all 30 result hashes match. Index-only full-base cost 44850 -> 37345; final selected report costs: payments 3128, managers 9786, products 7211, cities 7929, returns 130, debts 1285. Compact handover page/all-active stayed 3141/3742; no measured warehouse-query gain is claimed. Evidence: local ignored `_o1-evidence/before.json` and `after.json` (counts/hashes); command `node scripts/measure-o1-d1.mjs before|after`.
- Live SELECT-only comparison for August: manager plans 4403 -> 1996 rows read; department plans 1612 -> 1115. All returned fields/rows matched; zero rows written. These are per-query results, NOT an account-wide reduction claim.
- Implementation/validation details and remaining optimization work: `docs/continuation/O1_READ_BUDGET_20260909.md`.
- O1 implementation/publication is complete; account-wide effectiveness still needs a comparable clean post-deploy traffic interval. Do not promise Free-tier capacity for Branch2. W remains paused and open; Branch2 remains untouched. Final context-only follow-up does not change runtime.

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


## Checkpoint 2026-09-19 — Phase2D micro-step mode

- User requested that Stage02 continue in small, bounded steps rather than large bursts, to avoid losing progress to response/tool time limits.
- Current working branch: `w-stage02-phase2d-transfer-writeoff-20260919`.
- Current branch head when this checkpoint was written: `4e8e9103199ef6a01b5934eb4bc41b5e670fcbda`.
- Phase2C changes are already included in this branch; current work is Phase2D transfer/writeoff transactional possession handling.
- The latest GitHub Actions attempt is blocked before project checks by an external npm registry audit HTTP 503, so that failure is not yet evidence of a project regression.
- Continue with one narrow verification/fix at a time, report it, then proceed to the next micro-step.

- Phase2D micro-step: fixed legacy negative Physical handling in transfer. Source/target quantities are normalized to >= 0 at the transaction boundary; stale guards and retry diagnostics use the same semantics; transfer-in applies exact +Q from a non-negative baseline. This prevents an infinite resolver loop where the UI confirms expectedQuantity=0 but the server compares it to a legacy negative value. Regression assertions were added in `scripts/test-stage02-phase2d-transfer-writeoff-possession-resolver.mjs`. Commits: `c9e05d981be22ece8fda70aedf3d8d6edec2e06e`, `6a0cdd6d234cb234b6dd5f62cb41fbdf9bed9c52`.

- Phase2D micro-step: verified transfer resolver idempotency. A committed `request_id` is checked before stock-confirmation/resolver validation; resolver confirmations are not part of the transfer fingerprint; `inventory_transfer_documents.request_id` is UNIQUE; concurrent identical retries recover through the winning document; transfer items and operation evidence also have uniqueness guards. Added regression assertions and registered the Phase2D test in `scripts/release-check.mjs`. Commits: `d191ad47e7978682a22809997f52b7ee2c8bea59`, `e9da8aef051b2b9acc4129c1cef03e9ff0d9d42f`.

- Phase2D balanced checkpoint: writeoff resolver now uses the same bounded legacy-negative semantics as transfer, so old negative Physical is treated as 0 only for writeoff operation confirmation/replay while exact manual correction semantics stay unchanged. Writeoff retry/idempotency invariants are covered: committed `operation_id` short-circuits before resolver validation, confirmations are excluded from the request fingerprint, concurrent identical retries converge on duplicate success, and evidence keys remain unique. The Phase2D regression itself is green. CI then exposed the expected structural-preservation layer mismatch from Phase2D edits; added exact Phase2D Worker/frontend manifests and outer normalization layers for Step 190.6A/190.6B. Relevant commits: `25d6eb160c2f348dc652201bc30409686beaea33`, `01c3d517234a63d19a7321e8cb5cf0681ff0c1c0`, `1d9ed76857ae8d7892b4a693c917599091c2f3b9`, `f05ecdb5ee8aa358495e4af48caaec18044860f1`, `2dd0562500653ba87eb337bf317d85012ad3b126`, `aa10952a4c09f53616cc3f05af2b16299a23f117`. Latest full Quality run for the final structural-layer commit is still in progress at this checkpoint.

- Phase2D completion checkpoint: combined transfer + manual writeoff resolver audit is green. Additional correctness fixes found during final review: transfer reversal now restores only the source Physical delta that the forward transfer actually deducted (the explained portion), while destination reversal still removes exact Q; zero/negative tracked writeoff rows remain selectable so the possession resolver is reachable instead of being hidden by the UI; duplicate manual-movement retries no longer emit duplicate activity-log events; Worker route result narrowing is explicit and TypeScript-safe. W4/W8.4 legacy acceptance assertions were updated to protect the new bounded-possession flow instead of the retired full-count prompt. Full Quality run `35459453380` succeeded on code head `106a0dc9e849b1643d12a5f499e797f6beb694b4`. Phase2C is still stacked underneath Phase2D and neither is in production. Next repository action is to merge the combined Phase2C+Phase2D branch into `branch2`; production remains blocked until the user's full Stage02 review.
