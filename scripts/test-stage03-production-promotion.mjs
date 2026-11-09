import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  check(a >= 0 && b > a, 'Missing source boundary: ' + start)
  return source.slice(a, b)
}

const wrangler = read('wrangler.jsonc')
const release = read('scripts/release-check.mjs')
const migration73 = read('migrations/0073_v72_order_item_pricing_foundation.sql')
const migration74 = read('migrations/0074_v72_retained_order_pricing_mode.sql')
const app = read('src/App.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const editUi = read('src/features/sections/OrderEditorSection.tsx')
const returnUi = read('src/features/sections/OrderReturnsSection.tsx')
const exchangeUi = read('src/features/sections/OrderExchangeSection.tsx')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const orderWrite = read('worker/domains/orders-write.ts')
const pricing = read('worker/domains/order-pricing.ts')
const money = read('worker/domains/money.ts')
const returnsExchange = read('worker/domains/returns-exchanges.ts')
const finance = read('worker/domains/finance-reports.ts')
const workshop = read('worker/domains/workshop.ts')
const clients = read('worker/domains/clients.ts')
const cash = read('worker/domains/cash.ts')
const lifecycle = read('worker/domains/lifecycle.ts')
const storage = read('worker/domains/storage.ts')
const relations = read('worker/domains/orders-relations.ts')

check(wrangler.includes('"name": "orders-app"'), 'Stage03 Production: Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_prod"') && wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'Stage03 Production: Production D1 identity drifted')
check(!wrangler.includes('orders-app-branch2') && !wrangler.includes('orders_db_branch2') && !wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'Stage03 Production: Branch2 identity leaked into main')

check(migration73.includes("DEFAULT 'legacy_manual_total'") && migration73.includes('catalog_price_snapshot'), 'Stage03 Production: 0073 contract missing')
check(!/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(migration73), 'Stage03 Production: 0073 must not backfill business rows')
check(!migration73.includes('catalog_execution_prices'), 'Stage03 Production: 0073 must not infer history from current Catalog')
check(migration74.includes('retained_order_summaries') && migration74.includes("DEFAULT 'legacy_manual_total'"), 'Stage03 Production: 0074 contract missing')
check(!/\b(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(migration74), 'Stage03 Production: 0074 must not backfill retained business rows')

for (const marker of [
  'Catalog resolver R11 preserve known gender',
  'Catalog resolver R12 Catalog consistency',
  'Catalog resolver R13 known facts',
  'Catalog safe execution/product retirement',
  'Catalog retired operational write guards',
  'Catalog retired order/return recovery',
  'Stage03 Production promotion acceptance',
]) check(release.includes(marker), 'Stage03 Production cumulative gate missing: ' + marker)

check(relations.includes('export async function isOrderPricingFoundationEnabled'), 'Stage03 Production: schema capability gate missing')
check(createUi.includes('Цена по каталогу') && createUi.includes('Цена продажи'), 'Stage03 Production Create: Catalog and factual sold price are not separate')
check(createUi.includes('Укажите цену, по которой товар реально продаётся.'), 'Stage03 Production Create: factual price guidance missing')
check(app.includes("pricingMode: 'itemized_v1'"), 'Stage03 Production Create: new orders do not explicitly request itemized_v1')
check(pricing.includes('lineTotal = quantity * unitPrice'), 'Stage03 Production: line total is not server-derived')
check(pricing.includes('totalAmount = lineTotals.reduce'), 'Stage03 Production: order total is not server-derived')
check(pricing.includes("throw new ItemizedPricingValidationError") && pricing.includes("'itemized_overpayment'"), 'Stage03 Production: itemized overpayment rejection missing')

check(editUi.includes('Цена продажи') && editUi.includes('Цена по каталогу'), 'Stage03 Production Edit: direct itemized pricing UI missing')
check(orderWrite.includes('itemPriceCorrections') && orderWrite.includes('itemContentReplacement'), 'Stage03 Production Edit: correction/rewrite contracts missing')
check(orderWrite.includes('sameNormalizedOrderItemsExceptPriceForEdit'), 'Stage03 Production Edit: price-only stock isolation missing')
check(orderWrite.includes('expectedCatalogSnapshot !== currentCatalogSnapshot'), 'Stage03 Production Edit: stale price snapshot guard missing')
check(orderWrite.includes('debtAmount: Math.max(0, itemizedRewritePlan.totalAmount - correctedReceivedAmount)'), 'Stage03 Production Edit: debt is not derived from persisted commercial facts')

check(money.includes('COALESCE(o.total_amount, 0) AS total_amount'), 'Stage03 Production money: persisted order total is not ledger truth')
check(money.includes('debtAmount: Math.max(0, totalAmount - receivedAmount)'), 'Stage03 Production money: debt formula drifted')
check(!money.includes('catalog_execution_prices') && !money.includes('catalog_price_snapshot'), 'Stage03 Production money: current Catalog leaked into payment/debt logic')

for (const [name, source] of [['Workshop', workshop], ['Cash', cash], ['Lifecycle', lifecycle]]) {
  check(!source.includes('catalog_execution_prices'), 'Stage03 Production ' + name + ': mutable Catalog price leaked into operational history')
  check(!/UPDATE\s+orders\s+SET[\s\S]{0,320}?total_amount/i.test(source), 'Stage03 Production ' + name + ': commercial total rewrite detected')
  check(!/UPDATE\s+order_items[\s\S]{0,320}?(unit_price|line_total)/i.test(source), 'Stage03 Production ' + name + ': sold-line repricing detected')
}
check(clients.includes('o.total_amount') && clients.includes('s.total_amount'), 'Stage03 Production Clients: persisted live/retained totals no longer used')
check(!clients.includes('catalog_execution_prices'), 'Stage03 Production Clients: current Catalog is reinterpreting history')

const createReturn = between(returnsExchange, 'export async function createReturn', '\n\nexport async function receiveReturnedItem')
check(createReturn.includes('const amount = Math.max(0, toInt(input.amount, 0))'), 'Stage03 Production Return: refund is not explicit input')
check(createReturn.includes('if (amount > availableAmount)'), 'Stage03 Production Return: over-refund ceiling missing')
check(createReturn.includes('if (amount <= 0 && selectedItems.length === 0)'), 'Stage03 Production Return: zero-money physical return boundary missing')
check(!createReturn.includes('catalog_price_snapshot'), 'Stage03 Production Return: Catalog snapshot leaked into refund policy')
check(returnUi.includes('Введите фактическую сумму возврата вручную.'), 'Stage03 Production Return UI: manual-refund rule missing')

const createExchange = between(returnsExchange, 'export async function createExchange', '\n\nexport async function correctExchangeFinancials')
check(createExchange.includes('projectedTotalAmount = currentItemizedTotalAmount - replacedOldValue + newLine.lineTotal'), 'Stage03 Production Exchange: new total is not itemized-line-derived')
check(createExchange.includes('projectedNetPaid > projectedTotalAmount'), 'Stage03 Production Exchange: overpayment protection missing')
check(createExchange.includes('isItemizedExchange ? itemizedExchangeWritePlan : null'), 'Stage03 Production Exchange: replacement pricing is not persisted safely')
check(exchangeUi.includes('Цена по каталогу') && exchangeUi.includes('Цена продажи'), 'Stage03 Production Exchange UI: Catalog recommendation and sold price are not separate')

check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'Stage03 Production reports: exact itemized revenue missing')
check(finance.includes('average_sold_price: itemizedQuantity > 0 ? Math.round(itemizedGrossSales / itemizedQuantity) : null'), 'Stage03 Production reports: weighted factual average sold price missing')
check(!finance.includes('catalog_execution_prices'), 'Stage03 Production reports: current Catalog is repricing history')
check(storage.includes('pricing_mode'), 'Stage03 Production retention: pricing generation is not preserved')

check(workspace.includes('const enteredGender = canonicalOrderGender(currentItem.gender)'), 'Stage03 Production/R11: explicit gender preservation missing')
check(workspace.includes('const preferredGender = enteredGender || automaticGender'), 'Stage03 Production/R11: known gender preference missing')
check(workspace.includes('gender: enteredGender || canonicalOrderGender(selected.gender) || automaticGender'), 'Stage03 Production/R11: concrete SKU gender preservation missing')

check(orderWrite.includes("'legacy_manual_total'"), 'Stage03 Production: legacy order compatibility marker missing')
check(orderWrite.includes("pricingMode === 'itemized_v1'"), 'Stage03 Production: itemized write generation missing')

console.log('STAGE03 PRODUCTION PROMOTION ACCEPTANCE PASSED — itemized Create/Edit/Exchange, manual Return money, factual sold-price analytics, legacy history, resolver and operational isolation are all preserved on the Production environment contract')
