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
const app = read('src/App.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const editUi = read('src/features/sections/OrderEditorSection.tsx')
const returnUi = read('src/features/sections/OrderReturnsSection.tsx')
const exchangeUi = read('src/features/sections/OrderExchangeSection.tsx')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const resolverR11 = read('scripts/test-catalog-resolver-r11-preserve-known-gender.mjs')
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
const doc = read('docs/continuation/STAGE03_H12_FINAL_E2E_AUDIT_20260926.md')

check(wrangler.includes('"name": "orders-app-branch2"'), 'H12: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H12: Branch2 D1 identity drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H12: Production D1 identity leaked into Branch2')

// Final gate must actually include every active Stage03 slice.
for (const marker of [
  "Stage03-H7B itemized Create activation",
  "Stage03-H8F direct itemized editor",
  "Stage03-H8G direct Create price",
  "Stage03-H9A itemized Exchange backend",
  "Stage03-H9B itemized Exchange UI",
  "Stage03-H10 manual Return policy",
  "Stage03-H11 product price analytics",
]) check(release.includes(marker), 'H12 cumulative release gate missing predecessor: ' + marker)

// Create: current Catalog recommendation is separate from the factual final sold price.
check(createUi.includes('Цена по каталогу') && createUi.includes('Цена продажи'), 'H12 Create price fields are no longer separate')
check(createUi.includes('Скидка задаётся итоговой ценой продажи'), 'H12 absolute discount semantics disappeared from Create')
check(app.includes("pricingMode: 'itemized_v1'"), 'H12 Create request no longer explicitly activates itemized_v1')
check(pricing.includes('lineTotal = quantity * unitPrice'), 'H12 server no longer derives itemized line total')
check(pricing.includes('totalAmount = lineTotals.reduce'), 'H12 server no longer derives itemized order total')
check(pricing.includes('overpaymentAmount: Math.max(0, receivedAmount - totalAmount)'), 'H12 overpayment calculation missing')
check(pricing.includes("throw new ItemizedPricingValidationError") && pricing.includes("'itemized_overpayment'"), 'H12 server overpayment rejection missing')

// Edit: commercial correction and physical rewrite remain distinct and stale-safe.
check(editUi.includes('Цена продажи') && editUi.includes('Цена по каталогу'), 'H12 itemized Edit lost direct sold-price editing')
check(editUi.includes('Скидка задаётся итоговой ценой продажи, а не процентом.'), 'H12 Edit discount semantics drifted')
check(orderWrite.includes('itemPriceCorrections') && orderWrite.includes('itemContentReplacement'), 'H12 itemized Edit contracts missing')
check(orderWrite.includes('sameNormalizedOrderItemsExceptPriceForEdit'), 'H12 price-only Edit isolation missing')
check(orderWrite.includes('expectedCatalogSnapshot !== currentCatalogSnapshot'), 'H12 stale commercial snapshot protection missing')
check(orderWrite.includes('debtAmount: Math.max(0, itemizedRewritePlan.totalAmount - correctedReceivedAmount)'), 'H12 Edit debt is not derived from new commercial total and corrected payments')

// Money/debt: payment facts remain independent from Catalog and item price suggestions.
check(money.includes('COALESCE(o.total_amount, 0) AS total_amount'), 'H12 financial ledger no longer reads persisted commercial total')
check(money.includes('debtAmount: Math.max(0, totalAmount - receivedAmount)'), 'H12 debt formula drifted')
check(!money.includes('catalog_execution_prices') && !money.includes('catalog_price_snapshot'), 'H12 payment/debt path started depending on Catalog')
const manualPaymentStart = money.indexOf('export async function createManualOrderPaymentCritical')
check(manualPaymentStart >= 0, 'H12 manual payment critical path missing')
const manualPayment = money.slice(manualPaymentStart, money.indexOf('\n\nexport async function', manualPaymentStart + 40))
check(manualPayment.includes('if (amount > ledger.debtAmount)'), 'H12 debt-close overpayment guard missing')

// Warehouse / Workshop / lifecycle: operational movement must not rewrite commercial price facts.
for (const [name, source] of [['Workshop', workshop], ['Cash', cash], ['Lifecycle', lifecycle]]) {
  check(!source.includes('catalog_execution_prices'), 'H12 ' + name + ' reads mutable Catalog pricing')
  check(!/UPDATE\s+orders\s+SET[\s\S]{0,320}?total_amount/i.test(source), 'H12 ' + name + ' rewrites commercial total')
  check(!/UPDATE\s+order_items[\s\S]{0,320}?(unit_price|line_total)/i.test(source), 'H12 ' + name + ' rewrites sold line pricing')
}
check(clients.includes('o.total_amount') && clients.includes('s.total_amount'), 'H12 Clients no longer aggregate persisted live + retained totals')
check(!clients.includes('catalog_execution_prices'), 'H12 Clients reinterpret history from current Catalog')

// Return: physical return and actual refund money stay separate.
const createReturn = between(returnsExchange, 'export async function createReturn', '\n\nexport async function receiveReturnedItem')
check(createReturn.includes('const amount = Math.max(0, toInt(input.amount, 0))'), 'H12 Return refund is no longer explicit input')
check(createReturn.includes('if (amount > availableAmount)'), 'H12 Return over-refund ceiling missing')
check(createReturn.includes('if (amount <= 0 && selectedItems.length === 0)'), 'H12 zero-money physical Return boundary missing')
check(!createReturn.includes('unit_price') && !createReturn.includes('line_total') && !createReturn.includes('catalog_price_snapshot'), 'H12 Return started auto-pricing refunds')
check(returnUi.includes('Введите фактическую сумму возврата вручную.'), 'H12 Return UI no longer explains manual refund money')

// Exchange: active itemized lines determine commercial total; actual money movement remains a separate fact.
const createExchange = between(returnsExchange, 'export async function createExchange', '\n\nexport async function correctExchangeFinancials')
check(createExchange.includes('projectedTotalAmount = currentItemizedTotalAmount - replacedOldValue + newLine.lineTotal'), 'H12 itemized Exchange total is not line-derived')
check(createExchange.includes('projectedNetPaid > projectedTotalAmount'), 'H12 itemized Exchange overpayment protection missing')
check(createExchange.includes('isItemizedExchange ? itemizedExchangeWritePlan : null'), 'H12 replacement line is not persisted with itemized pricing')
check(exchangeUi.includes('Цена по каталогу') && exchangeUi.includes('Цена продажи'), 'H12 Exchange factual price and Catalog snapshot are no longer separate')
check(exchangeUi.includes('Доплата или возврат ниже остаются отдельным денежным фактом.'), 'H12 Exchange money/commercial separation wording missing')

// Reports/history: persisted history only; current Catalog never rewrites historical analytics.
check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'H12 exact itemized product revenue missing')
check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.quantity ELSE 0 END"), 'H12 exact itemized product quantity missing')
check(finance.includes('average_sold_price: itemizedQuantity > 0 ? Math.round(itemizedGrossSales / itemizedQuantity) : null'), 'H12 weighted average sold price missing')
check(finance.includes('legacy_quantity: Math.max(0, quantity - itemizedQuantity)'), 'H12 legacy price-coverage marker missing')
check(!finance.includes('catalog_execution_prices'), 'H12 Finance report reads mutable current Catalog price')
check(storage.includes('pricing_mode') || read('worker/domains/orders-read.ts').includes('pricing_mode'), 'H12 retained/read history lost pricing generation')

// Cross-stage preservation: the independently shipped Resolver R11 fix must survive Stage03 closure/promotion.
check(workspace.includes('const enteredGender = canonicalOrderGender(currentItem.gender)'), 'H12/R11: manager-entered gender preservation disappeared')
check(workspace.includes('const preferredGender = enteredGender || automaticGender'), 'H12/R11: known-gender group preference disappeared')
check(workspace.includes('gender: enteredGender || canonicalOrderGender(selected.gender) || automaticGender'), 'H12/R11: selected concrete SKU gender is no longer preserved')
check(!workspace.includes("gender: automaticGender ? (selected.gender || automaticGender) : ''"), 'H12/R11: old unisex gender-erasure path returned')
check(resolverR11.includes('explicit manager gender and concrete selected SKU gender survive unisex product picks'), 'H12/R11: dedicated resolver regression was removed or replaced')

// Explicit compatibility: old orders are not silently reinterpreted as itemized.
check(orderWrite.includes("'legacy_manual_total'") || read('worker/domains/order-core.ts').includes('legacy_manual_total'), 'H12 legacy pricing mode compatibility marker missing')
check(doc.includes('No Production/main action is part of H12'), 'H12 continuation contract lost environment boundary')

console.log('STAGE03-H12 FINAL E2E AUDIT PASSED — Create/Edit/money/Warehouse/Workshop/Return/Exchange/reports/history remain aligned around persisted factual sold prices, independent money facts, legacy compatibility and Branch2-only isolation')
