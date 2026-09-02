from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Confirmed defect 1: Workshop uses the same ordinary order editor as the Orders list,
# but its button was still hidden behind an obsolete isAdmin wrapper.
replace_once(
    'src/features/sections/WorkshopSection.tsx',
    "    isAdmin,\n    markWorkshopTaskDone,",
    "    markWorkshopTaskDone,",
    'remove unused Workshop isAdmin context',
)
replace_once(
    'src/features/sections/WorkshopSection.tsx',
    '''                            {isAdmin ? (\n                              <button\n                                className="secondary compact"\n                                type="button"\n                                onClick={() => void openWorkshopOrderEditor(task)}\n                              >\n                                Редактировать заказ\n                              </button>\n                            ) : null}''',
    '''                            <button\n                              className="secondary compact"\n                              type="button"\n                              onClick={() => void openWorkshopOrderEditor(task)}\n                            >\n                              Редактировать заказ\n                            </button>''',
    'Workshop order editor manager access',
)

# Confirmed defect 2: the Worker intentionally stopped hard-blocking final shipping on an
# historical handover-review flag, but the table still hid the Send action for that flag.
# Keep the review action visible; simply stop using the historical flag as a UI send blocker.
replace_once(
    'src/features/sections/OrdersTableSection.tsx',
    "!retainedOnly && !archived && !isReturnedOrderRecord(order) && order.shipping_status !== 'sent' && !workshopPending && !order.stock_handover_review_needed ? (",
    "!retainedOnly && !archived && !isReturnedOrderRecord(order) && order.shipping_status !== 'sent' && !workshopPending ? (",
    'shipping historical review UI blocker',
)

# Permanent regression: protect routine manager actions while explicitly retaining admin-only
# master-data / HR / plan controls. This prevents another broad permissions sweep.
test = r'''import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const app = read('src/App.tsx')
const orders = read('src/features/sections/OrdersTableSection.tsx')
const workshop = read('src/features/sections/WorkshopSection.tsx')
const team = read('src/features/sections/TeamSection.tsx')
const plans = read('src/features/sections/PlanSection.tsx')
const refs = read('src/features/sections/ReferencesSection.tsx')
const worker = read('worker/index.ts')

check(workshop.includes('onClick={() => void openWorkshopOrderEditor(task)}'), 'Workshop order edit action missing')
const workshopEditAt = workshop.indexOf('onClick={() => void openWorkshopOrderEditor(task)}')
check(workshopEditAt >= 0, 'Workshop editor action missing')
const workshopEditContext = workshop.slice(Math.max(0, workshopEditAt - 450), workshopEditAt + 250)
check(!workshopEditContext.includes('{isAdmin ? ('), 'Workshop order edit is still hidden from managers')

const sendAt = orders.indexOf('Отправить клиенту')
check(sendAt >= 0, 'Send-to-client action missing')
const sendContext = orders.slice(Math.max(0, sendAt - 900), sendAt + 250)
check(sendContext.includes("order.shipping_status !== 'sent' && !workshopPending ? ("), 'Ordinary send eligibility missing')
check(!sendContext.includes("!workshopPending && !order.stock_handover_review_needed"), 'Historical handover review still hides Send in UI')
check(orders.includes("order.stock_handover_review_needed ? 'Уточнить выдачу' : 'Выдать готовые товары'"), 'Handover review action must remain available')

check(app.includes("if (!isAdmin && (['deleted', 'archived'].includes(order.order_status) || order.shipping_status === 'sent'))"), 'Sent/deleted/archived edit protection changed')
check(!app.includes("order.order_status !== 'active' || order.shipping_status === 'sent'"), 'Closed unshipped manager edit restriction returned')

const shippingRouteStart = worker.indexOf('const orderShippingMatch =')
check(shippingRouteStart >= 0, 'Shipping route missing')
const shippingRoute = worker.slice(shippingRouteStart, worker.indexOf('const orderMatch =', shippingRouteStart))
check(!shippingRoute.includes('requireAdminAccess(request)'), 'Shipping route unexpectedly requires admin')

// Explicitly preserve unrelated admin/master-data boundaries in this narrow fix.
check(team.includes('disabled={timesheetBusy || !isAdmin}'), 'Timesheet admin boundary changed unexpectedly')
check(plans.includes('disabled={planBusy || !isAdmin}'), 'Plan admin boundary changed unexpectedly')
check(refs.includes('disabled={!isAdmin}'), 'Reference master-data admin boundary changed unexpectedly')

console.log('MANAGER ROUTINE ACCESS R1 PASSED — Workshop order edit and non-workshop final send are manager-safe; unrelated admin/master-data boundaries remain unchanged')
'''
Path('scripts/test-manager-routine-access-r1.mjs').write_text(test, encoding='utf-8')

replace_once(
    'package.json',
    'node scripts/test-d1-read-budget-r4.mjs && node scripts/test-operational-autonomy-r2.mjs',
    'node scripts/test-d1-read-budget-r4.mjs && node scripts/test-manager-routine-access-r1.mjs && node scripts/test-operational-autonomy-r2.mjs',
    'release check manager routine access',
)

print('Manager routine access R1 patched')
