import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0076_v72_catalog_safe_retirement.sql')
const retirement = read('worker/domains/catalog-retirement.ts')
const catalog = read('worker/domains/catalog.ts')
const reservations = read('worker/domains/order-reservations.ts')
const orderWrites = read('worker/domains/orders-write.ts')
const inventory = read('worker/domains/inventory-movement.ts')
const relations = read('worker/domains/orders-relations.ts')
const worker = read('worker/index.ts')
const executionUi = read('src/features/inventory/views/catalogPolishExecutionGroups.tsx')
const productUi = read('src/features/inventory/views/renderInventoryCatalogPanel.tsx')
const retirementUi = read('src/features/inventory/views/CatalogRetirementAction.tsx')

// Audit schema is additive; historical facts are never deleted.
check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_retirement_operations'), 'retirement operation audit table missing')
check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_retirement_variants'), 'retirement variant snapshot table missing')
check(!migration.includes('DELETE FROM order_items') && !migration.includes('DELETE FROM inventory_movements'), 'retirement migration must not delete order/movement history')

// Retirement is a working-state operation, not a history rewrite.
check(retirement.includes("export async function previewCatalogRetirement"), 'retirement preflight missing')
check(retirement.includes("export async function retireCatalogEntity"), 'retirement apply engine missing')
check(retirement.includes("s.status='active'") && retirement.includes("e.status='pending'"), 'active stocktake/pending lifecycle blockers missing')
check(retirement.includes('inactiveOperationalVariantCount'), 'inactive retired-SKU operational-state preflight missing')
check(retirement.includes("v.stock_position_id=sp.id AND v.is_active=1 AND wt.status = 'active'"), 'execution retirement lacks write-time active Workshop blocker')
check(retirement.includes("v.product_id=p.id AND v.is_active=1 AND wt.status = 'active'"), 'product retirement lacks write-time active Workshop blocker')
check(!retirement.includes("wt.status IN ('active','ready')"), 'ready Workshop work must not block local/whole retirement')
check(catalog.includes("WHERE variant_id = ? AND status = 'active'"), 'exact-SKU retirement must block only active Workshop work')
check(catalog.includes("WHERE product_id = ? AND status = 'active'"), 'product deactivation guard must block only active Workshop work')
check(!catalog.includes("status IN ('active', 'ready')"), 'ready Workshop work still blocks legacy Catalog deactivation guard')
check(retirement.includes('Нельзя удалить позицию, пока по ней есть незавершённая задача Цеха'), 'whole retirement does not fail closed on active Workshop work')
check(retirement.includes('у ранее выведенной позиции найден живой остаток или резерв'), 'whole retirement does not quarantine inactive SKU stock/reservation anomalies')
check(retirement.includes('const integrityPreview = await previewCatalogRetirement') && retirement.includes('Восстановление остановлено: у исторической неактивной позиции найден живой остаток или резерв'), 'restore ignores inactive SKU operational anomalies')
check(retirement.includes("SET status='released'") && retirement.includes("unresolved_reason='catalog_retired'"), 'active reservations are not safely released')
check(retirement.includes("stock_writeoff_status='catalog_retired'"), 'open order items are not marked as retired from warehouse semantics')
check(retirement.includes(').bind(now, entityId, requestId)'), 'retirement variant capture binds captured_at/entity id in the wrong order')
check(!retirement.includes(').bind(entityId, now, requestId)'), 'known retirement capture binding bug returned')
check(retirement.includes('const hasWorkingState = preview.active'), 'partially retired execution/product cannot be repaired on retry')
check(retirement.includes('repair_v.stock_position_id = sp.id') && retirement.includes('repair_v.product_id = p.id'), 'incomplete retirement repair guard missing')
check(retirement.includes('const after = await previewCatalogRetirement'), 'retirement does not verify that working state is actually gone')
check(retirement.includes("SET quantity=0, reserved_quantity=0"), 'retired SKU stock is not removed from working inventory')
check(retirement.includes("SET is_active=0") && retirement.includes('UPDATE catalog_stock_positions') && retirement.includes('UPDATE catalog_products'), 'execution/product retirement does not deactivate working Catalog identity')
check(retirement.includes("'delete'") && retirement.includes("'catalog_retirement'"), 'physical removal lacks inventory movement audit')
check(!retirement.includes('DELETE FROM order_items') && !retirement.includes('DELETE FROM catalog_variants') && !retirement.includes('DELETE FROM inventory_stock'), 'safe retirement must keep historical rows')

// Background/runtime resolution must never resurrect retired identity.
// A deliberate NEW order save may create a fresh working generation; history stays retired.
check(catalog.includes('export async function findRetiredCatalogExecutionV3'), 'retired execution lookup missing')
check(catalog.includes('if (!options.allowRetiredRecreate)'), 'automatic execution recreation guard missing')
check(catalog.includes('allowRetiredRecreate: true'), 'explicit Catalog admin recreation path missing')
check(catalog.includes('reactivated: true'), 'explicit re-add of a retired product shell is missing')
check(catalog.includes("SET category = ?, gender_scope = ?, is_active = 1"), 'retired product shell is not reactivated without restoring old executions/SKUs')
check(catalog.includes('Нельзя создать позицию у удалённого исполнения или товара'), 'combination creation can target inactive Catalog identity')
check(reservations.includes("matchStatus: 'unresolved_execution'"), 'default resolver does not stop at retired execution')
check(reservations.includes('findRetiredCatalogCombinationV3'), 'default resolver can silently recreate a retired exact SKU')
check(reservations.includes("retiredCombination?.id && !allowRetiredRecreate"), 'retired exact-SKU guard is not fail-closed by default')
check(reservations.includes("retiredExecution?.id && !allowRetiredRecreate"), 'retired execution guard is not fail-closed by default')
check(reservations.includes("retiredProductShell") && reservations.includes("SET is_active = 1, updated_at = ?"), 'explicit order path cannot reactivate only the retired product shell')
check(reservations.includes("allowRetiredRecreate ? { allowRetiredRecreate: true } : {}"), 'explicit retired execution recreation option is not scoped')
check(reservations.includes("-ORD-"), 'fresh order-driven SKU generation does not avoid retired external-id collision')
check(orderWrites.includes("confirmedRetiredKeys.has(catalogOrderInputKey(item))"), 'new-order save does not scope retired recreation to an explicit exact-item confirmation')
check(orderWrites.includes("resolveCatalogProductAndVariant(db, item, createdAt, { allowRetiredRecreate })"), 'confirmed new-order save does not pass the scoped retired recreation option')
check(!orderWrites.includes("resolveCatalogProductAndVariant(db, item, createdAt, { allowRetiredRecreate: true })"), 'new-order save still has blanket retired recreation permission')
check(!orderWrites.includes("resolveCatalogProductAndVariant(db, item, timestamp, { allowRetiredRecreate: true })"), 'order edit/background rewrite unexpectedly opts into retired recreation')

// Released retired lines are ignored by normal shipping; stale pre-retirement send/stock requests fail closed.
check(reservations.includes("WHERE r.order_id = ? AND r.status IN ('active', 'unresolved')"), 'shipping reservation scope unexpectedly includes released retirement rows')
check(reservations.includes('v.is_active AS variant_active, p.is_active AS product_active'), 'shipping does not load live Catalog status')
check(reservations.includes('live_variant.is_active') && reservations.includes('__shipping_conflict__'), 'stale shipping can still mutate a retired SKU')
check(inventory.includes('AND v.is_active = 1 AND p.is_active = 1'), 'manual stock/transfer canonical lookup can use retired SKU')
check(inventory.includes('const retiredExecutionKeys = new Set') && inventory.includes("retiredExecutionKeys.has(key) && !options.allowRetiredRecreate"), 'retired execution protection must remain for non-Arrival stock operations')
check(inventory.includes("allowRetiredRecreate: movementType === 'arrival'"), 'Arrival should explicitly opt into a fresh generation for a previously retired human variant')
check(inventory.includes('live_variant.is_active') && inventory.includes('__manual_operation_conflict__') && inventory.includes('__transfer_conflict__'), 'stale stock operation CAS does not include Catalog retirement')

// Historical order display switches to immutable order-time snapshots after Catalog retirement.
check(relations.includes('canonical_product_active') && relations.includes('canonical_variant_active'), 'order relation read lacks retired identity flags')
check(relations.includes('retiredLinkedIdentity'), 'retired order-line snapshot projection missing')
check(relations.includes('!retiredLinkedIdentity'), 'retired Catalog identity may still rewrite historical order display')

// Admin-only preview/apply API exists for both scopes.
for (const token of [
  'catalogExecutionRetirementPreviewMatch',
  'catalogExecutionRetireMatch',
  'catalogProductRetirementPreviewMatch',
  'catalogProductRetireMatch',
]) check(worker.includes(token), 'retirement route missing: ' + token)
check(worker.includes("requireAdminAccess(request)"), 'retirement endpoints are not admin-guarded')

check(executionUi.includes('CatalogRetirementAction') && executionUi.includes('buttonLabel="Удалить исполнение"'), 'execution delete action is missing from Catalog UI')
check(productUi.includes('CatalogRetirementAction') && productUi.includes('buttonLabel="Удалить товар"'), 'product delete action is missing from Catalog UI')
check(retirementUi.includes('/retirement-preview') && retirementUi.includes('/retire'), 'shared Catalog delete action does not use guarded preview/apply flow')
check(retirementUi.includes('Старые заказы и движения сохранятся в истории.'), 'friendly retirement dialog does not explain preserved history')
check(retirementUi.includes('Удалить исполнение?') && retirementUi.includes('Удалить товар?'), 'friendly retirement dialog headings missing')
check(!retirementUi.includes('window.confirm'), 'Catalog retirement still uses a browser/system confirmation prompt')
check(!productUi.includes("disabled={selectedVariants.length > 0}"), 'product delete is still blocked merely because active variants exist')

console.log('CATALOG SAFE RETIREMENT PASSED — retired rows stay outside working stock; background paths fail closed, while explicit Arrival/admin restore and deliberate new-order input may create a fresh generation')
