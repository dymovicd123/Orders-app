import fs from 'node:fs'

const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function replaceExact(path, before, after, expectedCount = 1) {
  const source = fs.readFileSync(path, 'utf8')
  const count = source.split(before).length - 1
  check(count === expectedCount, `${path}: expected ${expectedCount} exact replacement target(s), found ${count}`)
  fs.writeFileSync(path, source.replace(before, after))
}

const readPath = 'worker/domains/orders-read.ts'
const writePath = 'worker/domains/orders-write.ts'

replaceExact(
  readPath,
`        productName: toInt((item as any).product_id, 0) ? cleanText((item as any).canonical_product_name) : cleanText((item as any).product_name_snapshot),
        audienceType: toInt((item as any).variant_id, 0) ? (cleanText((item as any).canonical_category).toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ') : cleanText((item as any).audience_type),
        gender: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_gender) : cleanText((item as any).gender_snapshot),
        color: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_color) : cleanText((item as any).color_snapshot),
        material: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_material) : cleanText((item as any).material_snapshot),
        length: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_length) : cleanText((item as any).length_snapshot),
        size: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_size) : cleanText((item as any).size_snapshot),`,
`        // Order history is snapshot-first. A later catalog merge may repoint variant_id, but it must
        // never rewrite what the operator actually recorded on this historical order line.
        productName: cleanText((item as any).product_name_snapshot) || cleanText((item as any).canonical_product_name),
        audienceType: cleanText((item as any).audience_type) || (cleanText((item as any).canonical_category).toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ'),
        gender: cleanText((item as any).gender_snapshot),
        color: cleanText((item as any).color_snapshot),
        material: cleanText((item as any).material_snapshot),
        length: cleanText((item as any).length_snapshot),
        size: cleanText((item as any).size_snapshot),`
)

replaceExact(
  readPath,
`              COALESCE(p.name, oi.product_name_snapshot, '') AS product_name,
              COALESCE(v.size_label, oi.size_snapshot, '') AS size_label,`,
`              COALESCE(oi.product_name_snapshot, p.name, '') AS product_name,
              COALESCE(oi.size_snapshot, v.size_label, '') AS size_label,`
)

replaceExact(
  writePath,
`      productName: toInt((item as any).product_id, 0) ? cleanText((item as any).canonical_product_name) : cleanText((item as any).product_name_snapshot),
      audienceType: cleanText((item as any).audience_type) || (cleanText((item as any).canonical_category).toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ'),
      gender: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_gender) : cleanText((item as any).gender_snapshot),
      color: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_color) : cleanText((item as any).color_snapshot),
      material: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_material) : cleanText((item as any).material_snapshot),
      length: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_length) : cleanText((item as any).length_snapshot),
      size: toInt((item as any).variant_id, 0) ? cleanText((item as any).canonical_size) : cleanText((item as any).size_snapshot),`,
`      // Detailed order readback follows the same historical contract as the orders table: current
      // catalog links may change, while the order-time snapshots remain the source of truth.
      productName: cleanText((item as any).product_name_snapshot) || cleanText((item as any).canonical_product_name),
      audienceType: cleanText((item as any).audience_type) || (cleanText((item as any).canonical_category).toLowerCase() === 'child' ? 'ДЕТСКИЙ' : 'ВЗРОСЛЫЙ'),
      gender: cleanText((item as any).gender_snapshot),
      color: cleanText((item as any).color_snapshot),
      material: cleanText((item as any).material_snapshot),
      length: cleanText((item as any).length_snapshot),
      size: cleanText((item as any).size_snapshot),`
)

const testPath = 'scripts/test-catalog-order-history-preservation-r1.mjs'
fs.writeFileSync(testPath, `import fs from 'node:fs'\n\nconst migration = fs.readFileSync('migrations/0068_v72_catalog_product_gender_scope.sql', 'utf8')\nconst ordersRead = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')\nconst ordersWrite = fs.readFileSync('worker/domains/orders-write.ts', 'utf8')\nconst relations = fs.readFileSync('worker/domains/orders-relations.ts', 'utf8')\nconst tableUi = fs.readFileSync('src/features/sections/OrdersTableSection.tsx', 'utf8')\nconst detailsUi = fs.readFileSync('src/features/sections/OrderDetailsSection.tsx', 'utf8')\n\nconst fail = (message) => { throw new Error(message) }\nconst check = (condition, message) => { if (!condition) fail(message) }\n\n// Migration may repair only the live canonical FK on historical order lines. The orders themselves,\n// line identities, quantities, money and textual snapshots must survive byte-for-byte.\ncheck(!/DELETE\\s+FROM\\s+orders\\b/i.test(migration), '0068 must never delete orders')\ncheck(!/DELETE\\s+FROM\\s+order_items\\b/i.test(migration), '0068 must never delete order_items')\nconst orderItemUpdates = [...migration.matchAll(/UPDATE\\s+order_items\\s+SET\\s+([\\s\\S]*?)\\s+WHERE/gi)]\ncheck(orderItemUpdates.length === 1, '0068 must have exactly one order_items update')\nconst orderItemSet = orderItemUpdates[0][1].replace(/\\s+/g, ' ').trim()\ncheck(/^variant_id\\s*=/.test(orderItemSet), '0068 order_items update may only begin with variant_id remap')\ncheck(!/(product_name_snapshot|gender_snapshot|color_snapshot|material_snapshot|length_snapshot|size_snapshot|audience_type|quantity|unit_price|line_total|order_id)\\s*=/i.test(orderItemSet), '0068 must not rewrite historical order-item data')\n\n// Catalog joins are enrichment only. LEFT JOIN guarantees a missing/retired catalog row cannot drop\n// an order line from the response.\ncheck(relations.includes('FROM order_items oi') && relations.includes('LEFT JOIN catalog_products p ON p.id = oi.product_id') && relations.includes('LEFT JOIN catalog_variants v ON v.id = oi.variant_id'), 'order relations must retain LEFT JOIN catalog enrichment')\n\nconst snapshotReadMarkers = [\n  'productName: cleanText((item as any).product_name_snapshot) || cleanText((item as any).canonical_product_name)',\n  'gender: cleanText((item as any).gender_snapshot)',\n  'color: cleanText((item as any).color_snapshot)',\n  'material: cleanText((item as any).material_snapshot)',\n  'length: cleanText((item as any).length_snapshot)',\n  'size: cleanText((item as any).size_snapshot)',\n]\nfor (const marker of snapshotReadMarkers) {\n  check(ordersRead.includes(marker), \\`orders table/list read lost snapshot-first marker: \\${marker}\\`)\n  check(ordersWrite.includes(marker), \\`single-order readback lost snapshot-first marker: \\${marker}\\`)\n}\ncheck(ordersRead.includes("COALESCE(oi.product_name_snapshot, p.name, '') AS product_name"), 'debt-order item name must prefer historical snapshot')\ncheck(ordersRead.includes("COALESCE(oi.size_snapshot, v.size_label, '') AS size_label"), 'debt-order item size must prefer historical snapshot')\n\n// Frontend order surfaces render API order.items; they do not reconstruct historical lines from the live catalog.\ncheck(tableUi.includes('order.items'), 'OrdersTableSection must render returned order items')\ncheck(detailsUi.includes('selectedOrder.items'), 'OrderDetailsSection must render returned order items')\n\nconsole.log('CATALOG ORDER HISTORY PRESERVATION R1 PASSED — 0068 keeps orders/lines/snapshots intact and order reads are snapshot-first')\n`)

const packagePath = 'package.json'
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const command = 'node scripts/test-catalog-order-history-preservation-r1.mjs'
check(typeof pkg.scripts?.['release:check'] === 'string', 'package.json release:check missing')
if (!pkg.scripts['release:check'].includes(command)) pkg.scripts['release:check'] += ` && ${command}`
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log('Applied order-history snapshot preservation hardening and regression gate.')
