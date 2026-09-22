import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const catalog = read('worker/domains/catalog.ts')
const worker = read('worker/index.ts')
const migration = read('migrations/0072_v72_catalog_execution_prices.sql')

check(wrangler.includes('"name": "orders-app-branch2"'), 'Stage03-B3 must preserve Branch2 Worker identity')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'Stage03-B3 must preserve Branch2 D1 binding')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'Stage03-B3 must preserve Branch2 D1 id')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Production D1 must not leak into Branch2')

check(catalog.includes('stock_position_id, category, gender, color, material, length'), 'Catalog variant read must expose canonical execution id without another query')
check(catalog.includes('stockPositionId: toInt(row.stock_position_id, 0)'), 'Catalog variant response must expose stockPositionId')
check(catalog.includes('export async function saveCatalogExecutionPrice'), 'Stage03-B3 price write function missing')
check(catalog.includes("SELECT stock_position_id FROM catalog_execution_prices LIMIT 1"), 'Price writes must explicitly detect unapplied migration 0072')
check(catalog.includes('Схема цен каталога ещё не применена. Примените миграцию 0072'), 'Unapplied price schema must fail with a narrow human error')
check(catalog.includes("categoryText !== 'adult' && categoryText !== 'child'"), 'Price audience scope must reject unknown categories')
check(catalog.includes("Object.prototype.hasOwnProperty.call(input, 'costPrice')") && catalog.includes("Object.prototype.hasOwnProperty.call(input, 'salePrice')"), 'PUT contract must require an explicit full price pair')
check(catalog.includes('Number.isInteger(amount)') && catalog.includes('amount < 0'), 'Current prices must be whole non-negative KZT or null')
check(catalog.includes('WHERE sp.id = ? AND sp.is_active = 1'), 'Price write must target an existing active canonical execution')
check(catalog.includes('ON CONFLICT(stock_position_id, category) DO UPDATE SET'), 'Price write must be idempotent by execution + audience')
check(catalog.includes('cost_price = excluded.cost_price') && catalog.includes('sale_price = excluded.sale_price'), 'Price PUT must replace the complete current pair atomically')
check(!catalog.includes('UPDATE order_items SET unit_price'), 'Catalog current-price write must never rewrite historical order prices')

check(worker.includes("url.pathname === '/api/catalog/execution-prices' && request.method === 'PUT'"), 'Admin current-price route missing')
const routeAt = worker.indexOf("url.pathname === '/api/catalog/execution-prices' && request.method === 'PUT'")
const routeTail = worker.slice(routeAt, routeAt + 500)
check(routeTail.includes('requireAdminAccess(request)'), 'Current-price write route must be admin-only')
check(routeTail.includes('saveCatalogExecutionPrice(env.DB, input)'), 'Current-price route must delegate to the bounded domain write')
check(!worker.includes("url.pathname === '/api/catalog/execution-prices' && request.method === 'POST'"), 'Stage03-B3 must expose one explicit PUT mutation contract only')

check(migration.includes('PRIMARY KEY (stock_position_id, category)'), 'Schema/write idempotency key drifted')

console.log('STAGE03-B3 PRICE WRITE CONTRACT PASSED — Branch2 isolated, admin-only full-pair PUT, exact execution+audience upsert, no historical order rewrite')
