import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const worker = read('worker/domains/returns-exchanges.ts')
const app = read('src/App.tsx')
const doc = read('docs/continuation/STAGE03_H9_ITEMIZED_EXCHANGE_20260925.md')

check(wrangler.includes('"name": "orders-app-branch2"'), 'H9A: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H9A: Branch2 D1 identity drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H9A: Production D1 identity leaked into Branch2')

const exchangeStart = worker.indexOf('export async function createExchange')
const exchangeEnd = worker.indexOf('\n\nexport async function correctExchangeFinancials', exchangeStart)
check(exchangeStart >= 0 && exchangeEnd > exchangeStart, 'H9A createExchange boundary missing')
const createExchange = worker.slice(exchangeStart, exchangeEnd)

check(createExchange.includes("const isItemizedExchange = cleanText((existing as any).pricing_mode) === 'itemized_v1'"), 'H9A must branch on persisted pricing mode')
check(!createExchange.includes('Обмен для заказа с построчной itemized-ценой пока отключён'), 'H9A backend itemized guard was not retired')
for (const field of ['expectedOrderTotal', 'expectedOldActiveQuantity', 'expectedOldUnitPrice', 'expectedOldLineTotal', 'expectedOldCatalogPriceSnapshot']) {
  check(createExchange.includes(field), 'H9A stale itemized snapshot missing ' + field)
}
check(createExchange.includes('SELECT id, quantity, unit_price, line_total, catalog_price_snapshot'), 'H9A does not re-read active itemized commercial truth')
check(createExchange.includes('currentItemizedTotalAmount !== ledger.totalAmount'), 'H9A does not fail closed on order-total/item-line drift')
check(createExchange.includes('buildItemizedOrderWritePlan'), 'H9A replacement line does not use itemized write validation')
check(createExchange.includes('catalogPriceSnapshot: input.newItem.catalogPriceSnapshot ?? null'), 'H9A replacement Catalog snapshot is not explicit')
check(createExchange.includes('itemizedExchangePricingPlan: itemizedExchangePricingPlan || null'), 'H9A validated pricing plan is not frozen for idempotent retry')
check(createExchange.includes('isItemizedExchange ? itemizedExchangeWritePlan : null'), 'H9A replacement row is not inserted through itemized persistence')
check(createExchange.includes('projectedTotalAmount = currentItemizedTotalAmount - replacedOldValue + newLine.lineTotal'), 'H9A projected total is not derived from old/new line values')
check(createExchange.includes("financialAction === 'extra_payment'") && createExchange.includes("financialAction === 'refund'"), 'H9A money action separation missing')
check(createExchange.includes("if (isItemizedExchange || financialAction !== 'none')"), 'H9A itemized total is not persisted when exchange has no money event')
check(createExchange.includes('if (!isItemizedExchange)') && createExchange.includes('baseTotalAmount, ledger.totalAmount)) + financialAmount'), 'H9A legacy extra-payment total compatibility disappeared')
check(createExchange.includes('baseTotalAmount, ledger.totalAmount)) - financialAmount'), 'H9A legacy refund total compatibility disappeared')
check(createExchange.includes('необъяснённая переплата'), 'H9A projected net-money overpayment guard missing')

const correctionStart = worker.indexOf('export async function correctExchangeFinancials')
const correctionEnd = worker.indexOf('\n\nexport async function listExchanges', correctionStart)
const correction = worker.slice(correctionStart, correctionEnd)
check(correction.includes('o.pricing_mode'), 'H9A financial correction does not read pricing mode')
check(correction.includes("const isItemizedExchange = cleanText(row.pricing_mode) === 'itemized_v1'"), 'H9A financial correction itemized branch missing')
check(correction.includes('projectedReceivedAmount') && correction.includes('projectedReturnAmount') && correction.includes('projectedNetPaid'), 'H9A itemized money-correction overpayment guard missing')
check(correction.includes('if (!isItemizedExchange)') && correction.includes('UPDATE orders SET total_amount'), 'H9A legacy correction total path disappeared')
check(correction.indexOf('if (!isItemizedExchange)') < correction.lastIndexOf('UPDATE orders SET total_amount'), 'H9A itemized financial correction total write is not guarded')

const cancelStart = worker.indexOf('export async function cancelExchange')
const cancel = worker.slice(cancelStart)
check(cancel.includes('o.pricing_mode'), 'H9A cancellation does not read pricing mode')
check(cancel.includes("const isItemizedExchange = cleanText(exchange.pricing_mode) === 'itemized_v1'"), 'H9A cancellation itemized branch missing')
check(cancel.includes('restoredTotalAmountTarget = currentTotal - removedNewValue + restoredOldValue'), 'H9A cancellation still restores itemized total from financial delta instead of line values')
check(cancel.includes('derivedCurrentTotal !== currentTotal'), 'H9A cancellation does not fail closed on itemized total drift')

const regularExchangeStart = app.indexOf('async function handleOpenExchange')
const regularExchangeEnd = app.indexOf('\n\n  function closeOrderEditor', regularExchangeStart)
const workshopExchangeStart = app.indexOf('async function openWorkshopExchange')
const workshopExchangeEnd = app.indexOf('\n\n  async function ', workshopExchangeStart + 40)
const regularExchange = app.slice(regularExchangeStart, regularExchangeEnd)
const workshopExchange = app.slice(workshopExchangeStart, workshopExchangeEnd)
check(regularExchange.includes("order.pricing_mode === 'itemized_v1'"), 'H9A must not expose ordinary itemized Exchange UI yet')
check(workshopExchange.includes("order.pricing_mode === 'itemized_v1'"), 'H9A must not expose Workshop itemized Exchange UI yet')

for (const marker of [
  '`orders.total_amount` is derived from the active itemized lines',
  'money facts do **not** add to or subtract from `orders.total_amount`',
  'Legacy `legacy_manual_total` exchange arithmetic is preserved unchanged',
  'Production/main is not a target',
]) check(doc.includes(marker), 'H9A continuation contract missing: ' + marker)

console.log('STAGE03-H9A ITEMIZED EXCHANGE BACKEND PASSED — Branch2 backend now has stale-safe itemized replacement pricing, line-derived totals, independent exchange money, safe correction/cancellation semantics, while UI activation remains deferred to H9B')
