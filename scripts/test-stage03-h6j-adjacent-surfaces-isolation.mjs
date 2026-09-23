import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const workshop = read('worker/domains/workshop.ts')
const workshopMatching = read('worker/domains/workshop-matching.ts')
const workshopSchema = read('worker/domains/workshop-schema.ts')
const clients = read('worker/domains/clients.ts')
const cash = read('worker/domains/cash.ts')
const financeDay = read('worker/domains/finance-day.ts')
const lifecycle = read('worker/domains/lifecycle.ts')

for (const [name, source] of [
  ['workshop', workshop],
  ['workshop-matching', workshopMatching],
  ['workshop-schema', workshopSchema],
]) {
  check(!source.includes('catalog_execution_prices'), name + ' must not reprice from current Catalog')
  check(!source.includes('catalog_price_snapshot'), name + ' must not rewrite Catalog pricing snapshots')
  check(!/UPDATE\s+orders\s+SET[\s\S]{0,280}?total_amount/i.test(source), name + ' must not mutate commercial order total')
  check(!/UPDATE\s+order_items[\s\S]{0,280}?(unit_price|line_total)/i.test(source), name + ' must not mutate sold line prices')
}
check(workshop.includes('UPDATE orders SET workshop_status = ?'), 'Workshop status cache update boundary missing')
check(workshop.includes('UPDATE order_items') && workshop.includes('SET is_workshop = 1'), 'Workshop linked-line repair boundary missing')

check(clients.includes('o.total_amount') && clients.includes('s.total_amount'), 'Client history must aggregate persisted live + retained order totals')
check(clients.includes('COALESCE(SUM(h.total_amount), 0) AS total_amount'), 'Client sales aggregation must stay on historical order totals')
check(!clients.includes('catalog_execution_prices') && !clients.includes('catalog_price_snapshot'), 'Client statistics must not reinterpret history from Catalog')
check(!/UPDATE\s+orders\s+SET/i.test(clients) && !/UPDATE\s+order_items/i.test(clients), 'Client surfaces must remain read-only for order pricing')

for (const [name, source] of [['cash', cash], ['finance-day', financeDay]]) {
  check(!source.includes('catalog_execution_prices') && !source.includes('catalog_price_snapshot'), name + ' must stay Catalog-independent')
  check(!source.includes('pricing_mode') && !source.includes('itemized_v1'), name + ' must stay pricing-generation agnostic')
  check(!/UPDATE\s+orders\s+SET[\s\S]{0,280}?total_amount/i.test(source), name + ' must not rewrite order commercial totals')
  check(!/UPDATE\s+order_items[\s\S]{0,280}?(unit_price|line_total)/i.test(source), name + ' must not rewrite sold line prices')
}

check(lifecycle.includes('quantity, unit_price, line_total'), 'Return/exchange inventory lifecycle must retain read access to historical sold-line facts')
check(!lifecycle.includes('catalog_execution_prices') && !lifecycle.includes('catalog_price_snapshot'), 'Physical lifecycle must not use mutable Catalog recommendation')
check(!/UPDATE\s+orders\s+SET[\s\S]{0,280}?total_amount/i.test(lifecycle), 'Physical lifecycle must not rewrite commercial order total')
check(!/UPDATE\s+order_items[\s\S]{0,280}?(unit_price|line_total)/i.test(lifecycle), 'Physical lifecycle must not rewrite sold line prices')

console.log('STAGE03-H6J ADJACENT SURFACES ISOLATION PASSED — Workshop, Clients, Cash/Finance-day and physical lifecycle remain compatible with itemized history without hidden Catalog repricing or commercial price mutation')
