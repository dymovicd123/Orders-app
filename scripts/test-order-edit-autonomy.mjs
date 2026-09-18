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
check(app.includes("await import('./app/orderOperationalProjection')"), 'controller does not consume the shared operational projection')
const openEditHandler = app.slice(app.indexOf('async function handleEditOrder('), app.indexOf('function upsertOrderInState'))
const persistEditHandler = app.slice(app.indexOf('async function persistOrder('), app.indexOf('async function archiveOrderAsAdmin'))
check(openEditHandler.includes('await getOrderOperationalProjection(order)') && openEditHandler.includes('!projection.canEdit'), 'controller safe-scope guard missing at edit open')
check(persistEditHandler.includes('await getOrderOperationalProjection(order)') && persistEditHandler.includes('!projection.canEdit'), 'controller safe-scope guard missing at edit save')
check(!app.includes("order.order_status !== 'active' || order.shipping_status === 'sent'"), 'controller still blocks closed unshipped orders')
check(table.includes('projectOrderOperationalState(order, { isAdmin })'), 'table must derive edit/action visibility from the shared operational projection')
check(table.includes('projection.canEdit'), 'table lost projection-based safe edit action')
check(details.includes('projectOrderOperationalState(selectedOrder, { isAdmin })'), 'details must use the shared operational projection')
check(details.includes('projection.canEdit'), 'details lost projection-based safe edit action')
check(editor.includes('projection?.canEdit'), 'editor visibility must follow the shared operational projection')
const orderDetailsContext = app.match(/<OrderDetailsSection ctx=\{\{([\s\S]*?)\}\} \/>/)?.[1] || ''
check(!/\bisReturnedOrderRecord\b/.test(orderDetailsContext), 'OrderDetailsSection must not depend on the old return_amount lifecycle shortcut')
check(!editor.includes("updateEditorDraft(\n                            'workshopStatus'"), 'generic order editor must not mutate coarse workshop_status directly')
check(editor.includes('Состояние меняется по конкретным позициям в разделе «Цех».'), 'editor must explain that Workshop state comes from concrete Workshop positions')

console.log('ORDER EDIT AUTONOMY PASSED — ordinary staff can correct active or closed unshipped orders while sent/deleted/archived lifecycle and physical handover remain protected')
