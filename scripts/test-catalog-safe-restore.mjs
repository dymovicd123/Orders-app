import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0077_v72_catalog_safe_restore.sql')
const retirement = read('worker/domains/catalog-retirement.ts')
const inventory = read('worker/domains/inventory-movement.ts')
const worker = read('worker/index.ts')
const panel = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const historyUi = read('src/features/inventory/views/CatalogRetirementHistory.tsx')

check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_retirement_restores'), 'safe restore audit table missing')
check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_retirement_restore_variants'), 'safe restore variant mapping table missing')
check(!migration.includes('UPDATE catalog_variants') && !migration.includes('UPDATE inventory_stock'), '0077 must be additive schema only')

check(retirement.includes('export async function listCatalogRetirements'), 'retirement history read path missing')
check(retirement.includes('export async function restoreCatalogRetirement'), 'safe restore engine missing')
check(retirement.includes("UPDATE catalog_products SET is_active=1"), 'restore does not reactivate only the product shell')
check(retirement.includes('allowRetiredRecreate: true'), 'restore cannot create a fresh execution generation')
check(retirement.includes('createCatalogCombinationV3'), 'restore cannot create fresh SKU generation')
check(retirement.includes('catalog_retirement_restore_variants'), 'restore does not persist old-to-new SKU mapping')
check(!retirement.includes("UPDATE catalog_variants SET is_active=1"), 'restore must never reactivate retired SKU rows')
check(!retirement.includes("UPDATE inventory_stock SET quantity"), 'restore must never restore old physical stock')
check(retirement.includes("working_again"), 'history does not detect a variant already returned through Arrival/manual re-add')

check(inventory.includes("allowRetiredRecreate: movementType === 'arrival'"), 'only Arrival should opt into retired Catalog recreation')
check(inventory.includes('retiredProductIdsToReactivate'), 'Arrival cannot revive a retired product shell')
check(inventory.includes('lookup.byInactiveExact') && inventory.includes('lookup.byInactiveIdentity'), 'Arrival cannot find a retired product by human identity')
check(inventory.includes('retiredExecutionKeys.has(key) && !options.allowRetiredRecreate'), 'retired execution guard still blocks Arrival or is removed for all operations')
check(inventory.includes('INSERT OR IGNORE INTO catalog_stock_positions'), 'Arrival cannot create fresh execution generation')
check(inventory.includes('PHYS-'), 'Arrival fresh SKU generation does not avoid retired external-id collision')

check(worker.includes("url.pathname === '/api/catalog/retirements'"), 'Catalog retirement history endpoint missing')
check(worker.includes('catalogRetirementRestoreMatch'), 'Catalog safe restore endpoint missing')
check(worker.includes('requireAdminAccess(request)'), 'Catalog restore endpoints are not admin-guarded')

check(panel.includes('CatalogRetirementHistory'), 'Catalog does not expose deleted history')
check(historyUi.includes('Удалённые товары и исполнения'), 'human-facing deleted history title missing')
check(historyUi.includes('Физический остаток и резерв начнутся с нуля.'), 'restore confirmation does not state clean warehouse semantics')
check(historyUi.includes('Восстановить'), 'restore action missing from UI')
check(!historyUi.includes('window.confirm'), 'restore UI fell back to browser confirmation')

console.log('CATALOG SAFE RESTORE PASSED — restore creates a new working generation with clean stock/history isolation, while Arrival may reintroduce retired human variants without reviving old SKU rows')
