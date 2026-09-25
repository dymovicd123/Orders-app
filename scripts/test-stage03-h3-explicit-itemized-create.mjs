import fs from 'node:fs'
import path from 'node:path'

const read = (relative) => fs.readFileSync(relative, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const sliceBetween = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(start >= 0 && end > start, `Missing source slice: ${startMarker}`)
  return source.slice(start, end)
}

const types = read('worker/core/types.ts')
const write = read('worker/domains/orders-write.ts')
const createOrder = sliceBetween(write, 'export async function createOrder(', 'export async function updateOrderCritical(')
const insertContent = sliceBetween(write, 'export async function insertOrderContent(', 'export async function createWorkshopTaskForOrderItem(')
const manifest = JSON.parse(read('scripts/stage03-h3-explicit-itemized-create-worker-manifest.json'))

check(manifest?.version === 1 && manifest?.revision === 'stage03-h3-explicit-itemized-create', 'H3 structural manifest missing')
check(Object.keys(manifest.files || {}).sort().join(',') === 'worker/core/types.ts,worker/domains/orders-write.ts', 'H3 Worker allow-list widened')
check(types.includes("pricingMode?: 'legacy_manual_total' | 'itemized_v1'"), 'OrderInput explicit pricing mode is missing')
check(types.includes('catalogPriceSnapshot?: number | null'), 'Order item Catalog snapshot input is missing')

check(createOrder.includes("const pricingMode = requestedPricingMode === 'itemized_v1' ? 'itemized_v1' : 'legacy_manual_total'"), 'Omitted pricing mode must default to legacy')
check(createOrder.includes("if (pricingMode === 'legacy_manual_total')"), 'Legacy create branch is missing')
check(createOrder.includes('assertOrderTotalInput(input.orderTotal)'), 'Legacy manual total validation must remain')
check(createOrder.includes('calculateTotals(normalizedItems, normalizedPayments, input.orderTotal)'), 'Legacy total calculation must remain unchanged')
check(createOrder.includes("pricingMode === 'itemized_v1'"), 'Explicit itemized create branch is missing')
check(createOrder.includes('buildItemizedOrderWritePlan(itemizedLines, normalizedPayments)'), 'itemized_v1 must consume the H2 write plan')
check(createOrder.includes('isOrderPricingFoundationEnabled(db)'), 'itemized_v1 must fail closed before schema 0073')
check(createOrder.includes("Не передавайте отдельную цену заказа"), 'itemized_v1 must reject a separate manual order total')
check(createOrder.includes("pricing_mode, total_amount"), 'itemized order row must persist pricing_mode')
check(createOrder.includes("'itemized_v1'"), 'itemized order insert must persist itemized_v1')
check(createOrder.includes('totalAmount: itemizedWritePlan.totalAmount'), 'itemized order total must come from H2')
check(createOrder.includes('receivedAmount: itemizedWritePlan.receivedAmount'), 'itemized received amount must come from H2')
check(createOrder.includes('debtAmount: itemizedWritePlan.debtAmount'), 'itemized debt must come from H2')
check(createOrder.includes('itemizedWritePlan,'), 'validated critical-operation plan must freeze the itemized write plan')
check(createOrder.includes('pricingMode,'), 'validated critical-operation plan/response must retain pricing mode')

check(insertContent.includes('catalog_price_snapshot'), 'itemized content writer must persist Catalog snapshot')
check(insertContent.includes('itemizedLine?.catalogPriceSnapshot ?? null'), 'missing Catalog recommendation must persist as NULL')
check(insertContent.includes(': db.prepare('), 'legacy order-item insert branch must remain separate')
check(!createOrder.includes('catalog_execution_prices') && !insertContent.includes('catalog_execution_prices'), 'H3 must not read mutable Catalog prices or enable autofill')

const updateOrder = write.slice(write.indexOf('export async function updateOrderCritical('))
check(!updateOrder.includes('buildItemizedOrderWritePlan('), 'H3 must not silently switch existing-order edit to itemized semantics')

const app = read('src/App.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const frontendCreate = sliceBetween(app, 'async function createOrderFromDraft(', '\n  function ')
check(frontendCreate.includes("pricingMode: 'itemized_v1'"), 'Branch2 H7 Create must explicitly activate itemized_v1')
check(!frontendCreate.includes('orderTotal: createDraft.orderTotal'), 'Branch2 H7 Create must not send an independent manual total')
check(frontendCreate.includes('unitPrice: item.unitPrice') && frontendCreate.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'Branch2 H7 Create must send final line price and historical Catalog snapshot')
check(createUi.includes('Цена продажи') && createUi.includes('Цена по каталогу'), 'Branch2 H7 visible Create pricing controls are missing')
check(!createUi.includes('<span>itemized_v1</span>') && !createUi.includes('<span>pricingMode</span>'), 'Technical pricing mode leaked as visible UI copy')

console.log('STAGE03-H3 EXPLICIT ITEMIZED CREATE PASSED — legacy remains the server default for omitted mode, while Branch2 H7 explicitly activates itemized_v1 for new Create and preserves server-derived money plus historical Catalog snapshots')
