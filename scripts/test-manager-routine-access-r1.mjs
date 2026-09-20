import fs from 'node:fs'
const read = (p) => fs.readFileSync(p, 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }
const app = read('src/App.tsx')
const orders = read('src/features/sections/OrdersTableSection.tsx')
const projection = read('src/app/orderOperationalProjection.ts')
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
check(sendContext.includes('projection.canShip ? ('), 'Ordinary send action is not driven by the shared operational projection')
check(projection.includes("canShip: mutableWorkingOrder && !hasCommittedItemReturn && !sent && !workshopPending"), 'Ordinary send eligibility must follow the current item truth while completed Exchange remains shippable')
check(!projection.includes('stock_handover_review_needed') || projection.includes('canOpenStockHandover'), 'Historical handover review must not become a final-send blocker')
check(orders.includes("order.stock_handover_review_needed ? 'Уточнить выдачу' : 'Выдать готовые товары'"), 'Handover review action must remain available')

check(app.includes("await import('./app/orderOperationalProjection')"), 'App action handlers do not lazy-load the shared operational projection')
const editHandler = app.slice(app.indexOf('async function handleEditOrder('), app.indexOf('function upsertOrderInState'))
check(editHandler.includes('await getOrderOperationalProjection(order)') && editHandler.includes('!projection.canEdit'), 'Sent/deleted/archived edit protection is no longer enforced through the shared projection')
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
