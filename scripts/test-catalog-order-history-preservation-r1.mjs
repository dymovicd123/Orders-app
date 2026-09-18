import fs from 'node:fs'

const migration = fs.readFileSync('migrations/0068_v72_catalog_product_gender_scope.sql', 'utf8')
const ordersRead = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const ordersWrite = fs.readFileSync('worker/domains/orders-write.ts', 'utf8')
const relations = fs.readFileSync('worker/domains/orders-relations.ts', 'utf8')
const tableUi = fs.readFileSync('src/features/sections/OrdersTableSection.tsx', 'utf8')
const detailsUi = fs.readFileSync('src/features/sections/OrderDetailsSection.tsx', 'utf8')

const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

// Migration may repair only the live canonical FK on historical order lines. The orders themselves,
// line identities, quantities, money and textual snapshots must survive byte-for-byte.
check(!/DELETE\s+FROM\s+orders\b/i.test(migration), '0068 must never delete orders')
check(!/DELETE\s+FROM\s+order_items\b/i.test(migration), '0068 must never delete order_items')
const orderItemUpdates = [...migration.matchAll(/UPDATE\s+order_items\s+SET\s+([\s\S]*?)\s+WHERE/gi)]
check(orderItemUpdates.length === 1, '0068 must have exactly one order_items update')
const orderItemSet = orderItemUpdates[0][1].replace(/\s+/g, ' ').trim()
check(/^variant_id\s*=/.test(orderItemSet), '0068 order_items update may only begin with variant_id remap')
check(!/(product_name_snapshot|gender_snapshot|color_snapshot|material_snapshot|length_snapshot|size_snapshot|audience_type|quantity|unit_price|line_total|order_id)\s*=/i.test(orderItemSet), '0068 must not rewrite historical order-item data')

// Catalog joins are enrichment only. LEFT JOIN guarantees a missing/retired catalog row cannot drop
// an order line from the response.
check(
  relations.includes('FROM order_items oi')
  && relations.includes('LEFT JOIN catalog_products p ON p.id = oi.product_id')
  && relations.includes('LEFT JOIN catalog_variants v ON v.id = oi.variant_id'),
  'order relations must retain LEFT JOIN catalog enrichment',
)

// Working orders may follow a repaired canonical FK, but immutable order-time text must still
// be projected separately instead of being overwritten or silently discarded.
const historicalSnapshotMarkers = [
  'productName: cleanText(item.product_name_snapshot)',
  'audienceType: cleanText(item.audience_type)',
  'gender: cleanText(item.gender_snapshot)',
  'color: cleanText(item.color_snapshot)',
  'material: cleanText(item.material_snapshot)',
  'length: cleanText(item.length_snapshot)',
  'size: cleanText(item.size_snapshot)',
]
for (const marker of historicalSnapshotMarkers) {
  check(relations.includes(marker), 'canonical order projection lost historical snapshot field: ' + marker)
}
check(relations.includes("productName: (hasCanonicalProduct ? canonicalProductName : '') || originalSnapshot.productName"), 'working order product identity must prefer the current canonical product with snapshot fallback')
check(relations.includes("gender: hasCanonicalVariant ? (cleanText(item.canonical_gender) || originalSnapshot.gender) : originalSnapshot.gender"), 'working order exact SKU must keep canonical gender with snapshot fallback')
check(relations.includes('originalSnapshot,'), 'historical order-time snapshot is not exposed separately')
for (const [name, source] of [['orders table/list', ordersRead], ['single-order readback', ordersWrite]]) {
  check(source.includes('...canonicalItemProjection(item as Record<string, unknown>)'), name + ' stopped using the shared canonical/history projection')
}
check(ordersRead.includes("COALESCE(oi.product_name_snapshot, p.name, '') AS product_name"), 'debt-order item name must prefer historical snapshot')
check(ordersRead.includes("COALESCE(oi.size_snapshot, v.size_label, '') AS size_label"), 'debt-order item size must prefer historical snapshot')

// Frontend order surfaces render API order.items; the details view may expose the preserved order-time snapshot separately.
check(tableUi.includes('order.items'), 'OrdersTableSection must render returned order items')
check(detailsUi.includes('selectedOrder.items'), 'OrderDetailsSection must render returned order items')
check(detailsUi.includes('item.originalSnapshot'), 'OrderDetailsSection must keep changed order-time identity available as separate history')

console.log('CATALOG ORDER HISTORY PRESERVATION R1 PASSED — 0068 keeps orders/lines/snapshots intact while working reads may project repaired canonical identity separately')
