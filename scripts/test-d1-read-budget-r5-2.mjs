import fs from 'node:fs'

const migration = fs.readFileSync('migrations/0063_v72_d1_read_budget_r5_catalog_attention_index.sql', 'utf8')
const attention = fs.readFileSync('worker/domains/warehouse-attention.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(!/\b(?:INSERT|UPDATE|DELETE|REPLACE)\b/i.test(migration), 'R5.2 migration must not mutate business rows')
  check(migration.includes('CREATE INDEX IF NOT EXISTS idx_order_items_catalog_attention_order'), 'R5.2 catalog-attention index missing')
  check(migration.includes('ON order_items(order_id, id)'), 'R5.2 index must preserve the measured order_id lookup shape')
  check(migration.includes('(product_id IS NULL OR variant_id IS NULL)'), 'R5.2 index must cover only unresolved catalog items')
  for (const status of ['catalog_excluded', 'catalog_excluded_history', 'workshop_no_catalog']) {
    check(migration.includes(`'${status}'`), `R5.2 index must preserve exclusion ${status}`)
  }
  check(attention.includes('catalogReviewBasePredicate'), 'Warehouse Attention must keep the canonical catalog-review base predicate')
  check(attention.includes('catalogReviewOperationalPredicate'), 'Warehouse Attention must keep the operational catalog-review scope')
  check(attention.includes("e.status = 'pending' AND e.order_item_id = oi.id"), 'Warehouse Attention must keep the pending lifecycle exclusion')
  check(attention.includes('GROUP BY'), 'Warehouse Attention catalog count must remain grouped by catalog identity')
  console.log('D1 READ BUDGET R5.2 TESTS PASSED — additive catalog-attention index only; business truth unchanged')
} catch (error) {
  console.error(`D1 READ BUDGET R5.2 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
