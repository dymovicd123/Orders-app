import fs from 'node:fs'
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
