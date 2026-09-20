import fs from 'node:fs'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const projectionSource = read('src/app/orderOperationalProjection.ts')
const relationsSource = read('worker/domains/orders-relations.ts')
const stocktakeSource = read('worker/domains/inventory-stocktake.ts')
const lifecycleSource = read('worker/domains/lifecycle.ts')
const attentionSource = read('worker/domains/warehouse-attention.ts')
const r14Migration = read('migrations/0070_v72_stage01_canonical_order_search.sql')

const compiled = ts.transpileModule(projectionSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const { projectOrderOperationalState: project } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled).toString('base64')
)

const baseOrder = {
  id: 7001,
  order_status: 'active',
  shipping_status: 'not_sent',
  workshop_status: 'ready',
  total_amount: 10000,
  received_amount: 10000,
  debt_amount: 0,
  return_amount: 0,
  committed_return_count: 0,
  committed_exchange_count: 0,
  has_committed_item_return: false,
  returns: [],
  stock_handover_review_needed: true,
  stock_handover_has_active_items: true,
  items: [{ id: 1, quantity: 1, isWorkshop: false, sourceType: 'warehouse' }],
}

const plain = project(baseOrder, { isAdmin: false })
check(plain.canEdit && plain.canShip && plain.canOpenStockHandover, 'Plain working order lost ordinary edit/shipping/handover actions')
check(plain.canOpenReturn && plain.canOpenExchange, 'Plain working order lost Return/Exchange entry')

const moneyOnly = project({
  ...baseOrder,
  return_amount: 2000,
  committed_return_count: 1,
  has_committed_item_return: false,
  returns: [{ id: 1, status: 'completed' }],
}, { isAdmin: false })
check(moneyOnly.hasCommittedReturn && !moneyOnly.hasCommittedItemReturn, 'Money-only Return classification drifted')
check(!moneyOnly.canEdit, 'Money-only Return reopened structural editing')
check(moneyOnly.canShip && moneyOnly.canOpenStockHandover, 'Money-only Return again dead-ended the physical outbound flow')
check(moneyOnly.canOpenReturn && moneyOnly.canOpenExchange, 'Money-only Return incorrectly made the order terminal for later operations')

const itemReturn = project({
  ...baseOrder,
  return_amount: 2000,
  committed_return_count: 1,
  has_committed_item_return: true,
  returns: [{ id: 2, status: 'completed' }],
}, { isAdmin: false })
check(!itemReturn.canEdit && !itemReturn.canShip && !itemReturn.canOpenStockHandover, 'Item Return no longer protects stale original physical flow')
check(itemReturn.canOpenReturn && itemReturn.canOpenExchange, 'Partial item Return incorrectly disabled remaining Return/Exchange workflow')

const exchange = project({
  ...baseOrder,
  committed_exchange_count: 1,
}, { isAdmin: false })
check(exchange.hasCommittedExchange && exchange.hasCommittedPhysicalDownstreamOperation, 'Exchange lost historical physical downstream classification')
check(!exchange.canEdit, 'Completed Exchange unexpectedly reopened structural editing')
check(exchange.canShip && exchange.canOpenStockHandover, 'Completed Exchange no longer exposes its current replacement item to outbound/handover flow')
check(exchange.canOpenReturn && exchange.canOpenExchange, 'Exchange incorrectly made the whole order terminal')

const cancelledHistory = project({
  ...baseOrder,
  returns: [{ id: 3, status: 'cancelled' }],
  committed_return_count: 0,
  committed_exchange_count: 0,
}, { isAdmin: false })
check(cancelledHistory.canEdit && cancelledHistory.canShip, 'Cancelled Return history still blocks ordinary order work')

const sentAfterRefund = project({
  ...baseOrder,
  shipping_status: 'sent',
  return_amount: 2000,
  committed_return_count: 1,
  has_committed_item_return: false,
  returns: [{ id: 4, status: 'completed' }],
}, { isAdmin: true })
check(!sentAfterRefund.canShip, 'Already-sent order became shippable')
check(sentAfterRefund.canCorrectShipping, 'Money-only refund incorrectly blocks correction of a false physical handover mark')

const sentAfterExchange = project({
  ...baseOrder,
  shipping_status: 'sent',
  committed_exchange_count: 1,
  has_committed_item_return: false,
}, { isAdmin: true })
check(!sentAfterExchange.canShip, 'Already-sent exchanged order became directly shippable')
check(sentAfterExchange.canCorrectShipping, 'Completed Exchange still forces cancellation before correcting a false shipping mark')

const workshopAfterRefund = project({
  ...baseOrder,
  workshop_status: 'in_workshop',
  return_amount: 1000,
  committed_return_count: 1,
  has_committed_item_return: false,
  returns: [{ id: 5, status: 'completed' }],
  items: [{ id: 1, quantity: 1, isWorkshop: true, sourceType: 'workshop', workshopTaskStatus: 'active' }],
}, { isAdmin: false })
check(workshopAfterRefund.workshopPending && !workshopAfterRefund.canShip, 'Money-only Return accidentally bypasses Workshop readiness')

// Exercise the exact combined relation SQL introduced by R19/R19B.
const marker = '`WITH requested_orders(order_id) AS (VALUES ${requestedOrderValues}),'
const sqlStartMarker = relationsSource.indexOf(marker)
check(sqlStartMarker >= 0, 'R19/R19B combined relation SQL missing')
const sqlStart = sqlStartMarker + 1
const sqlEnd = relationsSource.indexOf('`', sqlStart)
check(sqlEnd > sqlStart, 'R19/R19B combined relation SQL end missing')
const relationSql = relationsSource.slice(sqlStart, sqlEnd).replace('${requestedOrderValues}', '(?),(?),(?),(?)')

const db = new DatabaseSync(':memory:')
db.exec([
  'CREATE TABLE returns (id INTEGER PRIMARY KEY, order_id INTEGER, status TEXT);',
  'CREATE TABLE return_items (id INTEGER PRIMARY KEY, return_id INTEGER, order_item_id INTEGER, quantity INTEGER);',
  'CREATE TABLE exchanges (id INTEGER PRIMARY KEY, order_id INTEGER, refund_return_id INTEGER, status TEXT);',
  // Order 10: standalone item Return + Exchange refund Return. Exchange-owned refund item must not be subtracted twice.
  "INSERT INTO returns VALUES (1,10,'completed'),(2,10,'completed'),(3,20,'completed'),(4,40,'cancelled'),(5,40,'cancelled');",
  'INSERT INTO return_items VALUES (11,1,100,1),(12,2,100,1),(14,4,400,5);',
  "INSERT INTO exchanges VALUES (21,10,2,'completed'),(31,30,NULL,'completed'),(41,40,5,'cancelled');",
].join('\n'))

const relationRows = db.prepare(relationSql).all(10,20,30,40)
const byOrder = new Map()
for (const row of relationRows) {
  const orderId = Number(row.order_id)
  if (!byOrder.has(orderId)) byOrder.set(orderId, [])
  byOrder.get(orderId).push(row)
}
check(Number(byOrder.get(10)?.[0]?.committed_exchange_count) === 1, 'Exchange count disappeared from combined relation read')
check(byOrder.get(10).some((row) => Number(row.order_item_id) === 100 && Number(row.returned_quantity) === 1), 'Exchange-owned refund Return was double-counted against standalone item availability')
check(byOrder.get(20)?.length === 1 && byOrder.get(20)?.[0]?.order_item_id == null, 'Money-only standalone Return incorrectly became a physical item Return')
check(Number(byOrder.get(30)?.[0]?.committed_exchange_count) === 1, 'Exchange without refund disappeared from downstream truth')
check(Number(byOrder.get(40)?.[0]?.committed_exchange_count) === 0, 'Cancelled Exchange still blocks downstream truth')
check(!byOrder.get(40).some((row) => Number(row.returned_quantity) > 0), 'Cancelled Return still reduces available item quantity')
db.close()

// Cross-check the later fixes did not re-collapse canonical/live truth into history snapshots.
check(stocktakeSource.includes("COALESCE(NULLIF(p.name, ''), s.product_name_snapshot)"), 'R20 stocktake canonical-name seed disappeared')
check(stocktakeSource.includes('COALESCE(v.product_id, s.product_id)'), 'R20 selective/current product precedence disappeared')
check(!/UPDATE\s+inventory_stock\s+SET\s+product_name_snapshot/i.test(
  stocktakeSource.slice(
    stocktakeSource.indexOf('export async function createInventoryStocktakeSession('),
    stocktakeSource.indexOf('export async function saveInventoryStocktakeCount('),
  ),
), 'R20 stocktake start now rewrites live stock snapshot history')

check(lifecycleSource.includes("WHERE NOT (direction = 'in' AND exact_variant_id IS NOT NULL)"), 'R21 manual queue again duplicates exact-known inbound')
check(lifecycleSource.includes('COUNT(*) OVER() AS manual_queue_count'), 'R21 manual queue count no longer describes the filtered queue')
check(attentionSource.includes('intake: lifecycleItems.filter((row) => row.exactKnown)'), 'Warehouse Attention lost ownership of exact-known intake')
check(attentionSource.includes('lifecycle: lifecycleItems.filter((row) => !row.exactKnown)'), 'Warehouse Attention known/unresolved lifecycle split drifted')

check(r14Migration.includes('CREATE TRIGGER trg_order_search_catalog_products_au'), 'R14 product-rename search trigger missing')
check(r14Migration.includes('CREATE TRIGGER trg_order_search_catalog_variants_au'), 'R14 variant-edit search trigger missing')
check(!/\b(?:UPDATE|DELETE FROM)\s+(?:orders|order_items|payments|catalog_products|catalog_variants)\b/i.test(r14Migration), 'R14 migration started rewriting business/history rows')

console.log('STAGE01 POST-FIX CROSS-REGRESSION PASSED — R19/R19B action truth, relation arithmetic, R20 canonical stocktake seed, R21 queue ownership and R14 derived-search boundaries remain mutually consistent')
