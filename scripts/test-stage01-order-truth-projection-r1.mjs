import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const projection = read('src/app/orderOperationalProjection.ts')
const utils = read('src/app/utils.ts')
const controller = read('src/app/controllers/useOperationalViewModel.ts')
const app = read('src/App.tsx')
const table = read('src/features/sections/OrdersTableSection.tsx')
const details = read('src/features/sections/OrderDetailsSection.tsx')
const editor = read('src/features/sections/OrderEditorSection.tsx')

// Stage 0 truth contract: refund money is not a whole-order lifecycle status.
check(projection.includes('return_amount is a financial aggregate, not a whole-order lifecycle state'), 'projection truth contract for return_amount is missing')
check(!utils.includes('export function isReturnedOrderRecord'), 'old return_amount lifecycle helper still exists')
check(!utils.includes("if (Number(order.return_amount || 0) > 0) return 'Возвращён'"), 'order lifecycle still collapses refund money into returned state')
check(!app.includes('isReturnedOrderRecord'), 'App still depends on the old returned-order shortcut')
check(!controller.includes('isReturnedOrderRecord'), 'operational view model still filters by the old returned-order shortcut')
check(!table.includes('isReturnedOrderRecord'), 'orders table still gates actions by the old returned-order shortcut')
check(!details.includes('isReturnedOrderRecord'), 'order details still gate actions by the old returned-order shortcut')

// A previous Return must not hide the whole order from Return/Exchange workflows.
check(
  controller.includes("orders.filter((order) => order.order_status !== 'deleted' && order.order_status !== 'archived')"),
  'Return/Exchange candidate lists must keep non-archived orders even when a previous Return exists',
)
check(projection.includes('canOpenReturn: mutableWorkingOrder'), 'projection must not make any refund terminal for future Return eligibility')
check(projection.includes('canOpenExchange: mutableWorkingOrder'), 'projection must not make any refund terminal for future Exchange eligibility')

// Backend still protects destructive editing; UI uses active Return operations, not refund amount, for that guard.
check(projection.includes('canEdit: mutableWorkingOrder && !hasCommittedDownstreamOperation'), 'edit safety must use committed Return/Exchange operations instead of return_amount lifecycle semantics')
check(table.includes('projection.canEdit'), 'orders table is not consuming projection edit safety')
check(details.includes('projection.canEdit'), 'order details are not consuming projection edit safety')
check(editor.includes('projection?.canEdit'), 'order editor visibility is not consuming projection edit safety')

// Debt remains its own money dimension and is no longer blocked merely because refund_amount > 0.
const debtHandler = app.slice(app.indexOf('function handleOpenDebt'), app.indexOf('function handleOpenReturn'))
check(!debtHandler.includes('Возвращённый заказ'), 'debt workflow still treats refund as terminal whole-order state')
check(!debtHandler.includes('return_amount'), 'debt workflow still reads refund amount as an eligibility shortcut')
check(projection.includes('canOpenDebt: mutableWorkingOrder && debtAmount > 0'), 'debt eligibility must be driven by actual debt')

// Order list exposes gross/refund/net facts instead of implying gross received is money still retained.
check(table.includes('Возвращено {formatMoney(projection.refundAmount)} · осталось {formatMoney(projection.netRetainedAmount)}'), 'orders table does not expose refund/net context next to gross received money')
check(details.includes('Осталось денег: {formatMoney(projection.netRetainedAmount)}'), 'order details do not expose net retained money')

// Workshop truth is derived from per-item tasks first; the coarse order field is only a fallback.
check(projection.includes('knownWorkshopStatuses.length === 0 && coarseWorkshopStatus === \'in_workshop\''), 'coarse workshop_status must only be a compatibility fallback')
check(!editor.includes("'workshopStatus',"), 'generic order editor still mutates coarse workshop_status')
check(details.includes('projection.workshopLabel'), 'order details do not consume derived Workshop summary')
check(table.includes('projection.workshopPending'), 'orders table does not consume derived Workshop task summary')

// Avoid reintroducing one giant status; independent dimensions remain explicit in the projection.
for (const marker of ['refundAmount', 'netRetainedAmount', 'workshopSummary', 'lifecycleLabel', 'canOpenDebt', 'canOpenReturn', 'canOpenExchange']) {
  check(projection.includes(marker), 'shared operational projection lost dimension: ' + marker)
}

console.log('STAGE01 ORDER TRUTH PROJECTION R1 PASSED — refund, money, Workshop and order lifecycle are no longer collapsed into return_amount/coarse status shortcuts')
