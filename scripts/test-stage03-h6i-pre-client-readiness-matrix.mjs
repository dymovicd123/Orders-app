import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const between = (source, start, end) => {
  const a = source.indexOf(start)
  const b = source.indexOf(end, a + start.length)
  check(a >= 0 && b > a, 'Missing source boundary: ' + start)
  return source.slice(a, b)
}

const write = read('worker/domains/orders-write.ts')
const pricing = read('worker/domains/order-pricing.ts')
const frontendPricing = read('src/app/order-pricing.ts')
const app = read('src/App.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const returns = read('worker/domains/returns-exchanges.ts')
const money = read('worker/domains/money.ts')
const orderDelete = read('worker/domains/order-delete.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const reservations = read('worker/domains/order-reservations.ts')
const finance = read('worker/domains/finance-reports.ts')
const storage = read('worker/domains/storage.ts')
const migration73 = read('migrations/0073_v72_order_item_pricing_foundation.sql')
const migration74 = read('migrations/0074_v72_retained_order_pricing_mode.sql')
const contract = read('docs/continuation/STAGE03_E_PRICING_CONTRACT_V1_20260922.md')
const wrangler = read('wrangler.jsonc')

check(wrangler.includes('"name": "orders-app-branch2"'), 'Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'Branch2 D1 logical binding drifted')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'Branch2 D1 physical binding drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Production D1 identity leaked into Branch2')

const create = between(write, 'export async function createOrder(', 'export async function updateOrderCritical(')
const edit = between(write, 'export async function updateOrderCritical(', '\n\nexport async function getOrder')
check(create.includes("pricingMode === 'itemized_v1'"), 'Explicit itemized server Create path missing')
check(create.includes('buildItemizedOrderWritePlan(itemizedLines, normalizedPayments)'), 'Server Create no longer revalidates itemized arithmetic')
check(create.includes('isOrderPricingFoundationEnabled(db)'), 'Server Create no longer fails closed before pricing schema')
check(create.includes('itemizedWritePlan.totalAmount') && create.includes('itemizedWritePlan.receivedAmount') && create.includes('itemizedWritePlan.debtAmount'), 'Server Create money no longer comes from itemized write plan')
check(create.includes('pricing_mode, total_amount') && write.includes('catalog_price_snapshot'), 'Itemized historical pricing metadata persistence missing')
check(pricing.includes('requiredSafeInteger') && pricing.includes('assertItemizedOrderMoneyNotOverpaid'), 'Server itemized arithmetic safety missing')

check(edit.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete' && !itemizedMetadataOnlyEdit"), 'Legacy full-editor guard for unsupported itemized rewrites missing')
check(edit.includes('input.items === undefined') && edit.includes('input.payments === undefined') && edit.includes('input.orderTotal === undefined'), 'H8A itemized metadata-only lane widened into commercial rewrite semantics')
check(edit.includes('itemizedRewritePlan = buildItemizedOrderWritePlan('), 'H8D dedicated itemized rewrite plan is missing')
check(edit.includes('Безопасную itemized-замену состава нельзя совмещать со старым полем items'), 'Legacy full-items field can bypass the dedicated H8D replacement boundary')
check(edit.includes('itemContentReplacement?: ItemContentReplacementInput'), 'H8D dedicated replacement contract is missing')

const exchange = between(returns, 'export async function createExchange', '\n\nexport async function')
check(exchange.includes("cleanText((existing as any).pricing_mode) === 'itemized_v1'"), 'Legacy exchange guard for itemized orders missing')
check(exchange.includes('unitPrice: 0') && exchange.includes('lineTotal: 0'), 'Legacy exchange model changed without client policy')

const createReturn = between(returns, 'export async function createReturn', '\n\nexport async function')
check(createReturn.includes('const amount = Math.max(0, toInt(input.amount, 0))'), 'Returns no longer use explicit manager-entered refund amount')
check(!createReturn.includes('catalog_execution_prices') && !createReturn.includes('catalog_price_snapshot'), 'Return flow unexpectedly reprices from Catalog')
check(!createReturn.includes('unit_price') && !createReturn.includes('line_total'), 'Return flow unexpectedly auto-prices refund from sold line values')

const manualPaymentStart = money.indexOf('export async function createManualOrderPaymentCritical')
check(manualPaymentStart >= 0, 'Manual order payment function missing')
const manualPayment = money.slice(manualPaymentStart)
check(manualPayment.includes('const ledger = await readOrderFinancialLedger(db, orderId)'), 'Debt-close flow does not re-read persisted ledger')
check(manualPayment.includes('if (amount > ledger.debtAmount)'), 'Debt-close overpayment protection missing')
check(!manualPayment.includes('catalog_execution_prices') && !manualPayment.includes('catalog_price_snapshot'), 'Debt-close unexpectedly depends on Catalog')

check(orderDelete.includes("{ lifecycleAction: 'order_delete' }"), 'Dedicated delete no longer uses the reviewed lifecycle path')
check(orderDelete.includes("orderStatus: 'deleted'") && !orderDelete.includes('unitPrice') && !orderDelete.includes('catalogPriceSnapshot'), 'Dedicated delete must not supply commercial repricing fields')
check(edit.includes("if (p.rewriteItems) await retireOrderItemsForRewrite"), 'Edit retirement boundary missing')
check(edit.includes("if (p.deletingOrder)") && edit.includes("preservePayments: true"), 'Delete history preservation behavior drifted')

const archive = between(ordersRead, 'export async function archiveOrders', '\n\nexport async function restoreArchivedOrder')
const restore = between(ordersRead, 'export async function restoreArchivedOrder', '\n\nexport function retainedOrderSummaryPayload')
check(archive.includes("SET order_status = 'archived'") && !archive.includes('catalog_execution_prices'), 'Archive flow must stay lifecycle-only')
check(restore.includes("SET order_status = 'closed'") && !restore.includes('catalog_execution_prices'), 'Archive restore must stay lifecycle-only')
check(!archive.includes('unit_price') && !restore.includes('unit_price'), 'Archive lifecycle must never rewrite line prices')

check(!reservations.includes('catalog_execution_prices'), 'Shipping/handover must not read mutable current Catalog price')
check(!reservations.includes('catalog_price_snapshot'), 'Shipping/handover must not rewrite Catalog pricing snapshot')
check(!/UPDATE orders SET[\s\S]{0,240}?total_amount/i.test(reservations), 'Shipping/handover unexpectedly mutates commercial order total')
check(!/UPDATE order_items[\s\S]{0,240}?(unit_price|line_total)/i.test(reservations), 'Shipping/handover unexpectedly mutates commercial line price')

check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'Exact itemized product revenue path missing')
check(!finance.includes('catalog_execution_prices'), 'Historical Finance must not read mutable current Catalog price')

check(storage.includes("COALESCE(o.pricing_mode, 'legacy_manual_total')"), 'Long-term retained history no longer preserves pricing generation')
check(ordersRead.includes("cleanText(row.pricing_mode) === 'itemized_v1' ? 'itemized_v1' : 'legacy_manual_total'"), 'Retained read pricing classification missing')
check(migration73.includes("DEFAULT 'legacy_manual_total'") && migration73.includes('catalog_price_snapshot'), 'Pricing foundation migration drifted')
check(migration74.includes("DEFAULT 'legacy_manual_total'") && migration74.includes("'itemized_v1'"), 'Retained pricing migration drifted')

check(frontendPricing.includes('export function resolveCatalogOrderSalePrice'), 'Catalog recommendation resolver missing')
check(frontendPricing.includes('export function evaluateItemizedCreatePricing'), 'Itemized Create readiness model missing')
check(frontendPricing.includes("'missing_unit_price'") && frontendPricing.includes("'overpayment'"), 'Create readiness fail-closed blockers missing')
check(frontendPricing.includes("pricingMode: 'itemized_v1'"), 'Create readiness does not carry future explicit pricing mode')

const appCreate = between(app, 'async function createOrderFromDraft', '\n  function ')
check(appCreate.includes("pricingMode: 'itemized_v1'"), 'Branch2 visible Create lost explicit itemized pricing mode after approved activation')
check(!appCreate.includes('orderTotal: createDraft.orderTotal'), 'Branch2 itemized Create must not send a separate manual order total')
check(appCreate.includes('unitPrice: item.unitPrice') && appCreate.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'Branch2 itemized Create lost final sold price or Catalog snapshot')
check(createUi.includes('Цена продажи') && createUi.includes('Цена по каталогу'), 'Branch2 visible itemized Create pricing UI disappeared')
check(!createUi.includes('<span>itemized_v1</span>') && !createUi.includes('<span>catalogPriceSnapshot</span>'), 'Technical itemized internals leaked as visible UI text')

check(contract.includes('the manager may and must be able to supply an explicit final `unit_price` when Catalog has no applicable price'), 'Confirmed missing-Catalog manual-price policy disappeared')
check(contract.includes('explicit final price `0` is valid'), 'Confirmed zero-price policy disappeared')
check(contract.includes('delivery does not add or select a separate product sale price'), 'Confirmed delivery price boundary disappeared')
check(contract.includes('whether returns should stay fully manual') && contract.includes('itemized exchange price semantics'), 'Remaining return/exchange client boundaries disappeared')

console.log('STAGE03-H6I BRANCH2 ACTIVATION MATRIX PASSED — confirmed Catalog/manual/zero-price policies are active in new-order Create while history, reports, debt, manual returns, lifecycle actions, retention and unresolved discount/exchange boundaries remain isolated')
