import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const reservations = read('worker/domains/order-reservations.ts')
const workshop = read('worker/domains/workshop.ts')
const worker = read('worker/index.ts')
const app = read('src/App.tsx')
const projection = read('src/app/orderOperationalProjection.ts')

// Workshop task rows are operational truth; the coarse order cache is legacy fallback only.
const pendingStart = reservations.indexOf('export async function orderWorkshopPendingForShipping')
const pendingEnd = reservations.indexOf('export async function activeStocktakeSessionForHandover', pendingStart)
check(pendingStart >= 0 && pendingEnd > pendingStart, 'Workshop shipping truth helper not found')
const pending = reservations.slice(pendingStart, pendingEnd)
check(pending.includes('AS workshop_task_count'), 'Workshop shipping truth does not count concrete task rows')
check(pending.includes('workshopTaskCount === 0'), 'Coarse orders.workshop_status still overrides concrete task truth')
check(pending.includes('activeWorkshopTaskCount > 0'), 'Active Workshop tasks stopped blocking shipment')
check(projection.includes("knownWorkshopStatuses.length === 0 && coarseWorkshopStatus === 'in_workshop'"), 'Frontend Workshop projection lost the same fallback-only contract')

// A committed Workshop task update must not become a false failure because a secondary cache/log/readback failed.
const updateStart = workshop.indexOf('export async function updateWorkshopTask')
const updateEnd = workshop.indexOf('export async function bulkUpdateWorkshopTasks', updateStart)
check(updateStart >= 0 && updateEnd > updateStart, 'Workshop task mutation not found')
const updateBlock = workshop.slice(updateStart, updateEnd)
check(updateBlock.includes("console.warn('Workshop order status cache refresh failed after committed task mutation'"), 'Coarse Workshop cache refresh can still false-fail a committed task mutation')

const routeStart = worker.indexOf("const workshopMatch = url.pathname.match(/^\\/api\\/workshop\\/(\\d+)$/)")
const routeEnd = worker.indexOf("if (url.pathname === '/api/orders/archive/preview'", routeStart)
check(routeStart >= 0 && routeEnd > routeStart, 'Workshop route block not found')
const route = worker.slice(routeStart, routeEnd)
check(route.includes("console.warn('Workshop activity log after committed task mutation failed'"), 'Workshop activity log can still false-fail a committed task mutation')
check(route.includes("console.warn('Workshop order readback after committed task mutation failed'"), 'Workshop order readback can still false-fail a committed task mutation')
check(route.includes('updatedOrder = await getOrder(env.DB, orderId)'), 'Workshop mutation does not return fresh order truth when readback succeeds')
check(route.includes('refreshRequired: Boolean((result as any).changed && !updatedOrder)'), 'Workshop mutation lacks explicit refresh fallback')
check(worker.includes("console.warn('Workshop bulk activity log after committed update failed'"), 'Workshop bulk activity log can still false-fail a committed bulk update')

// Frontend must update the shared order record immediately, otherwise Orders can keep stale Workshop readiness.
const doneStart = app.indexOf('async function markWorkshopTaskDone')
const restoreStart = app.indexOf('async function restoreWorkshopTaskActive')
check(doneStart >= 0 && restoreStart > doneStart, 'Workshop frontend handlers missing')
const done = app.slice(doneStart, restoreStart)
const restore = app.slice(restoreStart, app.indexOf('function buildWorkshopInvoiceText', restoreStart))
for (const [name, block] of [['done', done], ['restore', restore]]) {
  check(block.includes('order?: OrderRecord; refreshRequired?: boolean'), name + ' Workshop handler does not accept fresh order readback')
  check(block.includes('if (result.order) upsertOrderInState(result.order)'), name + ' Workshop handler leaves Orders state stale after task mutation')
  check(block.includes('else if (result.refreshRequired) void loadDashboard(false)'), name + ' Workshop handler lacks safe background recovery when readback is unavailable')
}

console.log('STAGE01 WORKSHOP TRUTH R3 PASSED — per-task truth controls shipping and order UI; coarse cache, activity log and readback are secondary only')
