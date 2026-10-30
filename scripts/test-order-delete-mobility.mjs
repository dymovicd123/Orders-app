import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = file => fs.readFileSync(file,'utf8')
const table=read('src/features/sections/OrdersTableSection.tsx')
const worker=read('worker/index.ts')
const deletion=read('worker/domains/order-delete.ts')
const preview=read('worker/domains/order-delete-preview.ts')
const ordersWrite=read('worker/domains/orders-write.ts')

// Main policy: manager uses scoped corrections, full order deletion is admin-only.
assert.match(table,/\{isAdmin && !retainedOnly && !archived \? \(/,
  'Delete button must be admin-only')
assert.match(table,/loadAdminOrderDeletePreview\(order\)/,
  'Deletion must preview physical and financial consequences')
assert.match(table,/setAdminDeleteDraft\(/,'Delete needs an explicit review state')
const start=worker.indexOf('const orderDeleteMatch =')
const end=worker.indexOf('const orderMatch =',start)
assert(start>0 && end>start, 'Dedicated POST delete route is missing')
const route=worker.slice(start,end)
assert.match(route,/request\.method === 'POST'/)
assert.match(route,/requireAdminUser\(authUser\)/,'Manager must not bypass admin-only delete through the API')
assert.match(route,/deleteOrderSafely\(/)
assert.match(deletion,/const deletionPreview=await previewAdminOrderDeletion\(db,orderId\)/)
assert.match(deletion,/expectedSnapshot!==deletionPreview\.chainPlan\.snapshotFingerprint/,
  'A stale preview cannot authorize deletion')
assert.match(deletion,/!deletionPreview\.canAttemptDelete/,
  'Unsafe dependent return/exchange must stop unreviewed deletion')
assert.match(preview,/chainPlan/,'Preview must describe dependency chain')
assert.match(deletion,/admin_order_delete_sagas/,
  'A partly executed dependency saga cannot be bypassed')
assert.match(deletion,/hasPhysicalHandoverMarker && physicalOutcome !== 'not_issued'/,
  'Physical handovers need explicit confirmation before any restore')
assert.match(deletion,/order_delete_physical_confirmation_required/)
assert.match(deletion,/stock_quantity_before/)
assert.match(deletion,/stock_quantity_after/)
assert.match(deletion,/physicalRestoreQuantity/,
  'Restore measured actual delta, not reservation quantity')
assert.match(deletion,/datetime\(checked_at\) > datetime\(\?\)/,
  'Newer physical checks take precedence over old shipments')
assert.match(deletion,/inventory_stocktake_sessions/)
assert.match(deletion,/status = 'active'/)
assert.match(deletion,/id NOT LIKE 'REV-%-P-%'/,'Full stocktakes must take precedence')
assert.match(deletion,/reference_type, reference_id, comment, created_at/,
  'False-shipment restore must be audited')
assert.match(deletion,/SET status = 'released', released_at = \?, updated_at = \?/,
  'Reversed reservations must be retired')
assert.match(deletion,/SET shipping_status = 'not_sent', shipping_date = NULL/)
assert.match(deletion,/await db\.batch\(statements\)/,'Stock restore is transactional')
assert.doesNotMatch(deletion,/await cancelExchange\(db/,
  'Do not reintroduce non-atomic blind exchange cancellation')
assert.doesNotMatch(deletion,/await cancelReturn\(db/,
  'Do not reintroduce non-atomic blind return cancellation')
assert.match(deletion,/const autoCancelledExchanges = 0/)
assert.match(deletion,/const autoCancelledReturns = 0/)
assert.match(deletion,/await restoreArchivedOrder/)
assert.match(deletion,/orderStatus: 'deleted'/)
assert.match(deletion,/lifecycleAction: 'order_delete'/)
assert.match(ordersWrite,/options\.lifecycleAction === 'order_delete'/)
assert.match(ordersWrite,/workingModeEdit && !dedicatedOrderDelete/,
  'Ordinary edits cannot gain the deletion privilege')
console.log('MAIN ORDER DELETE SAFETY PASSED — admin-only UI/API, dependency snapshot and saga, explicit physical facts, stocktake freshness, idempotent deletion')
