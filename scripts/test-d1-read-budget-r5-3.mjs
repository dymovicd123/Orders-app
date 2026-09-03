import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const migration = fs.readFileSync('migrations/0064_v72_d1_read_budget_r5_order_search_fts.sql', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(source.includes('} else if (Array.from(q).length >= 3) {'), 'FTS path must be limited to >=3 Unicode characters')
check(source.includes('const qVariants = Array.from(new Set([q, q.toUpperCase(), q.toLowerCase()]))'), 'legacy raw/upper/lower search variants changed')
check(source.includes('order_search_orders_fts MATCH ?'), 'order FTS candidate path missing')
check(source.includes('order_search_items_fts MATCH ?'), 'item FTS candidate path missing')
check(source.includes('order_search_payments_fts MATCH ?'), 'payment FTS candidate path missing')
check(source.includes("INSTR(COALESCE(o.manager_snapshot_name, ''), ?) > 0"), 'historical manager snapshot search fallback missing')
check(!migration.includes('manager_snapshot_name'), 'R5.3 migration must run on canonical migration history without Production-only snapshot drift')
check(source.includes('FTS5 trigram cannot match fewer than three Unicode characters'), 'short-query legacy fallback missing')
check(source.includes('INSTR(${searchOrderText}, ?) > 0'), 'short-query order fallback changed')
check(source.includes("baseWhereParts.push('o.external_id >= ? AND o.external_id < ?')"), 'indexed ORD prefix fast path lost')
check(!source.includes('genericSearchClause'), 'rejected full-history materialization path returned')

for (const table of ['order_search_orders_fts', 'order_search_items_fts', 'order_search_payments_fts']) {
  check(migration.includes(`CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5`), `${table} FTS definition missing`)
}
check((migration.match(/tokenize='trigram case_sensitive 1'/g) || []).length === 3, 'FTS must use exact case-sensitive trigram tokenizer on all search tables')
for (const trigger of [
  'trg_order_search_orders_ai','trg_order_search_orders_ad','trg_order_search_orders_au',
  'trg_order_search_items_ai','trg_order_search_items_ad','trg_order_search_items_au',
  'trg_order_search_payments_ai','trg_order_search_payments_ad','trg_order_search_payments_au',
  'trg_order_search_managers_au','trg_order_search_customers_au',
]) check(migration.includes(`CREATE TRIGGER IF NOT EXISTS ${trigger}`), `FTS maintenance trigger missing: ${trigger}`)
check(!/\b(?:UPDATE|DELETE FROM)\s+(?:orders|order_items|payments|managers|customers)\b/i.test(migration), 'R5.3 migration must not mutate business rows')
check(migration.includes('PRAGMA optimize;'), 'R5.3 migration must refresh query-planner statistics')

console.log('D1 READ BUDGET R5.3 PASSED — generic >=3-char order search uses derived case-sensitive trigram FTS indexes; short search and ORD prefix semantics stay intact')
