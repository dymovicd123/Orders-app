import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const workshop = read('src/features/sections/WorkshopSection.tsx')
const editor = read('src/features/sections/OrderEditorSection.tsx')

check(workshop.includes("task.shippingStatus !== 'sent' ? ("), 'Workshop must not offer the normal order editor for an already-sent order')
check(workshop.includes('onClick={() => void openWorkshopOrderEditor(task)}'), 'Normal unsent Workshop rows lost the order editor action')
check(workshop.includes('onClick={() => void openWorkshopExchange(task)}'), 'Workshop exchange action disappeared')
check(workshop.includes("task.status === 'active'"), 'Workshop ready/done action flow changed unexpectedly')
check(editor.includes("selectedOrder.shipping_status !== 'sent'"), 'Sent-order manager edit protection was weakened')
check(editor.includes("editorReturnSector === 'workshop' ? 'Назад в цех'"), 'Workshop editor return path changed unexpectedly')

const editGuard = workshop.indexOf("task.shippingStatus !== 'sent' ? (")
const editAction = workshop.indexOf('openWorkshopOrderEditor(task)', editGuard)
const exchangeAction = workshop.indexOf('openWorkshopExchange(task)', editAction)
check(editGuard >= 0 && editAction > editGuard && exchangeAction > editAction, 'Workshop action order/guard is malformed')

console.log('MANAGER WORKSHOP SENT-ORDER ACTIONS R2 PASSED — sent exchange rows keep Exchange/Done without a dead normal-order Edit action; unsent rows keep Edit')
