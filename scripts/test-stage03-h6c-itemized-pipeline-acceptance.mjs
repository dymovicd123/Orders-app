import fs from 'node:fs'
import ts from 'typescript'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const pricing = read('worker/domains/order-pricing.ts')
const write = read('worker/domains/orders-write.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const finance = read('worker/domains/finance-reports.ts')
const app = read('src/App.tsx')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const appTypes = read('src/app/types.ts')

const transpiled = ts.transpileModule(pricing, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const pricingMod = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)

const plan = pricingMod.buildItemizedOrderWritePlan(
  [
    { quantity: 2, unitPrice: 36000, catalogPriceSnapshot: 40000 },
    { quantity: 1, unitPrice: 11000, catalogPriceSnapshot: null },
  ],
  [
    { amount: 30000 },
    { amount: 10000 },
  ],
)
check(plan.pricingMode === 'itemized_v1', 'Acceptance plan must be itemized_v1')
check(plan.lines[0].lineTotal === 72000 && plan.lines[1].lineTotal === 11000, 'Acceptance line totals drifted')
check(plan.totalAmount === 83000 && plan.receivedAmount === 40000 && plan.debtAmount === 43000, 'Acceptance order/payment/debt arithmetic drifted')
check(plan.lines[0].catalogPriceSnapshot === 40000 && plan.lines[0].unitPrice === 36000, 'Catalog recommendation and actual sold price must stay separate')
check(plan.lines[1].catalogPriceSnapshot === null, 'Missing recommendation must remain NULL')

const createStart = write.indexOf('export async function createOrder')
const editStart = write.indexOf('export async function updateOrderCritical')
check(createStart >= 0 && editStart > createStart, 'Create/Edit Worker boundaries missing')
const create = write.slice(createStart, editStart)
const edit = write.slice(editStart, write.indexOf('\n\nexport async function getOrder', editStart))
check(create.includes("pricingMode === 'itemized_v1'"), 'Real Create path no longer gates explicit itemized mode')
check(create.includes('buildItemizedOrderWritePlan(itemizedLines, normalizedPayments)'), 'Real Create path no longer consumes H2 write plan')
check(create.includes('itemizedWritePlan.totalAmount') && create.includes('itemizedWritePlan.receivedAmount') && create.includes('itemizedWritePlan.debtAmount'), 'Real Create money is not sourced from H2 plan')
check(create.includes('pricing_mode') && create.includes("'itemized_v1'"), 'Real Create no longer persists itemized order classification')
check(write.includes('catalog_price_snapshot') && write.includes('itemizedLine?.catalogPriceSnapshot ?? null'), 'Real item insert no longer persists nullable Catalog snapshot')
check(edit.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete' && !itemizedMetadataOnlyEdit"), 'Unsupported legacy edit path is no longer fail-closed for itemized orders')
check(edit.includes('input.items === undefined') && edit.includes('input.orderTotal === undefined'), 'H8A metadata-only exception widened into item/total repricing')

check(ordersRead.includes('pricing_mode'), 'Order read path lost pricing_mode')
check(ordersRead.includes('catalog_price_snapshot'), 'Order read path lost Catalog snapshot')
check(appTypes.includes("pricing_mode?: 'legacy_manual_total' | 'itemized_v1'"), 'Frontend OrderRecord lost pricing mode')
check(appTypes.includes('catalogPriceSnapshot?: number | null'), 'Frontend order item lost Catalog snapshot')

check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'Exact itemized product revenue no longer uses persisted line_total')
check(finance.includes('AS itemized_gross_sales'), 'Exact itemized product gross-sales field missing')
check(!finance.includes('catalog_price_snapshot'), 'Product revenue must never be derived from Catalog recommendation snapshot')
check(!finance.includes('catalog_execution_prices'), 'Historical product revenue must never read mutable current Catalog price')

check(app.includes('resolveCatalogOrderSalePrice') && app.includes('evaluateItemizedCreatePricing'), 'Create controller no longer reaches resolver/readiness model')
check(workspace.includes("import { resolveCatalogOrderSalePrice } from '../order-pricing'"), 'Catalog pick no longer reaches H5 resolver')
check(app.includes("nextItem.unitPrice = pricing.status === 'matched' ? pricing.salePrice : undefined"), 'Price-driving draft edits no longer clear missing/ambiguous recommendation safely')
check(workspace.includes("catalogPriceSnapshot: pricing.status === 'matched' ? pricing.catalogPriceSnapshot : null"), 'Catalog pick no longer maintains recommendation snapshot')

const appCreateStart = app.indexOf('async function createOrderFromDraft')
const appCreateEnd = app.indexOf('\n  function ', appCreateStart + 40)
const appCreate = app.slice(appCreateStart, appCreateEnd > appCreateStart ? appCreateEnd : app.length)
check(!appCreate.includes('orderTotal: createDraft.orderTotal'), 'Activated itemized Create must not send independent order total')
check(appCreate.includes("pricingMode: 'itemized_v1'"), 'Activated itemized Create request lost explicit pricing mode')
check(appCreate.includes('unitPrice: item.unitPrice') && appCreate.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'Activated itemized Create request lost line price history')
check(createUi.includes('Цена продажи') && createUi.includes('Цена по каталогу'), 'Visible Create line pricing is missing')
check(!createUi.includes('<span>catalogPriceSnapshot</span>'), 'Technical Catalog snapshot field name leaked as visible UI text')

console.log('STAGE03-H6C ITEMIZED PIPELINE ACCEPTANCE PASSED — itemized arithmetic, Create persistence, historical read/report behavior, edit guard and visible Branch2 line pricing align end-to-end')
