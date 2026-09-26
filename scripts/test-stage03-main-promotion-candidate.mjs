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
const ordersRead = read('worker/domains/orders-read.ts')
const catalog = read('worker/domains/catalog.ts')
const migration73 = read('migrations/0073_v72_order_item_pricing_foundation.sql')
const migration74 = read('migrations/0074_v72_retained_order_pricing_mode.sql')

// This is a main/Production promotion candidate, but this test never deploys or mutates D1.
check(wrangler.includes('"name": "orders-app"'), 'Stage03 candidate: Production Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_prod"') && wrangler.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'), 'Stage03 candidate: Production D1 identity drifted')
check(!wrangler.includes('orders-app-branch2') && !wrangler.includes('orders_db_branch2') && !wrangler.includes('40065052-854e-44b8-bcd5-251bdd488301'), 'Stage03 candidate: Branch2 environment leaked into main candidate')

// Schema changes classify old history; they must not fabricate or rewrite money.
check(migration73.includes("DEFAULT 'legacy_manual_total'") && migration73.includes("'itemized_v1'"), 'Stage03 candidate: pricing_mode migration missing')
check(migration73.includes('ADD COLUMN catalog_price_snapshot INTEGER'), 'Stage03 candidate: Catalog price snapshot schema missing')
check(migration74.includes('retained_order_summaries') && migration74.includes("DEFAULT 'legacy_manual_total'"), 'Stage03 candidate: retained pricing generation migration missing')
for (const [name, sql] of [['0073', migration73], ['0074', migration74]]) {
  const executable = sql.replace(/^\s*--.*$/gm, ' ')
  check(!/\bUPDATE\b/i.test(executable) && !/\bDELETE\b/i.test(executable) && !/\bREPLACE\b/i.test(executable), 'Stage03 candidate: ' + name + ' performs business-row rewrite')
}

// Create: recommendation, factual sold price, payment facts and debt remain separate.
check(createUi.includes('Цена по каталогу') && createUi.includes('Цена продажи'), 'Stage03 candidate: Create price fields are no longer separate')
check(createUi.includes('Введите цену продажи вручную.'), 'Stage03 candidate: missing Catalog price no longer permits explicit manager price')
check(app.includes("pricingMode: 'itemized_v1'"), 'Stage03 candidate: new Create no longer explicitly uses itemized_v1')
check(pricing.includes('lineTotal = quantity * unitPrice'), 'Stage03 candidate: server no longer derives itemized line total')
check(pricing.includes('totalAmount = lineTotals.reduce'), 'Stage03 candidate: server no longer derives itemized order total')
check(pricing.includes('overpaymentAmount: Math.max(0, receivedAmount - totalAmount)'), 'Stage03 candidate: overpayment calculation missing')
check(pricing.includes("throw new ItemizedPricingValidationError") && pricing.includes("'itemized_overpayment'"), 'Stage03 candidate: server overpayment rejection missing')

// Edit: price-only correction must not become an inventory rewrite.
check(editUi.includes('Цена продажи') && editUi.includes('Цена по каталогу'), 'Stage03 candidate: itemized Edit lost price fields')
check(editUi.includes('Скидка задаётся итоговой ценой продажи, а не процентом.'), 'Stage03 candidate: Edit discount semantics drifted')
check(orderWrite.includes('itemPriceCorrections') && orderWrite.includes('itemContentReplacement'), 'Stage03 candidate: itemized Edit contracts missing')
check(orderWrite.includes('sameNormalizedOrderItemsExceptPriceForEdit'), 'Stage03 candidate: price-only Edit isolation missing')
check(orderWrite.includes('expectedCatalogSnapshot !== currentCatalogSnapshot'), 'Stage03 candidate: stale commercial snapshot protection missing')
check(orderWrite.includes('debtAmount: Math.max(0, itemizedRewritePlan.totalAmount - correctedReceivedAmount)'), 'Stage03 candidate: edited debt is not derived from factual commercial total')

// Payments/debt are independent money facts.
check(money.includes('COALESCE(o.total_amount, 0) AS total_amount'), 'Stage03 candidate: money ledger no longer reads persisted total')
check(money.includes('debtAmount: Math.max(0, totalAmount - receivedAmount)'), 'Stage03 candidate: debt formula drifted')
check(!money.includes('catalog_execution_prices') && !money.includes('catalog_price_snapshot'), 'Stage03 candidate: payment/debt path started depending on mutable Catalog')
const manualPaymentStart = money.indexOf('export async function createManualOrderPaymentCritical')
check(manualPaymentStart >= 0, 'Stage03 candidate: manual payment critical path missing')
const manualPayment = money.slice(manualPaymentStart, money.indexOf('\n\nexport async function', manualPaymentStart + 40))
check(manualPayment.includes('if (amount > ledger.debtAmount)'), 'Stage03 candidate: debt-close overpayment guard missing')

// Warehouse / Workshop / lifecycle cannot rewrite commercial truth.
for (const [name, source] of [['Workshop', workshop], ['Cash', cash], ['Lifecycle', lifecycle]]) {
  check(!source.includes('catalog_execution_prices'), 'Stage03 candidate: ' + name + ' reads mutable Catalog pricing')
  check(!/UPDATE\s+orders\s+SET[\s\S]{0,320}?total_amount/i.test(source), 'Stage03 candidate: ' + name + ' rewrites commercial total')
  check(!/UPDATE\s+order_items[\s\S]{0,320}?(unit_price|line_total)/i.test(source), 'Stage03 candidate: ' + name + ' rewrites sold-line pricing')
}
check(clients.includes('o.total_amount') && clients.includes('s.total_amount'), 'Stage03 candidate: Clients lost persisted live + retained totals')
check(!clients.includes('catalog_execution_prices'), 'Stage03 candidate: Clients reinterpret history from current Catalog')

// Return keeps physical items and actual refund money independent.
const createReturn = between(returnsExchange, 'export async function createReturn', '\n\nexport async function receiveReturnedItem')
check(createReturn.includes('const amount = Math.max(0, toInt(input.amount, 0))'), 'Stage03 candidate: Return refund is no longer explicit input')
check(createReturn.includes('if (amount > availableAmount)'), 'Stage03 candidate: Return over-refund ceiling missing')
check(createReturn.includes('if (amount <= 0 && selectedItems.length === 0)'), 'Stage03 candidate: zero-money physical Return boundary missing')
check(!createReturn.includes('unit_price') && !createReturn.includes('line_total') && !createReturn.includes('catalog_price_snapshot'), 'Stage03 candidate: Return started auto-pricing refunds')
check(returnUi.includes('Введите фактическую сумму возврата вручную.'), 'Stage03 candidate: Return UI no longer explains factual manual refund')

// Exchange derives commercial total from itemized lines; extra payment/refund stays separate.
const createExchange = between(returnsExchange, 'export async function createExchange', '\n\nexport async function correctExchangeFinancials')
check(createExchange.includes('projectedTotalAmount = currentItemizedTotalAmount - replacedOldValue + newLine.lineTotal'), 'Stage03 candidate: itemized Exchange total is not line-derived')
check(createExchange.includes('projectedNetPaid > projectedTotalAmount'), 'Stage03 candidate: itemized Exchange overpayment protection missing')
check(createExchange.includes('isItemizedExchange ? itemizedExchangeWritePlan : null'), 'Stage03 candidate: replacement line is not persisted with itemized pricing')
check(exchangeUi.includes('Цена по каталогу') && exchangeUi.includes('Цена продажи'), 'Stage03 candidate: Exchange lost Catalog/factual-price separation')
check(exchangeUi.includes('Доплата или возврат ниже остаются отдельным денежным фактом.'), 'Stage03 candidate: Exchange money/commercial separation wording missing')

// Reports/history use persisted historical facts, never today's Catalog.
check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'Stage03 candidate: exact itemized product revenue missing')
check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.quantity ELSE 0 END"), 'Stage03 candidate: exact itemized product quantity missing')
check(finance.includes('average_sold_price: itemizedQuantity > 0 ? Math.round(itemizedGrossSales / itemizedQuantity) : null'), 'Stage03 candidate: weighted average sold price missing')
check(finance.includes('legacy_quantity: Math.max(0, quantity - itemizedQuantity)'), 'Stage03 candidate: legacy coverage marker missing')
check(!finance.includes('catalog_execution_prices'), 'Stage03 candidate: Finance report reads mutable current Catalog price')
check(storage.includes('pricing_mode') || ordersRead.includes('pricing_mode'), 'Stage03 candidate: retained/read history lost pricing generation')
check(orderWrite.includes("'legacy_manual_total'") || read('worker/domains/order-core.ts').includes('legacy_manual_total'), 'Stage03 candidate: legacy compatibility marker missing')

// Preserve later Production Catalog/Resolver safety while adding Stage03.
check(workspace.includes('const activeCatalogProducts = (catalogData?.products || []).filter((product) => product.isActive)'), 'Stage03 candidate: retired products leaked back into working pickers')
check(workspace.includes('products: collect(refs.products, activeCatalogProducts.map((product) => product.name))'), 'Stage03 candidate: active Catalog/reference product vocabulary lost')
check(workspace.includes('const enteredGender = canonicalOrderGender(currentItem.gender)'), 'Stage03 candidate: R11 manager gender preservation disappeared')
check(workspace.includes('const preferredGender = enteredGender || automaticGender'), 'Stage03 candidate: R11 preferred gender disappeared')
check(workspace.includes('gender: enteredGender || canonicalOrderGender(selected.gender) || automaticGender'), 'Stage03 candidate: R11 concrete SKU gender preservation disappeared')
check(!workspace.includes("gender: automaticGender ? (selected.gender || automaticGender) : ''"), 'Stage03 candidate: old unisex gender-erasure path returned')
check(catalog.includes('export async function assertCatalogProductMayDeactivate'), 'Stage03 candidate: guarded whole-product retirement disappeared')
check(catalog.includes('Нельзя добавить позицию: товар не найден или выведен из активного каталога.'), 'Stage03 candidate: retired product can receive new active SKU')

console.log('STAGE03 MAIN-PROMOTION CANDIDATE PASSED — itemized pricing, legacy isolation, payments/debt, Return/Exchange, reports/history, Resolver and Catalog-retirement invariants are preserved without D1 mutation')
