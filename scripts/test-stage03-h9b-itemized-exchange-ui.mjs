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
const ui = read('src/features/sections/OrderExchangeSection.tsx')
const vm = read('src/app/controllers/useWorkspaceViewModel.tsx')
const utils = read('src/app/utils.ts')
const worker = read('worker/domains/returns-exchanges.ts')
const doc = read('docs/continuation/STAGE03_H9_ITEMIZED_EXCHANGE_20260925.md')
const manifest = JSON.parse(read('scripts/stage03-h9b-itemized-exchange-ui-frontend-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H9B: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H9B: Branch2 D1 identity drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H9B: Production D1 identity leaked into Branch2')

check(manifest?.version === 1 && manifest?.revision === 'stage03-h9b-itemized-exchange-ui', 'H9B frontend manifest missing')
check(Object.keys(manifest.files || {}).sort().join(',') === [
  'src/App.tsx',
  'src/app/controllers/useWorkspaceViewModel.tsx',
  'src/app/utils.ts',
  'src/features/sections/OrderExchangeSection.tsx',
].sort().join(','), 'H9B frontend structural allow-list widened')

const regularExchange = between(app, 'async function handleOpenExchange', '\n\n  function closeOrderEditor')
const workshopExchange = between(app, 'async function openWorkshopExchange', '\n\n  function inventoryOperationVariantFromRow')
check(!regularExchange.includes("order.pricing_mode === 'itemized_v1'"), 'H9B ordinary itemized Exchange remains blocked')
check(!workshopExchange.includes("order.pricing_mode === 'itemized_v1'"), 'H9B Workshop itemized Exchange remains blocked')
check(workshopExchange.includes("order.pricing_mode === 'itemized_v1' && exactWorkshopItem") && workshopExchange.includes("unitPrice: Number(exactWorkshopItem.unitPrice)"), 'H9B Workshop entry does not seed the exact historical sold price')
check(!app.includes('текущая форма обмена работает по старой общей цене'), 'H9B stale guard copy remains visible')

const saveExchange = between(app, 'async function saveExchange()', '\n\n  async function ')
check(saveExchange.includes("const itemizedExchange = exchangeSelectedOrder.pricing_mode === 'itemized_v1'"), 'H9B save path does not branch on persisted pricing mode')
check(saveExchange.includes('itemizedExchange && pairDrafts.length !== 1'), 'H9B itemized Exchange does not fail closed on multi-pair draft')
for (const field of ['expectedOrderTotal', 'expectedOldActiveQuantity', 'expectedOldUnitPrice', 'expectedOldLineTotal', 'expectedOldCatalogPriceSnapshot']) {
  check(saveExchange.includes(field), 'H9B stale snapshot payload missing ' + field)
}
check(saveExchange.includes('unitPrice: Number(pair.effectiveNewItem.unitPrice)') && saveExchange.includes('catalogPriceSnapshot: pair.effectiveNewItem.catalogPriceSnapshot == null ? null'), 'H9B does not send factual sold price separately from Catalog snapshot')
check(saveExchange.includes('ценовые данные старой позиции устарели или повреждены'), 'H9B old-line client preflight missing')
check(saveExchange.includes('укажите фактическую цену продажи новой позиции'), 'H9B missing sold-price client guard missing')

check(ui.includes("const itemizedExchange = exchangeSelectedOrder?.pricing_mode === 'itemized_v1'"), 'H9B form does not identify itemized order')
check(ui.includes('Цена по каталогу') && ui.includes('Цена продажи') && ui.includes('Сумма новой позиции'), 'H9B direct itemized pricing controls missing')
check(ui.includes("priceOrigin: 'manual'"), 'H9B direct manager sold-price edit is not marked as factual/manual')
check(ui.includes('Рекомендация фиксируется в истории отдельно и не меняет цену клиента автоматически.'), 'H9B Catalog recommendation separation copy missing')
check(ui.includes('Для обмена без доплаты можно оставить цену старой позиции.'), 'H9B no-surcharge factual-price guidance missing')
check(ui.includes('{!itemizedExchange ? (') && ui.includes('Добавить ещё позицию'), 'H9B itemized multi-pair UI is not disabled')
check(ui.includes('itemizedPriceReady'), 'H9B UI does not fail closed when sold price is missing/invalid')

check(vm.includes('const resolveExchangeItemPricing'), 'H9B exchange Catalog price resolver missing')
check(vm.includes("selectedOrder?.pricing_mode !== 'itemized_v1'"), 'H9B resolver is not isolated from legacy Exchange')
check(vm.includes("previousItem.priceOrigin === 'manual'"), 'H9B Catalog refresh drops a deliberate sold price')
check(vm.includes('catalogPriceSnapshot: pricing.status === \'matched\' ? pricing.catalogPriceSnapshot : null'), 'H9B current Catalog recommendation is not refreshed separately')
check(vm.includes('applyExchangeItemPatch') && app.includes('applyExchangeItemPatch'), 'H9B price-driving field helper is not wired into App')

check(utils.includes("const itemizedPricing = order?.pricing_mode === 'itemized_v1'"), 'H9B draft does not distinguish itemized Exchange')
check(utils.includes('unitPrice: hasSafeOldSoldPrice ? Number(oldSoldPrice) : undefined'), 'H9B no-surcharge default does not start from historical sold price')
check(utils.includes('catalogPriceSnapshot: null'), 'H9B draft must not copy the old item Catalog snapshot to the new item')

const createExchange = between(worker, 'export async function createExchange', '\n\nexport async function correctExchangeFinancials')
check(createExchange.includes('projectedTotalAmount = currentItemizedTotalAmount - replacedOldValue + newLine.lineTotal'), 'H9B lost H9A line-derived total semantics')
check(createExchange.includes('projectedNetPaid > projectedTotalAmount'), 'H9B lost unexplained-overpayment protection')
check(createExchange.includes('isItemizedExchange ? itemizedExchangeWritePlan : null'), 'H9B does not persist the replacement as an itemized priced line')

for (const marker of [
  'H9B UI activation',
  'one replacement pair per itemized Exchange operation',
  'historical sold price is the default factual price',
  'Catalog recommendation remains a separate snapshot',
]) check(doc.includes(marker), 'H9B continuation contract missing: ' + marker)

console.log('STAGE03-H9B ITEMIZED EXCHANGE UI PASSED — Branch2 Exchange now exposes direct sold price plus separate Catalog snapshot, sends the H9A stale snapshot, keeps legacy behavior isolated, and limits itemized operations to one replacement pair per critical operation')
