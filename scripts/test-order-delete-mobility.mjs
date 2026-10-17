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
  const ordersWrite = read('worker/domains/orders-write.ts')

  check(!app.includes("setError('Удаление заказа доступно только администратору.')"), 'frontend still blocks manager deletion')
  check(app.includes("apiFetch(`/api/orders/${order.id}/delete`"), 'frontend does not use scoped delete endpoint')
  check(table.includes('{isAdmin && !retainedOnly && !archived ? ('), 'delete action must be admin-only')

  const routeStart = worker.indexOf('const orderDeleteMatch =')
  const routeEnd = worker.indexOf('const orderMatch =', routeStart)
  const route = worker.slice(routeStart, routeEnd)
  check(routeStart >= 0 && routeEnd > routeStart, 'delete route block missing')
  check(route.includes("request.method === 'POST'"), 'delete route is not POST')
  check(route.includes('const denied = requireAdminUser(authUser)'), 'delete route must enforce authenticated admin role')

  check(deletion.includes('const deletionPreview=await previewAdminOrderDeletion(db,orderId)'), 'dependency preflight missing')
  check(deletion.indexOf('const deletionPreview=') < deletion.indexOf('const humanInventoryModelEnabled'), 'linked-operation guard must run before any stock changes')
  check(deletion.includes('if(!deletionPreview.canAttemptDelete)'), 'linked-operation early abort missing')
  check(!deletion.includes('await cancelExchange(db, exchangeId'), 'legacy exchange auto-cancel risks wrong V2 handler and partial deletion')
  check(!deletion.includes('await cancelReturn(db, returnId'), 'non-atomic return auto-cancel must be removed')
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
  check(app.includes('previewAcknowledged = false'), 'admin deletion must require explicit preview approval')
  check(app.includes('/delete-preview'), 'read-only admin deletion preview API missing')
  check(table.includes('adminDeleteDraft.preview?.canAttemptDelete'), 'unsafe delete button is not disabled')
  check(deletion.includes('requestId: `${requestId}:order`'), 'final logical deletion is not retry-idempotent')
  check(deletion.includes("orderStatus: 'deleted'"), 'existing logical deletion path is not reused')
  check(deletion.includes("{ lifecycleAction: 'order_delete' }"), 'dedicated delete path does not declare its lifecycle action')
  check(ordersWrite.includes("options: { lifecycleAction?: 'order_delete' } = {}"), 'order editor lacks a typed internal lifecycle-action option')
  check(ordersWrite.includes("options.lifecycleAction === 'order_delete'"), 'dedicated delete lifecycle bypass is missing')
  check(ordersWrite.includes('workingModeEdit && !dedicatedOrderDelete'), 'ordinary working-mode lifecycle edits are no longer protected')
  check(ordersWrite.includes('nextWorkshopStatus === existingWorkshopStatus'), 'dedicated delete bypass is not constrained against workshop lifecycle changes')
  check(ordersWrite.includes('nextShippingStatus === existingShippingStatus'), 'dedicated delete bypass is not constrained against shipping lifecycle changes')

  console.log('ORDER DELETE MOBILITY PASSED — authenticated admin only, no manager access, non-atomic Exchange/Return auto-cancel removed, admin impact preview required, stocktake safeguards retained')
} catch (error) {
  console.error(`ORDER DELETE MOBILITY FAILED: ${error?.message || error}`)
  process.exit(1)
}
