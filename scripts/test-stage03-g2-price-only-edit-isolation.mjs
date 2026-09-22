import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = start >= 0 ? source.indexOf(endMarker, start + startMarker.length) : -1
  check(start >= 0 && end > start, `Missing source slice: ${startMarker} -> ${endMarker}`)
  return source.slice(start, end)
}

const core = read('worker/domains/order-core.ts')
const write = read('worker/domains/orders-write.ts')

const exceptPriceComparator = sliceBetween(
  core,
  'export function sameOrderItemExceptPriceForEdit',
  'export function sameOrderItemForEdit',
)
check(!exceptPriceComparator.includes('unitPrice'), 'Non-price item comparator must not treat unit price as physical/content identity')
check(
  core.includes('return sameOrderItemExceptPriceForEdit(left, right)\n    && left.unitPrice === right.unitPrice;'),
  'Full item comparator must still detect a unit-price change',
)
check(
  core.includes('export function sameNormalizedOrderItemsExceptPriceForEdit'),
  'Normalized non-price comparator is missing',
)

check(
  write.includes('const itemContentChanged = Boolean(requestedItems && !sameNormalizedOrderItemsForEdit(existingItemsForEdit, requestedItems));'),
  'Order edit must keep an any-item-change signal for policy guards',
)
check(
  write.includes('const rewriteItems = Boolean(requestedItems && !sameNormalizedOrderItemsExceptPriceForEdit(existingItemsForEdit, requestedItems));'),
  'Order edit must reserve full item rewrite for non-price content changes',
)
check(
  write.includes('const priceOnlyItemsEdit = itemContentChanged && !rewriteItems;'),
  'Price-only classification is missing',
)
check(
  write.includes('SELECT id, unit_price') && write.includes('WHERE order_id = ? AND quantity > 0') && write.includes('ORDER BY id ASC'),
  'Price-only edit must bind requested prices to the existing active order-item rows',
)

const priceCommit = sliceBetween(
  write,
  "const priceOnlyItemUpdates = Array.isArray(p.priceOnlyItemUpdates)",
  "await advanceCriticalOperation(db, criticalOperation, 'order_updated');",
)
check(
  priceCommit.includes('UPDATE order_items') && priceCommit.includes('SET unit_price = ?, line_total = ?'),
  'Price-only edit must update persisted unit_price and line_total',
)
check(
  !priceCommit.includes('catalog_price_snapshot'),
  'Price-only correction must preserve the historical Catalog price snapshot',
)
check(
  priceCommit.includes('await db.batch([') && priceCommit.includes('orderUpdateStatement'),
  'Order money totals and line-price corrections must commit in the same D1 batch',
)

check(
  write.includes('stockReversals = (p.rewriteItems || p.deletingOrder)'),
  'Stock reversal must remain tied to physical/content rewrite, not price-only edits',
)
check(
  write.includes('if (p.rewriteItems) await retireOrderItemsForRewrite(db, id, p.timestamp);'),
  'Existing order items must not be retired for price-only edits',
)
check(
  write.includes("p.rewriteItems ? p.nextItems : [], p.rewritePayments ? p.nextPayments : []"),
  'Price-only edits must not reinsert order content or reservations',
)

check(
  write.includes("existingShippingStatus === 'sent' && (itemContentChanged || deletingOrder)"),
  'Sent-order policy guard must still treat a price correction as an item edit',
)
check(
  write.includes("existingShippingStatus !== 'sent' && (itemContentChanged || deletingOrder)"),
  'Partial-handover policy guard must still treat a price correction as an item edit',
)
check(
  write.includes('if (itemContentChanged || rewritePayments || deletingOrder) {'),
  'Return/exchange safety guard must remain active for price corrections',
)
check(
  write.includes('Цены позиций исправлены без движения склада'),
  'Activity log must distinguish commercial price correction from stock rewrite',
)

console.log('STAGE03-G2 PRICE-ONLY EDIT ISOLATION PASSED — unit-price-only order edits preserve active order-item identity, Catalog snapshot and inventory/reservation state while existing lifecycle/return/exchange policy guards remain unchanged')
