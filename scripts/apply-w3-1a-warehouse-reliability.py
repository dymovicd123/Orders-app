from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one occurrence, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_count(path: str, old: str, new: str, expected: int) -> None:
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise SystemExit(f'{path}: expected {expected} occurrences, found {count}: {old[:120]!r}')
    p.write_text(text.replace(old, new), encoding='utf-8')


replace_once(
    'src/features/inventory/views/renderInventoryMovementPanel.tsx',
    "disabled={inventoryMovementBusy || !isAdmin || (inventoryDraft.movementType === 'arrival' ? inventoryArrivalSummary.rows === 0 : inventoryDraftSummary.rows === 0)}",
    "disabled={inventoryMovementBusy || (inventoryDraft.movementType === 'arrival' ? inventoryArrivalSummary.rows === 0 : inventoryDraftSummary.rows === 0)}",
)

replace_once(
    'src/App.tsx',
    """  function invalidateInventoryStockCaches(includeCatalogReview = false) {\n    setInventoryData({ warehouse: null, boutique: null })\n    if (includeCatalogReview) setCatalogReview(null)\n    warehouseAttentionSummaryCache = null\n    void loadWarehouseAttention(false, true)\n  }""",
    """  function invalidateInventoryStockCaches(includeCatalogReview = false) {\n    setInventoryData({ warehouse: null, boutique: null })\n    if (includeCatalogReview) setCatalogReview(null)\n    // W3.1A: mutations invalidate Warehouse Attention truth, but do not spend a D1 read\n    // unless the user actually opens/refreshes the recovery surface. Its own effect/action\n    // remains the single owner of detailed refreshes (W2.1 race invariant).\n    warehouseAttentionSummaryCache = null\n  }""",
)

replace_count(
    'src/App.tsx',
    "      if (postSaveShortages.length) void loadWarehouseAttention()\n",
    "",
    2,
)

package = Path('package.json')
package_text = package.read_text(encoding='utf-8')
old_tail = "node scripts/test-w2-human-warehouse.mjs && node scripts/test-w2-attention-refresh-r1.mjs\""
new_tail = "node scripts/test-w2-human-warehouse.mjs && node scripts/test-w2-attention-refresh-r1.mjs && node scripts/test-w3-1a-warehouse-reliability.mjs\""
if package_text.count(old_tail) != 1:
    raise SystemExit('package.json: release:check tail marker not found exactly once')
package.write_text(package_text.replace(old_tail, new_tail, 1), encoding='utf-8')

Path('scripts/test-w3-1a-warehouse-reliability.mjs').write_text(r'''import fs from 'node:fs'

const read = (p) => fs.readFileSync(p, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const app = read('src/App.tsx')
const movement = read('src/features/inventory/views/renderInventoryMovementPanel.tsx')
const worker = read('worker/index.ts')
const inventorySection = read('src/features/sections/InventorySection.tsx')

const block = (text, start, end) => {
  const from = text.indexOf(start)
  check(from >= 0, `Missing block start: ${start}`)
  const to = text.indexOf(end, from + start.length)
  check(to > from, `Missing block end after: ${start}`)
  return text.slice(from, to)
}

// The shared Operations submit button must not reintroduce a blanket admin-only UI gate.
check(!movement.includes("disabled={inventoryMovementBusy || !isAdmin ||"), 'Operations submit is still blanket admin-only')
check(movement.includes("disabled={inventoryMovementBusy || (inventoryDraft.movementType === 'arrival' ? inventoryArrivalSummary.rows === 0 : inventoryDraftSummary.rows === 0)}"), 'Operations submit does not use the manager-safe gate')

// The existing frontend boundary remains responsible for unknown Arrival/master-data rows.
check(app.includes("if (!isAdmin && inventoryDraft.movementType === 'arrival' && cleanItems.some((item) => !item.variantId))"), 'known-only Arrival manager boundary disappeared')
check(app.includes('Новый товар или новая характеристика требуют админ-режима'), 'unknown Arrival needs a clear admin explanation')

// Backend permission truth remains the authority: manager-safe existing-stock work, guarded expansion.
const movementsRoute = block(worker, "if (url.pathname === '/api/inventory/movements' && request.method === 'POST')", "if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')")
check(movementsRoute.includes("movementType === 'manual_set' || movementType === 'writeoff'"), 'manager-safe correction/writeoff contract missing')
check(movementsRoute.includes("movementType === 'arrival'"), 'known Arrival contract missing')
check(movementsRoute.includes("input.items.every((item) => toInt(item?.variantId, 0) > 0)"), 'known Arrival exact-variant guard missing')
check(movementsRoute.includes('requireAdminAccess(request)'), 'catalog-expanding movement must remain admin-guarded')
const transferRoute = block(worker, "if (url.pathname === '/api/inventory/transfer' && request.method === 'POST')", "if (url.pathname === '/api/catalog' && request.method === 'GET')")
check(!transferRoute.includes('requireAdminAccess(request)'), 'known-SKU transfer unexpectedly became admin-only')

// Cache invalidation must be side-effect free for Attention: no hidden D1 read after unrelated writes.
const invalidator = block(app, 'function invalidateInventoryStockCaches(includeCatalogReview = false)', 'async function loadCatalogData(force = false)')
check(invalidator.includes('warehouseAttentionSummaryCache = null'), 'Attention summary cache is not invalidated')
check(!invalidator.includes('loadWarehouseAttention('), 'inventory cache invalidation still performs a hidden Attention read')
check(!app.includes('if (postSaveShortages.length) void loadWarehouseAttention()'), 'order save still performs an unsolicited Attention read')

// W2.1 detail ownership/race protection must remain intact.
check(app.includes("const shouldLoadDetails = details || (activeSector === 'inventory' && inventoryPanel === 'attention')"), 'W2.1 detail ownership guard missing')
check(app.includes('setWarehouseAttention((current) => current?.items ? current : cached.data)'), 'W2.1 cached-summary detail preservation missing')

// Frozen Arrival interface must remain byte-for-byte recognizable.
check(inventorySection.includes('<div className="inventory-arrival-legacy-workspace">'), 'frozen Arrival workspace changed')
check(inventorySection.includes('<button className="inventory-arrival-add-position" type="button" onClick={addInventoryArrivalPosition}>+ Добавить позицию</button>'), 'frozen Arrival add-position action changed')

console.log('W3.1A WAREHOUSE RELIABILITY PASSED — manager-safe Operations restored; Attention refreshes are demand-driven; Arrival remains frozen')
''', encoding='utf-8')

Path('docs/continuation/W3_1A_WAREHOUSE_RELIABILITY_20260905.md').write_text(r'''# W3.1A — Warehouse reliability before voluntary recovery UX

Date: 2026-09-05
Base Production: `1cf1f302dfbb8e7852bdbb0e3a3a5a5a7bd02d26` (`W2.1: fix Warehouse Attention refresh race`)

## Goal

Remove two reliability regressions found by W3.0 before adding any new recovery prompts:

1. ordinary Warehouse workers must not be blocked by a blanket frontend admin gate when the existing server contract already permits safe routine operations;
2. unrelated mutations must invalidate Warehouse Attention cache without automatically spending a D1 read while the recovery surface is not being used.

## Changes

- `src/features/inventory/views/renderInventoryMovementPanel.tsx`
  - removed the blanket `!isAdmin` disable from the shared Operations submit button;
  - backend/frontend operation-specific guards remain authoritative;
  - manager can again submit existing-SKU transfer, writeoff, correction and known-variant Arrival;
  - unknown/new Arrival remains rejected by the existing frontend boundary with the explicit admin explanation, and independently by the backend.

- `src/App.tsx`
  - `invalidateInventoryStockCaches()` now only invalidates inventory/catalog-review/Attention caches;
  - it no longer starts a forced Warehouse Attention request;
  - order create/edit shortage paths no longer issue an unsolicited Attention refresh after save;
  - W2.1 detailed Attention refresh ownership remains with the Attention surface/effect/actions.

- `scripts/test-w3-1a-warehouse-reliability.mjs`
  - protects the manager-safe Operations submit path;
  - protects the backend permission matrix and known-Arrival admin boundary;
  - protects demand-driven Attention invalidation;
  - protects W2.1 race invariants;
  - protects the frozen Arrival workspace markers.

- `package.json`
  - focused W3.1A regression is chained into `release:check`.

## Invariants / exclusions

- No D1 migration.
- No Production data mutation.
- No inventory quantity or reservation business-rule change.
- No Branch2 change.
- Arrival UI remains frozen; its workspace and add-position action are unchanged.
- Unknown catalog/master-data creation remains admin-only.
- Destructive reversals remain admin-only.
- W2.1 Attention race fix is preserved.
- No visual acceptance is required for this reliability step.

## Next

After W3.1A acceptance, W3.1B can add the first voluntary micro-check on a concrete stock position, using already-loaded stock data and without turning physical verification into a blocking requirement.
''', encoding='utf-8')

print('W3.1A patch applied')
