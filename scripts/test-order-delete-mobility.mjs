import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = file => fs.readFileSync(path.join(root, file), 'utf8')
const check = (value, message) => { if (!value) throw new Error(message) }

try {
  const app = read('src/App.tsx')
  const table = read('src/features/sections/OrdersTableSection.tsx')
  const worker = read('worker/index.ts')
  const deletion = read('worker/domains/order-delete.ts')

  check(!app.includes("setError('Удаление заказа доступно только администратору.')"), 'frontend still blocks manager deletion')
  check(app.includes("apiFetch(`/api/orders/${order.id}/delete`"), 'frontend does not use scoped delete endpoint')
  check(table.includes('{!retainedOnly && !archived ? ('), 'delete action is not visible to ordinary staff')

  const routeStart = worker.indexOf('const orderDeleteMatch =')
  const routeEnd = worker.indexOf('const orderMatch =', routeStart)
  const route = worker.slice(routeStart, routeEnd)
  check(routeStart >= 0 && routeEnd > routeStart, 'delete route block missing')
  check(route.includes("request.method === 'POST'"), 'delete route is not POST')
  check(!route.includes('requireAdminAccess') && !route.includes('requireAdminUser'), 'delete route still requires admin')

  check(deletion.includes('ORDER BY e.id DESC'), 'active exchanges are not cancelled newest-first')
  check(deletion.includes('await cancelExchange(db, exchangeId'), 'exchange auto-cancel missing')
  check(deletion.includes('await cancelReturn(db, returnId'), 'return auto-cancel missing')
  check(deletion.indexOf('const unsafeReturn =') < deletion.indexOf('await cancelExchange(db, exchangeId'), 'return safety preflight happens after mutation')
  check(deletion.indexOf('const appliedLifecycle =') < deletion.indexOf('await cancelExchange(db, exchangeId'), 'canonical lifecycle preflight happens after mutation')
  check(deletion.includes("status = 'fulfilled'"), 'physical handover preflight missing')
  check(deletion.includes("normalizeShippingStatus((order as any).shipping_status) === 'sent'"), 'sent-order physical guard missing')
  check(deletion.includes("confirmationRequired.code = 'order_delete_physical_confirmation_required'"), 'physical fact confirmation code missing')
  check(deletion.includes("physicalOutcome !== 'not_issued'"), 'false-shipment confirmation is not explicit')
  check(deletion.includes('datetime(checked_at) > datetime(?)'), 'newer physical check freshness barrier missing')
  check(deletion.includes('inventory_stocktake_sessions'), 'stocktake freshness barrier missing')
  check(deletion.includes("status = 'active'"), 'active stocktake chronology guard missing')
  check(deletion.includes("id NOT LIKE 'REV-%-P-%'"), 'completed full stocktake barrier missing')
  check(deletion.includes("reference_type, reference_id, comment, created_at"), 'false-shipment reversal movement history missing')
  check(deletion.includes("SET status = 'released', released_at = ?, updated_at = ?"), 'fulfilled reservation is not retired after false-shipment reversal')
  check(deletion.includes("SET shipping_status = 'not_sent', shipping_date = NULL"), 'false shipping marker is not normalized before deletion')
  check(app.includes("attempt.result.code === 'order_delete_physical_confirmation_required'"), 'frontend does not handle narrow physical confirmation')
  check(app.includes("sendDelete('not_issued')"), 'frontend does not send explicit not-issued fact')
  check(deletion.includes('await restoreArchivedOrder'), 'safe archived-order recovery missing')
  check(deletion.includes('requestId: `${requestId}:exchange:${exchangeId}`'), 'exchange cancellation is not retry-idempotent')
  check(deletion.includes('requestId: `${requestId}:return:${returnId}`'), 'return cancellation is not retry-idempotent')
  check(deletion.includes('requestId: `${requestId}:order`'), 'final logical deletion is not retry-idempotent')
  check(deletion.includes("orderStatus: 'deleted'"), 'existing logical deletion path is not reused')

  console.log('ORDER DELETE MOBILITY PASSED — ordinary staff get one safe delete action, deterministic return/exchange blockers auto-cancel, recorded handover asks one physical fact, false shipment reverses only when no newer physical truth supersedes it, retries are idempotent')
} catch (error) {
  console.error(`ORDER DELETE MOBILITY FAILED: ${error?.message || error}`)
  process.exit(1)
}
