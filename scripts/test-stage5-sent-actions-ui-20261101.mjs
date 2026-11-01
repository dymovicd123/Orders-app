import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const ui=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
assert(ui.includes("!projection.deleted && order.shipping_status !== 'sent' ? ("),
  'Sent orders must have no ordinary send button')
assert(!ui.includes("order.shipping_status==='sent' ? 'Отправки' : 'Отправить товары'"),
  'Do not show a mislabeled active shipping action on shipped orders')
assert(ui.includes('Посмотреть отправленные товары'),'Dispatch history must stay reachable')
assert(ui.includes('(order.items||[]).some((item:any)=>item.shipmentSentQuantity!=null)'),
  'Only orders with a recorded dispatch ledger should show its history button')
assert(ui.includes('openDispatchDraft(order)'), 'Do not remove the existing correction/history path')
assert(ui.includes("role=\"dialog\" aria-modal=\"true\""),'History must retain accessible dialog')
assert(ui.includes("Отправить замену:"),'Do not strand pending exchange replacements during UX-only correction')
assert(!ui.includes('window.confirm(')&&!ui.includes('window.prompt('),
  'Do not re-introduce blocking browser confirmation dialogs')
console.log('STAGE5_SENT_ORDER_ACTIONS_UX_PASS')
