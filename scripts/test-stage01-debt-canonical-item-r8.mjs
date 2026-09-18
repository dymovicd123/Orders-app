import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function listOpenDebtOrders(')
check(start >= 0, 'listOpenDebtOrders missing')
const fn = source.slice(start)

check(fn.includes('p.name AS canonical_product_name'), 'Debt workspace does not load canonical product identity')
check(fn.includes('COALESCE(v.category, p.category) AS canonical_category'), 'Debt workspace does not load canonical category identity')
check(fn.includes('v.gender AS canonical_gender') && fn.includes('v.size_label AS canonical_size'), 'Debt workspace does not load exact canonical SKU identity')
check(fn.includes('...canonicalItemProjection(item)'), 'Debt workspace does not consume the shared canonical item projection')
check(!fn.includes("COALESCE(oi.product_name_snapshot, p.name, '') AS product_name"), 'Debt workspace still prefers historical product snapshot over repaired canonical identity')
check(!fn.includes("COALESCE(oi.size_snapshot, v.size_label, '') AS size_label"), 'Debt workspace still prefers historical size snapshot over repaired canonical SKU')
check(fn.includes('oi.product_name_snapshot') && fn.includes('oi.gender_snapshot') && fn.includes('oi.size_snapshot'), 'Debt workspace stopped preserving order-time snapshot input for projection fallback/history')

console.log('STAGE01 DEBT CANONICAL ITEM R8 PASSED — the live Debt workspace follows repaired catalog identity through canonicalItemProjection while retaining order-time snapshots as fallback/history')
