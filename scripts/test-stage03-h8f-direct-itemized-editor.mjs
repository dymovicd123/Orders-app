import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderEditorSection.tsx')
const vm = read('src/app/controllers/useWorkspaceViewModel.tsx')
const write = read('worker/domains/orders-write.ts')
const workerManifest = JSON.parse(read('scripts/stage03-h8f-direct-itemized-editor-worker-manifest.json'))
const frontendManifest = JSON.parse(read('scripts/stage03-h8f-direct-itemized-editor-frontend-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H8F: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H8F: Branch2 D1 binding drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H8F: Production D1 identity leaked into Branch2')

check(workerManifest?.version === 1 && workerManifest?.revision === 'stage03-h8f-direct-itemized-editor', 'H8F Worker structural manifest missing')
check(frontendManifest?.version === 1 && frontendManifest?.revision === 'stage03-h8f-direct-itemized-editor', 'H8F frontend structural manifest missing')
check(Object.keys(workerManifest.files || {}).join(',') === 'worker/domains/orders-write.ts', 'H8F Worker allow-list widened')
check(Object.keys(frontendManifest.files || {}).sort().join(',') === [
  'src/App.tsx',
  'src/app/controllers/useWorkspaceViewModel.tsx',
  'src/features/sections/OrderEditorSection.tsx',
].sort().join(','), 'H8F frontend allow-list widened')

check(!app.includes('itemizedContentEditMode'), 'H8F old composition mode still exists in App')
check(!ui.includes('Изменить состав') && !ui.includes('Отменить изменение состава'), 'H8F old composition permission buttons still exist')
check(!ui.includes('Подтвердить изменение цены') && !ui.includes('Подтвердить текущую цену') && !ui.includes('Цена подтверждена'), 'H8F redundant sold-price confirmations still exist')
check(ui.includes('Редактируйте заказ прямо в форме'), 'H8F direct-edit explanation missing')
check(ui.includes("{savingOrder ? 'Сохраняю...' : 'Сохранить изменения'}"), 'H8F unified Save button missing')

check(ui.includes('<span>Цена продажи</span>'), 'H8F sold price is not directly editable in the item card')
check(ui.includes("onChange={(event) => updateEditorItem(index, 'unitPrice'"), 'H8F sold-price field is not wired directly')
check(ui.includes("onChange={(event) => updateEditorItem(index, 'quantity'"), 'H8F quantity is not directly editable')
check(ui.includes("onChange={(event) => updateEditorItem(index, 'sourceType'"), 'H8F source is not directly editable')
check(ui.includes('onClick={addEditorItem}') && ui.includes('onClick={() => removeEditorItem(index)}'), 'H8F add/remove item actions are not directly available')
check(ui.includes('editorDraft.items.length <= 1'), 'H8F last-item deletion guard missing')

check(ui.includes('Проведённые оплаты редактируются прямо в полях ниже'), 'H8F payment editing is not obvious in the UI')
check(ui.includes("onChange={(event) => updateEditorPayment(index, 'amount'"), 'H8F payment amount is not directly editable')
check(ui.includes("onChange={(value) => updateEditorPayment(index, 'method'"), 'H8F payment method is not directly editable')
check(ui.includes("onChange={(event) => updateEditorPayment(index, 'paymentDate'"), 'H8F payment date is not directly editable')
check(ui.includes("onChange={(event) => updateEditorPayment(index, 'paymentKind'"), 'H8F payment kind is not directly editable')
check(ui.includes('+ Первичная оплата') && ui.includes('+ Закрытие долга'), 'H8F payment-add actions are hidden from itemized editor')
check(ui.includes('Провести оплату'), 'H8F new payment draft has no explicit commit action')

check(ui.includes('editedItemizedTotal') && ui.includes('editedReceivedTotal') && ui.includes('editedDebtTotal'), 'H8F live itemized money preview missing')
check(ui.includes('Пересчитывается автоматически из количества и цены продажи по позициям'), 'H8F live total explanation missing')

const persistStart = app.indexOf('async function persistOrder')
const persistEnd = app.indexOf('\n\n  async function loadArchivePreview', persistStart)
check(persistStart >= 0 && persistEnd > persistStart, 'H8F persistOrder boundary missing')
const persist = app.slice(persistStart, persistEnd)
check(persist.includes('const isItemizedContentRewrite = isItemizedEdit && ('), 'H8F does not decide rewrite from actual physical differences')
check(!persist.includes('if (item.priceNeedsConfirmation)'), 'H8F Save still requires redundant price confirmation')
check(persist.includes('for (const payment of nextDraft.payments)'), 'H8F existing payment changes are not collected in all itemized edit cases')
check(persist.includes('const pendingEditorPayments = nextDraft.payments.filter((payment) => !payment.id)'), 'H8F itemized editor drops new payment drafts')
check(persist.includes('itemPriceCorrections') && persist.includes('itemContentReplacement'), 'H8F lost separate safe server contracts for price-only versus physical changes')

const rewriteStart = persist.indexOf('const payload = isItemizedContentRewrite ? {')
const metadataStart = persist.indexOf('} : isItemizedEdit ? {', rewriteStart)
check(rewriteStart >= 0 && metadataStart > rewriteStart, 'H8F unified rewrite payload boundary missing')
const rewritePayload = persist.slice(rewriteStart, metadataStart)
for (const field of ['orderDate:', 'managerId:', 'managerName:', 'customerPhone:', 'customerName:', 'city:', 'deliveryType:', 'comment:', 'paymentCorrections', 'itemContentReplacement']) {
  check(rewritePayload.includes(field), 'H8F unified rewrite payload missing ' + field)
}
check(!rewritePayload.includes('itemPriceCorrections'), 'H8F composition rewrite must not duplicate price-only correction contract')

const workerStart = write.indexOf('export async function updateOrderCritical')
const workerEnd = write.indexOf('\n\nexport async function getOrder', workerStart)
const edit = write.slice(workerStart, workerEnd)
check(!edit.includes('Замена состава должна сохраняться отдельным действием без одновременного изменения реквизитов заказа'), 'H8F server still blocks unified metadata + composition save')
check(!edit.includes('Замена состава и исправление проведённых оплат должны сохраняться отдельными действиями'), 'H8F server still blocks unified payment + composition save')
check(edit.includes('receivedAmount: correctedReceivedAmount'), 'H8F combined rewrite ignores edited payment amount')
check(edit.includes('debtAmount: Math.max(0, itemizedRewritePlan.totalAmount - correctedReceivedAmount)'), 'H8F combined rewrite debt is not derived from new total and corrected payments')
check(edit.includes('if (totals.receivedAmount > totals.totalAmount)'), 'H8F combined edit lost overpayment protection')
check(edit.includes('expectedCatalogSnapshot !== currentCatalogSnapshot'), 'H8F combined edit lost stale Catalog snapshot protection')
check(edit.includes('assertCreateOrderShortageDecisions(db, nextItems, rewritePreResolvedCatalog, { excludeOrderId: id })'), 'H8F combined edit lost authoritative stock recheck')
check(edit.includes("existingShippingStatus === 'sent'") && edit.includes('completedOrderOperationCounts(db, id)'), 'H8F combined edit lost sent/downstream operation guards')

check(vm.includes("priceNeedsConfirmation: false"), 'H8F Catalog product pick still creates an extra confirmation step')
check(vm.includes("mode === 'itemized_edit' && selectedOrder"), 'H8F direct editor lost old-reservation availability credit')

console.log('STAGE03-H8F DIRECT ITEMIZED EDITOR PASSED — edit entry itself authorizes normal field editing, one Save may combine metadata/composition/existing-payment changes, sold price has no extra confirmation click, and backend stale/inventory/money guards remain intact')
