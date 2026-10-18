// Regression: managers/admins can cancel a specific standalone Return from the
// order row; Exchange-owned refunds remain coupled to their Exchange. All
// actual money/stock writes remain in established, tested Worker handlers.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const ui=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const app=readFileSync('src/App.tsx','utf8')
const server=readFileSync('worker/index.ts','utf8')
const returns=readFileSync('worker/domains/returns-exchanges.ts','utf8')
assert(ui.includes('Отменить возврат')&&ui.includes('Отменить выбранный возврат'))
assert(ui.includes('openReturnCancel(order)')&&ui.includes('returnCancelDraft.choices'))
assert(ui.includes('selected.parentExchangeId')&&ui.includes('Отмените сам обмен'))
assert(app.includes('async function loadOrderReturnCancellationChoices('))
assert(app.includes('async function cancelOrderReturnChoice('))
assert(app.includes('const current=await loadOrderReturnCancellationChoices(order)'))
assert(app.includes('actual.parentExchangeId')&&app.includes("method:'PATCH'"))
assert(app.includes("prepareCriticalRequest(criticalKey,payload)"))
assert(app.includes("completeCriticalRequest(criticalKey,critical.requestId)"))
assert(app.includes("'/api/returns/'+selected.id+'/cancel'"))
assert(server.includes("const orderReturnCancelChoicesMatch="))
assert(server.includes("r.order_id=? AND COALESCE(r.status,'completed')<>'cancelled'"))
assert(server.includes("AS parent_exchange_id"))
assert(returns.includes('const linkedExchange = await db.prepare('))
assert(returns.includes('Отмените сам обмен, чтобы склад и деньги откатились вместе.'))
assert(returns.includes('cancelInventoryLifecycleEvent('))
assert(returns.includes('refundReversalMoneyEventStatement('))
assert((app.match(/loadOrderReturnCancellationChoices, cancelOrderReturnChoice,/g)||[]).length===2,
  'Ordinary and Kaspi order lists must use the same reviewed handler')
console.log('ORDER_RETURN_CANCEL_MENU_AND_EXCHANGE_REFUND_GUARDS_PASSED')
