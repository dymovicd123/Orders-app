from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_exact(path, old, new, expected=1):
    text = read(path)
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{path}: expected {expected} matches, got {count}: {old[:80]!r}')
    write(path, text.replace(old, new))

replace_exact(
    'worker/domains/orders-write.ts',
    "      if (workingModeEdit && (existingOrderStatus !== 'active' || existingShippingStatus === 'sent')) {\n        throw new CriticalOperationConflictError('Этот заказ уже вышел из обычного активного редактирования. Используйте его штатное действие: возврат, обмен, отправку или административное восстановление.');\n      }",
    "      if (workingModeEdit && (['deleted', 'archived'].includes(existingOrderStatus) || existingShippingStatus === 'sent')) {\n        throw new CriticalOperationConflictError('Отправленный, удалённый или архивный заказ нельзя переписывать в рабочем режиме. Используйте отдельное штатное действие заказа.');\n      }",
)
replace_exact('src/App.tsx', "    if (!isAdmin && (order.order_status !== 'active' || order.shipping_status === 'sent')) {", "    if (!isAdmin && (['deleted', 'archived'].includes(order.order_status) || order.shipping_status === 'sent')) {", expected=2)
replace_exact('src/App.tsx', "      setMessage('Для завершённого или уже отправленного заказа используйте его штатные действия: возврат, обмен или административное восстановление.')", "      setMessage('Отправленный, удалённый или архивный заказ нельзя редактировать в рабочем режиме. Используйте его отдельное штатное действие.')")
replace_exact('src/App.tsx', "      setMessage('Заказ уже вышел из обычного редактирования. Используйте возврат, обмен или другое штатное действие заказа.')", "      setMessage('Отправленный, удалённый или архивный заказ нельзя редактировать в рабочем режиме. Используйте его отдельное штатное действие.')")

for path, subject in [
    ('src/features/sections/OrdersTableSection.tsx', 'order'),
    ('src/features/sections/OrderDetailsSection.tsx', 'selectedOrder'),
    ('src/features/sections/OrderEditorSection.tsx', 'selectedOrder'),
]:
    replace_exact(path, f"isAdmin || ({subject}.order_status === 'active' && {subject}.shipping_status !== 'sent')", f"isAdmin || (!['deleted', 'archived'].includes({subject}.order_status) && {subject}.shipping_status !== 'sent')")

test_path = 'scripts/test-order-edit-autonomy.mjs'
test = read(test_path)
test = test.replace(
    "check(orders.includes(\"existingOrderStatus !== 'active' || existingShippingStatus === 'sent'\"), 'active/not-sent server gate missing')",
    "check(orders.includes(\"['deleted', 'archived'].includes(existingOrderStatus) || existingShippingStatus === 'sent'\"), 'destructive/sent server gate missing')\ncheck(!orders.includes(\"existingOrderStatus !== 'active' || existingShippingStatus === 'sent'\"), 'closed orders are still blocked by the old active-only server gate')",
)
test = test.replace(
    "check(app.includes(\"!isAdmin && (order.order_status !== 'active' || order.shipping_status === 'sent')\"), 'controller safe-scope fallback missing')",
    "check((app.match(/!isAdmin && \\(\\['deleted', 'archived'\\]\\.includes\\(order\\.order_status\\) \\|\\| order\\.shipping_status === 'sent'\\)/g) || []).length === 2, 'controller safe-scope guard missing at open/save')\ncheck(!app.includes(\"order.order_status !== 'active' || order.shipping_status === 'sent'\"), 'controller still blocks closed unshipped orders')",
)
test = test.replace(
    "check(table.includes(\"isAdmin || (order.order_status === 'active' && order.shipping_status !== 'sent')\"), 'table does not expose safe ordinary edit')",
    "check(table.includes(\"isAdmin || (!['deleted', 'archived'].includes(order.order_status) && order.shipping_status !== 'sent')\"), 'table does not expose closed/unshipped ordinary edit')",
)
test = test.replace(
    "check(details.includes(\"isAdmin || (selectedOrder.order_status === 'active' && selectedOrder.shipping_status !== 'sent')\"), 'details do not expose safe ordinary edit')",
    "check(details.includes(\"isAdmin || (!['deleted', 'archived'].includes(selectedOrder.order_status) && selectedOrder.shipping_status !== 'sent')\"), 'details do not expose closed/unshipped ordinary edit')",
)
test = test.replace(
    "check(editor.includes(\"isAdmin || (selectedOrder.order_status === 'active' && selectedOrder.shipping_status !== 'sent')\"), 'editor working-mode visibility missing')",
    "check(editor.includes(\"isAdmin || (!['deleted', 'archived'].includes(selectedOrder.order_status) && selectedOrder.shipping_status !== 'sent')\"), 'editor closed/unshipped working-mode visibility missing')",
)
test = test.replace(
    "console.log('ORDER EDIT AUTONOMY PASSED — ordinary staff can correct active unshipped orders while lifecycle transitions and physical handover remain server-protected')",
    "console.log('ORDER EDIT AUTONOMY PASSED — ordinary staff can correct active or closed unshipped orders while sent/deleted/archived lifecycle and physical handover remain protected')",
)
write(test_path, test)

replace_exact(
    'scripts/test-operational-autonomy-r2.mjs',
    "check(app.includes(\"if (!isAdmin && (order.order_status !== 'active' || order.shipping_status === 'sent'))\"), 'completed/sent order edit protection must remain')",
    "check(app.includes(\"if (!isAdmin && (['deleted', 'archived'].includes(order.order_status) || order.shipping_status === 'sent'))\"), 'sent/deleted/archived order edit protection must remain')\ncheck(!app.includes(\"order.order_status !== 'active' || order.shipping_status === 'sent'\"), 'closed unshipped orders must remain editable in working mode')",
)
print('Applied Branch2 order edit scope R1')
