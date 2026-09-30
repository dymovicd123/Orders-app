# Catalog retirement / restore / order recreation — continuation checkpoint

Updated: 2026-09-30  
Repository: `dymovicd123/Orders-app`  
Target environment: **Branch2 only**  
Runtime/business-code baseline after the latest completed fix: `7933aba9940c82884d83e2f282bc4782964497a3` (PR #239)

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


### PR #239 — safe local color/gender subgroup retirement
Merged as `7933aba9940c82884d83e2f282bc4782964497a3`.

Added a narrower admin correction path for mistakes such as one accidental `ОРАНЖЕВЫЙ · ЖЕН` subgroup inside an otherwise male execution.

Semantics:
- scope is exact `execution + adult/child + gender + color`;
- all active sizes/ages in that visible subgroup are retired together;
- other colors, gender groups and executions are untouched;
- the local action is **strict**: if any targeted SKU has Physical, Reserved, active reservation, active unsent order, active/ready Workshop task, pending lifecycle, or active stocktake, the whole operation is blocked;
- mutation is one guarded soft-retirement UPDATE with blocker rechecks, so preview/write races cannot produce a partial subgroup delete;
- local retirement does **not** rewrite `inventory_stock`, reservations, order rows, Workshop rows, Product or execution identity;
- historical SKU rows remain historical/inactive;
- legacy blank-gender/no-color groups are targetable because raw identity is kept separate from UI labels;
- ordinary PATCH against an already inactive SKU now fails closed, so a stale editor/direct legacy update cannot reactivate or mutate historical SKU.

UI:
- every visible color/gender subgroup has admin action **«Удалить группу»**;
- confirmation explains the narrow scope and lists blockers if deletion is unsafe.

Validation:
- branch validation `36689192770`: cumulative `release:check` **success**, build **success**;
- merged-SHA Stage03 H7 Branch2 safety `36689481147`: **success**;
- exact merged-SHA Cloudflare deploy `36689480949`: **success** to `orders-app-branch2` with D1 binding `orders_db_branch2`;
- no migration and no D1 data mutation were required by this feature.

## Current UX facts

- Exact active SKU card has admin action **«Вывести из каталога»**.
- A visible color/gender subgroup now also has **«Удалить группу»**; this removes only that subgroup within the current execution and is strict-blocked by any operational linkage.
- Whole execution/product retirement uses the newer retirement flow.
- Admin Catalog header has **«Удалённые»** next to refresh; it shows whole execution/product retirement history and restore.
- Exact-SKU retirement is an older path and is not currently represented as a first-class row in the new `Удалённые` history UI.
- Active autocomplete/pickers must not suggest retired SKU/product rows.
- Old orders may still display historical retired characteristics because that is order history, not active autocomplete.

## Read-only Branch2 data audit — 2026-09-30

Audit workflow run `36699118208` executed SELECT-only checks against the verified Branch2 D1 identity. Wrangler reported `changed_db: false` / `rows_written: 0` for the audit queries.

Results:
- 13 active fixed-scope gender mismatches remain as legacy data.
- Every mismatch is currently safe for strict local retirement: zero Physical, zero stock Reserved, zero active reservation, zero active unsent order item, zero active/ready Workshop task, zero pending lifecycle, zero active stocktake.
- Group breakdown: `АЙДАР БОМБЕР` — 4 female groups under male scope; `АЙДАР ШАПАН` — 4 male groups under female scope; `СӘУКЕЛЕ ШАПАН` — 4 male groups under female scope; `ҚОЗЫ КӨРПЕШ ШАПАН` — 1 female group under male scope.
- No inactive Catalog variant with non-zero Physical/Reserved or active reservation was found.

This changes the earlier P2 fixed-gender item: **prevention is closed by PR #240/#241/#242; only evidence-bound cleanup of 13 legacy zero-footprint groups remains.** Do not infer a broader data rewrite from this audit.

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

### P2 — fixed product gender scope still needs prevention, not just cleanup

PR #239 makes an erroneous subgroup removable, but it does not yet change the older gender-resolution rule.

Current Catalog/Resolver lineage intentionally treats an explicit human `ЖЕН/МУЖ` choice as authoritative before fixed product-scope fallback. That rule was introduced to preserve known gender in unisex flows and must not be broadly removed without reconciliation.

The new concrete product requirement is narrower:
- if a Catalog product is truly fixed `gender_scope = male`, an accidental female working SKU should not be creatable through ordinary Catalog/Arrival/order materialization;
- likewise for fixed female products;
- `unisex` products must continue to allow both concrete genders;
- historical rows are not rewritten.

Required next step:
- audit every SKU-creation/materialization path against fixed `gender_scope`;
- add a focused fail-closed rule only where product scope is explicitly fixed;
- preserve R11 behavior for genuinely unisex products and historical reads;
- add a regression reproducing the accidental wrong-gender subgroup case.

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

1. Audit/fix **fixed product gender-scope prevention** so a removed wrong-gender subgroup cannot be recreated accidentally, while preserving unisex/R11 behavior.
2. Fix recovery for open `catalog_retired` orders.
3. Make restore resumable/idempotent and represent partial restore honestly.
4. Run read-only inactive-SKU/non-zero-stock audit and add invariant guards.
5. Decide and implement Workshop-retirement rule.
6. Add explicit retired-SKU Return/Exchange intake UX.
7. Unify exact-SKU/local-group history with the new retirement-history UI.
8. Separately resolve the high-risk dev-dependency audit.

For every remaining item, start from current `branch2`, add focused semantic regression, run cumulative `release:check` + build, verify exact merged SHA deploy, and keep `main` untouched unless the user explicitly changes the release boundary.
