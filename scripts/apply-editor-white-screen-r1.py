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
        raise RuntimeError(f'{path}: expected {expected} matches, got {count}: {old[:120]!r}')
    write(path, text.replace(old, new))

# Runtime root cause: OrderDetailsSection stays mounted after first activation.
# When an order becomes selected, it calls isReturnedOrderRecord. App forgot to wire that
# function into the lazy section context, so Production crashed the whole React root on edit.
replace_exact(
    'src/App.tsx',
    "OrderDetailsSection ctx={{ formatDateShort, formatMoney, formatOrderItemTitle, handleEditOrder, isAdmin, isArchivedOrderRecord, orderPanelStyle, restoreArchivedOrder, savingOrder, sectorStyle, selectedOrder, setSelectedWorkshopStatus, sourceLabel }}",
    "OrderDetailsSection ctx={{ formatDateShort, formatMoney, formatOrderItemTitle, handleEditOrder, isAdmin, isArchivedOrderRecord, isReturnedOrderRecord, orderPanelStyle, restoreArchivedOrder, savingOrder, sectorStyle, selectedOrder, setSelectedWorkshopStatus, sourceLabel }}",
)

test_path = 'scripts/test-order-edit-autonomy.mjs'
test = read(test_path)
anchor = "check(editor.includes(\"isAdmin || (!['deleted', 'archived'].includes(selectedOrder.order_status) && selectedOrder.shipping_status !== 'sent')\"), 'editor closed/unshipped working-mode visibility missing')\n"
addition = anchor + "const orderDetailsContext = app.match(/<OrderDetailsSection ctx=\\{\\{([\\s\\S]*?)\\}\\} \\/>/)?.[1] || ''\ncheck(/\\bisReturnedOrderRecord\\b/.test(orderDetailsContext), 'OrderDetailsSection runtime context is missing isReturnedOrderRecord and can crash the React root when edit selects an order')\n"
if 'OrderDetailsSection runtime context is missing isReturnedOrderRecord' not in test:
    if anchor not in test:
        raise RuntimeError('test-order-edit-autonomy anchor missing')
    test = test.replace(anchor, addition)
write(test_path, test)

print('Applied editor white-screen R1 runtime wiring fix')
