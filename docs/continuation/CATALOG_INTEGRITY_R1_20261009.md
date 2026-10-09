# Catalog Integrity R1 — 2026-10-09

Source: `main` at `c840feb0bc`. Branch: `ci-catalog-integrity-r1-20261009`, separate from Stage04 `branch2`.

**Delivered in R1:** central **Справочники** shows all reference kinds, while working context shortcuts remain. Reference values use the same punctuation-insensitive color identity as Catalog/Arrival/Stocktake. Adding semantically equivalent active values reuses existing ID instead of duplicating it; explicitly re-adding an inactive value restores that existing ID. Renaming a reference to an already-existing legacy equivalent remains rejected. Color reference checks accept punctuation-equivalent active references. Removal errors propagate concrete reasons to the UI.

**Not done in R1:** applying any DB migration, silent merging of existing SKU/reference duplicates, touching stock/orders/payments, redesigning Writeoff, or deploying Production. Current Production audit: one reference duplicate color (`СВЕТЛО СЕРЫЙ` / `СВЕТЛО-СЕРЫЙ`), two semantic duplicate Ethno Cardigan SKU pairs (drap, 52 and 54), both pairs have zero physical stock now; separate drap from wool. Production uniqueness still compares raw spelling and requires a later schema migration after safe cleanup.

**Next:** build an administrator-friendly impact preview for reference and SKU merges, then safe transactional consolidation with stable survivor identity, conflict detection, history and post-operation invariants. Finally enforce canonical uniqueness in D1 after reconciliation. Keep operator flows non-blocking for obvious equivalent spellings. Writeoff UI postponed as requested.

## R2 read-only reference consolidation preview
- Added admin-only endpoint `GET /api/reference-values/duplicates`. Group existing same-kind entries by exactly the shared punctuation/whitespace identity key, even if inactive.
- Added admin-only endpoint `GET /api/reference-values/consolidation-preview?sourceId=...&targetId=...`: check canonical identity, target active, inspect affected catalog variants, material/length executions, current physical and reserved quantities. Bounded result and explicit truncated warning.
- Added `Порядок в справочниках` in centralized references: explicit user-triggered scan and per-duplicate preview, avoiding heavy reads on page load.
- **No endpoint for merging yet**, no write SQL in preview module; never silently transfer inventory, modify orders, rewrite history or collapse actual different materials.
- Current catalog products may have two active variants with same business identity: safe reference removal must wait until a verified SKU merge workflow exists.

R2 work continues on branch `catalog-integrity-r2-20261009` to prevent redundant full CI on every incremental `ci-*` push. The original R1 branch is preserved. Historical exact-SHA CI gate currently fails with intentional newer source edits; focused test/build does not replace full gate.

R2 also lists active Catalog SKU duplicates using exact product, execution ID, category, gender, canonical color, and size. Read current stock and reserved quantities without modifying them. Ethno cardigan drap and wool never merge by this check. This is read-only and user-initiated to conserve D1 rows.

R2 guarded admin action: only a reference value with **no active Catalog variants, no material/length executions, no physical stock or reservation** may be marked inactive in reference_values using a single atomic conditional UPDATE that rechecks targets and current source usage. Historical orders/variants, materialized inventory, quantities and customer money are never changed by this operation. Duplicate cleanup is reversible by normal admin reference activation. Full SKU merges remain a separate stage.

R2 executable SQLite acceptance covers active SKU, inactive SKU with nonzero stock, active material execution, stale-preview concurrent SKU creation, idempotent replay and preserved stock/variant rows. No existing business data is modified by the test.

## R2 guarded SKU consolidation (2026-10-09)

The administrator can select a *keeper SKU* for each detected same-execution/same-audience/same-gender/same-color-identity/same-size collision, inspect impacts on the keeper and redundant SKU, and retire the redundant active SKU when safe. This is **not** a stock transfer: the old SKU stays in the database as a historical identity; its stock row(s), movements, order items, reservation history, prices, payments and snapshots remain unchanged. Incoming operations use the still-active keeper. Keep different executions (e.g., DRAP and WOOL), audiences, genders and sizes separate.

The action refuses a source with non-zero physical stock or stock reservation, any active reservation, active unshipped order, active workshop task, pending inventory lifecycle, or active stocktake on either source or keeper. The SQL UPDATE checks these blockers atomically again and compares the inspected identity/updated_at of both SKUs before retiring. The accompanying audit INSERT uses the same D1 batch transaction; a changed preview fails instead of silently rewriting live data. Repeated same source→target submissions return an idempotent result.

**Schema deployment requirement**: first apply `migrations/0083_v72_catalog_variant_consolidations.sql` to **each intended database separately**, only after validating the migration against that environment. Then deploy the matching Worker/frontend. Code branches alone have not applied migrations; **no production or branch2 DB was changed**.

**Tests**: `node --experimental-strip-types scripts/test-catalog-integrity-r2-sku-consolidation.mjs`; focused CI invokes it. Cases cover drap-vs-wool and size mismatch, stock/reservation/order/workshop/lifecycle/stocktake blockers, concurrent stock/keeper mutation, history preservation and replay.

**Not yet supported**: merging SKUs that carry non-zero physical quantities/reserves. Their stock must not be manipulated just to clean up Catalog. A dedicated, carefully audited stock reconciliation and active reservation workflow remains a further phase. Also pending: final schema canonical uniqueness, wider operational acceptance, Writeoff UI redesign, and production deployment.
## R3 physical SKU stock consolidation (2026-10-09)

- Branch: `catalog-integrity-r2-20261009`. Admin selects a keeper, previews *warehouse and boutique* separately, and confirms the exact source+keeper physical quantities.
- New worker transaction atomically checks the inspected pair, current inventory rows, no active reservations on source, no unshipped active order, no active workshop task, no pending lifecycle, no active stocktake on either variant, and **no applied/reversible transfer involving source**.
- For every positive source stock row, increment/materialize keeper stock in the SAME location; clear the source's current quantity and retire the redundant SKU. **This is an internal identifier consolidation, not a sale, arrival, writeoff or warehouse-to-boutique transfer**. Historical order items, movements and old stock row identities remain untouched.
- Journal: `0083` parent record + `0084_v72_catalog_variant_stock_consolidation.sql` per-source snapshots and CHECK-constrained postcondition. The final validation aborts and rolls back the whole D1 batch if conservation fails. Browser supplies an exact preview token whenever any physical quantity moves; SQL repeats current-state checks at transaction time.
- Focused GitHub CI and SQLite tests cover zero-stock consolidation, warehouse and boutique rollup, keeper reservation preserved, missing keeper stock materialization, historical IDs, applied transfer blockers, stale user preview, mid-transaction stock race, explicit rollback of a corrupted postcondition, replay.
- **Migrations MUST run 0083 THEN 0084 on an intended environment before deploying its Worker/frontend**. Neither has been applied to production or branch2 D1 here. Branch-to-production merge remains on hold.
- **Open product-merging work:** active order reservations must be reconciled with live `order_items`, active `inventory_reservations`, `inventory_stock.reserved_quantity`, exchange/return links, pending handovers and audit history as one transaction. Never repoint just one of those foreign keys; do not ask operators to artificially remove reserves or write off physical units to clear an SKU duplicate. Keep such cases blocked until verified.
- **User priorities after product merging:** inspect and modernize the *Списание* workflow and interface **before** implementing comprehensive reference-value mergers.
- **Deferred reference-merging scope:** not only colors/materials/lengths/sizes, but ALL reference kinds: payment methods, delivery types, cities, return reasons, writeoff reasons and child ages. Preserve existing money/order/history snapshots, usage reporting, stable canonical choices, and clear impact previews, rather than deleting values still used by historical facts. Managers/accounts need their own identity rules; never conflate them with text dictionary values. Enforce canonical uniqueness only after cleansing and migration review.
