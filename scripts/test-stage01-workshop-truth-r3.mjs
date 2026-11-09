import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const reservations = read('worker/domains/order-reservations.ts')
const workshop = read('worker/domains/workshop.ts')
const worker = read('worker/index.ts')
const app = read('src/App.tsx')
const taskActions = read('src/features/workshop/workshopTaskActions.ts')
const invoiceActions = read('src/features/workshop/workshopInvoiceActions.ts')
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
check(app.includes('createWorkshopTaskActions({') && app.includes('createWorkshopInvoiceActions({'), 'Workshop App must delegate task and invoice behavior to typed owners')
const doneStart = taskActions.indexOf('async function markWorkshopTaskDone')
const restoreStart = taskActions.indexOf('async function restoreWorkshopTaskActive')
check(doneStart >= 0 && restoreStart > doneStart, 'Workshop frontend handlers missing')
const done = taskActions.slice(doneStart, restoreStart)
const restore = taskActions.slice(restoreStart, taskActions.indexOf('return { applyWorkshopPeriodPreset', restoreStart))
for (const [name, block] of [['done', done], ['restore', restore]]) {
  check(block.includes('order?: OrderRecord; refreshRequired?: boolean'), name + ' Workshop handler does not accept fresh order readback')
  check(block.includes('if (result.order) upsertOrderInState(result.order)'), name + ' Workshop handler leaves Orders state stale after task mutation')
  check(block.includes('else if (result.refreshRequired) void loadDashboard(false)'), name + ' Workshop handler lacks safe background recovery when readback is unavailable')
}

// Execute the actual compiled browser-side Workshop actions, not only source excerpts.
async function compiledModule(path) {
  const result = await build({
    entryPoints: [path], bundle: true, platform: 'node', format: 'esm',
    target: 'es2022', write: false, logLevel: 'silent',
    external: ['docx', 'html2canvas', 'jspdf'],
  })
  return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
}

const { createWorkshopTaskActions } = await compiledModule('src/features/workshop/workshopTaskActions.ts')
const changes = []
const ordersUpdated = []
const requests = []
const reloaded = []
let err = null
let message = null
let filtersState = { view: 'active', period: 'all', dateFrom: '', dateTo: '', urgentOnly: false, q: '' }
let nextResponse = { ok: true, changed: true, previousStatus: 'active', order: { id: 50, shipping_status: 'not_sent' } }
let responseCode = 200
const actions = createWorkshopTaskActions({
  workshopFilters: filtersState,
  setWorkshopFilters: (fn) => { filtersState = typeof fn === 'function' ? fn(filtersState) : fn },
  setWorkshopBusy: (busy) => changes.push(['busy', busy]),
  setError: (value) => { err = value },
  setMessage: (value) => { message = value },
  apiFetch: async (path, init) => {
    requests.push({ path, init })
    return new Response(JSON.stringify(nextResponse), {
      status: responseCode, headers: { 'Content-Type': 'application/json' },
    })
  },
  loadWorkshopData: async (_filters, options) => { reloaded.push(options); return null },
  applyWorkshopTaskStatusChange: (task, status, previous) => changes.push(['task', task.id, status, previous]),
  upsertOrderInState: (order) => ordersUpdated.push(order),
  loadDashboard: async (force) => { reloaded.push(['dashboard', force]) },
})
const task = { id: 21, orderId: 50, orderItemId: 77, status: 'active', shippingStatus: 'not_sent', externalOrderId: 'W-50' }
await actions.markWorkshopTaskDone(task)
assert.equal(requests[0].path, '/api/workshop/21')
assert.equal(requests[0].init.method, 'PATCH')
assert.deepEqual(JSON.parse(requests[0].init.body), { status: 'done', orderItemId: 77 })
assert.deepEqual(ordersUpdated, [{ id: 50, shipping_status: 'not_sent' }])
assert(changes.some((entry) => entry[0] === 'task' && entry[2] === 'done'))
assert.match(message, /Это не отправка клиенту/)
assert.equal(err, null)

// Returning the task to active restores Workshop truth without shipping or stock mutations.
nextResponse = { ok: true, changed: true, previousStatus: 'done', order: { id: 50, shipping_status: 'sent' } }
await actions.restoreWorkshopTaskActive({ ...task, status: 'done' })
assert.equal(JSON.parse(requests[1].init.body).status, 'active')
assert(changes.some((entry) => entry[0] === 'task' && entry[2] === 'active' && entry[3] === 'done'))
assert.match(message, /возвращена в актуальные/)

// An already-applied write must refresh the server view rather than count again.
nextResponse = { ok: true, changed: false }
await actions.markWorkshopTaskDone(task)
assert.deepEqual(reloaded.at(-1), { force: true, refreshCounts: true })

// A successful critical update with unavailable order readback must refresh Orders.
nextResponse = { ok: true, changed: true, refreshRequired: true }
await actions.markWorkshopTaskDone(task)
assert.deepEqual(reloaded.at(-1), ['dashboard', false])

// On a stale/error HTTP response neither local task status nor order state may advance.
const beforeChanges = changes.filter((entry) => entry[0] === 'task').length
const beforeOrders = ordersUpdated.length
responseCode = 409
nextResponse = { ok: false, message: 'Операция устарела' }
await actions.markWorkshopTaskDone(task)
assert.equal(changes.filter((entry) => entry[0] === 'task').length, beforeChanges)
assert.equal(ordersUpdated.length, beforeOrders)
assert.equal(err, 'Операция устарела')

// Invoice scope, labels and escaping must stay consistent across text, print and exports.
const { createWorkshopInvoiceActions } = await compiledModule('src/features/workshop/workshopInvoiceActions.ts')
const row = {
  key: 'w-1', priority: 0, urgent: true, hasComment: true, isSpecialOrder: false,
  isKaspi: false, orderId: 50, orderDate: '2026-11-08',
  productName: '<Камзол>', characteristics: 'КРАСНЫЙ',
  quantity: 2, orderRef: 'W-50', comment: '<script>note</script>',
  dueDate: '2026-11-09', dueTime: '15:30',
}
const invoice = createWorkshopInvoiceActions({
  invoiceRows: [row], invoiceIsKaspi: false, invoiceTaskCount: 1,
  invoiceDateFrom: '2026-11-08', invoiceDateTo: '2026-11-09',
  getWorkshopInvoiceDeadlineLabel: (item) => 'до ' + item.dueTime,
  getWorkshopInvoiceImportanceLabel: () => 'Срочный заказ',
  printHtmlDocument: (title, html) => { requests.push({ title, html }) },
  setError: (value) => { err = value },
  setMessage: (value) => { message = value },
})
assert.match(invoice.buildWorkshopInvoiceText(), /Накладная цеха/)
assert.match(invoice.buildWorkshopInvoiceText(), /Срочный заказ/)
const html = invoice.buildWorkshopInvoiceHtmlTable()
assert(!html.includes('<script>'), 'Invoice must escape untrusted operator input')
assert(html.includes('&lt;script&gt;'))
invoice.printWorkshopInvoice()
assert.equal(requests.at(-1).title, 'Накладная цеха')
const kaspi = createWorkshopInvoiceActions({
  invoiceRows: [row], invoiceIsKaspi: true, invoiceTaskCount: 1,
  invoiceDateFrom: '2026-11-08', invoiceDateTo: '2026-11-09',
  getWorkshopInvoiceDeadlineLabel: (item) => 'до ' + item.dueTime,
  getWorkshopInvoiceImportanceLabel: () => 'Срочный заказ',
  printHtmlDocument: () => {},
  setError: () => {}, setMessage: () => {},
})
assert.match(kaspi.buildWorkshopInvoiceText(), /Накладная КАСПИ МАГАЗИН/)
assert.match(kaspi.buildWorkshopInvoiceText(), /до 15:30/)
assert(!kaspi.buildWorkshopInvoiceText().includes('Срочный заказ'), 'Kaspi must render its deadline, not the ordinary urgency label')

console.log('STAGE01 WORKSHOP TRUTH R3 PASSED — per-task truth controls shipping and order UI; coarse cache, activity log and readback are secondary only')
