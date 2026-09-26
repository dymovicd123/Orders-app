import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const finance = read('worker/domains/finance-reports.ts')
const types = read('src/app/types.ts')
const reportUi = read('src/features/renderers/FinanceReportContentRenderer.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const editUi = read('src/features/sections/OrderEditorSection.tsx')
const exchangeUi = read('src/features/sections/OrderExchangeSection.tsx')
const doc = read('docs/continuation/STAGE03_H11_PRODUCT_PRICE_ANALYTICS_20260926.md')

check(wrangler.includes('"name": "orders-app-branch2"'), 'H11: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H11: Branch2 D1 identity drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H11: Production D1 identity leaked into Branch2')

check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.quantity ELSE 0 END"), 'H11 exact itemized quantity projection missing')
check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'H11 exact itemized sold-value projection missing')
check(finance.includes('AS itemized_quantity') && finance.includes('AS itemized_gross_sales'), 'H11 product exact-price numerators missing')
check(finance.includes('average_sold_price: itemizedQuantity > 0 ? Math.round(itemizedGrossSales / itemizedQuantity) : null'), 'H11 weighted average sold price must be gross sold value divided by exact sold quantity')
check(finance.includes('legacy_quantity: Math.max(0, quantity - itemizedQuantity)'), 'H11 legacy quantity coverage marker missing')
check(finance.includes('products: normalizedProductRows'), 'H11 normalized product analytics are not returned')
check(finance.includes(': rawProductRows;'), 'H11 pre-pricing report response must remain byte-shape compatible without synthetic analytics fields')
check(finance.includes('ORDER BY quantity DESC, order_count DESC, product ASC'), 'H11 popularity ranking changed away from sold quantity')
check(!finance.includes('catalog_execution_prices'), 'H11 historical product average must never read current Catalog price')
check(!finance.includes('catalog_price_snapshot'), 'H11 average sold price must use factual sold line totals, not Catalog recommendation')

for (const marker of ['itemized_quantity?: number', 'itemized_gross_sales?: number', 'legacy_quantity?: number', 'average_sold_price?: number | null']) {
  check(types.includes(marker), 'H11 API type missing: ' + marker)
}

check(reportUi.includes('Самые продаваемые товары'), 'H11 best-seller report heading missing')
check(reportUi.includes('Средняя цена продажи'), 'H11 average sold-price column missing')
check(reportUi.includes('Данные для средней цены'), 'H11 exact-price coverage column missing')
check(reportUi.includes('учтены все') && reportUi.includes('цена позиции не сохранена'), 'H11 mixed legacy/itemized coverage wording missing')
check(reportUi.includes('Нет данных по цене отдельных позиций'), 'H11 legacy-only average must be visibly unavailable')
check(reportUi.includes('row.average_sold_price'), 'H11 UI is not displaying server-derived weighted average')

check(createUi.includes('Укажите цену, по которой товар реально продаётся.') && createUi.includes('115 000') && createUi.includes('105 000'), 'H11 Create does not explain absolute final-price discount')
check(editUi.includes('Скидка задаётся итоговой ценой продажи, а не процентом.'), 'H11 Edit does not explain absolute final-price discount')
check(exchangeUi.includes('Скидка задаётся этой суммой, не процентом.'), 'H11 Exchange does not explain absolute final-price discount')
for (const source of [createUi, editUi, exchangeUi]) {
  check(!source.includes('Скидка %') && !source.includes('Процент скидки'), 'H11 accidentally introduced percent discount UI')
}

for (const marker of [
  'Discount is expressed through the **final sold price amount**',
  'average is quantity-weighted',
  'They must **not** be mixed into the average sold price',
  'No D1 business-row write is part of H11',
]) check(doc.includes(marker), 'H11 continuation contract missing: ' + marker)

console.log('STAGE03-H11 PRODUCT PRICE ANALYTICS PASSED — discounts stay absolute final sold prices, best sellers remain quantity-ranked, weighted average sold price uses exact itemized line totals only, and legacy history is reported without fabricated price allocation')
