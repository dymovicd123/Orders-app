import fs from 'node:fs'
import path from 'node:path'
import { inventoryLifecycleDeferredInboundDisposition } from '../worker/domains/lifecycle.ts'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const count = (text, needle) => text.split(needle).length - 1

function section(text, startMarker, endMarker = '') {
  const start = text.indexOf(startMarker)
  check(start >= 0, `Section start missing: ${startMarker}`)
  if (!endMarker) return text.slice(start)
  const end = text.indexOf(endMarker, start + startMarker.length)
  check(end > start, `Section end missing after ${startMarker}: ${endMarker}`)
  return text.slice(start, end)
}

class FakeStatement {
  constructor(owner, sql, bindings = []) { this.owner = owner; this.sql = sql; this.bindings = bindings }
  bind(...bindings) { return new FakeStatement(this.owner, this.sql, bindings) }
  async first() {
    if (this.sql.includes('FROM inventory_stocktake_sessions s')) return this.owner.boundary
    if (this.sql.includes('FROM inventory_stock_checks')) return this.owner.laterCheckId ? { id: this.owner.laterCheckId } : null
    throw new Error(`Unexpected fake query: ${this.sql.slice(0, 120)}`)
  }
}

class FakeD1 {
  constructor(boundary, laterCheckId = 0) { this.boundary = boundary; this.laterCheckId = laterCheckId }
  prepare(sql) { return new FakeStatement(this, sql) }
}

const trustedBoundary = (overrides = {}) => ({
  id: 'REV-TEST-F-1',
  started_at: '2026-08-26T08:00:00.000Z',
  completed_at: '2026-08-26T08:10:00.000Z',
  total_items: 4,
  counted_items: 4,
  applied_items: 4,
  full_check_rows: 4,
  active_session_id: null,
  ...overrides,
})

const inboundEvent = (createdAt, overrides = {}) => ({
  id: 101,
  event_key: 'phase1c:test:event',
  operation_type: 'return',
  operation_id: 77,
  operation_item_id: 88,
  order_id: 66,
  order_item_id: 55,
  event_type: 'return_in',
  direction: 'in',
  inventory_source: 'warehouse',
  quantity: 1,
  product_id: 1,
  variant_id: 11,
  is_workshop: 1,
  status: 'pending',
  created_at: createdAt,
  ...overrides,
})

try {
  const exchanges = read('worker/domains/returns-exchanges.ts')
  const lifecycle = read('worker/domains/lifecycle.ts')
  const workshop = read('worker/domains/workshop.ts')
  const reservations = read('worker/domains/order-reservations.ts')
  const activity = read('worker/domains/activity.ts')
  const app = read('src/App.tsx')
  const returnView = read('src/features/sections/OrderReturnsSection.tsx')
  const exchangeView = read('src/features/sections/OrderExchangeSection.tsx')
  const types = read('src/app/types.ts')

  const createReturn = section(exchanges, 'export async function createReturn(', 'export const noStandaloneReturnSql')
  const createExchange = section(exchanges, 'export async function createExchange(', 'export async function listExchanges(')
  const cancelReturn = section(exchanges, 'export async function cancelReturn(', 'export async function cancelExchange(')
  const cancelExchange = section(exchanges, 'export async function cancelExchange(')
  const insertLifecycle = section(lifecycle, 'export async function insertInventoryLifecycleEvent(', 'export function inventoryLifecycleMovementReference(')
  const applyLifecycle = section(lifecycle, 'export async function applyCanonicalInventoryLifecycleEvent(', 'export async function cancelInventoryLifecycleEvent(')
  const cancelLifecycle = section(lifecycle, 'export async function cancelInventoryLifecycleEvent(', 'export async function listInventoryLifecyclePending(')
  const deferredInbound = section(lifecycle, 'export async function inventoryLifecycleDeferredInboundDisposition(', 'export async function supersedeInventoryLifecycleInboundWithoutStockChange(')
  const resolveFacts = section(lifecycle, 'export async function resolveInventoryLifecycleFacts(')
  const updateWorkshop = section(workshop, 'export async function updateWorkshopTask(', 'export async function bulkUpdateWorkshopTasks(')

  // Workshop completion and ordinary shipping remain outside Warehouse/Boutique stock semantics.
  for (const forbidden of ['inventory_stock', 'inventory_reservations', 'inventory_lifecycle_events', 'applyCanonicalInventoryLifecycleEvent']) {
    check(!updateWorkshop.includes(forbidden), `Workshop completion/status can mutate inventory via ${forbidden}`)
  }
  check(!workshop.includes('inventory_stock'), 'Workshop domain unexpectedly owns physical inventory writes')
  check(reservations.includes('COALESCE(oi.is_workshop, 0) = 0'), 'Ordinary Workshop lines no longer stay outside stock blockers/handover')

  // Workshop client return defaults to no-stock and needs an explicit Warehouse decision.
  check(createReturn.includes("const explicitRestock = typeof rawItem?.restock === 'boolean' ? rawItem.restock : null"), 'Return transport lost explicit per-line disposition')
  check(createReturn.includes("const itemRestockRequested = isWorkshop ? selected.restock === true : selected.restock !== false"), 'Workshop omission no longer means no-stock')
  check(createReturn.includes("isWorkshop && itemRestockRequested && restockSource === 'boutique'"), 'Workshop -> Boutique return guard missing')
  const returnRestockGate = createReturn.indexOf('if (wantsRestock) {')
  const returnResolve = createReturn.indexOf('resolveInventoryLifecycleCandidate(db, orderItem, isWorkshop)')
  check(returnRestockGate >= 0 && returnResolve > returnRestockGate, 'No-stock return can resolve/mutate inventory')
  check(!section(createReturn, 'const selectedItemMap', 'const validatedSelectedItems').includes('restock: true,'), 'Return backend again forces rows into stock')
  check(app.includes('restock: item.restock'), 'Frontend no longer sends explicit return disposition')

  // Lost-response replay is one-shot through stable keys + critical operation cache + pending guards.
  check(createReturn.includes('`return:${returnId}:item:${returnItemId}`'), 'Return lifecycle key is not stable per item')
  check(createExchange.includes('eventKey: `exchange:${exchangeId}:old`'), 'Exchange old-item lifecycle key is not stable')
  check(insertLifecycle.includes('INSERT OR IGNORE INTO inventory_lifecycle_events'), 'Lifecycle insertion is not replay-safe')
  check(insertLifecycle.includes('WHERE event_key = ? LIMIT 1'), 'Lifecycle replay cannot recover existing event')
  check(createReturn.includes('if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse'), 'Return retry does not reuse completed response')
  check(createExchange.includes('if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse'), 'Exchange retry does not reuse completed response')
  check(applyLifecycle.includes("cleanText(event.status) === 'applied'"), 'Applied lifecycle replay is not idempotent')
  check(applyLifecycle.includes("cleanText(event.status) === 'cancelled'"), 'Cancelled lifecycle event can be re-applied')
  check(count(applyLifecycle, "status = 'pending'") >= 4, 'Physical lifecycle writes are not consistently pending-guarded')
  check(applyLifecycle.includes('await db.batch(statements)'), 'Lifecycle physical mutation is not one guarded D1 batch')

  // Unknown no-stock creates no identity task; explicit Warehouse gets one lifecycle resolution path.
  check(count(createReturn, 'insertInventoryLifecycleEvent(db, {') === 1, 'Return create has multiple intake paths')
  check(createReturn.includes('pendingInventory.push({'), 'Unknown explicit return intake no longer stays pending')
  check(createReturn.includes('pendingInventoryCount: pendingInventory.length'), 'Return response lost pending inventory count')
  const exchangeOldGate = createExchange.indexOf("if (oldReturnSource !== 'none') {")
  const exchangeOldResolve = createExchange.indexOf('resolveInventoryLifecycleCandidate(db, oldItem, oldIsWorkshop)')
  check(exchangeOldGate >= 0 && exchangeOldResolve > exchangeOldGate, 'No-stock exchange old item can create identity/lifecycle work')
  check(createExchange.includes("oldItemIsWorkshop && oldReturnSource === 'boutique'"), 'Exchange Workshop -> Boutique guard missing')

  // Exact and manually-resolved Warehouse intake must still respect physical freshness.
  check(createReturn.includes('await canAutoApplyFreshWorkshopInbound(db, event, resolved.variantId)'), 'Return exact Workshop intake bypasses freshness')
  check(createExchange.includes('await canAutoApplyFreshWorkshopInbound(db, oldEvent, resolvedOld.variantId)'), 'Exchange exact Workshop intake bypasses freshness')
  for (const marker of ["cleanText(event.status) !== 'pending'", '!boundary.trusted', 'createdAt < boundary.startedAt', 'createdAt <= boundary.completedAt', 'inventory_stock_checks', 'checked_at >= ?']) {
    check(deferredInbound.includes(marker), `Deferred intake freshness guard missing: ${marker}`)
  }
  check(resolveFacts.includes('const finalDisposition = await inventoryLifecycleDeferredInboundDisposition(db, event, combination.id)'), 'Manual identity resolution does not re-check freshness')
  check(resolveFacts.includes("if (finalDisposition.action === 'supersede')"), 'Manual resolution cannot supersede older physical event')

  // Cancellation/reversal remains lifecycle-backed and replay-safe.
  check(cancelReturn.includes("cleanText(ret.status) === 'cancelled'"), 'Repeated return cancellation does not short-circuit')
  check(cancelReturn.includes('NOT EXISTS (\n         SELECT 1 FROM inventory_lifecycle_events e'), 'Return cancellation lost unsafe legacy guard')
  check(cancelReturn.includes("if (cleanText(event.status) !== 'applied') continue"), 'Return cancellation no longer preflights applied events')
  check(cancelReturn.includes('await loadCanonicalVariantSnapshot(db, variantId)'), 'Return cancellation does not preflight canonical variant')
  check(cancelReturn.includes('cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment)'), 'Return cancellation bypasses lifecycle reversal')
  check(cancelExchange.includes("cleanText(exchange.status) === 'cancelled'"), 'Repeated exchange cancellation does not short-circuit')
  check(cancelExchange.includes('baselineCaptured: true'), 'Exchange cancellation does not freeze restoration targets')
  check(cancelExchange.includes('cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment)'), 'Exchange cancellation bypasses lifecycle reversal')
  check(cancelLifecycle.includes("cleanText(event.status) === 'cancelled'"), 'Lifecycle cancellation replay is not idempotent')
  check(cancelLifecycle.includes("cleanText(event.status) === 'pending'"), 'Pending lifecycle cancellation path missing')
  check(cancelLifecycle.includes('reversalDelta = -originalDelta'), 'Applied cancellation does not reverse exact delta')

  // History explicitly separates client return from requested/pending/applied stock intake.
  for (const marker of ['ri.inventory_source AS return_item_inventory_source', 'ri.restocked AS return_item_restocked', 'lifecycle.status AS return_item_lifecycle_status', 'lifecycle.pending_reason AS return_item_pending_reason']) {
    check(activity.includes(marker), `Return history evidence missing: ${marker}`)
  }
  check(types.includes("lifecycleStatus?: 'pending' | 'applied' | 'cancelled'"), 'Frontend history type lost lifecycle state')
  check(returnView.includes("item.lifecycleStatus === 'pending'"), 'History UI lost pending intake state')
  check(returnView.includes("item.lifecycleStatus === 'cancelled'"), 'History UI lost cancelled/superseded intake state')
  check(returnView.includes("item.restocked ? `Возвращён:"), 'History UI lost actual-restock distinction')
  check(exchangeView.includes('Вещь из Цеха не попадает в остатки автоматически'), 'Exchange UI lost Workshop disposition guidance')

  // Exercise the real deferred-freshness function with deterministic D1 reads.
  const stale = await inventoryLifecycleDeferredInboundDisposition(new FakeD1(trustedBoundary()), inboundEvent('2026-08-26T07:59:59.000Z'), 11)
  check(stale.action === 'supersede' && stale.reason === 'stale_before_full_stocktake', 'Later full stocktake does not supersede older inbound')

  const overlap = await inventoryLifecycleDeferredInboundDisposition(new FakeD1(trustedBoundary()), inboundEvent('2026-08-26T08:05:00.000Z'), 11)
  check(overlap.action === 'hold' && overlap.reason === 'overlaps_full_stocktake', 'Inbound overlapping full stocktake is not held')

  const laterCheck = await inventoryLifecycleDeferredInboundDisposition(new FakeD1(trustedBoundary(), 909), inboundEvent('2026-08-26T08:11:00.000Z'), 11)
  check(laterCheck.action === 'supersede' && laterCheck.reason === 'later_physical_check' && laterCheck.laterCheckId === 909, 'Later exact check does not supersede older inbound')

  const fresh = await inventoryLifecycleDeferredInboundDisposition(new FakeD1(trustedBoundary()), inboundEvent('2026-08-26T08:11:00.000Z'), 11)
  check(fresh.action === 'apply' && fresh.reason === 'fresh', 'Fresh explicit inbound is not allowed')

  const active = await inventoryLifecycleDeferredInboundDisposition(new FakeD1(trustedBoundary({ active_session_id: 'REV-ACTIVE' })), inboundEvent('2026-08-26T08:11:00.000Z'), 11)
  check(active.action === 'hold' && active.reason === 'active_stocktake', 'Active stocktake no longer blocks inbound')

  console.log('PHASE 1C WORKSHOP RETURN SAFETY PASSED — no-stock Workshop returns stay non-inventory, explicit Warehouse intake is one-shot/freshness-gated, cancellation is lifecycle-backed, and history preserves client-return vs stock-intake truth')
} catch (error) {
  console.error(`PHASE 1C WORKSHOP RETURN SAFETY FAILED: ${error?.message || error}`)
  process.exit(1)
}
