# 2026-10-14 — Warehouse operations/root-cause incident (BLOCKER)

## Highest priority / user instruction
**Stop reference/characteristic/SKU cleanup, Stage04, and unrelated UI work** until the user-visible warehouse discrepancy is explained and the affected operation paths are made reliable. Do not repair symptoms or silently manipulate production stock. Use **main** source schema for production truth; branch2 is NOT a production data copy. Do not merge or deploy without user-reviewed root cause, verified testing and production read-only evidence.

## Reported incident and screenshots (user 2026-10-14 ~17:52 Kazakhstan, UTC+05)
- History: completed **Arrival** to `boutique` at UI local time **14.10.26 17:37**, display **АЙНҰРЫМ-АЙ КӨЙЛЕК**, **АЙВОРИ, size 46, material АТЛАС, length СТАНДАРТ, gender ЖЕН**, delta **+1**, post-movement quantity **2**.
- User compares active **Catalog** and **Stock** pages for **АЙ-НӘЗІГІМ КӨЙЛЕК**: both show 5 variants, ATLAC and ДЖИНСА; ivory **44** with 1 in boutique; no ivory **46**. These TWO DISPLAY NAMES are DIFFERENT; determine if separate products, alias/renaming, or wrong SKU binding using `product_id`, `variant_id`, and operation reference before concluding arrival is lost.
- User reports other employees observe inventory quantities sometimes appearing and disappearing; audit all stock mutations and read paths, not only this SKU.
- Relevant images supplied in user chat; not committed to repository due to private app data.

## Confirmed source observations (main; not production DB evidence)
- `worker/domains/inventory-movement.ts::applyInventoryMovement` resolves variants and writes `inventory_stock` and `inventory_movements` in a D1 batch. A completed movement denotes quantity immediately after THAT movement, not necessarily current quantity. Arrival can create products, executions and variants in pre-materialization; requires evidence their canonical IDs are preserved and visible.
- `worker/domains/inventory-read.ts::listInventory` uses `inventory_stock` with catalog joins, and hides inactive variant/product rows **only when both quantity and reserved are zero**, except legacy null variant. Snapshot paging is handled by `src/App.tsx::loadInventoryData`.
- `worker/domains/catalog.ts::listCatalog` returns variants (including inactive) and frontend filters; `updateCatalogVariant` contains separate gender-correction merge path mutating inventory stock, movements and order links — audit carefully. `catalog-variant-consolidation`, `catalog-retirement`, undo, stocktake, transfers, sale/return/exchange and lifecycle can also move/mutate physical inventory.
- The frontend post-arrival verification in `src/App.tsx::saveInventoryMovement` checks only existence of receipt `variantId` in refreshed inventory snapshot, not the exact size/color/expected delta; re-evaluate.
- No direct Cloudflare D1 SQL connector in present tool set. GitHub access to repository is available. User can run strictly SELECT statements in Cloudflare Console if needed; NEVER request credentials, NEVER run UPDATE/DELETE in production to investigate.

## Investigation acceptance criteria
1. Identify actual `inventory_movements.id,reference_id,variant_id,product_id` for arrival at 17:37 and its stock/catalog row(s), including operation original/reversal.
2. Explain whether the mismatch is a different product, alias, wrong variant binding, subsequent mutation, stale view, archived/missing SKU, or another mechanism. Distinguish proven facts from plausible causes.
3. Audit all mutating operations: arrival, manual set, writeoff, transfer/reversal, stocktake/quick count, orders/sales, returns/exchanges/lifecycle, catalog edit/merge/delete/restore, workshop handoff and undo.
4. Implement guarded fix on isolation branch with regression for identity fidelity (product/size/material/color/source), atomic stock+movement invariants, and missing/orphaned current stock read/visibility.
5. Re-run read-only production discrepancy diagnostics for ALL SKUs with movements-vs-live stock mismatch, and verify counts from multiple paths before merge.
6. **Never** infer physical truth from history alone or automatically add/write off stock. Hold ambiguous entries for explicit physical check.

## Paused reference/duplicate-color work; retain full context
- Old `reference_values` colors 50418 `СВЕТЛО СЕРЫЙ` and 50419 `СВЕТЛО-СЕРЫЙ`; desired canonical spelling with dash. `ТЕМНО СИНИЙ` vs `ТЕМНО-СИНИЙ` appears in catalog; user prefers dash. Do not mutate now.
- Production D1 user-provided read-only inventory counts: 147 SKU within those colors, 28 with wrong spelling; those 28 have **48 warehouse / 4 boutique physical**, **3 reserved**.
- 6 direct duplicate-pair SKU groups in ЭТНО КАРДИГАН, execution POS:146 sizes 46,48,50,52,54,56; size 52 wrong-color SKU 1532 (warehouse 1 after Oct 13 arrival), proper spelling 1280 (now warehouse 0 after Oct 2 sale). Other 22 don't have exact same-business-ID keeper; SKU 1718 holds warehouse 3 boutique 1 reservations 3, open-order lines 3.
- Other wrong-spelling active affected products: АЙБЫН БОМБЕР, БАЯН СҰЛУ ШАПАН, ДАРА ШАПАН, СӘУЛЕТ ЖИЛЕТ, БЕГІМ ПОНЧО, ҰЛЫ ДАЛА ШАПАНЫ and ЭТНО КАРДИГАН.
- Read-only SQL preflight (not yet run on production) located at `scripts/audits/color-duplicates-prod-preflight-20261014.sql` on branch `audit/main-color-duplicates-readonly-20261014`. No writes executed; user asked to PAUSE all this until warehouse incident resolved.
- Branch2 source may match main on selected modules, but `branch2` DB `orders_db_branch2` != production D1 `orders_db_prod`; do not use branch2 quantities for production decisions.

## Current progress and next
Main read paths and one write path checked; two product labels appear different in screenshots and remain unverified in production. Root cause NOT YET ESTABLISHED. Next: read-only targeted SQL for 17:37 movement + current IDs and history, broader cross-operation audit; only then implement fix and rerun tests.
