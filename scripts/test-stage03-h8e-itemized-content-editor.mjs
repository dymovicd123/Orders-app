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

check(app.includes('const [itemizedContentEditMode, setItemizedContentEditMode] = useState(false)'), 'H8E dedicated composition mode state missing')
check(app.includes('const [itemizedContentEditLoading, setItemizedContentEditLoading] = useState(false)'), 'H8E composition refresh state missing')

const begin = between(app, 'async function beginItemizedContentEdit()', '\n\n  function cancelItemizedContentEdit')
check(begin.includes("selectedOrder.shipping_status === 'sent'"), 'H8E UI entry does not block sent orders')
check(begin.includes('committed_return_count') && begin.includes('committed_exchange_count'), 'H8E UI entry does not block known downstream operations')
check(begin.includes('loadCatalogData(true)'), 'H8E does not refresh Catalog before composition editing')
check(begin.includes("loadInventoryData('warehouse', true, '', false)") && begin.includes("loadInventoryData('boutique', true, '', false)"), 'H8E does not refresh both stock sources before editing')
check(begin.includes('setEditorDraft(createEditorDraft(selectedOrder))') && begin.includes('setItemizedContentEditMode(true)'), 'H8E does not start from fresh persisted order truth')

const updateEditorItem = between(app, 'function updateEditorItem(', '\n\n  function updateEditorPayment')
check(updateEditorItem.includes("selectedOrder?.pricing_mode === 'itemized_v1' && itemizedContentEditMode"), 'H8E editor changes are not scoped to itemized composition mode')
check(updateEditorItem.includes("nextItem.priceOrigin = rawPrice === '' ? 'missing' : 'manual'"), 'H8E manual final price state missing')
check(updateEditorItem.includes("['productName', 'audienceType', 'material', 'length'].includes(String(field))"), 'H8E confirmed Catalog price dimensions drifted')
check(updateEditorItem.includes('resolveCatalogOrderSalePrice(catalogData, nextItem)'), 'H8E price-key changes do not resolve current Catalog price')
check(updateEditorItem.includes("keepManualPrice = item.priceOrigin === 'manual'"), 'H8E manual sold-price override preservation missing')
check(updateEditorItem.includes('nextItem.priceNeedsConfirmation = true'), 'H8E retained manual price is not confirmation-gated after price-key change')

const persist = between(app, 'async function persistOrder(', '\n\n  async function loadArchivePreview')
check(persist.includes("const isItemizedContentRewrite = isItemizedEdit && itemizedContentEditMode"), 'H8E persistence mode selector missing')
check(persist.includes('if (isItemizedEdit && !isItemizedContentRewrite)'), 'H8E can mix H8C price correction into content rewrite')
check(persist.includes('if (!isItemizedContentRewrite) for (const payment of nextDraft.payments)'), 'H8E can mix payment corrections into content rewrite')
check(persist.includes('evaluateItemizedCreatePricing(nextDraft.items, order.payments)'), 'H8E does not validate replacement money against persisted payments')
check(persist.includes("blocker?.code === 'overpayment'"), 'H8E client overpayment blocker missing')
check(persist.includes('expectedItems: order.items.map((item) => ({'), 'H8E full expected stale snapshot missing')
for (const marker of ['orderItemId:', 'lineTotal:', 'catalogPriceSnapshot:', 'sourceType:', 'workshopUrgent:']) {
  check(persist.includes(marker), 'H8E expected/replacement contract missing field: ' + marker)
}
check(persist.includes('items: nextDraft.items.map((item) => ({'), 'H8E proposed full composition missing')
check(persist.includes('observedPhysicalQuantity:') && persist.includes('shortageAcknowledged:'), 'H8E stock shortage decisions are not carried into replacement')
check(persist.includes('const payload = isItemizedContentRewrite ? {') && persist.includes('itemContentReplacement,'), 'H8E does not use the dedicated H8D request envelope')

const rewritePayloadStart = persist.indexOf('const payload = isItemizedContentRewrite ? {')
const metadataBranchStart = persist.indexOf('} : isItemizedEdit ? {', rewritePayloadStart)
check(rewritePayloadStart >= 0 && metadataBranchStart > rewritePayloadStart, 'H8E rewrite payload boundary missing')
const rewritePayload = persist.slice(rewritePayloadStart, metadataBranchStart)
check(rewritePayload.includes('itemContentReplacement'), 'H8E rewrite payload lost replacement envelope')
for (const marker of ['orderDate:', 'managerId:', 'paymentCorrections', 'itemPriceCorrections', 'orderTotal:', 'sourceType:']) {
  check(!rewritePayload.includes(marker), 'H8E rewrite payload mixed forbidden field: ' + marker)
}
check(persist.includes('if (!isItemizedEdit || isItemizedContentRewrite) invalidateInventoryStockCaches(true)'), 'H8E content rewrite does not invalidate stock cache')
check(persist.includes('резервы и задачи Цеха пересобраны по новому составу'), 'H8E content rewrite success state is ambiguous')

check(ui.includes('Изменить состав') && ui.includes('Отменить изменение состава'), 'H8E dedicated composition-mode controls missing')
check(ui.includes('fieldset disabled={Boolean(itemizedContentEditMode)}'), 'H8E metadata is not disabled during content rewrite')
check(ui.includes('fieldset disabled={Boolean(itemizedMode && !itemizedContentEditMode)}'), 'H8E physical item editor is not gated behind composition mode')
check(ui.includes("itemizedContentEditMode ? 'Сохранить новый состав'"), 'H8E dedicated save action missing')
check(ui.includes('Оплаты не меняются вместе с составом'), 'H8E payment isolation is not explained in UI')
check(ui.includes('{itemizedMode && !itemizedContentEditMode ? ('), 'H8E does not hide H8C price-only correction panel while replacing content')
check(ui.includes("renderOrderSourceAvailability(item, `edit-item-${index}`, index, 'itemized_edit')"), 'H8E future-reservation preview is not rendered')
check(ui.includes('Старый резерв этого заказа учитывается как освобождаемый'), 'H8E reservation replacement semantics are not explained')
check(ui.includes('Цена продажи') && ui.includes('Подтвердить текущую цену'), 'H8E final sold-price controls/confirmation missing')
check(ui.includes("item.priceOrigin === 'manual'") && ui.includes("item.priceOrigin === 'catalog'"), 'H8E price origin is not visible to manager')

check(vm.includes('itemizedContentEditMode: boolean') && vm.includes('selectedOrder: OrderRecord | null'), 'H8E workspace view model lacks composition/order context')
const editorPick = between(vm, 'function applyEditorProductPick(', '\n\n\n  function applyExchangeProductPick')
check(editorPick.includes('resolveCatalogOrderSalePrice(catalogData, pickedItem)'), 'H8E Catalog product pick does not resolve sale price')
check(editorPick.includes("keepManualPrice = item.priceOrigin === 'manual'"), 'H8E product pick silently drops a manual sold price')
check(editorPick.includes('priceNeedsConfirmation: keepManualPrice'), 'H8E product pick does not require confirmation of retained manual price')
check(vm.includes("mode: 'create' | 'edit' | 'itemized_edit'"), 'H8E availability preview mode missing')
check(vm.includes("mode === 'itemized_edit' && selectedOrder"), 'H8E old order reservation is not credited in preview')
check(vm.includes('summary.reserved - Math.max(0, reservationCredit)'), 'H8E availability preview does not remove the current order reservation')
check(vm.includes("if (mode === 'edit' && !serverShortage) return null"), 'H8E should show local preview only in dedicated itemized mode, not legacy edit')

check(utils.includes("priceOrigin: item.catalogPriceSnapshot !== null"), 'H8E editor draft does not classify historical final price origin')
check(pricing.includes('export function resolveCatalogOrderSalePrice'), 'H8E Catalog price resolver disappeared')

const serverEdit = between(write, 'export async function updateOrderCritical(', '\n\nexport async function getOrder')
check(serverEdit.includes('itemContentReplacement?: ItemContentReplacementInput'), 'H8E server H8D replacement contract missing')
check(serverEdit.includes('replacementExpectedItems') && serverEdit.includes('replacementItems'), 'H8E server stale-safe pair missing')
check(serverEdit.includes('assertCreateOrderShortageDecisions(db, nextItems, rewritePreResolvedCatalog, { excludeOrderId: id })'), 'H8E server does not revalidate fresh stock excluding old order reservations')
check(serverEdit.includes('itemizedRewritePlan = buildItemizedOrderWritePlan('), 'H8E server does not derive itemized money for replacement')
check(write.includes('p.itemizedRewritePlan || null'), 'H8E replacement insertion lost Catalog snapshot write plan')

console.log('STAGE03-H8E ITEMIZED CONTENT EDITOR PASSED — Branch2 exposes an explicit composition mode that refreshes Catalog/stock, previews availability with the old reservation released, re-resolves confirmed price dimensions, isolates metadata/payments/H8C, and submits only the stale-safe H8D replacement envelope')
