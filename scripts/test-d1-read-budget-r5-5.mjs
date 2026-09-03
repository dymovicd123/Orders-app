import fs from 'node:fs'

const migration = fs.readFileSync('migrations/0065_v72_d1_read_budget_r5_workshop_variant_order_index.sql', 'utf8')
const workshop = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(!/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(migration), 'R5.5 migration must not mutate business rows')
  check(!/\b(?:DROP|ALTER)\b/i.test(migration), 'R5.5 migration must be additive only')
  check(migration.includes('CREATE INDEX IF NOT EXISTS idx_catalog_variants_product_active_desc_sort'), 'R5.5 Workshop resolver index missing')
  check(/ON\s+catalog_variants\s*\(\s*product_id\s*,\s*is_active\s+DESC\s*,\s*sort_order\s+ASC\s*\)/i.test(migration), 'R5.5 index must match product + active DESC + sort ASC lookup order')
  check(!/product_id\s*,\s*is_active\s+DESC\s*,\s*sort_order\s+ASC\s*,\s*id\b/i.test(migration), 'R5.5 must keep the smaller measured 3-column index; id was not beneficial')

  check(workshop.includes('COALESCE(oi.variant_id, cv_fallback.id) AS resolved_variant_id'), 'Workshop must keep direct variant precedence')
  check(workshop.includes('WHERE oi.variant_id IS NULL'), 'Workshop fallback must run only when the direct variant is missing')
  check(workshop.includes('cv2.product_id = oi.product_id'), 'Workshop fallback must stay product-scoped')
  check(workshop.includes("UPPER(TRIM(COALESCE(cv2.color, ''))) = UPPER(TRIM(COALESCE(oi.color_snapshot, '')))"), 'Workshop fallback must preserve optional color matching')
  check(workshop.includes("UPPER(TRIM(COALESCE(cv2.size_label, ''))) = UPPER(TRIM(COALESCE(oi.size_snapshot, '')))"), 'Workshop fallback must preserve optional size matching')
  check(workshop.includes('ORDER BY cv2.is_active DESC, cv2.sort_order ASC, cv2.id ASC'), 'Workshop fallback ordering truth must remain unchanged')

  console.log('D1 READ BUDGET R5.5 TESTS PASSED — additive mixed-direction index only; Workshop resolver truth unchanged')
} catch (error) {
  console.error(`D1 READ BUDGET R5.5 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
