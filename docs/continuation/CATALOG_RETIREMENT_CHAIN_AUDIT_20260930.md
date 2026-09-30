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

## Guarded cleanup of audited fixed-gender legacy rows — 2026-09-30

Correction workflow run `36699491214` completed **successfully** on verified Branch2 D1 only.

Preflight revalidated the exact evidence set immediately before mutation:
- expected target count: 13;
- all active fixed-scope mismatches: 13;
- target active mismatches: 13;
- Physical / stock Reserved / active reservation / open unsent order / active-ready Workshop / pending lifecycle / active stocktake: all 0.

The mutation soft-retired only variant IDs `158,254,288,315,450,654,670,854,862,893,1016,1022,1082`. It did not rewrite inventory quantities, reservation rows, order rows, products, executions, movements, or historical snapshots.

Verified post-state:
- active fixed-scope gender mismatches: 0;
- all 13 exact targets inactive;
- inactive variants with live Physical/Reserved/active reservation: 0.

Therefore the fixed-gender retirement sub-chain is now closed on Branch2: prevention is in runtime, legacy mismatches are removed from the working Catalog, and no operational stock state was stranded.

## Remaining unresolved retirement-chain work

### CLOSED — explicit recovery for open `catalog_retired` orders

Read-only Branch2 D1 audit `36705983071` found **0** currently affected open order items, so no production-style data correction was needed.

The operational path is now explicit and history-preserving:
- open unsent `catalog_retired` rows enter the order-scoped Resolver queue;
- automatic/global reconciliation filters them out, so recovery cannot happen silently;
- recovery is row-scoped and requires a fresh **active exact combination** of the same product/category/gender/color/material/length/size;
- the replacement reservation is created and re-read/proven before the operation is published as successful;
- the old `order_items.variant_id` is deliberately not rewritten. It remains historical retired evidence while the active reservation carries the current physical identity for shipping/handover;
- failed reservation replacement keeps `stock_writeoff_status='catalog_retired'`, preserving the explicit retry lane.

UI states plainly that the historical SKU is not revived/relinked and offers either «Привязать резерв к свежей версии» or a restore/recreate-first instruction.

Validation `36708803392`: cumulative release-check + build — **success**.

### CLOSED — safe restore resumability / partial-state honesty

Read-only Branch2 D1 audit `36703729894` found 0 current `started` restore rows before the new invariant.

The restore path is now resumable/idempotent by retirement:
- additive migration 0078 creates a partial unique index allowing at most one `started` restore per `retirement_id`;
- retry with a new browser requestId finds and resumes the persisted `started` restore instead of creating a parallel audit/generation;
- concurrent start uses `INSERT OR IGNORE` and converges on that one in-flight row;
- an already completed restore is replayed instead of starting again;
- completion is refused until the persisted old→new mapping count exactly matches the retirement snapshot count;
- history exposes `restorePending`; while a restore is partial, `workingAgain` is forced false even if a shell/execution has already appeared;
- UI shows «Восстановление не завершено» and offers «Продолжить».

Validation `36705047496`: cumulative release-check + build — **success**.

### CLOSED — inactive SKU operational-state audit + invariant guard

Read-only Branch2 D1 audit `36699118208` found **0** inactive variants with non-zero Physical/Reserved or active reservations.

The later retirement-integrity hardening now also makes this a runtime invariant:
- whole and local retirement surface inactive historical SKU rows with live stock/reservation state instead of ignoring them;
- whole retirement fails closed before mutation and rechecks the invariant in its write guard;
- restore checks the same invariant before starting/resuming a restore.

Validation: `36702222809` cumulative release-check + build — **success**.

### CLOSED — fixed product gender scope prevention + legacy cleanup

PR #240 added fixed `male|female` scope enforcement across ordinary Catalog creation, order resolution, inventory/Arrival materialization, Resolver review and restore preflight while preserving unisex/R11 behavior. PR #241/#242 synchronized the older acceptance gates.

Guarded Branch2 data cleanup `36699491214` then retired the exact 13 legacy wrong-gender variants found by audit. Post-state: **0 active fixed-scope mismatches** and **0 inactive variants with live stock/reservation**.

### CLOSED — Workshop semantics during Catalog retirement

The corrected rule is explicit and consistent across exact-SKU, local-group and whole execution/product retirement:

- **`active` Workshop task = hard blocker**;
- **`ready` / `done` = completed Workshop state and does not block Catalog retirement by itself**;
- stock, reservation, open-order, pending lifecycle and stocktake blockers remain independent.

Both preview and write-time race guards use the active-only condition, so a genuinely active task created between preview and mutation still stops deletion. The earlier PR #245 wording that included `ready` is superseded.

Validation `36705047496`: cumulative release-check + build — **success**.

### CLOSED — Return/Exchange intake for retired historical SKU

Read-only audit `36705983071` found **0** current pending inbound rows linked to inactive/retired SKU, so this is preventive runtime/UX hardening.

New semantics:
- an inbound Return/Exchange with an inactive historical SKU becomes explicit `retired_historical` lifecycle work;
- even when a fresh exact active lookalike already exists, the retired historical event is kept out of the one-click exact-known intake lane;
- generic fact resolution is fail-closed for this state, preventing accidental creation/revival from historical evidence;
- if a fresh exact identity already exists, the operator explicitly confirms «Принять в свежую версию»; Physical is applied only after active-SKU resolution;
- if a whole-retirement record exists, admin can explicitly restore a fresh working generation first, then confirm intake;
- the historical sold `order_items.variant_id` remains unchanged.

Warehouse Attention continues to own ordinary exact-known intake; `retired_historical` stays in the deliberate lifecycle/recovery lane instead.

Validation `36708803392`: cumulative release-check + build — **success**.

### CLOSED — unified exact-SKU / local-group retirement history

Additive migration 0079 creates a dedicated durable event table for granular retirement. It does **not** backfill/guess from legacy inactive rows, so the earlier fixed-gender cleanup is not misrepresented as operator deletion.

Current semantics:
- exact-SKU `Вывести из каталога` records one `variant` history event after the guarded soft-retirement;
- local `Удалить группу` records one `group` event after all scoped active variants are proven retired;
- whole product/execution operations remain in `catalog_retirement_operations`;
- the history read combines both sources chronologically without merging old/new SKU identity;
- only whole product/execution rows expose the existing safe restore action; granular rows remain historical evidence and show if a fresh working equivalent later exists.

UI polish in the same chunk moves `Удалить группу` into the subgroup header and gives it a larger, clearly destructive visual treatment, with a full-width mobile layout.

Branch2 D1 pre-apply `36716667655` — success. Validation `36717045662`: cumulative release-check + build — **success**.

### Separate infrastructure debt — repository Quality dependency audit

The standard Quality workflow currently fails at **Audit high-risk development dependencies** before it reaches cumulative release-check/build. The production-dependency audit passes.

This is separate from Catalog retirement semantics. Do not weaken/remove the security audit just to get a green badge. Investigate/update the flagged dev dependency in its own bounded change.

## Suggested continuation order

1. Separately resolve the high-risk dev-dependency audit.
2. Only after that, prepare a fresh main candidate from current `main`; never merge Branch2 wholesale.

For every remaining item, start from current `branch2`, add focused semantic regression, run cumulative `release:check` + build, verify exact merged SHA deploy, and keep `main` untouched unless the user explicitly changes the release boundary.
