from pathlib import Path
import re


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, value: str) -> None:
    Path(path).write_text(value, encoding='utf-8')


def replace_once(path: str, old: str, new: str, label: str) -> None:
    value = read(path)
    count = value.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    write(path, value.replace(old, new, 1))


# 1) Backend: ordinary working mode may edit only active, not-sent orders and may not
# use generic order edit to perform lifecycle transitions. Existing inventory/payment
# safety gates remain authoritative for composition and money changes.
orders_path = 'worker/domains/orders-write.ts'
old = """      const nextWorkshopStatus = input.workshopStatus ? normalizeWorkshopStatus(input.workshopStatus) : normalizeWorkshopStatus(existingAny.workshop_status);\n      const nextOrderStatus = input.orderStatus ? normalizeOrderStatus(input.orderStatus) : normalizeOrderStatus(existingAny.order_status);\n      const existingOrderStatus = normalizeOrderStatus(existingAny.order_status);\n      const deletingOrder = existingOrderStatus !== 'deleted' && nextOrderStatus === 'deleted';\n      const finalWorkshopStatus = deletingOrder && nextWorkshopStatus === 'in_workshop' ? 'cancelled' : nextWorkshopStatus;\n      const nextComment = input.comment !== undefined ? cleanText(input.comment) : cleanText(existingAny.comment);\n      const nextShippingStatus = input.shippingStatus !== undefined\n        ? normalizeShippingStatus(input.shippingStatus)\n        : normalizeShippingStatus(existingAny.shipping_status);\n      const nextShippingDate = nextShippingStatus === 'sent'\n        ? normalizeDate(input.shippingDate || existingAny.shipping_date || timestamp)\n        : null;\n\n"""
new = """      const nextWorkshopStatus = input.workshopStatus ? normalizeWorkshopStatus(input.workshopStatus) : normalizeWorkshopStatus(existingAny.workshop_status);\n      const nextOrderStatus = input.orderStatus ? normalizeOrderStatus(input.orderStatus) : normalizeOrderStatus(existingAny.order_status);\n      const existingOrderStatus = normalizeOrderStatus(existingAny.order_status);\n      const existingWorkshopStatus = normalizeWorkshopStatus(existingAny.workshop_status);\n      const existingShippingStatus = normalizeShippingStatus(existingAny.shipping_status);\n      const workingModeEdit = actor?.role !== 'admin';\n      if (workingModeEdit && (existingOrderStatus !== 'active' || existingShippingStatus === 'sent')) {\n        throw new CriticalOperationConflictError('Этот заказ уже вышел из обычного активного редактирования. Используйте его штатное действие: возврат, обмен, отправку или административное восстановление.');\n      }\n      const deletingOrder = existingOrderStatus !== 'deleted' && nextOrderStatus === 'deleted';\n      const finalWorkshopStatus = deletingOrder && nextWorkshopStatus === 'in_workshop' ? 'cancelled' : nextWorkshopStatus;\n      const nextComment = input.comment !== undefined ? cleanText(input.comment) : cleanText(existingAny.comment);\n      const nextShippingStatus = input.shippingStatus !== undefined\n        ? normalizeShippingStatus(input.shippingStatus)\n        : existingShippingStatus;\n      if (workingModeEdit && (\n        nextOrderStatus !== existingOrderStatus\n        || nextWorkshopStatus !== existingWorkshopStatus\n        || nextShippingStatus !== existingShippingStatus\n      )) {\n        throw new CriticalOperationConflictError('В рабочем режиме редактор исправляет данные заказа, но не меняет его жизненный цикл. Для статуса Цеха, отправки и удаления используйте отдельные штатные действия.');\n      }\n      const nextShippingDate = nextShippingStatus === 'sent'\n        ? normalizeDate(input.shippingDate || existingAny.shipping_date || timestamp)\n        : null;\n\n"""
replace_once(orders_path, old, new, 'insert working-mode order edit boundary')
replace_once(
    orders_path,
    """      const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);\n      const existingShippingStatus = normalizeShippingStatus(existingAny.shipping_status);\n      const deferShippingCommit = humanInventoryModelEnabled && existingShippingStatus !== 'sent' && nextShippingStatus === 'sent';\n""",
    """      const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);\n      const deferShippingCommit = humanInventoryModelEnabled && existingShippingStatus !== 'sent' && nextShippingStatus === 'sent';\n""",
    'deduplicate shipping status after working-mode boundary',
)

# 2) Router: remove only the obsolete admin gate for PATCH /api/orders/:id.
worker_path = 'worker/index.ts'
worker = read(worker_path)
old = """        if (request.method === 'PATCH') {\n          const denied = requireAdminAccess(request);\n          if (denied) return denied;\n          const input = await readJson<OrderInput>(request);\n"""
new = """        if (request.method === 'PATCH') {\n          const input = await readJson<OrderInput>(request);\n"""
if worker.count(old) != 1:
    raise SystemExit(f'order PATCH admin guard: expected exactly 1 match, found {worker.count(old)}')
worker = worker.replace(old, new, 1)
health = "          returnExchangeCancelAutonomy: '192b2a5',\n"
if worker.count(health) != 1:
    raise SystemExit('health marker anchor mismatch')
worker = worker.replace(health, health + "          orderEditAutonomy: '192b2a6',\n", 1)
write(worker_path, worker)

# 3) App controller: open/save editor for ordinary staff only for the safe working-mode scope.
app_path = 'src/App.tsx'
app = read(app_path)
old = """    if (!isAdmin) {\n      setSelectedOrderId(order.id)\n      setEditorOpen(false)\n      setMessage('Редактирование заказа доступно только администратору.')\n      return\n    }\n"""
new = """    if (!isAdmin && (order.order_status !== 'active' || order.shipping_status === 'sent')) {\n      setSelectedOrderId(order.id)\n      setEditorOpen(false)\n      setMessage('Для завершённого или уже отправленного заказа используйте его штатные действия: возврат, обмен или административное восстановление.')\n      return\n    }\n"""
if app.count(old) != 1:
    raise SystemExit('handleEditOrder admin block mismatch')
app = app.replace(old, new, 1)
old = """  async function persistOrder(nextDraft: EditorDraft, targetOrder?: OrderRecord | null) {\n    if (!isAdmin) {\n      setError('Сохранение редактирования заказа доступно только администратору.')\n      return\n    }\n    const order = targetOrder || selectedOrder\n    if (!order) return\n"""
new = """  async function persistOrder(nextDraft: EditorDraft, targetOrder?: OrderRecord | null) {\n    const order = targetOrder || selectedOrder\n    if (!order) return\n    if (!isAdmin && (order.order_status !== 'active' || order.shipping_status === 'sent')) {\n      setMessage('Заказ уже вышел из обычного редактирования. Используйте возврат, обмен или другое штатное действие заказа.')\n      return\n    }\n"""
if app.count(old) != 1:
    raise SystemExit('persistOrder admin block mismatch')
app = app.replace(old, new, 1)
write(app_path, app)

# 4) Table/details: expose Edit only when ordinary staff can actually complete it.
table_path = 'src/features/sections/OrdersTableSection.tsx'
table = read(table_path)
old = """                            {isAdmin && !retainedOnly && !archived && !isReturnedOrderRecord(order) ? (\n                              <button\n                                className=\"primary compact\"\n"""
new = """                            {!retainedOnly && !archived && !isReturnedOrderRecord(order)\n                              && (isAdmin || (order.order_status === 'active' && order.shipping_status !== 'sent')) ? (\n                              <button\n                                className=\"primary compact\"\n"""
if table.count(old) != 1:
    raise SystemExit('orders table edit action mismatch')
table = table.replace(old, new, 1)
write(table_path, table)

details_path = 'src/features/sections/OrderDetailsSection.tsx'
details = read(details_path)
old = """    isAdmin,\n    isArchivedOrderRecord,\n"""
new = """    isAdmin,\n    isArchivedOrderRecord,\n    isReturnedOrderRecord,\n"""
if details.count(old) != 1:
    raise SystemExit('details context anchor mismatch')
details = details.replace(old, new, 1)
old = """                        {isAdmin && !isArchivedOrderRecord(selectedOrder) ? (\n                          <button\n"""
new = """                        {!isArchivedOrderRecord(selectedOrder) && !isReturnedOrderRecord(selectedOrder)\n                          && (isAdmin || (selectedOrder.order_status === 'active' && selectedOrder.shipping_status !== 'sent')) ? (\n                          <button\n"""
if details.count(old) != 1:
    raise SystemExit('details edit action mismatch')
details = details.replace(old, new, 1)
write(details_path, details)

# 5) Editor: render for safe working mode. Lifecycle selects remain visible as context but
# disabled for ordinary staff so the UI does not invite an action the server must reject.
editor_path = 'src/features/sections/OrderEditorSection.tsx'
editor = read(editor_path)
old = """              style={{ ...sectorStyle('orders'), ...orderPanelStyle('edit'), display: isAdmin && selectedOrder && !isArchivedOrderRecord(selectedOrder) && editorDraft && editorOpen ? undefined : 'none' }}\n"""
new = """              style={{ ...sectorStyle('orders'), ...orderPanelStyle('edit'), display: selectedOrder && !isArchivedOrderRecord(selectedOrder) && editorDraft && editorOpen && (isAdmin || (selectedOrder.order_status === 'active' && selectedOrder.shipping_status !== 'sent')) ? undefined : 'none' }}\n"""
if editor.count(old) != 1:
    raise SystemExit('editor display gate mismatch')
editor = editor.replace(old, new, 1)
old = """                        value={editorDraft.workshopStatus}\n                        onChange={(event) =>\n"""
new = """                        value={editorDraft.workshopStatus}\n                        disabled={!isAdmin || savingOrder}\n                        onChange={(event) =>\n"""
if editor.count(old) != 1:
    raise SystemExit('workshop status select anchor mismatch')
editor = editor.replace(old, new, 1)
old = """                        value={editorDraft.orderStatus}\n                        onChange={(event) =>\n"""
new = """                        value={editorDraft.orderStatus}\n                        disabled={!isAdmin || savingOrder}\n                        onChange={(event) =>\n"""
if editor.count(old) != 1:
    raise SystemExit('order status select anchor mismatch')
editor = editor.replace(old, new, 1)
old = """                  <div className=\"card-meta\">\n                    Можно быстро править данные выбранного заказа. Оплаты и товары подставляются из базы и сохраняются обратно одним действием.\n                  </div>\n"""
new = """                  <div className=\"card-meta\">\n                    Можно быстро исправить данные выбранного заказа. Оплаты и товары подставляются из базы и сохраняются безопасно; отправка, удаление и статусы Цеха меняются отдельными штатными действиями.\n                  </div>\n"""
if editor.count(old) != 1:
    raise SystemExit('editor autonomy note anchor mismatch')
editor = editor.replace(old, new, 1)
write(editor_path, editor)

# 6) Permanent regression gate.
Path('scripts/test-order-edit-autonomy.mjs').write_text(r'''import fs from 'node:fs'

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
''', encoding='utf-8')

package_path = 'package.json'
package = read(package_path)
old = 'node scripts/test-return-exchange-cancel-autonomy.mjs"'
new = 'node scripts/test-return-exchange-cancel-autonomy.mjs && node scripts/test-order-edit-autonomy.mjs"'
if package.count(old) != 1:
    raise SystemExit('release:check anchor mismatch')
write(package_path, package.replace(old, new, 1))
