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

const packagePath = 'package.json'
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const command = 'node scripts/test-catalog-order-history-preservation-r1.mjs'
check(typeof pkg.scripts?.['release:check'] === 'string', 'package.json release:check missing')
if (!pkg.scripts['release:check'].includes(command)) pkg.scripts['release:check'] += ` && ${command}`
fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`)

console.log('Applied order-history snapshot preservation hardening and regression gate.')
