import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const types = read('src/app/types.ts')
const utils = read('src/app/utils.ts')
const app = read('src/App.tsx')
const ui = read('src/features/sections/OrderReturnsSection.tsx')
const worker = read('worker/domains/returns-exchanges.ts')

check(types.includes('issuedToClient: boolean'), 'Return draft no longer carries exact handover truth')
check(utils.includes("const issuedStockStatuses = new Set(['fulfilled', 'written_off', 'negative'])"), 'Return draft lost exact stock handover statuses')
check(utils.includes("order?.shipping_status === 'sent' && (sourceType === 'workshop' || !stockStatus)"), 'Return draft uses broad sent status instead of Workshop/missing-status fallback')
check(utils.includes('issuedToClient,'), 'Return draft does not expose the derived handover fact')

const saveStart = app.indexOf('async function saveReturn()')
const saveEnd = app.indexOf('\n\n  async function saveExchange', saveStart)
const save = app.slice(saveStart, saveEnd)
check(save.includes('selectedUnissuedItem') && save.includes('!item.issuedToClient'), 'Return client save path can still submit a never-issued physical row')
check(save.includes('если нужно вернуть только деньги') || save.includes('Если нужно вернуть только деньги'), 'Return client guard does not explain money-only refund path')

check(ui.includes('Есть товары, которые клиенту не выдавали'), 'Return UI does not explain the never-issued case')
check(ui.includes('сначала измените состав заказа'), 'Return UI does not direct cancelled-before-handover goods to Order edit')
check(ui.includes("'Не выдавали'") && ui.includes('Товар остаётся у вас') && ui.includes('disabled={item.issuedToClient === false || returnBusy}'), 'Never-issued Return rows are not visibly blocked from physical intake')
check(ui.includes('handleEditOrder(returnSelectedOrder)'), 'Return UI does not offer a direct safe Order edit action')
check(ui.includes("(item.isWorkshop ? 'no_stock' : 'warehouse')"), 'Delayed Workshop Return intake can default to Warehouse from history')

const createStart = worker.indexOf('export async function createReturn(')
const createEnd = worker.indexOf('\n\nexport async function receiveReturnedItem', createStart)
const createReturn = worker.slice(createStart, createEnd)
check(createReturn.includes('const issuedToClient = orderItemWasPhysicallyIssued(orderItem) || sentFallback'), 'Return backend does not derive physical handover truth')
check(createReturn.includes("cleanText((existing as any).shipping_status) === 'sent' && (isWorkshop || !stockStatus)"), 'Return backend uses a broad order-level sent fallback')
check(createReturn.includes('if (!issuedToClient)') && !createReturn.includes('humanInventoryModelEnabled && !issuedToClient'), 'Return backend still allows no-stock/pending loopholes for never-issued goods or gates the safety rule behind an inventory feature flag')
check(createReturn.includes('Физический возврат для неё оформлять нельзя'), 'Return backend guard is not operator-readable')

const cancelStart = worker.indexOf('export async function cancelReturn(')
const cancelEnd = worker.indexOf('\n\nexport async function cancelExchange', cancelStart)
const cancelReturn = worker.slice(cancelStart, cancelEnd)
check(cancelReturn.includes('workshopTargets'), 'Return cancellation does not freeze Workshop restore targets')
check(cancelReturn.includes("await advanceCriticalOperation(db, criticalOperation, 'validated'"), 'Return cancellation does not persist its frozen pre-mutation target')
check(cancelReturn.includes('currentQuantity === targetQuantity && currentStatus === targetStatus'), 'Return cancellation retry does not recognize an already-restored Workshop target')
check(cancelReturn.includes('currentQuantity !== baselineQuantity || currentStatus !== baselineStatus'), 'Return cancellation can add Workshop quantity twice after a lost response')
check(cancelReturn.includes('AND quantity = ? AND status = ?'), 'Return Workshop restore lacks a CAS guard')
check(cancelReturn.indexOf('Связанная задача Цеха больше не найдена') < cancelReturn.indexOf('const lifecycleRows = await db.prepare'), 'Return cancellation can touch stock before proving Workshop dependencies still exist')
check(cancelReturn.includes('const atBaseline =') && cancelReturn.includes('const atTarget ='), 'Return cancellation does not preflight Workshop baseline/target state before stock reversal')

console.log('RETURN UX/SAFETY R2 PASSED — never-issued goods cannot become fake physical returns, money-only refunds remain explicit, Workshop delayed intake defaults safely, and Return cancellation is replay-safe for Workshop quantities.')
