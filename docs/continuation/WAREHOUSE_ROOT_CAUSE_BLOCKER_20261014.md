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


## Source-code audit progress (main, Oct 14)
- **Confirmed destructive mechanism** `worker/domains/catalog-retirement.ts` lines ~922-970: catalog retirement records `inventory_movements` delete deltas, marks active reservations released, then unconditionally sets `inventory_stock.quantity=0,reserved_quantity=0` for retired variants; deactivates the linked variants and product. This CAN account for disappearing stock after delete/retire operations. Not yet proven as cause of 17:37 incident.
- `worker/domains/catalog.ts::updateCatalogVariant` gender-correction merge path around ~1350-1460 reassigns existing `inventory_movements.variant_id` and `order_items.variant_id`, merges `inventory_stock` quantities; source of rewritten identity / operational history risk, needs fixture tests.
- `worker/domains/inventory-movement.ts::applyInventoryMovement` for `arrival` with already-supplied `variantId` checks product identity/alias but (unlike `manual_set` and `writeoff`) does NOT strictly compare submitted size/color/material/length/gender to loaded canonical SKU; incorrect/stale form variant selection might be silently accepted. Distinct potential vulnerability, not yet proof for screenshot.
- `src/App.tsx::saveInventoryMovement` post-commit receipt verification only checks arrival `variantId` exists in refreshed stock list at correct source, NOT exact final inventory quantity or characteristics. Can give false confidence about visible intended size.
- `src/features/inventory/buildInventoryStockGroups.ts` groups warehouse stock by canonicalized *product name* (not underlying product ID), potentially concealing separate duplicate catalog product IDs. `worker/domains/inventory-read.ts::listInventory` resolves live catalog text and filters zeroed inactive SKUs.
- Other direct mutators inspected/located: transfers + reversal `inventory-movement.ts`, quick/full stocktake `inventory-stocktake.ts`, reservation and handover `order-reservations.ts`, lifecycle `lifecycle.ts`, returns/exchanges `returns-exchanges.ts`, SKU merges `catalog-variant-consolidation.ts`. No evidence yet that all preserve ledger equality.

## Prepared read-only scripts (investigation branch only)
- `scripts/audits/inventory-incident-arrival-20261014.sql`: all boutique arrivals around 17:37 local, exact movement SKU and live stock, subsequent movements, reversal.
- `scripts/audits/inventory-incident-product-ids-20261014.sql`: both distinct product labels and all related catalog SKU+source stock.
- `scripts/audits/inventory-global-movement-state-review-20261014.sql`: heuristic list of mismatched latest movement after-quantity vs current inventory, missing/duplicate links, inactive nonzero stock. Differences are NOT automatically missing goods; code paths may legitimately mutate inventory without identical movement semantics. No write statements.
- **PRODUCTION D1 HAS NOT BEEN QUERIED BY ASSISTANT; user must execute read-only SQL in Cloudflare D1 Console and share outputs for definitive cause.**


## Correction from user and focused role/cache finding (later same day)
- User corrected the initial screenshot: the Catalog and Stocks screenshots of **АЙ-НӘЗІГІМ КӨЙЛЕК** were WRONG product evidence for this incident. Do not report them as a discrepancy for **АЙНҰРЫМ-АЙ КӨЙЛЕК**.
- User's corrected current screenshots for **АЙНҰРЫМ-АЙ КӨЙЛЕК** show **АТЛАС / АЙВОРИ / 46 / ЖЕН**: **warehouse 0, boutique 2**. The user's stock and catalog pages agree now. An earlier employee video shows an item with **“Не хватает 1 для принятых заказов”, “На месте 0”, “В заказах 1”**. The video is cropped: selected location, SKU, full product name and capture time are not proven. DO NOT assert it is the same source/SKU/time. Strong hypothesis: employee viewing default warehouse, while user checking boutique 2; warehouse 0 with reserve 1 is a valid shortage even if boutique has 2.
- Verified GitHub/main: `worker/index.ts` /api/inventory GET, /api/inventory/attention GET and /api/catalog GET all use `env.DB` for authenticated roles; they do not branch inventory data by admin versus manager. Role changes available screens/actions, not these GET stock calculations.
- `src/features/sections/InventorySection.tsx:270` `simpleStockSource` defaults to `warehouse` for ALL roles. `renderInventoryOverviewPanel.tsx` calculates shortage = `physical - reserved` and explicitly labels negative free as `Не хватает N для принятых заказов`. It uses chosen source only. `worker/domains/warehouse-attention.ts` likewise keys reservations and physical by **inventory_source + variant_id**.
- Refresh weakness: `src/App.tsx` `INVENTORY_FORM_SNAPSHOT_TTL_MS=30_000`; `loadInventoryData` reuses cached full snapshot up to 30 sec unless forced and screen can stay open without automatic reloading. `src/app/controllers/useApiClient.ts` has fallback GET cached response up to 45 sec for operational endpoints during connection failure. Main `loadInventoryData` rejects `X-Orders-App-Stale:1`; `loadWarehouseAttention` currently DOES NOT reject stale fallback; a summary cache can be reused for 60 sec. These are plausible **temporary stale UI** mechanisms, not yet proven causes for specific video.
- `src/features/inventory/loadCompleteInventorySnapshot.ts` properly assembles pages and rejects gaps/overlaps but separate pages are not guaranteed to be a single transaction/snapshot if real-time writes occur mid-load; investigate if needed.
- NEXT immediate evidence: get uncropped employee stock panel screenshot/video with visible selected `Склад/Бутик`, product, SKU/size/color and time; compare same SOURCE+SKU same time. If warehouse 0 reserved1 and boutique 2, there is no data mismatch, but UX should show per-source explanation. If employee sees boutique 0 while admin boutique 2 simultaneously after forced refresh, investigate cache/server/live API vs DB and fix.
- No stock/movement changes or application bug patches have been made. Only this read-only investigation note committed to isolated branch. Reference cleanup remains PAUSED.
