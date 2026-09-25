import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderEditorSection.tsx')
const utils = read('src/app/utils.ts')
const types = read('src/app/types.ts')
const write = read('worker/domains/orders-write.ts')
const workerManifest = JSON.parse(read('scripts/stage03-h8c-itemized-price-correction-worker-manifest.json'))
const frontendManifest = JSON.parse(read('scripts/stage03-h8c-itemized-price-correction-frontend-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H8C: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H8C: Branch2 D1 binding drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H8C: Production D1 identity leaked into Branch2')

check(workerManifest?.version === 1 && workerManifest?.revision === 'stage03-h8c-itemized-price-correction', 'H8C Worker structural manifest missing')
check(frontendManifest?.version === 1 && frontendManifest?.revision === 'stage03-h8c-itemized-price-correction', 'H8C frontend structural manifest missing')
check(Object.keys(workerManifest.files || {}).join(',') === 'worker/domains/orders-write.ts', 'H8C Worker allow-list widened')
check(Object.keys(frontendManifest.files || {}).sort().join(',') === [
  'src/App.tsx',
  'src/app/types.ts',
  'src/app/utils.ts',
  'src/features/sections/OrderEditorSection.tsx',
].sort().join(','), 'H8C frontend allow-list widened')

check(types.includes('export type EditorItem = OrderItem & {') && types.includes('orderItemId?: number'), 'H8C editor item lost persisted order-item identity')
check(utils.includes('orderItemId: Number(item.id || 0) || undefined'), 'H8C editor draft does not preserve order-item id')
check(utils.includes('catalogPriceSnapshot: item.catalogPriceSnapshot ?? null'), 'H8C editor draft lost historical Catalog snapshot')

const persistStart = app.indexOf('async function persistOrder')
const persistEnd = app.indexOf('\n\n  async function loadArchivePreview', persistStart)
check(persistStart >= 0 && persistEnd > persistStart, 'H8C persistOrder boundary missing')
const persist = app.slice(persistStart, persistEnd)
check(persist.includes('const itemPriceCorrections: Array<{'), 'H8C client correction list missing')
check(persist.includes('expectedUnitPrice: originalUnitPrice'), 'H8C client stale-price snapshot missing')
check(persist.includes('expectedQuantity: Number(original.quantity || 0)'), 'H8C client stale-quantity snapshot missing')
check(persist.includes('expectedLineTotal: Number(original.lineTotal || 0)'), 'H8C client stale-line-total snapshot missing')
check(persist.includes('expectedCatalogPriceSnapshot: original.catalogPriceSnapshot ?? null'), 'H8C client stale Catalog-snapshot guard missing')
check(persist.includes('if (item.priceNeedsConfirmation)'), 'H8C manual price confirmation gate missing')
check(persist.includes('itemPriceCorrections,'), 'H8C restricted payload does not send dedicated corrections')

const restrictedStart = persist.indexOf(': isItemizedEdit ? {')
const legacyStart = persist.indexOf('} : {', restrictedStart)
const restrictedPayload = persist.slice(restrictedStart, legacyStart)
check(restrictedPayload.includes('itemPriceCorrections'), 'H8C restricted payload lost price corrections')
for (const marker of ['items:', 'orderTotal:', 'sourceType:', 'workshopStatus:', 'orderStatus:', 'shippingStatus:']) {
  check(!restrictedPayload.includes(marker), 'H8C price correction leaked full commercial/physical field: ' + marker)
}

check(ui.includes('Исправить цену продажи'), 'H8C price correction input missing')
check(ui.includes('Подтвердить изменение цены'), 'H8C explicit human confirmation missing')
check(ui.includes('Цена по каталогу') && ui.includes('цена Каталога при этом не переписывается'), 'H8C historical Catalog snapshot policy is not visible')
check(ui.includes('Итог после коррекции'), 'H8C corrected order-total preview missing')
check(ui.includes('Сохранение будет остановлено, если новый итог окажется меньше уже проведённых оплат'), 'H8C overpayment fail-closed explanation missing')
check(ui.includes('fieldset disabled={Boolean(itemizedMode && !itemizedContentEditMode)}'), 'H8C physical item fields are no longer read-only outside H8E')
check(ui.includes('{itemizedMode && !itemizedContentEditMode ? ('), 'H8C price-only panel is not isolated from H8E composition editing')

const editStart = write.indexOf('export async function updateOrderCritical')
const editEnd = write.indexOf('\n\nexport async function getOrder', editStart)
check(editStart >= 0 && editEnd > editStart, 'H8C server edit boundary missing')
const edit = write.slice(editStart, editEnd)
check(edit.includes('type ItemPriceCorrectionInput = {'), 'H8C server correction contract missing')
check(edit.includes('rawItemPriceCorrections'), 'H8C server does not parse dedicated price corrections')
check(edit.includes("existingPricingMode !== 'itemized_v1'"), 'H8C server does not reject dedicated correction on legacy orders')
check(edit.includes("options.lifecycleAction === 'order_delete'"), 'H8C server does not isolate price correction from delete')
check(edit.includes('SELECT id, quantity, unit_price, line_total, catalog_price_snapshot'), 'H8C server does not read current sold-line truth')
check(edit.includes('seenItemIds.has(orderItemId)'), 'H8C duplicate item correction guard missing')
check(edit.includes('expectedUnitPrice') && edit.includes('expectedQuantity') && edit.includes('expectedLineTotal') && edit.includes('expectedCatalogPriceSnapshot'), 'H8C stale-write guards incomplete')
check(edit.includes('Number.isSafeInteger(nextUnitPrice)') && edit.includes('nextUnitPrice < 0'), 'H8C sold-price integer validation missing')
check(edit.includes('const nextLineTotal = quantity * nextUnitPrice'), 'H8C line total is not server-derived')
check(edit.includes('assertItemizedOrderMoneyNotOverpaid('), 'H8C order total/debt is not server-revalidated')
check(edit.includes('if (itemContentChanged || priceOnlyItemsEdit || rewritePayments || deletingOrder) {'), 'H8C return/exchange safety guard missing')
check(edit.includes('priceOnlyItemUpdates.push({ orderItemId, unitPrice: nextUnitPrice, lineTotal: nextLineTotal })'), 'H8C does not reuse isolated price-only write path')

const priceCommitStart = write.indexOf('const priceOnlyItemUpdates = Array.isArray(p.priceOnlyItemUpdates)')
const priceCommitEnd = write.indexOf("await advanceCriticalOperation(db, criticalOperation, 'order_updated');", priceCommitStart)
const priceCommit = write.slice(priceCommitStart, priceCommitEnd)
check(priceCommit.includes('SET unit_price = ?, line_total = ?'), 'H8C persisted sold price/line total write missing')
check(!priceCommit.includes('catalog_price_snapshot'), 'H8C must never rewrite historical Catalog snapshot')
check(priceCommit.includes('await db.batch([') && priceCommit.includes('orderUpdateStatement'), 'H8C line and order totals must commit together')
check(write.includes('stockReversals = (p.rewriteItems || p.deletingOrder)'), 'H8C price correction started moving stock')
check(write.includes('if (p.rewriteItems) await retireOrderItemsForRewrite'), 'H8C price correction may retire physical order items')

console.log('STAGE03-H8C ITEMIZED PRICE CORRECTION PASSED — sold-price correction remains stale-safe and isolated from the H8E composition-rewrite UI; Catalog snapshot and inventory stay untouched in H8C')
