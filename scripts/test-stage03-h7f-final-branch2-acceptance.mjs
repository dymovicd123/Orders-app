import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const ui = read('src/features/sections/CreateOrderSection.tsx')
const pricing = read('src/app/order-pricing.ts')
const write = read('worker/domains/orders-write.ts')
const returns = read('worker/domains/returns-exchanges.ts')
const finance = read('worker/domains/finance-reports.ts')
const workshop = read('worker/domains/workshop.ts')
const clients = read('worker/domains/clients.ts')
const cash = read('worker/domains/cash.ts')
const storage = read('worker/domains/storage.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const migration73 = read('migrations/0073_v72_order_item_pricing_foundation.sql')
const migration74 = read('migrations/0074_v72_retained_order_pricing_mode.sql')
const manifest = JSON.parse(read('scripts/stage03-h7b-itemized-create-activation-frontend-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H7F: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"'), 'H7F: Branch2 D1 name drifted')
check(wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H7F: Branch2 D1 id drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H7F: Production D1 identity leaked into Branch2')

check(manifest?.version === 1 && manifest?.revision === 'stage03-h7b-itemized-create-activation', 'H7F: exact H7 frontend manifest missing')
const expectedFrontendFiles = [
  'src/App.tsx',
  'src/app/controllers/useWorkspaceViewModel.tsx',
  'src/app/order-pricing.ts',
  'src/app/types.ts',
  'src/app/utils.ts',
  'src/features/sections/CreateOrderSection.tsx',
].sort().join(',')
check(Object.keys(manifest.files || {}).sort().join(',') === expectedFrontendFiles, 'H7F: H7 frontend allow-list widened')

const createStart = app.indexOf('async function createOrderFromDraft')
const createEnd = app.indexOf('\n  function ', createStart + 40)
check(createStart >= 0 && createEnd > createStart, 'H7F: Create flow boundary missing')
const create = app.slice(createStart, createEnd)
check(create.includes("pricingMode: 'itemized_v1'"), 'H7F: Create lost explicit itemized pricing mode')
check(!create.includes('orderTotal: createDraft.orderTotal'), 'H7F: legacy independent order total leaked back into itemized Create')
check(create.includes('unitPrice: item.unitPrice'), 'H7F: final sold line price missing from Create payload')
check(create.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'H7F: Catalog price snapshot missing from Create payload')
check(create.includes('evaluateItemizedCreatePricing(createDraft.items, createDraft.payments)'), 'H7F: frontend save-time pricing preflight missing')

check(ui.includes('Цена по каталогу') && ui.includes('Цена продажи') && ui.includes('Сумма позиции'), 'H7F: visible itemized line-pricing UI missing')
check(!ui.includes('value={createDraft.orderTotal}'), 'H7F: old editable order total is visible again')
check(ui.includes('Подтвердить цену') && ui.includes('priceNeedsConfirmation'), 'H7F: stale manual-price confirmation UI missing')
check(pricing.includes("'price_confirmation_required'"), 'H7F: stale manual override blocker missing')
check(pricing.includes("'missing_unit_price'") && pricing.includes("'overpayment'"), 'H7F: missing-price/overpayment fail-closed blockers missing')

const serverCreateStart = write.indexOf('export async function createOrder')
const serverEditStart = write.indexOf('export async function updateOrderCritical')
check(serverCreateStart >= 0 && serverEditStart > serverCreateStart, 'H7F: server Create/Edit boundaries missing')
const serverCreate = write.slice(serverCreateStart, serverEditStart)
const serverEdit = write.slice(serverEditStart)
check(serverCreate.includes("pricingMode === 'itemized_v1'"), 'H7F: server itemized Create mode gate missing')
check(serverCreate.includes('isOrderPricingFoundationEnabled(db)'), 'H7F: server no longer requires pricing schema')
check(serverCreate.includes('buildItemizedOrderWritePlan(itemizedLines, normalizedPayments)'), 'H7F: server itemized arithmetic revalidation missing')
check(serverCreate.includes("'itemized_v1'") && serverCreate.includes('pricing_mode'), 'H7F: persisted itemized classification missing')
check(serverEdit.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete' && !itemizedMetadataOnlyEdit"), 'H7F: unsupported legacy full-editor rewrites are no longer fail-closed for itemized orders')
check(serverEdit.includes('input.items === undefined') && serverEdit.includes('input.payments === undefined') && serverEdit.includes('input.orderTotal === undefined'), 'H7F: H8A metadata-only exception widened into commercial rewrite semantics')

const exchangeStart = returns.indexOf('export async function createExchange')
const returnStart = returns.indexOf('export async function createReturn')
check(exchangeStart >= 0 && returnStart >= 0, 'H7F: return/exchange boundaries missing')
const exchange = returns.slice(exchangeStart)
const createReturn = returns.slice(returnStart, exchangeStart > returnStart ? exchangeStart : undefined)
check(exchange.includes("cleanText((existing as any).pricing_mode) === 'itemized_v1'"), 'H7F: legacy exchange no longer blocks itemized orders')
check(createReturn.includes('const amount = Math.max(0, toInt(input.amount, 0))'), 'H7F: return amount is no longer explicit manager input')
check(!createReturn.includes('catalog_execution_prices') && !createReturn.includes('catalog_price_snapshot'), 'H7F: return flow started repricing from Catalog')

check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'H7F: exact itemized product revenue path missing')
check(!finance.includes('catalog_execution_prices'), 'H7F: Finance started reading mutable current Catalog price')
for (const [name, source] of [['workshop', workshop], ['clients', clients], ['cash', cash]]) {
  check(!source.includes('catalog_execution_prices'), 'H7F: ' + name + ' started reading mutable current Catalog price')
}
check(storage.includes("COALESCE(o.pricing_mode, 'legacy_manual_total')"), 'H7F: retained storage no longer preserves pricing generation')
check(ordersRead.includes("cleanText(row.pricing_mode) === 'itemized_v1' ? 'itemized_v1' : 'legacy_manual_total'"), 'H7F: retained read classification missing')
check(migration73.includes("DEFAULT 'legacy_manual_total'") && migration73.includes('catalog_price_snapshot'), 'H7F: pricing foundation migration drifted')
check(migration74.includes("DEFAULT 'legacy_manual_total'") && migration74.includes("'itemized_v1'"), 'H7F: retained pricing migration drifted')

console.log('STAGE03-H7F FINAL BRANCH2 ACCEPTANCE PASSED — active itemized Create, server revalidation, legacy edit/exchange guards, manual returns, historical pricing retention and adjacent Finance/Workshop/Clients/Cash isolation remain aligned under Branch2-only environment hard stops')
