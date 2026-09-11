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

const snapshotReadMarkers = [
  'productName: cleanText((item as any).product_name_snapshot) || cleanText((item as any).canonical_product_name)',
  'gender: cleanText((item as any).gender_snapshot)',
  'color: cleanText((item as any).color_snapshot)',
  'material: cleanText((item as any).material_snapshot)',
  'length: cleanText((item as any).length_snapshot)',
  'size: cleanText((item as any).size_snapshot)',
]
for (const marker of snapshotReadMarkers) {
  check(ordersRead.includes(marker), 'orders table/list read lost snapshot-first marker: ' + marker)
  check(ordersWrite.includes(marker), 'single-order readback lost snapshot-first marker: ' + marker)
}
check(ordersRead.includes("COALESCE(oi.product_name_snapshot, p.name, '') AS product_name"), 'debt-order item name must prefer historical snapshot')
check(ordersRead.includes("COALESCE(oi.size_snapshot, v.size_label, '') AS size_label"), 'debt-order item size must prefer historical snapshot')

// Frontend order surfaces render API order.items; they do not reconstruct historical lines from the live catalog.
check(tableUi.includes('order.items'), 'OrdersTableSection must render returned order items')
check(detailsUi.includes('selectedOrder.items'), 'OrderDetailsSection must render returned order items')

console.log('CATALOG ORDER HISTORY PRESERVATION R1 PASSED — 0068 keeps orders/lines/snapshots intact and order reads are snapshot-first')
