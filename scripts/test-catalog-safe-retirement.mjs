import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0076_v72_catalog_safe_retirement.sql')
const retirement = read('worker/domains/catalog-retirement.ts')
const catalog = read('worker/domains/catalog.ts')
const reservations = read('worker/domains/order-reservations.ts')
const inventory = read('worker/domains/inventory-movement.ts')
const relations = read('worker/domains/orders-relations.ts')
const worker = read('worker/index.ts')

// Audit schema is additive; historical facts are never deleted.
check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_retirement_operations'), 'retirement operation audit table missing')
check(migration.includes('CREATE TABLE IF NOT EXISTS catalog_retirement_variants'), 'retirement variant snapshot table missing')
check(!migration.includes('DELETE FROM order_items') && !migration.includes('DELETE FROM inventory_movements'), 'retirement migration must not delete order/movement history')

// Retirement is a working-state operation, not a history rewrite.
check(retirement.includes("export async function previewCatalogRetirement"), 'retirement preflight missing')
check(retirement.includes("export async function retireCatalogEntity"), 'retirement apply engine missing')
check(retirement.includes("s.status='active'") && retirement.includes("e.status='pending'"), 'active stocktake/pending lifecycle blockers missing')
check(retirement.includes("SET status='released'") && retirement.includes("unresolved_reason='catalog_retired'"), 'active reservations are not safely released')
check(retirement.includes("stock_writeoff_status='catalog_retired'"), 'open order items are not marked as retired from warehouse semantics')
check(retirement.includes("SET quantity=0, reserved_quantity=0"), 'retired SKU stock is not removed from working inventory')
check(retirement.includes("SET is_active=0") && retirement.includes('UPDATE catalog_stock_positions') && retirement.includes('UPDATE catalog_products'), 'execution/product retirement does not deactivate working Catalog identity')
check(retirement.includes("'delete'") && retirement.includes("'catalog_retirement'"), 'physical removal lacks inventory movement audit')
check(!retirement.includes('DELETE FROM order_items') && !retirement.includes('DELETE FROM catalog_variants') && !retirement.includes('DELETE FROM inventory_stock'), 'safe retirement must keep historical rows')

// Runtime resolution must never resurrect a deliberately retired execution.
// Explicit Catalog admin creation may create a fresh active generation.
check(catalog.includes('export async function findRetiredCatalogExecutionV3'), 'retired execution lookup missing')
check(catalog.includes('if (!options.allowRetiredRecreate)'), 'automatic execution recreation guard missing')
check(catalog.includes('allowRetiredRecreate: true'), 'explicit Catalog admin recreation path missing')
check(catalog.includes('Нельзя создать позицию у удалённого исполнения или товара'), 'combination creation can target inactive Catalog identity')
check(reservations.includes("matchStatus: 'unresolved_execution'"), 'order resolver does not stop at retired execution')
check(reservations.indexOf('findRetiredCatalogExecutionV3') < reservations.indexOf('await ensureCatalogExecutionV3(db, product.id, material, length'), 'retired execution guard runs too late')

// Released retired lines are ignored by normal shipping; stale pre-retirement send/stock requests fail closed.
check(reservations.includes("WHERE r.order_id = ? AND r.status IN ('active', 'unresolved')"), 'shipping reservation scope unexpectedly includes released retirement rows')
check(reservations.includes('v.is_active AS variant_active, p.is_active AS product_active'), 'shipping does not load live Catalog status')
check(reservations.includes('live_variant.is_active') && reservations.includes('__shipping_conflict__'), 'stale shipping can still mutate a retired SKU')
check(inventory.includes('AND v.is_active = 1 AND p.is_active = 1'), 'manual stock/transfer canonical lookup can use retired SKU')
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

console.log('CATALOG SAFE RETIREMENT PASSED — execution/product removal preserves history, releases warehouse obligations, zeroes working stock with audit, blocks stale operations, and never auto-resurrects retired identity')
