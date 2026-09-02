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
check(orders.includes("['deleted', 'archived'].includes(existingOrderStatus) || existingShippingStatus === 'sent'"), 'destructive/sent server gate missing')
check(!orders.includes("existingOrderStatus !== 'active' || existingShippingStatus === 'sent'"), 'closed orders are still blocked by the old active-only server gate')
check(orders.includes('nextOrderStatus !== existingOrderStatus'), 'order-status transition boundary missing')
check(orders.includes('nextWorkshopStatus !== existingWorkshopStatus'), 'workshop-status transition boundary missing')
check(orders.includes('nextShippingStatus !== existingShippingStatus'), 'shipping-status transition boundary missing')
check(orders.includes("status = 'fulfilled'"), 'fulfilled reservation physical handover guard missing')
check(orders.includes('completedOrderOperationCounts'), 'return/exchange edit guard missing')
check(orders.includes('assertCreateOrderShortageDecisions'), 'inventory shortage guard missing')

check(!app.includes('Редактирование заказа доступно только администратору.'), 'frontend still blocks ordinary edit at open')
check(!app.includes('Сохранение редактирования заказа доступно только администратору.'), 'frontend still blocks ordinary edit at save')
check((app.match(/!isAdmin && \(\['deleted', 'archived'\]\.includes\(order\.order_status\) \|\| order\.shipping_status === 'sent'\)/g) || []).length === 2, 'controller safe-scope guard missing at open/save')
check(!app.includes("order.order_status !== 'active' || order.shipping_status === 'sent'"), 'controller still blocks closed unshipped orders')
check(table.includes("isAdmin || (!['deleted', 'archived'].includes(order.order_status) && order.shipping_status !== 'sent')"), 'table does not expose closed/unshipped ordinary edit')
check(details.includes("isAdmin || (!['deleted', 'archived'].includes(selectedOrder.order_status) && selectedOrder.shipping_status !== 'sent')"), 'details do not expose closed/unshipped ordinary edit')
check(editor.includes("isAdmin || (!['deleted', 'archived'].includes(selectedOrder.order_status) && selectedOrder.shipping_status !== 'sent')"), 'editor closed/unshipped working-mode visibility missing')
const orderDetailsContext = app.match(/<OrderDetailsSection ctx=\{\{([\s\S]*?)\}\} \/>/)?.[1] || ''
check(/\bisReturnedOrderRecord\b/.test(orderDetailsContext), 'OrderDetailsSection runtime context is missing isReturnedOrderRecord and can crash the React root when edit selects an order')
check((editor.match(/disabled=\{!isAdmin \|\| savingOrder\}/g) || []).length >= 2, 'lifecycle selects are not locked in working mode')

console.log('ORDER EDIT AUTONOMY PASSED — ordinary staff can correct active or closed unshipped orders while sent/deleted/archived lifecycle and physical handover remain protected')
