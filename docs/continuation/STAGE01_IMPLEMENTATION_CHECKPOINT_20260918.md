# Stage 0+1 — implementation checkpoint (2026-09-18)

Status: R1 + R2 + R3 + R4 + R5 + R6 + R7 + R8 + R9 + R10 + R11 + R12 + R13 + R14 + R15 + R16 + R17 + R18 are implemented and green on the isolated feature branch. Production D1 was not touched. Do not merge/deploy this branch yet; continue Stage 0+1 in small guarded slices.

## Source of truth

- Production/main baseline at the beginning of this slice: `main`.
- Implementation branch: `feature/stage01-truth-projections-20260918`.
- Current green implementation head: `324af02d35471622d0d27649fe774e083a5ec7dd`.
- Branch2 is the isolated UI/integration proving environment. After R18 passed the full gate it was fast-forwarded to the same green head: `324af02d35471622d0d27649fe774e083a5ec7dd`.
- No Production D1 migration/write was performed.

## R1 — OrderOperationalProjection

Implemented a shared frontend projection in `src/app/orderOperationalProjection.ts`.

The projection now separates operational facts that were previously collapsed into coarse fields:

- received money;
- returned money;
- net retained money;
- debt;
- active return/exchange operation;
- archive/delete/sent state;
- concrete Workshop task state from `workshop_tasks`, with legacy `orders.workshop_status` only as fallback;
- permissions/actions such as edit, return, exchange, shipping and handover.

Important behavior:

- `return_amount > 0` no longer automatically means «the order is in Return/Exchange».
- Return/exchange UI does not automatically throw an order out of normal working flow only because historical returned money exists.
- Workshop state is derived from item/task truth first.
- The ordinary editor and order details use the same shared projection instead of reimplementing status conditions.
- Manager send/edit regressions were updated to assert the shared projection rather than old JSX inline conditions.

Permanent focused regression:
`scripts/test-stage01-order-truth-projection-r1.mjs`

## R2 — CanonicalItemProjection

Implemented shared backend item projection in `worker/domains/orders-relations.ts`:

`canonicalItemProjection(item)`

Goal: once Resolver has linked an order row to the current canonical catalog identity, the **working order** must show the current canonical product/SKU, while the immutable manager input at order creation remains separately available as history.

Rules implemented:

1. If a valid canonical product link exists, working `productName` uses the canonical catalog product name.
2. Exact canonical SKU fields (gender/color/material/length/size) are projected when an exact variant link exists.
3. Base-product-only resolution changes product/category identity but does not invent SKU characteristics; those remain from the order-time snapshot until an exact variant is linked.
4. `originalSnapshot` is returned separately and keeps:
   - product name;
   - audience/category input;
   - gender;
   - color;
   - material;
   - length;
   - size.
5. Resolver still does **not** rewrite historical snapshot columns. It links `product_id` / `variant_id`.
6. `listOrders` and `getOrder` now use exactly the same canonical/history projection.
7. Order details show the current canonical title as the main truth and add `Изначально при оформлении: ...` only when the historical title actually differs.

Frontend `OrderRecord.items` now exposes:

- `productId`;
- `variantId`;
- `catalogIdentity: 'snapshot' | 'product' | 'variant'`;
- `originalSnapshot`.

Permanent focused regression:
`scripts/test-stage01-canonical-item-projection-r2.mjs`

Exact preservation manifests:

- `scripts/stage01-canonical-item-projection-r2-worker-manifest.json`
- `scripts/stage01-canonical-item-projection-r2-frontend-manifest.json`

The 190.6A Worker and 190.6B frontend structural chains were extended narrowly rather than weakened.

## Regressions encountered while validating R2

Two old static tests correctly stopped the first cumulative runs because they encoded the previous implementation shape.

1. `test-step192b2a4-order-create-save-integrity.mjs`
   - old assertion expected `audienceType:` to be literally inside `orders-write.ts`;
   - updated to require the same invariant through shared `canonicalItemProjection`.

2. `test-catalog-order-history-preservation-r1.mjs`
   - old test required snapshot-first working order reads;
   - that contradicted the new explicit Stage 0+1 contract.
   - test now protects the actual invariant: snapshots are immutable/preserved and exposed separately, while current working identity may follow repaired canonical FKs.

No production rule was bypassed to make these tests pass.

## Final validation

R2 used temporary CI-only branch `w-stage01-check4-20260918` / draft PR #72. R3 used `w-stage01-check5-20260918` / draft PR #73. Both PRs were CI triggers only and were closed without merge.

Final successful run:

- R2 GitHub Actions run: `35327687377` — SUCCESS.
- R3 final GitHub Actions run: `35330539221` — SUCCESS.
- cumulative `npm run release:check`: SUCCESS
- production build: SUCCESS
- dependency audits: SUCCESS
- PR #72 and PR #73 were closed without merge.

The focused Stage01 R2 regression itself also passed before the remaining cumulative suite:

`STAGE01 CANONICAL ITEM PROJECTION R2 PASSED`

## R3 — Workshop / order action truth

The next audit found two concrete contradictions around Workshop state and order action entry.

### Workshop task truth

`workshop_tasks` is now the operational truth for whether Workshop work is still pending.

- `orderWorkshopPendingForShipping()` counts concrete task rows and uses coarse `orders.workshop_status` only as a compatibility fallback when an order has Workshop items but genuinely has no task records.
- A stale coarse `in_workshop` cache can no longer keep shipment blocked after all real tasks are done/cancelled.
- `updateWorkshopTask()` treats refresh of the coarse order cache as secondary after the concrete task mutation is committed. A cache-refresh failure is logged and cannot turn the successful task mutation into a false API failure.
- Workshop activity-log writes are also secondary after the mutation; log failure no longer reclassifies a committed task update as failed.
- The Workshop PATCH route best-effort reads back the fresh order and returns it to the frontend. If readback fails, it returns `refreshRequired` instead of false-failing.
- The frontend immediately `upsert`s that fresh order, so Orders and Workshop no longer disagree about readiness until a later unrelated reload.

Focused regression:
`scripts/test-stage01-workshop-truth-r3.mjs`

Exact Worker/frontend preservation layers:
- `scripts/stage01-workshop-truth-r3-worker-manifest.json`
- `scripts/stage01-workshop-truth-r3-frontend-manifest.json`

### Shared action entry

Order controller entry points now consult the same `OrderOperationalProjection` before opening or executing working actions.

Covered entry points include debt, return, exchange, edit, Workshop edit, final shipment and mistaken-shipment correction. This removes another class of drift where buttons and controller handlers could encode different lifecycle rules.

Focused regression:
`scripts/test-stage01-order-action-entry-r3.mjs`

Exact frontend layer:
`scripts/stage01-order-action-entry-r3-frontend-manifest.json`

The existing manager/autonomy regressions were updated only where they had been asserting obsolete inline JSX/controller conditions. They now protect the same safety boundary through the shared projection.

## R4 — Finance correction commit/readback boundary

The money/finance audit found one concrete reliability contradiction in `correctExchangeFinancials()`.

Before R4, the exchange financial correction could successfully commit the payment/refund/exchange/order/cash changes and synchronize the order ledger, then call `getOrder()` before `completeCriticalOperation()`. A transient secondary read failure at that point could report the already-committed money correction as failed and leave the idempotent operation in a misleading state.

R4 aligns this path with the safer Return/Exchange patterns already used elsewhere:

- after the business writes and `syncOrderFinancialLedger()` succeed, the critical operation is completed immediately with a minimal successful response and `refreshRequired: true`;
- order readback happens only after completion and is best-effort;
- successful readback enriches only the first response with `order` and `refreshRequired: false`;
- readback failure logs a warning and keeps the operation successful;
- activity logging remains secondary and cannot false-fail the correction;
- the unchanged/idempotent branch uses the same readback isolation.

Focused regression:
`scripts/test-stage01-finance-correction-reliability-r4.mjs`

Exact Worker preservation layer:
`scripts/stage01-finance-correction-reliability-r4-worker-manifest.json`

Final validation:
- temporary draft PR #74, closed without merge;
- GitHub Actions Quality check run `35331323128`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R5 — Return/Exchange Workshop cache reliability

The follow-up lifecycle audit found the same commit-boundary hazard around the legacy coarse Workshop cache in Return/Exchange operations.

Concrete Return/Exchange mutations already update the real lifecycle/task truth first. R5 makes the later `refreshOrderWorkshopStatusFromTasks()` call best-effort in:

- return creation;
- exchange creation;
- return cancellation;
- exchange cancellation.

A transient failure while refreshing `orders.workshop_status` can therefore no longer turn already-committed lifecycle work into an API failure. The authoritative records remain the concrete Return/Exchange rows, inventory lifecycle records, and `workshop_tasks`; the coarse order field remains compatibility/cache only.

Focused regression:
`scripts/test-stage01-return-exchange-workshop-cache-r5.mjs`

Exact Worker preservation layer:
`scripts/stage01-return-exchange-workshop-cache-reliability-r5-worker-manifest.json`

Final validation:
- temporary draft PR #75, closed without merge;
- GitHub Actions Quality check run `35332084525`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R6 — Unshipped queue no longer depends on refund history

The remaining Orders read path still had one old lifecycle shortcut: `shippingStatus=not_sent` excluded every order with `return_amount > 0`.

That contradicted the shared Stage 0+1 contract. A partial or historical refund is a money fact and must not make an otherwise active, physically unshipped order disappear from the ordinary `Не отправлено` work queue.

R6 removes that dependency. The visible shipping filter now follows `shipping_status` only.

The legacy explicit `status=returned` API filter is intentionally left unchanged in this narrow slice; R6 fixes only the current user-facing shipping queue and does not broaden into API compatibility semantics.

Focused regression:
`scripts/test-stage01-unshipped-refund-decoupling-r6.mjs`

Exact Worker preservation layer:
`scripts/stage01-unshipped-refund-decoupling-r6-worker-manifest.json`

Final validation:
- temporary draft PR #76, closed without merge;
- GitHub Actions Quality check run `35332881155`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R7 — Bulk Workshop cache is secondary

The remaining Workshop write path `bulkUpdateWorkshopTasks()` still transaction-coupled the coarse `orders.workshop_status` cache to the authoritative task/item mutations.

R7 separates those layers:

- bulk `workshop_tasks` and linked `order_items` changes still commit together atomically;
- only after that concrete truth commits, the affected orders are deduplicated;
- one bounded cache refresh updates `orders.workshop_status` for those order ids;
- cache refresh failure is caught and logged and cannot roll back or false-fail the valid Workshop bulk work.

This completes the same task-first/cache-second rule already used by single Workshop actions and Return/Exchange paths.

Focused regression:
`scripts/test-stage01-workshop-bulk-cache-r7.mjs`

Exact Worker preservation layer:
`scripts/stage01-workshop-bulk-cache-reliability-r7-worker-manifest.json`

Validation:
- first CI run exposed only a coordinate bug in the new static regression; production code had already built and the preceding release checks were green;
- the regression was corrected without changing business code;
- final temporary draft PR #77, closed without merge;
- GitHub Actions Quality check run `35333766883`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R6 — Unshipped/refund truth decoupling

The Orders read-path still contained one legacy truth collapse: the `shippingStatus=not_sent` filter also required `return_amount <= 0`.

That meant an active order with any historical or partial refund could disappear from the ordinary “Не отправлено” work queue even though its actual shipping fact was still `shipping_status <> 'sent'`.

R6 removes that coupling. The unshipped filter now follows shipping truth only.

Important scope boundary:
- this slice does not redefine the separate legacy `status=returned` API filter;
- it only prevents refund history from hiding otherwise active unshipped work.

Focused regression:
`scripts/test-stage01-unshipped-refund-decoupling-r6.mjs`

Exact Worker preservation layer:
`scripts/stage01-unshipped-refund-decoupling-r6-worker-manifest.json`

Final validation:
- temporary draft PR #76, closed without merge;
- GitHub Actions Quality check run `35332881155`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R7 — Workshop bulk cache reliability

The bulk Workshop mutation still coupled concrete task/item updates with the coarse `orders.workshop_status` cache inside the same batch.

R7 separates them:
- concrete `workshop_tasks` and `order_items` changes commit atomically first;
- affected order ids are deduplicated afterwards;
- the coarse order cache is refreshed with one bounded `json_each(?)` update;
- cache refresh is best-effort and cannot false-fail already-committed Workshop work.

Focused regression:
`scripts/test-stage01-workshop-bulk-cache-r7.mjs`

Exact Worker preservation layer:
`scripts/stage01-workshop-bulk-cache-reliability-r7-worker-manifest.json`

Validation:
- temporary draft PR #77, closed without merge;
- GitHub Actions Quality check run `35333766883`: SUCCESS.

## R8 — Debt workspace canonical item truth

The Debt workspace still rendered item identity from historical snapshots before current catalog identity, unlike the main Orders read path.

R8 makes the live Debt workspace consume the same shared `canonicalItemProjection()` used by Orders:
- repaired/current product and exact SKU identity are projected first when canonical links exist;
- order-time snapshots remain loaded and preserved as fallback/history;
- the old snapshot-first Debt-only interpretation is removed.

The old catalog-history regression was updated so it still protects immutable snapshots without forcing stale identity into the live Debt view.

Focused regression:
`scripts/test-stage01-debt-canonical-item-r8.mjs`

Exact Worker preservation layer:
`scripts/stage01-debt-canonical-item-r8-worker-manifest.json`

Validation:
- temporary draft PR #78, closed without merge;
- GitHub Actions Quality check run `35335232585`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R9 — Workshop canonical item truth

The live Workshop read path still enriched product/SKU labels snapshot-first even after Orders and Debt had moved to the shared canonical item projection.

R9 keeps Workshop matching/recovery behavior intact but changes the displayed working identity:
- linked `order_items` now load the current canonical product name alongside immutable snapshots;
- exact linked SKU identity is projected through `canonicalItemProjection()`;
- base-product-only or legacy inferred variant matches do not get promoted into exact canonical SKU truth;
- the existing inferred `resolved_variant_id` remains available for legacy matching/recovery, but `canonicalItemProjection()` sees the real `oi.variant_id` only;
- immutable order/task snapshots remain unchanged in D1 and continue to serve as matching/fallback evidence.

This is read-model-only. No Workshop/order snapshot column is rewritten.

Focused regression:
`scripts/test-stage01-workshop-canonical-item-r9.mjs`

Exact Worker preservation layer:
`scripts/stage01-workshop-canonical-item-r9-worker-manifest.json`

Validation:
- temporary draft PR #79, closed without merge;
- GitHub Actions Quality check run `35336256637`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.

## R10 — Workshop lifecycle canonical links

The Return/Exchange lifecycle audit found a deeper Workshop contradiction after R9.

A Workshop order line could already have a repaired exact `variant_id` / `product_id`, but new physical lifecycle work still re-resolved Workshop identity from old text snapshots first. That could turn a repaired exact line back into unresolved/pending inventory work or resolve against an obsolete product name.

R10 changes the resolution order:
- a valid explicit `order_items.variant_id` is trusted first for both ordinary and Workshop lines via `loadCanonicalVariantSnapshot()`;
- if Workshop has only a repaired base `product_id`, that product id is preferred over old free-text product name while exact combination matching still uses recorded SKU facts;
- if the explicit link is stale/invalid, the old independent snapshot-based fallback remains available;
- freshness/full-stocktake guards and one-shot lifecycle application are unchanged.

Focused regression:
`scripts/test-stage01-workshop-lifecycle-canonical-link-r10.mjs`

Exact Worker preservation layer:
`scripts/stage01-workshop-lifecycle-canonical-link-r10-worker-manifest.json`

Validation:
- first CI run exposed the structural 192A1-added-declaration gate; the manifest wrapper was corrected without weakening the baseline;
- second CI run exposed one TypeScript narrowing issue; typing and exact manifest were corrected;
- final temporary draft PR #80 was closed without merge;
- GitHub Actions Quality check run `35337039333`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS.


## R11 — Pending lifecycle follows repaired current links

The post-R10 audit found one remaining split between repaired order truth and already-created pending physical lifecycle rows.

A pending `inventory_lifecycle_events` row intentionally keeps immutable event-time snapshots. After Resolver later repairs the linked `order_items.product_id` / `variant_id`, however, the live pending intake workflow was still trying to resolve only from the old lifecycle row first. That could leave a physically pending item in manual clarification even though its linked order item already had an exact canonical identity.

R11 keeps the historical event snapshot immutable but makes live pending-work views/actions consult the current linked order item first:

- known-intake reconciliation prefers current linked `order_items.product_id` / `variant_id`, then falls back to the event snapshot/link;
- lifecycle context pre-fills current canonical variant facts when a repaired exact link exists;
- the pending lifecycle list exposes current canonical FKs while keeping event-time text snapshots as evidence;
- Warehouse Attention classifies such repaired pending inbound rows as known intake, so the ordinary “accept known item” action is available;
- no lifecycle snapshot column is rewritten.

Focused regression:
`scripts/test-stage01-pending-lifecycle-current-links-r11.mjs`

Exact Worker preservation layer:
`scripts/stage01-pending-lifecycle-current-links-r11-worker-manifest.json`

Structural-gate note:
the first R11 CI attempts exposed only integration problems in the cumulative 190.6A preservation wrapper. The final solution validates the exact R11 after-blocks, temporarily normalizes only those exact deltas back to their predecessors, and then runs the complete legacy structural hash chain. This avoids weakening or guessing historical baselines.

Validation:
- temporary draft PR #81, closed without merge;
- GitHub Actions Quality check run `35339510564`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- Branch2 fast-forwarded to the same green R11 head `fc797f5da88ddb5eaa409b2101583c8910529b7f`.


## R12 — Resolver and active reservation stay one physical truth

The audit found a high-risk split in the live shipping path. Resolver could repair `order_items.product_id / variant_id`, while an already-active `inventory_reservations` row kept pointing at the previous SKU. The order could therefore display one canonical SKU while final handover physically decremented another.

R12 makes active unsent Resolver repair reservation-first:

- an active reservation is compared with the Resolver target by source, exact variant and quantity;
- a matching active reservation keeps its id/lineage and only refreshes the redundant product FK;
- a mismatching active reservation is released first so the old SKU's `reserved_quantity` is corrected, then its current-state row is replaced by an exact reservation for the Resolver target;
- unresolved/released placeholder reservations are removed before exact reservation creation;
- a retry marker keeps the order item in `catalog_unresolved` if replacement reservation creation fails;
- the committed reservation is re-read and must match active source/product/variant/quantity before the new canonical identity is published on the order item;
- fulfilled/already-issued physical history is never re-reserved;
- sent/historical order behavior remains identity-only and does not manufacture present-day stock movement.

Focused regression:
`scripts/test-stage01-resolver-active-reservation-r12.mjs`

Exact Worker preservation layer:
`scripts/stage01-resolver-active-reservation-r12-worker-manifest.json`

Validation:
- first CI run exposed only an over-broad coordinate in the new focused regression; business code and the preceding cumulative release check were already green;
- final temporary draft PR #82 was closed without merge;
- GitHub Actions Quality check run `35340711953`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- Branch2 fast-forwarded to `3d1e28748d0892126f2deb7ca30b6bfa98f5f5c3`.


## R13 — Handover displays the physical canonical SKU

After R12 aligned Resolver and active reservations, the next live-read audit found that the handover/shipping UI still labelled items from immutable order-time snapshots. That could show an old name/size while the physical reservation — and therefore the final stock decrement — correctly pointed at the repaired canonical SKU.

R13 changes live handover/shipping presentation only:

- detailed handover rows prefer the canonical product/SKU behind the active reservation;
- if there is no reservation-side canonical identity, current `order_items.product_id / variant_id` is the next fallback;
- immutable order-time snapshots remain the final fallback and are not rewritten;
- the handover UI model renders those working canonical fields;
- shipping preparation/error labels prefer the product attached to the physically reserved SKU;
- shipment blocker/shortage diagnostics also report current canonical product identity where available.

No immutable movement/history snapshot is rewritten.

Focused regression:
`scripts/test-stage01-handover-physical-canonical-identity-r13.mjs`

Exact Worker preservation layer:
`scripts/stage01-handover-physical-canonical-identity-r13-worker-manifest.json`

Validation:
- first CI run exposed only an outdated SQLite fixture in the old 192B2A3 SQL-compilation regression; it did not create the catalog tables now legitimately joined by the live handover query;
- the fixture was extended to include the relevant catalog tables/columns;
- final temporary draft PR #83 was closed without merge;
- GitHub Actions Quality check run `35344170743`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- Branch2 fast-forwarded to `d8af03c492db9b44629578ecfcd94c72b4177aef`.


## R14 — Order search follows canonical item identity

The working Orders list already rendered repaired canonical product/SKU identity, but its search index still contained only immutable order-time item snapshots. After Resolver repair, an operator could therefore see a corrected product name in the row and still fail to find that same order by the corrected name/SKU.

R14 aligns working search with the same truth model without erasing history:

- short (<3 Unicode character) item search joins current `catalog_products` / `catalog_variants` and searches canonical identity plus historical snapshots;
- the bounded >=3-character trigram FTS path remains in place for D1 read-budget safety;
- additive migration `0070_v72_stage01_canonical_order_search.sql` rebuilds only the derived `order_search_items_fts` index with canonical + snapshot vocabulary;
- order-item FTS triggers now refresh on `product_id` / `variant_id` repair as well as snapshot changes;
- catalog product-name and variant-detail edits refresh linked order search rows;
- old snapshot vocabulary remains searchable after Resolver/catalog repair;
- no order, item, payment, catalog or historical business row is rewritten by the migration.

Focused regression:
`scripts/test-stage01-canonical-order-search-r14.mjs`

Exact Worker preservation layer:
`scripts/stage01-canonical-order-search-r14-worker-manifest.json`

Validation:
- the first CI run correctly rejected the new migration until it was registered as an accepted additive migration; its filename was also corrected from the tentative `0073` to the actual next sequence `0070`;
- later focused-test failures were test-coordinate/FTS-trigram fixture issues only; the cumulative gate and build preceding them were green;
- final temporary draft PR #84 was closed without merge;
- GitHub Actions Quality check run `35345556890`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- database safety reports 73 preserved migration files;
- Branch2 fast-forwarded to `a12c9c5307f7d147a17881ff6e846b08ff92ebbc`.

Important Branch2 proving note:
the migration file is now present in Branch2 source, but this Stage01 work did **not** execute D1 migrations. Before interactive R14 canonical-search testing in Branch2, apply the normal Branch2 migration path so `0070_v72_stage01_canonical_order_search.sql` reaches `orders_db_branch2`. Production D1 remains untouched.


## R15 — Return/Exchange item availability is current-state truth

The Return/Exchange audit found that the forms still treated the original order-line quantity as if all units were always available for another operation.

That was wrong after a standalone return: an item with quantity 3 and an already-completed standalone return of 1 could still offer all 3 units again. Exchange UI had the same risk, including multiple unsaved old-item pairs in one draft.

R15 adds an explicit current-state item operation availability projection:

- backend relation loading sums non-cancelled standalone returned quantity per `order_item_id`;
- return rows owned by an active exchange are excluded from the standalone-return subtraction so exchange accounting is not double-counted;
- if that exchange is cancelled, its formerly owned refund return becomes standalone evidence again;
- `orderItemAvailableOperationQuantity()` computes `max(0, current quantity - active standalone returned quantity)`;
- `listOrders` and `getOrder` expose `availableOperationQuantity` on each working order item;
- Return draft construction uses that value, omits fully exhausted positions and labels the column “Доступно к возврату”;
- Exchange draft/save validation uses the same backend-derived remaining quantity;
- queued unsaved exchange pairs reserve their quantities locally so one draft cannot over-allocate the same old order item several times.

Historical Return/Exchange records remain historical; R15 changes only the current availability of a live order item for another operation.

Focused regression:
`scripts/test-stage01-return-exchange-item-availability-r15.mjs`

Exact preservation layers:
- `scripts/stage01-return-exchange-item-availability-r15-worker-manifest.json`
- `scripts/stage01-return-exchange-item-availability-r15-frontend-manifest.json`

Validation:
- temporary draft PR #85, closed without merge;
- GitHub Actions Quality check run `35347157116`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- Branch2 fast-forwarded to `5db747e685f7e94b30edc26210c705cef5a9e3e4`.

## R16 — Live inventory stock follows current canonical identity

The remaining live Stock read path still rendered and searched `inventory_stock` snapshot labels first even when the row had a valid current catalog link. That could leave ordinary Warehouse stock showing an old product/SKU label after catalog identity repair while shortage/handover paths already followed the canonical variant.

R16 classifies `inventory_stock` as current physical state and keeps movement rows historical:

- the live stock query joins the current canonical product/variant behind `variant_id` / `product_id`;
- current product/SKU fields are projected first for ordinary stock display;
- old stock snapshot vocabulary remains in search as fallback/history so legacy terms still find the row;
- live stock sorting follows the projected working identity rather than stale snapshot text;
- `inventory_movements` remains event-time snapshot evidence and is not converted to canonical-first;
- no stock or movement row is rewritten.

Focused regression:
`scripts/test-stage01-inventory-current-canonical-identity-r16.mjs`

Exact Worker preservation layer:
`scripts/stage01-inventory-current-canonical-identity-r16-worker-manifest.json`

Validation:
- the first two CI runs failed safely only in the cumulative 190.6A structural wrapper because the new manifest block had declaration-boundary formatting that did not match the AST-normalized declaration;
- the manifest boundary was normalized without changing business code;
- final temporary draft PR #86 was closed without merge;
- GitHub Actions Quality check run `35351019907`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- Branch2 fast-forwarded to `867fdaae5d15a66a38da195d05d47eca62ccbd2b`.

## R17 — Known-intake attention shows the exact current SKU

Warehouse Attention already knew when a pending inbound lifecycle event had an exact current catalog variant and allowed the operator to press “Принять в остаток” directly. The action itself targeted the exact variant, but the card still displayed the event-time snapshot identity first. After Resolver/catalog repair that could show one product/SKU label while the button would receive another canonical SKU.

R17 makes only the direct known-intake action canonical-first:

- pending lifecycle rows still preserve immutable event snapshots;
- when an inbound event has an exact current variant, Warehouse Attention additionally loads that exact product/SKU;
- the operator-facing known-intake card publishes the current canonical product, category and SKU details before the receipt action;
- unresolved lifecycle rows remain snapshot/evidence-first because their current identity is not yet known;
- no lifecycle event, order item or inventory row is rewritten.

Focused regression:
`scripts/test-stage01-known-intake-current-canonical-identity-r17.mjs`

Exact Worker preservation layer:
`scripts/stage01-known-intake-current-canonical-identity-r17-worker-manifest.json`

Validation:
- the first CI attempt failed safely in the cumulative 190.6A wrapper because R11 and R17 touch the same Warehouse Attention declaration and the older R11 normalization ran first;
- the structural wrapper was corrected to unwind the newest R17 declaration before the older R11 nested delta;
- temporary draft PR #87 was closed without merge;
- GitHub Actions Quality check run `35352382922`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- Branch2 fast-forwarded to `00385e30547edafba4cc798115dee8897f3f2dd3`.

## R18 — Found-stock direct binding shows the exact current SKU

Warehouse Attention also has a direct “Связать с вариантом” action for a physical stock row found during revision once the backend can identify one exact current catalog variant. Before R18, the card still rendered the unresolved stock snapshot identity even though the direct action would bind that row to the exact current SKU.

R18 aligns the pre-action read model with the existing binding target:

- unresolved found-stock rows remain immutable physical/snapshot evidence;
- when an exact variant candidate exists, Attention additionally loads its current product/SKU identity;
- the direct-bind card shows that current product, category and SKU before the operator confirms the link;
- rows without an exact candidate remain snapshot/evidence-first and still require admin review;
- the existing `reconcileFoundInventoryStock` mutation path is unchanged.

Focused regression:
`scripts/test-stage01-found-stock-current-canonical-identity-r18.mjs`

Exact Worker preservation layer:
`scripts/stage01-found-stock-current-canonical-identity-r18-worker-manifest.json`

Validation:
- the first CI attempt passed the structural gate but exposed a weak legacy B2A2 regression assertion: it had accidentally detected `exactKnown: Boolean` in the found-stock model instead of checking the lifecycle projection it was meant to guard;
- that regression was narrowed to the actual lifecycle projection, without changing R18 business behavior;
- temporary draft PR #88 was closed without merge;
- final GitHub Actions Quality check run `35352886204`: SUCCESS;
- cumulative release gate: SUCCESS;
- production build: SUCCESS;
- dependency audits: SUCCESS;
- Branch2 fast-forwarded to `324af02d35471622d0d27649fe774e083a5ec7dd`.

## Current safety boundary

Do not touch Production D1 while Stage 0+1 is still being assembled.

Branch2 is the UI/integration proving ground. Keep assembling guarded Stage01 slices on the feature branch; when a coherent group is ready for interactive UI/end-to-end validation, move that group into Branch2 rather than testing it in Production.

Do not rewrite order snapshots during Resolver repair.

Do not let a shared projection become a hidden mutation layer: projection is read-model logic only.

Do not collapse return money, return workflow, shipping, Workshop, and catalog identity into one coarse order status.

## Next work

R1–R18 are green. Continue auditing remaining live action surfaces separately from historical evidence. Do not mechanically convert historical/audit views to canonical-first.

Priority targets:

1. find any remaining working-order screens/actions that still infer current item identity from snapshot text instead of the canonical projection;
2. find any remaining order actions that still infer active Return/Exchange or Workshop state from coarse legacy fields instead of `OrderOperationalProjection`;
3. keep historical/finance/audit views intentionally historical where appropriate rather than mechanically converting every screen to canonical-first;
4. only after that audit, take the next smallest Stage 0+1 slice and add its own focused regression + exact structural layer.



# Stage01 completion checkpoint — R19 through final Branch2 proving

## R19 — explicit Return/Exchange downstream truth

R19 removed the misleading `hasActiveReturnOperation` abstraction and made committed Return and Exchange history explicit in the order read model.

Current order payloads expose:
- `committed_return_count`;
- `committed_exchange_count`;
- current projection facts for committed Return/Exchange state.

The frontend no longer treats Return history as a fake active lifecycle state. Structural edit protection follows any committed downstream operation, while Return/Exchange entry itself remains governed by remaining quantity/domain validation.

Validation:
- final R19 head: `bcfe9c7eeae360a244872a0cb2eb06dc732418db`;
- Quality check run `35357677429`: SUCCESS;
- D1 query fan-out remained within the existing bounded limit.

## R19B — money-only Return no longer dead-ends physical outbound flow

The post-R19 audit proved that a money-only Return can legitimately exist before physical shipment. Treating every completed Return as a physical downstream operation blocked a still-valid outbound obligation.

R19B separates:
- any committed downstream financial/history operation;
- committed physical downstream operation.

A money-only Return still protects structural order history, but does not block physical shipment/handover. Item-linked Returns and Exchanges remain physical blockers.

Validation:
- final head: `a044cfcaf5b4b2225cdf346cf2137184b920df6a`;
- Quality check run `35358733752`: SUCCESS;
- focused projection regression executes money-only Return, item Return, Exchange, and legacy payload behavior.

## R20 — new stocktake sessions capture current catalog identity

Starting a new stocktake after a catalog rename previously copied stale `inventory_stock.product_name_snapshot`.

R20 makes a new stocktake snapshot the current canonical product identity when a valid current catalog link exists, while preserving the older stock snapshot as fallback/history and leaving already-created stocktakes unchanged.

Validation:
- final head: `4170ab0298cadfe55fa04730fab579faac81ef6e`;
- Quality check run `35359369178`: SUCCESS.

## R21 — lifecycle manual queue no longer duplicates exact-known inbound

Exact-known inbound lifecycle work already belongs to Warehouse Attention's normal intake lane. R21 removes those rows from the admin manual-resolution queue while keeping unresolved inbound and outgoing physical lifecycle work there.

Historical lifecycle event snapshots remain immutable.

Validation:
- final head: `b05b866580005de88028ab426a9e3b3bef329f15`;
- Quality check run `35360065135`: SUCCESS.

## Post-fix cross-regression

A dedicated cross-regression now proves R19/R19B/R20/R21 and R14 remain mutually consistent rather than merely passing isolated tests.

It covers:
- plain order actions;
- money-only Return;
- item Return;
- Exchange;
- cancelled downstream history;
- sent-order correction protection;
- Workshop readiness after refund;
- combined Return/Exchange relation arithmetic;
- current-canonical stocktake seeding without snapshot rewrite;
- lifecycle queue ownership;
- R14 derived-search boundaries.

Branch2 head after adding that guard:
`21b6ad6bbe066d7c11ced060507c4ccff2d5e7f6`

Quality check run `35361865692`: SUCCESS, including:
- cumulative regression gate;
- R19, R19B, R20, R21;
- post-fix cross-regression;
- D1 capacity/read-budget regressions;
- production build;
- production and high-risk dependency audits.

## Branch2 live proving

A live mutation E2E was executed against the isolated deployed Branch2 Worker, not Production.

Successful path:
1. create Workshop order;
2. read it back;
3. find it through order search;
4. create Exchange without refund;
5. verify Exchange readback;
6. cancel Exchange and verify original item restoration;
7. create money-only Return;
8. verify it is not classified as an item Return;
9. mark restored Workshop task ready;
10. ship the order successfully despite the money-only Return;
11. cancel the Return;
12. verify downstream counts clear.

Live result:
- run `35364377476`: SUCCESS;
- test order `QA-S01-5364377476`, Branch2 order id `13`;
- final shipping state: `sent`.

This is the strongest current evidence that the recent fixes did not repair one path by breaking the adjacent Return/Exchange/Workshop/shipping path.

## Branch2 migration ledger repair

Branch2 D1 had a stale `d1_migrations` ledger ending at `0044` even though the actual schema/data markers for `0045`–`0070` were already present.

A guarded Branch2-only repair:
- proved the expected tables/indexes/triggers and critical columns existed;
- proved major data-migration markers were present;
- proved R14 FTS row coverage matched `order_items`;
- inserted only the missing migration names into `d1_migrations`;
- did not replay migration SQL;
- did not touch business tables.

Repair run `35366366986`: SUCCESS.

After repair:
- 26 ledger entries `0045`–`0070` are present;
- Wrangler reports `No migrations to apply!`.

Production D1 was not touched.

## Current Stage01 state

Branch2 code head:
`21b6ad6bbe066d7c11ced060507c4ccff2d5e7f6`

Stage01 R1–R21 is now implementation-complete and cross-validated on Branch2. The current release gate and live E2E did not expose a new regression caused by R19–R21.

The next step is no longer another speculative Stage01 fix. It is a release/promotion decision and production rollout plan with explicit backup, migration-ledger verification and smoke checks before any Production mutation.
