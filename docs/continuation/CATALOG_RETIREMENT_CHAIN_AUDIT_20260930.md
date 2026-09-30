# Catalog retirement / restore / order recreation — continuation checkpoint

Updated: 2026-09-30  
Repository: `dymovicd123/Orders-app`  
Target environment: **Branch2 only**  
Runtime/business-code baseline after the latest completed fix: `da0e24363ea25b65b0e8170a04fdfaaf4db22b28` (PR #238)

This document is the detailed continuation note for the Catalog retirement chain audited on 2026-09-29/30.  
Always re-open the current GitHub branch before continuing; this note is a checkpoint, not a replacement for current code.

## Hard release boundary

- Do **not** merge/deploy this Catalog retirement work to `main` without a new explicit user instruction.
- `main` was still `820ff6be9a2e06fad4f61b147263927b0c42d3a7` when this checkpoint was written.
- Stage03 PR #218 and #219 were still open Draft and unmerged.
- Branch2 remains isolated on Worker `orders-app-branch2` and D1 `orders_db_branch2` / `40065052-854e-44b8-bcd5-251bdd488301`.
- Production Worker/D1 must not be touched as part of the remaining retirement-chain cleanup.

## Agreed business semantics

A retired Catalog identity is historical and must not keep affecting the working warehouse.

The intended lifecycle is:

1. Retirement closes the old working life.
2. Old SKU/execution rows remain historical/inactive; old orders, movements and snapshots keep their original links.
3. Old Physical and Reserved must never silently come back.
4. Working pickers/autocomplete must use active Catalog only.
5. A retired identity may return only through an explicit business action:
   - Catalog restore;
   - Arrival;
   - deliberate new-order input after explicit operator confirmation.
6. Returning the same human combination creates a **fresh working generation**, not a revival of the old SKU.
7. Fresh generation starts from clean stock truth; any new reservation belongs to the new active generation.
8. Background Resolver/reconcile/generic inventory paths must fail closed and must never resurrect retired identity.

## Completed work

### PR #230 — safe execution/product retirement
Merged to Branch2 as `10aa39688ac51cc4807a065512dd4b20047c9731`.

Introduced guarded soft retirement and retirement history/snapshots for whole execution/product removal.

### PR #231 — retirement hotfix
Merged as `1e2a4cea5fd3d9e903c05ef765a0fbdf8cc9c3bc`.

Fixed retirement behavior and replaced technical confirmation copy. Branch2 repair workflow was run successfully.

### PR #232 — safe restore
Merged as `59456be2ac7ab204d42abff0b1389329348db0e6`.

Added:
- `Удалённые` history UI for admin;
- safe restore that creates a fresh working execution/SKU generation;
- additive migration 0077 for restore audit/mapping;
- explicit Arrival recreation path;
- guarded Branch2-only migration/deploy checks.

Migration 0077 workflow `36602372671` succeeded.

### PR #233 — deliberate new-order recreation
Merged as `5d995405d0017c00ac945b4546c8a7f54a0ec7d5`.

Allowed a new order to start a fresh working generation for an exact retired human identity rather than reusing the retired SKU.

### PR #234 — operational write guards
Merged as `74ff4f0106384609f36a234ca937e91e784f3c4f`.

Closed the most dangerous write paths:
- new/active reservations revalidate a live Product + SKU;
- return/exchange lifecycle cannot write Physical to retired SKU rows;
- lifecycle cancellation cannot reverse Physical back into a retired SKU;
- mistaken-handover correction cannot restore Physical/Reserved onto a retired SKU;
- generic inventory materialization fails closed on retired product/execution/SKU outside explicit Arrival recreation;
- exact regression/structural successor layer added.

This closes the original race where a SKU could be retired after order resolution but before reservation and then receive Reserved anyway.

### PR #235 / #236 — regression synchronization
Merged as:
- #235 `33b569f52461f6671ae1d44dae5ab1d3882dfcd2`;
- #236 `a46e3b203f0030224db7896eb1c0b6d12a84b610`.

Aligned Arrival alias and Stage01 lifecycle regressions with the new retired-identity safety semantics. Runtime business behavior was not broadened.

### PR #238 — explicit operator confirmation before order recreation
Merged as `da0e24363ea25b65b0e8170a04fdfaaf4db22b28`.

This fixes the earlier hidden problem where merely pressing Save could mutate Catalog before shortage validation.

Current Create behavior:
- server performs a **read-only** retired product/execution/SKU preflight first;
- exact retired identity returns structured `order_retired_catalog_confirmation_required`;
- UI explicitly asks whether to return it as a fresh working position;
- confirmation is bound to the exact normalized order-item identity via confirmation keys;
- blanket `allowRetiredRecreate: true` on every new-order item is gone;
- confirmed retired fresh-generation shortage is evaluated before Catalog materialization, so cancelling/failed first save leaves the retired Catalog untouched;
- only after explicit confirmation + stock decision may that exact item materialize a fresh generation.

Validation:
- temporary current-Branch2 validation run `36669568796`: cumulative release-check **success**, build **success**;
- merged-SHA Stage03 H7 Branch2 safety run `36669787332`: **success**;
- exact merged-SHA Cloudflare deploy monitor `36669787336`: **success**.

The repository-wide Quality workflow still stops earlier at the pre-existing high-risk development-dependency audit. Production dependency audit passes. The separate branch validation proved the cumulative regression gate and build for this change.

## Current UX facts

- Exact active SKU card has admin action **«Вывести из каталога»**.
- Whole execution/product retirement uses the newer retirement flow.
- Admin Catalog header has **«Удалённые»** next to refresh; it shows whole execution/product retirement history and restore.
- Exact-SKU retirement is an older path and is not currently represented as a first-class row in the new `Удалённые` history UI.
- Active autocomplete/pickers must not suggest retired SKU/product rows.
- Old orders may still display historical retired characteristics because that is order history, not active autocomplete.

## Remaining unresolved retirement-chain work

### P1 — open orders left in `catalog_retired` can become operationally stuck

Whole execution/product retirement can intentionally release the reservation and mark a still-open order item `stock_writeoff_status='catalog_retired'` while keeping its old historical `variant_id`.

Shipping correctly blocks such an order, but the current Catalog Resolver queue is primarily built around unresolved/null Catalog links and does not provide a complete recovery path for `catalog_retired`.

Required design:
- preserve old order-item historical evidence;
- never relink history silently;
- give an explicit operational action to bind the still-open order demand to a **fresh active generation** after restore/recreation;
- recreate reservation only on the fresh active SKU;
- keep sent/completed/history cases immutable.

This is the next highest-priority functional gap.

### P1 — safe restore is not fully atomic/resumable

`restoreCatalogRetirement()` reactivates/creates several rows sequentially and marks the restore complete at the end.

If execution stops after product/execution/some variants were created but before completion:
- partial active state may exist;
- restore record may still be `started`;
- current history UI can infer `workingAgain` from active entities and hide the normal Restore action too early.

Required fix:
- make restore explicitly resumable/idempotent by retirement;
- distinguish `started/partial/completed` in read model/UI;
- retries must continue from the exact persisted mapping and never create duplicate generations;
- UI must not claim complete restoration merely because some working identity exists.

### P1/P2 — audit and quarantine legacy inactive SKU rows with non-zero operational stock

PR #234 prevents the known new write paths from putting Physical/Reserved onto retired SKU rows, but pre-existing anomalies may still exist in Branch2 data.

Current retirement snapshots focus on active variants. A legacy inactive SKU with non-zero Physical/Reserved is an invalid state and can escape ordinary retirement assumptions.

Required work:
- read-only audit on Branch2 D1 for inactive Product/SKU + non-zero `inventory_stock.quantity` or `reserved_quantity` and active reservations;
- no automatic destructive correction;
- define a guarded correction path if any anomaly is found;
- add preflight/assertion so future retirement/restore does not ignore such corrupted state.

### P2 — inactive exact SKU remains too mutable through the legacy variant PATCH contract

The ordinary Catalog variant update API still has historical capabilities that can set `isActive` and may call execution ensure logic.

The normal current UI does not intentionally revive a retired SKU, but stale/admin/API calls should not be able to:
- reactivate the old historical SKU row;
- manufacture a fresh execution as a side effect of editing an inactive historical row.

Required fix:
- make retired/inactive SKU immutable for ordinary PATCH;
- restoration/recreation must go only through explicit restore/Arrival/new-order-confirmation paths;
- stale editor save against a retired SKU must fail with a refresh/retired-state conflict.

### P2 — Workshop semantics during whole execution/product retirement are not explicit enough

Retirement preview computes active Workshop task count, but whole execution/product retirement does not currently use that fact as a clear blocker/warning in the same way the older exact-SKU retirement path does.

Required decision:
- either active/ready Workshop tasks block retirement;
- or retirement is allowed, but UI must explicitly state how the task continues and what happens to future Catalog/stock linkage.

Do not guess this business rule silently.

### P2 — returns/exchanges involving a retired historical SKU need a deliberate operator UX

Safety is now correct: lifecycle cannot put new Physical back onto the retired SKU.

However, when a customer returns an item whose historical SKU has since been retired, the system may now need an explicit working-identity resolution/restore step rather than silently completing stock intake.

Required UX:
- explain that the sold SKU is historical/retired;
- choose/confirm the fresh working identity or restore path;
- apply returned Physical only to the fresh active identity;
- preserve the return's historical sold-item evidence.

### P3 — exact-SKU retirement history/admin visibility is weaker than whole retirement history

The new `Удалённые` panel represents whole execution/product retirements, while an exact SKU can still be removed through the older `Вывести из каталога` action.

Potential improvement:
- include exact-SKU retirement history in one consistent admin history/read model;
- show old combination, retirement date/actor and whether a fresh generation later replaced it;
- do not merge old/new SKU identity.

This is observability/UX debt, not a current stock-truth blocker.

### Separate infrastructure debt — repository Quality dependency audit

The standard Quality workflow currently fails at **Audit high-risk development dependencies** before it reaches cumulative release-check/build. The production-dependency audit passes.

This is separate from Catalog retirement semantics. Do not weaken/remove the security audit just to get a green badge. Investigate/update the flagged dev dependency in its own bounded change.

## Suggested continuation order

1. Fix recovery for open `catalog_retired` orders.
2. Make restore resumable/idempotent and represent partial restore honestly.
3. Run read-only inactive-SKU/non-zero-stock audit and add invariant guards.
4. Lock ordinary inactive-SKU PATCH/stale editor behavior.
5. Decide and implement Workshop-retirement rule.
6. Add explicit retired-SKU Return/Exchange intake UX.
7. Unify exact-SKU history with the new retirement-history UI.
8. Separately resolve the high-risk dev-dependency audit.

For every remaining item, start from current `branch2`, add focused semantic regression, run cumulative `release:check` + build, verify exact merged SHA deploy, and keep `main` untouched unless the user explicitly changes the release boundary.
