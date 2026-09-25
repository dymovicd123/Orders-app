import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderEditorSection.tsx')
const utils = read('src/app/utils.ts')
const write = read('worker/domains/orders-write.ts')
const manifest = JSON.parse(read('scripts/stage03-h8b-itemized-restricted-editor-frontend-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H8B: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H8B: Branch2 D1 binding drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H8B: Production D1 identity leaked into Branch2')

check(manifest?.version === 1 && manifest?.revision === 'stage03-h8b-itemized-restricted-editor', 'H8B frontend manifest missing')
check(Object.keys(manifest.files || {}).sort().join(',') === [
  'src/App.tsx',
  'src/app/utils.ts',
  'src/features/sections/OrderEditorSection.tsx',
].sort().join(','), 'H8B frontend allow-list widened')

const persistStart = app.indexOf('async function persistOrder')
const persistEnd = app.indexOf('\n\n  async function loadArchivePreview', persistStart)
check(persistStart >= 0 && persistEnd > persistStart, 'H8B persistOrder boundary missing')
const persist = app.slice(persistStart, persistEnd)
check(persist.includes("const isItemizedEdit = order.pricing_mode === 'itemized_v1'"), 'H8B itemized edit selector missing')
check(persist.includes(': isItemizedEdit ? {'), 'H8B restricted metadata/payment payload branch missing')
const restrictedStart = persist.indexOf(': isItemizedEdit ? {')
const legacyStart = persist.indexOf('} : {', restrictedStart)
check(legacyStart > restrictedStart, 'H8B restricted/legacy payload split missing')
const restrictedPayload = persist.slice(restrictedStart, legacyStart)
for (const marker of ['orderDate:', 'managerId:', 'managerName:', 'customerPhone:', 'customerName:', 'city:', 'deliveryType:', 'comment:', 'paymentCorrections', 'itemPriceCorrections']) {
  check(restrictedPayload.includes(marker), 'H8B restricted payload missing allowed field: ' + marker)
}
for (const marker of ['sourceType:', 'orderTotal:', 'workshopStatus:', 'orderStatus:', 'shippingStatus:', 'items:', 'payments:']) {
  check(!restrictedPayload.includes(marker), 'H8B restricted payload leaked forbidden commercial/physical field: ' + marker)
}
check(persist.includes('const pendingEditorPayments = nextDraft.payments.filter((payment) => !payment.id)'), 'H8F itemized editor lost support for visible new-payment drafts')
check(persist.includes('if (!isItemizedEdit || isItemizedContentRewrite) invalidateInventoryStockCaches(true)'), 'H8B/H8E inventory invalidation boundary drifted')

const openStart = app.indexOf('async function handleEditOrder')
const openEnd = app.indexOf('\n\n  function upsertOrderInState', openStart)
const openFlow = app.slice(openStart, openEnd)
check(!openFlow.includes("if (order.pricing_mode === 'itemized_v1')"), 'H8B still blanket-blocks itemized editor opening')

check(ui.includes("const itemizedMode = selectedOrder?.pricing_mode === 'itemized_v1'"), 'H8B restricted UI mode missing')
check(ui.includes('Редактируйте заказ прямо в форме'), 'H8F direct editor guidance missing')
check(!ui.includes('Изменить состав') && !ui.includes('Только просмотр'), 'H8F must not restore the old composition permission gate')
check(ui.includes('Цена продажи') && ui.includes('Цена по каталогу') && ui.includes('Сумма позиции'), 'H8B historical price facts missing')
check(ui.includes('Пересчитывается автоматически из количества и цены продажи по позициям'), 'H8F itemized order total no longer updates directly in the editor')
check(ui.includes('Жизненный цикл меняется только отдельными штатными действиями'), 'H8B lifecycle field is not read-only')
check(ui.includes('+ Первичная оплата') && ui.includes('+ Закрытие долга'), 'H8F payment creation controls are not visible in the editor')
check(ui.includes('Проведённые оплаты редактируются прямо в полях ниже'), 'H8F direct payment-edit guidance missing')
check(ui.includes("{savingOrder ? 'Сохраняю...' : 'Сохранить изменения'}"), 'H8F unified save action missing')

check(utils.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'H8B editor draft loses the historical Catalog snapshot')

const updateStart = write.indexOf('export async function updateOrderCritical')
const updateEnd = write.indexOf('\n\nexport async function getOrder', updateStart)
const edit = write.slice(updateStart, updateEnd)
check(edit.includes("const itemizedMetadataOnlyEdit = existingPricingMode === 'itemized_v1'"), 'H8B backend metadata-only lane missing')
check(edit.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete' && !itemizedMetadataOnlyEdit"), 'H8B backend fail-closed guard missing')
for (const marker of ['input.externalId === undefined','input.items === undefined','input.payments === undefined','input.orderTotal === undefined','input.sourceType === undefined','input.orderStatus === undefined','input.shippingStatus === undefined']) {
  check(edit.includes(marker), 'H8B backend hard stop missing: ' + marker)
}

console.log('STAGE03-H8B ITEMIZED EDIT FOUNDATION PASSED — stale-safe metadata/payment correction remains intact while H8F presents the authorized editor as one direct form')
