import fs from 'node:fs'

const migration = fs.readFileSync('migrations/0066_v72_d1_read_budget_r5_finance_summary_indexes.sql', 'utf8')
const references = fs.readFileSync('worker/domains/references.ts', 'utf8')
const ordersRead = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const executableSql = migration
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
  check(!/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER)\b/i.test(executableSql), 'R5.6 migration must be additive only')
  for (const marker of [
    'idx_payments_payment_date_order_amount',
    'idx_orders_current_debt_partial',
    'idx_order_items_pending_writeoff_status_order',
    'idx_order_items_workshop_order_quantity',
  ]) check(migration.includes(marker), `R5.6 index missing: ${marker}`)

  check(migration.includes('ON payments(payment_date, order_id, amount)'), 'R5.6 payment covering index shape changed')
  check(migration.includes("WHERE debt_amount > 0 AND order_status <> 'deleted'"), 'R5.6 current-debt partial truth changed')
  check(migration.includes('WHERE is_workshop = 0 AND quantity > 0'), 'R5.6 pending-writeoff partial scope changed')
  check(migration.includes('WHERE is_workshop = 1;'), 'R5.6 workshop-summary partial scope changed')

  const writeoffFunction = references.slice(
    references.indexOf('export async function getPendingInventoryWriteoffCount'),
    references.indexOf('export async function listDistinctText'),
  )
  check(writeoffFunction.includes("AND oi.stock_writeoff_status IN ('writeoff_disabled', 'pending_manual_writeoff')"), 'Pending writeoff query is not indexable')
  check(!writeoffFunction.includes("COALESCE(oi.stock_writeoff_status, '') IN ('writeoff_disabled', 'pending_manual_writeoff')"), 'Pending writeoff COALESCE scan predicate returned')

  check(ordersRead.includes('FROM order_items\n        WHERE is_workshop = 1\n        GROUP BY order_id'), 'Orders summary workshop predicate is not indexable')
  check(!ordersRead.includes('FROM order_items\n        WHERE COALESCE(is_workshop, 0) = 1\n        GROUP BY order_id'), 'Orders summary workshop COALESCE scan predicate returned')

  console.log('D1 READ BUDGET R5.6 TESTS PASSED — additive indexes and truth-equivalent predicates preserved')
} catch (error) {
  console.error(`D1 READ BUDGET R5.6 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
