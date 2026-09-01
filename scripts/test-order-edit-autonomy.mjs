import fs from 'node:fs'

function check(condition, message) {
  if (!condition) throw new Error(message)
}

const orders = fs.readFileSync('worker/domains/orders-write.ts', 'utf8')
const worker = fs.readFileSync('worker/index.ts', 'utf8')
const app = fs.readFileSync('src/App.tsx', 'utf8')
const table = fs.readFileSync('src/features/sections/OrdersTableSection.tsx', 'utf8')
const details = fs.readFileSync('src/features/sections/OrderDetailsSection.tsx', 'utf8')
const editor = fs.readFileSync('src/features/sections/OrderEditorSection.tsx', 'utf8')

const orderPatch = worker.match(/const orderMatch[\s\S]*?const returnCancelMatch/)?.[0] || worker.slice(worker.indexOf('const orderMatch'), worker.indexOf('const orderMatch') + 4500)
check(orderPatch.includes("if (request.method === 'PATCH')"), 'order PATCH route missing')
check(!orderPatch.match(/if \(request\.method === 'PATCH'\) \{\s*const denied = requireAdminAccess/), 'order PATCH is still admin-only')
check(worker.includes("orderEditAutonomy: '192b2a6'"), 'order edit autonomy health marker missing')

check(orders.includes("const workingModeEdit = actor?.role !== 'admin'"), 'server working-mode boundary missing')
check(orders.includes("existingOrderStatus !== 'active' || existingShippingStatus === 'sent'"), 'active/not-sent server gate missing')
check(orders.includes('nextOrderStatus !== existingOrderStatus'), 'order-status transition boundary missing')
check(orders.includes('nextWorkshopStatus !== existingWorkshopStatus'), 'workshop-status transition boundary missing')
check(orders.includes('nextShippingStatus !== existingShippingStatus'), 'shipping-status transition boundary missing')
check(orders.includes("status = 'fulfilled'"), 'fulfilled reservation physical handover guard missing')
check(orders.includes('completedOrderOperationCounts'), 'return/exchange edit guard missing')
check(orders.includes('assertCreateOrderShortageDecisions'), 'inventory shortage guard missing')

check(!app.includes('Редактирование заказа доступно только администратору.'), 'frontend still blocks ordinary edit at open')
check(!app.includes('Сохранение редактирования заказа доступно только администратору.'), 'frontend still blocks ordinary edit at save')
check(app.includes("!isAdmin && (order.order_status !== 'active' || order.shipping_status === 'sent')"), 'controller safe-scope fallback missing')
check(table.includes("isAdmin || (order.order_status === 'active' && order.shipping_status !== 'sent')"), 'table does not expose safe ordinary edit')
check(details.includes("isAdmin || (selectedOrder.order_status === 'active' && selectedOrder.shipping_status !== 'sent')"), 'details do not expose safe ordinary edit')
check(editor.includes("isAdmin || (selectedOrder.order_status === 'active' && selectedOrder.shipping_status !== 'sent')"), 'editor working-mode visibility missing')
check((editor.match(/disabled=\{!isAdmin \|\| savingOrder\}/g) || []).length >= 2, 'lifecycle selects are not locked in working mode')

console.log('ORDER EDIT AUTONOMY PASSED — ordinary staff can correct active unshipped orders while lifecycle transitions and physical handover remain server-protected')
