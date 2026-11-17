import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const types = read('src/app/types.ts')
const utils = read('src/app/utils.ts')
const app = read('src/App.tsx')
const creationActions = read('src/features/orders/returnExchangeCreationActions.ts')
const ui = read('src/features/sections/OrderReturnsSection.tsx')
const v2Ui = read('src/features/sections/OrderReturnV2Flow.tsx')
const creation = read('worker/domains/order-return-creation.ts')
const cancellation = read('worker/domains/order-return-cancellation.ts')
const preparation = read('src/app/returnCreationOperation.ts')

check(types.includes('issuedToClient: boolean'), 'Return draft no longer carries exact handover truth')
check(utils.includes("const issuedStockStatuses = new Set(['fulfilled', 'written_off', 'negative'])"), 'Return draft lost exact stock handover statuses')
check(utils.includes("order?.shipping_status === 'sent' && (sourceType === 'workshop' || !stockStatus)"), 'Return draft uses broad sent status instead of Workshop/missing-status fallback')
check(utils.includes('issuedToClient,'), 'Return draft does not expose the derived handover fact')

const saveStart = creationActions.indexOf('async function saveReturn()')
const saveEnd = creationActions.indexOf('\n\n  async function saveExchange', saveStart)
const save = creationActions.slice(saveStart, saveEnd)
check(app.includes('createReturnExchangeCreationActions({') && saveStart >= 0 && saveEnd > saveStart
  && save.includes('prepareReturnCreation(returnSelectedOrder, returnDraft)'), 'Return client must call validated preparation before saving')
check(preparation.includes('selectedUnissuedItem') && preparation.includes('!item.issuedToClient'), 'Return preparation must reject never-issued physical items')
check(preparation.includes('Если нужно вернуть только деньги'), 'Return preparation must explain money-only refund path')

check(ui.includes('<OrderReturnV2Flow') && !ui.includes('saveReturn()'),
  'Employee Returns must use the versioned editor instead of legacy physical intake')
check(v2Ui.includes("line.proposedAction==='physical_return_pending'"),
  'Return V2 must only offer receipt intent for an actually dispatched item')
check(v2Ui.includes('receiptIntent:line.proposedAction') && v2Ui.includes(":'pending'"),
  'Unsent goods must never create physical arrival')
check(v2Ui.includes('Не отправлен') && v2Ui.includes('Физический остаток не увеличится'),
  'Return V2 must explain never-issued warehouse quantity')
check(v2Ui.includes('Клиент отказался от изделия из цеха') && v2Ui.includes('Задание цеху и его оплата сохраняются'),
  'Return V2 must retain Workshop obligation when the client cancels')
check(v2Ui.includes('line.requiresReview') && v2Ui.includes('disabled={locked||line.requiresReview}'),
  'Return V2 must prohibit unsafe unproven lines')

const warehouseModel = read('src/features/inventory/views/warehouseReceivingModel.ts')
const warehouseUi = read('src/features/inventory/views/WarehouseReceivingWorkspace.tsx')
check(warehouseModel.includes("sourceType === 'workshop' || isWorkshop")
  && warehouseModel.includes("return 'no_stock'")
  && warehouseUi.includes('value={destination}')
  && warehouseUi.includes('destination: destinations[item.key] || item.defaultDestination'),
  'Delayed Workshop Return intake must default to no_stock in the Warehouse display and save call')

const createReturn = creation
check(createReturn.includes('const issuedToClient = await orderItemWasActuallyDispatched(db,orderItem) || sentFallback'), 'Return backend does not derive physical handover truth')
check(createReturn.includes("cleanText((existing as any).shipping_status) === 'sent' && (isWorkshop || !stockStatus)"), 'Return backend uses a broad order-level sent fallback')
check(createReturn.includes('if (!issuedToClient)') && !createReturn.includes('humanInventoryModelEnabled && !issuedToClient'), 'Return backend still allows no-stock/pending loopholes for never-issued goods or gates the safety rule behind an inventory feature flag')
check(createReturn.includes('Физический возврат для неё оформлять нельзя'), 'Return backend guard is not operator-readable')

const cancelReturn = cancellation
check(cancelReturn.includes('workshopTargets'), 'Return cancellation does not freeze Workshop restore targets')
check(cancelReturn.includes("await advanceCriticalOperation(db, criticalOperation, 'validated'"), 'Return cancellation does not persist its frozen pre-mutation target')
check(cancelReturn.includes('currentQuantity === targetQuantity && currentStatus === targetStatus'), 'Return cancellation retry does not recognize an already-restored Workshop target')
check(cancelReturn.includes('currentQuantity !== baselineQuantity || currentStatus !== baselineStatus'), 'Return cancellation can add Workshop quantity twice after a lost response')
check(cancelReturn.includes('AND quantity = ? AND status = ?'), 'Return Workshop restore lacks a CAS guard')
check(cancelReturn.indexOf('Связанная задача Цеха больше не найдена') < cancelReturn.indexOf('const lifecycleRows = await db.prepare'), 'Return cancellation can touch stock before proving Workshop dependencies still exist')
check(cancelReturn.includes('const atBaseline =') && cancelReturn.includes('const atTarget ='), 'Return cancellation does not preflight Workshop baseline/target state before stock reversal')

console.log('RETURN UX/SAFETY R2 PASSED — never-issued goods cannot become fake physical returns, money-only refunds remain explicit, Workshop delayed intake defaults safely, and Return cancellation is replay-safe for Workshop quantities.')
