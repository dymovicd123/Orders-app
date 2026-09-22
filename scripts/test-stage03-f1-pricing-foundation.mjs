import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const migration = read('migrations/0073_v72_order_item_pricing_foundation.sql')
const appTypes = read('src/app/types.ts')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const app = read('src/App.tsx')
const reports = read('worker/domains/finance-reports.ts')
const returnsExchanges = read('worker/domains/returns-exchanges.ts')

check(wrangler.includes('"name": "orders-app-branch2"'), 'Stage03-F1 must preserve Branch2 Worker identity')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'Stage03-F1 must preserve Branch2 D1 binding')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'Stage03-F1 must preserve Branch2 D1 id')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Production D1 must not leak into Branch2')

check(migration.includes("ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'legacy_manual_total'"), 'Explicit legacy pricing default missing')
check(migration.includes("CHECK (pricing_mode IN ('legacy_manual_total', 'itemized_v1'))"), 'Pricing mode domain check missing')
check(migration.includes('ADD COLUMN catalog_price_snapshot INTEGER'), 'Catalog sale-price snapshot column missing')
check(migration.includes('catalog_price_snapshot IS NULL OR catalog_price_snapshot >= 0'), 'Catalog snapshot nullable/non-negative check missing')

const businessStatements = migration
  .replace(/^\s*--.*$/gm, ' ')
  .split(';')
  .map((value) => value.replace(/\s+/g, ' ').trim())
  .filter(Boolean)
check(!businessStatements.some((statement) => /^(INSERT|UPDATE|DELETE)\b/i.test(statement)), 'Stage03-F1 must not backfill/rewrite business rows')
check(!/catalog_execution_prices/i.test(migration), 'Stage03-F1 must not copy current Catalog prices into historical orders')
check(!/unit_price\s*=|line_total\s*=/i.test(migration), 'Stage03-F1 must not rewrite historical item prices/totals')
check(!/total_amount\s*=|received_amount\s*=|debt_amount\s*=/i.test(migration), 'Stage03-F1 must not recalculate historical order money')

check(appTypes.includes("pricing_mode?: 'legacy_manual_total' | 'itemized_v1'"), 'Frontend order type does not understand optional pricing mode')
check(appTypes.includes('catalogPriceSnapshot?: number | null'), 'Frontend item type does not understand optional Catalog snapshot')

check(createUi.includes('<span>Цена заказа</span>'), 'Legacy Create Order price field unexpectedly removed in foundation step')
check(app.includes('unitPrice: 0'), 'Legacy create path unexpectedly stopped sending zero item prices')
check(!app.includes('catalogPriceSnapshot:'), 'Stage03-F1 must not start writing Catalog snapshots from UI')
check(!reports.includes('catalog_execution_prices'), 'Finance reports must not reprice history from current Catalog')
check(returnsExchanges.includes('unitPrice: 0'), 'Return/exchange legacy commercial behavior unexpectedly changed')

console.log('STAGE03-F1 PRICING FOUNDATION PASSED — additive legacy classification + nullable Catalog snapshot schema, type vocabulary only, no autofill/repricing/report/return/exchange behavior change')
