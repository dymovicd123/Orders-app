import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/orders-read.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(source.includes("let genericSearchClause = '';"), 'generic search materialization gate missing')
check(source.includes('genericSearchBindings = [...qVariants, ...qVariants, ...qVariants]'), 'legacy raw/upper/lower search variants changed')
check(source.includes('const matchingRows = await db.prepare(`'), 'generic search ids are not resolved once')
check(source.includes("baseWhereParts.push('o.id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))')"), 'downstream queries do not use compact matching ids')
check(source.includes('baseBindings.push(JSON.stringify(matchingIds))'), 'matching id payload is not bound safely')
check(source.indexOf('if (genericSearchClause) {') < source.indexOf('const orderWhereParts = [...baseWhereParts]'), 'generic ids must be materialized before per-dataset date filters')
check(source.includes("orderWhereParts.push('o.order_date >= ?')"), 'order_date semantics changed')
check(source.includes("paymentWhereParts.push('p.payment_date >= ?')"), 'payment_date semantics changed')
check(source.includes("returnWhereParts.push('r.return_date >= ?')"), 'return_date semantics changed')
check(source.includes("baseWhereParts.push('o.external_id >= ? AND o.external_id < ?')"), 'indexed ORD prefix fast path lost')
check(!source.includes('aggregateNeedsCustomerJoin = true;\n      const searchOrderText'), 'generic search still forces repeated customer joins into aggregates')

console.log('D1 READ BUDGET R5.3 PASSED — generic order search is materialized once and reused without changing date semantics')
