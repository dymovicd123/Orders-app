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

const createStart = app.indexOf('async function createOrderFromDraft')
const createEnd = app.indexOf('\n  function ', createStart + 40)
check(createStart >= 0 && createEnd > createStart, 'Create flow source boundary missing')
const createFlow = app.slice(createStart, createEnd)
check(createUi.includes('Цена продажи') && createUi.includes('Цена по каталогу'), 'H7 activation must preserve the F1 pricing foundation in the visible Create UI')
check(createFlow.includes("pricingMode: 'itemized_v1'"), 'H7 activation must explicitly select itemized_v1 for new orders')
check(createFlow.includes('unitPrice: item.unitPrice') && createFlow.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'H7 activation must persist final sold price separately from Catalog snapshot')
check(!createFlow.includes('orderTotal: createDraft.orderTotal'), 'H7 itemized Create must not revive an independent manual order total')
check(!reports.includes('catalog_execution_prices'), 'Finance reports must not reprice history from current Catalog')
check(returnsExchanges.includes("unitPrice: isItemizedExchange ? itemizedExchangePricingPlan!.newUnitPrice : 0"), 'Legacy exchange zero-price compatibility is no longer isolated to legacy pricing mode')
check(returnsExchanges.includes("if (!isItemizedExchange) {") && returnsExchanges.includes("baseTotalAmount, ledger.totalAmount)) + financialAmount") && returnsExchanges.includes("baseTotalAmount, ledger.totalAmount)) - financialAmount"), 'Legacy exchange total-delta arithmetic unexpectedly changed')

console.log('STAGE03-F1 PRICING FOUNDATION PASSED — additive legacy classification and nullable Catalog snapshot schema remain intact after Branch2 H7 activation; historical reports and legacy return/exchange pricing stay isolated')
