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
const ui = read('src/features/sections/OrderEditorSection.tsx')
const vm = read('src/app/controllers/useWorkspaceViewModel.tsx')
const utils = read('src/app/utils.ts')
const pricing = read('src/app/order-pricing.ts')
const write = read('worker/domains/orders-write.ts')
const manifest = JSON.parse(read('scripts/stage03-h8e-itemized-content-editor-frontend-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H8E: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H8E: Branch2 D1 binding drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H8E: Production D1 identity leaked into Branch2')

check(manifest?.version === 1 && manifest?.revision === 'stage03-h8e-itemized-content-editor', 'H8E frontend structural manifest missing')
check(Object.keys(manifest.files || {}).sort().join(',') === [
  'src/App.tsx',
  'src/app/controllers/useWorkspaceViewModel.tsx',
  'src/app/utils.ts',
  'src/features/sections/OrderEditorSection.tsx',
].sort().join(','), 'H8E frontend allow-list widened')

check(!app.includes('itemizedContentEditMode') && !app.includes('beginItemizedContentEdit'), 'H8F must remove the old permission-like composition mode')

const openFlow = between(app, 'async function handleEditOrder(', '\n\n  function upsertOrderInState')
check(openFlow.includes("order.pricing_mode === 'itemized_v1'"), 'H8F itemized editor no longer refreshes supporting data')
check(openFlow.includes('loadCatalogData(true)'), 'H8F does not refresh Catalog after opening an itemized editor')
check(openFlow.includes("loadInventoryData('warehouse', true, '', false)") && openFlow.includes("loadInventoryData('boutique', true, '', false)"), 'H8F does not refresh both stock sources')

const updateEditorItem = between(app, 'function updateEditorItem(', '\n\n  function updateEditorPayment')
check(updateEditorItem.includes("selectedOrder?.pricing_mode === 'itemized_v1'"), 'H8F direct itemized price logic missing')
check(updateEditorItem.includes("nextItem.priceOrigin = rawPrice === '' ? 'missing' : 'manual'"), 'H8F manual final price state missing')
check(updateEditorItem.includes("['productName', 'audienceType', 'material', 'length'].includes(String(field))"), 'H8F confirmed Catalog price dimensions drifted')
check(updateEditorItem.includes('resolveCatalogOrderSalePrice(catalogData, nextItem)'), 'H8F price-key changes do not resolve current Catalog price')
check(updateEditorItem.includes("keepManualPrice = item.priceOrigin === 'manual'"), 'H8F manual sold-price override preservation missing')
check(updateEditorItem.includes('nextItem.priceNeedsConfirmation = false'), 'H8F should preserve manual price without requiring another click')

const persist = between(app, 'async function persistOrder(', '\n\n  async function loadArchivePreview')
check(persist.includes('const isItemizedContentRewrite = isItemizedEdit && ('), 'H8F no longer derives physical rewrite from actual draft changes')
check(persist.includes('originalItemsById') && persist.includes('nextDraft.items.length !== order.items.length'), 'H8F physical-change detector missing item identity/count checks')
check(persist.includes('if (isItemizedEdit && !isItemizedContentRewrite)'), 'H8F price-only path no longer stays separate from physical rewrite')
check(persist.includes('for (const payment of nextDraft.payments)'), 'H8F payment corrections are not collected during unified editing')
check(persist.includes("evaluateItemizedCreatePricing(nextDraft.items, nextDraft.payments.filter((payment) => Boolean(payment.id)))"), 'H8F does not validate replacement money against edited posted payments')
check(persist.includes("blocker?.code === 'overpayment'"), 'H8F client overpayment blocker missing')
check(!persist.includes("blocker?.code === 'price_confirmation_required'"), 'H8F still blocks Save on redundant price confirmation')
check(persist.includes('expectedItems: order.items.map((item) => ({'), 'H8F full expected stale snapshot missing')
check(persist.includes('items: nextDraft.items.map((item) => ({'), 'H8F proposed full composition missing')
check(persist.includes('observedPhysicalQuantity:') && persist.includes('shortageAcknowledged:'), 'H8F stock shortage decisions are not carried into replacement')

const rewritePayloadStart = persist.indexOf('const payload = isItemizedContentRewrite ? {')
const metadataBranchStart = persist.indexOf('} : isItemizedEdit ? {', rewritePayloadStart)
check(rewritePayloadStart >= 0 && metadataBranchStart > rewritePayloadStart, 'H8F rewrite payload boundary missing')
const rewritePayload = persist.slice(rewritePayloadStart, metadataBranchStart)
for (const marker of ['orderDate:', 'managerId:', 'customerPhone:', 'comment:', 'paymentCorrections', 'itemContentReplacement']) {
  check(rewritePayload.includes(marker), 'H8F unified rewrite payload missing: ' + marker)
}
for (const marker of ['itemPriceCorrections', 'orderTotal:', 'workshopStatus:', 'orderStatus:', 'shippingStatus:', 'items:']) {
  check(!rewritePayload.includes(marker), 'H8F unified rewrite payload leaked forbidden legacy field: ' + marker)
}
check(persist.includes('if (!isItemizedEdit || isItemizedContentRewrite) invalidateInventoryStockCaches(true)'), 'H8F physical rewrite does not invalidate stock cache')

check(ui.includes('Редактируйте заказ прямо в форме'), 'H8F direct editor guidance missing')
check(!ui.includes('Изменить состав') && !ui.includes('Отменить изменение состава'), 'H8F still exposes a separate composition mode')
check(!ui.includes('Подтвердить изменение цены') && !ui.includes('Подтвердить текущую цену'), 'H8F still exposes redundant price confirmations')
check(ui.includes('Цена продажи') && ui.includes('Цена по каталогу') && ui.includes('Сумма позиции'), 'H8F direct price controls missing')
check(ui.includes("renderOrderSourceAvailability(item, `edit-item-${index}`, index, 'itemized_edit')"), 'H8F future-reservation preview is not rendered')
check(ui.includes('Проведённые оплаты редактируются прямо в полях ниже'), 'H8F direct payment edit is not visible to the user')
check(ui.includes('+ Первичная оплата') && ui.includes('+ Закрытие долга'), 'H8F new-payment controls missing')
check(ui.includes("{savingOrder ? 'Сохраняю...' : 'Сохранить изменения'}"), 'H8F unified Save action missing')

check(vm.includes('selectedOrder: OrderRecord | null'), 'H8F workspace view model lacks order context')
check(!vm.includes('itemizedContentEditMode: boolean'), 'H8F workspace view model still requires old composition mode')
const editorPick = between(vm, 'function applyEditorProductPick(', '\n\n  const resolveExchangeItemPricing')
check(editorPick.includes('resolveCatalogOrderSalePrice(catalogData, pickedItem)'), 'H8F Catalog product pick does not resolve sale price')
check(editorPick.includes("keepManualPrice = item.priceOrigin === 'manual'"), 'H8F product pick silently drops a manual sold price')
check(editorPick.includes('priceNeedsConfirmation: false'), 'H8F product pick reintroduced confirmation gating')
check(vm.includes("mode: 'create' | 'edit' | 'itemized_edit'"), 'H8F availability preview mode missing')
check(vm.includes("mode === 'itemized_edit' && selectedOrder"), 'H8F old order reservation is not credited in preview')
check(vm.includes('summary.reserved - Math.max(0, reservationCredit)'), 'H8F availability preview does not remove the current order reservation')

check(utils.includes("priceOrigin: item.catalogPriceSnapshot !== null"), 'H8F editor draft does not classify historical final price origin')
check(pricing.includes('export function resolveCatalogOrderSalePrice'), 'H8F Catalog price resolver disappeared')

const serverEdit = between(write, 'export async function updateOrderCritical(', '\n\nexport async function getOrder')
check(serverEdit.includes('itemContentReplacement?: ItemContentReplacementInput'), 'H8F server H8D replacement contract missing')
check(serverEdit.includes('replacementExpectedItems') && serverEdit.includes('replacementItems'), 'H8F server stale-safe pair missing')
check(serverEdit.includes('assertCreateOrderShortageDecisions(db, nextItems, rewritePreResolvedCatalog, { excludeOrderId: id })'), 'H8F server does not revalidate fresh stock excluding old reservations')
check(serverEdit.includes('receivedAmount: correctedReceivedAmount') && serverEdit.includes('debtAmount: Math.max(0, itemizedRewritePlan.totalAmount - correctedReceivedAmount)'), 'H8F server does not combine rewritten composition with edited posted payments safely')
check(write.includes('p.itemizedRewritePlan || null'), 'H8F replacement insertion lost Catalog snapshot write plan')

console.log('STAGE03-H8E/H8F ITEMIZED EDITOR PASSED — itemized editing is now one direct form; backend stale, inventory, pricing and money guards remain authoritative without redundant UI permission/confirmation steps')
