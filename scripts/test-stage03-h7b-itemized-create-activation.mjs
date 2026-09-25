import fs from 'node:fs'
import ts from 'typescript'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const ui = read('src/features/sections/CreateOrderSection.tsx')
const pricingSource = read('src/app/order-pricing.ts')
const types = read('src/app/types.ts')
const utils = read('src/app/utils.ts')
const workspace = read('src/app/controllers/useWorkspaceViewModel.tsx')
const write = read('worker/domains/orders-write.ts')
const returns = read('worker/domains/returns-exchanges.ts')

check(wrangler.includes('"name": "orders-app-branch2"'), 'H7B must run against Branch2 Worker')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'H7B must run against Branch2 D1')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H7B Branch2 D1 id drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H7B detected Production D1 identity')

check(types.includes("priceOrigin?: 'catalog' | 'manual' | 'missing'") && types.includes('priceNeedsConfirmation?: boolean'), 'Draft price-origin safety state missing')
check(utils.includes("priceOrigin: 'missing'") && utils.includes('unitPrice: undefined'), 'New Create draft must distinguish missing price from explicit zero')
check(workspace.includes("const keepManualPrice = item.priceOrigin === 'manual'"), 'Catalog product pick no longer preserves manual override for explicit reconfirmation')
check(workspace.includes('priceNeedsConfirmation: keepManualPrice'), 'Catalog product pick no longer marks stale manual price for review')
check(app.includes("const keepManualPrice = item.priceOrigin === 'manual'"), 'Price-driving field update no longer protects manual override')
check(app.includes('nextItem.priceNeedsConfirmation = true'), 'Price-driving field update no longer requires explicit reconfirmation')
check(app.includes("field === 'unitPrice'") && app.includes("nextItem.priceOrigin = rawPrice === '' ? 'missing' : 'manual'"), 'Manual final-price edit state missing')

const createStart = app.indexOf('async function createOrderFromDraft')
const createEnd = app.indexOf('\n  function ', createStart + 40)
check(createStart >= 0 && createEnd > createStart, 'H7B Create source boundary missing')
const create = app.slice(createStart, createEnd)
check(create.includes("pricingMode: 'itemized_v1'"), 'H7B Create does not send itemized_v1')
check(!create.includes('orderTotal: createDraft.orderTotal'), 'H7B Create still sends legacy manual total')
check(create.includes('unitPrice: item.unitPrice'), 'H7B Create does not send final sold price')
check(create.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'H7B Create does not send historical Catalog recommendation')
check(create.includes('evaluateItemizedCreatePricing(createDraft.items, createDraft.payments)'), 'H7B Create does not preflight pricing/payments immediately before save')
check(create.includes("pricing_mode: 'itemized_v1'"), 'Optimistic local order loses itemized identity')

check(ui.includes('Цена по каталогу') && ui.includes('Цена продажи') && ui.includes('Сумма позиции'), 'H7B visible line-pricing fields missing')
check(!ui.includes('value={createDraft.orderTotal}'), 'Legacy editable order total remains in Create UI')
check(ui.includes('Подтвердить цену') && ui.includes('priceNeedsConfirmation'), 'Manual override reconfirmation UI missing')
check(!ui.includes('<span>catalogPriceSnapshot</span>'), 'Technical snapshot field name leaked as visible UI text')

check(pricingSource.includes("'price_confirmation_required'"), 'Readiness model lacks stale-manual-price blocker')
check(pricingSource.includes("'missing_unit_price'") && pricingSource.includes("'overpayment'"), 'Readiness model lost core fail-closed blockers')

const utilsSource = read('src/app/utils.ts')
const transpile = src => ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const modules = new Map()
function load(name, src) {
  if (modules.has(name)) return modules.get(name).exports
  const module = { exports: {} }
  modules.set(name, module)
  new Function('require','module','exports',transpile(src))((specifier) => {
    if (specifier === './utils') return load('utils', utilsSource)
    if (specifier === './types') return {}
    throw new Error('Unexpected import: ' + specifier)
  }, module, module.exports)
  return module.exports
}
const pricing = load('pricing', pricingSource)

let result = pricing.evaluateItemizedCreatePricing(
  [
    { productName: 'A', quantity: 2, unitPrice: 4000, catalogPriceSnapshot: 5000, priceOrigin: 'manual', priceNeedsConfirmation: false },
    { productName: 'B', quantity: 1, unitPrice: 0, catalogPriceSnapshot: null, priceOrigin: 'manual', priceNeedsConfirmation: false },
  ],
  [{ method: 'НАЛИЧКА', amount: 3000 }, { method: 'КАСПИ МАГАЗИН', amount: 0 }],
)
check(result.status === 'ready' && result.totalAmount === 8000 && result.receivedAmount === 3000 && result.debtAmount === 5000, 'H7B itemized preview arithmetic/zero-price policy drifted')

result = pricing.evaluateItemizedCreatePricing(
  [{ productName: 'A', quantity: 1, unitPrice: 4000, catalogPriceSnapshot: 5000, priceOrigin: 'manual', priceNeedsConfirmation: true }],
  [],
)
check(result.status === 'blocked' && result.blockers.some(x => x.code === 'price_confirmation_required'), 'H7B stale manual override must fail closed')

const serverCreate = write.slice(write.indexOf('export async function createOrder'), write.indexOf('export async function updateOrderCritical'))
check(serverCreate.includes("pricingMode === 'itemized_v1'") && serverCreate.includes('buildItemizedOrderWritePlan(itemizedLines, normalizedPayments)'), 'Server itemized Create revalidation missing')
check(write.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete'"), 'Existing-order legacy editor is not fail-closed for itemized orders')
const exchange = returns.slice(returns.indexOf('export async function createExchange'))
check(exchange.includes("pricing_mode") && exchange.includes("'itemized_v1'"), 'Legacy exchange is not fail-closed for itemized orders')

console.log('STAGE03-H7B ITEMIZED CREATE ACTIVATION PASSED — Branch2 new orders use explicit line prices and historical Catalog snapshots, missing versus zero is distinct, stale manual overrides require confirmation, and legacy edit/exchange remain isolated')
