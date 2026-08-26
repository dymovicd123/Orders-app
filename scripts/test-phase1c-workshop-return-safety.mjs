import fs from 'node:fs'
import path from 'node:path'
import { inventoryLifecycleDeferredInboundDisposition } from '../worker/domains/lifecycle.ts'

const root = process.cwd()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function section(text, startMarker, endMarker = '') {
  const start = text.indexOf(startMarker)
  check(start >= 0, `Section start missing: ${startMarker}`)
  if (!endMarker) return text.slice(start)
  const end = text.indexOf(endMarker, start + startMarker.length)
  check(end > start, `Section end missing after ${startMarker}: ${endMarker}`)
  return text.slice(start, end)
}

function count(text, needle) {
  return text.split(needle).length - 1
}

class FakeStatement {
  constructor(owner, sql, bindings = []) {
    this.owner = owner
    this.sql = sql
    this.bindings = bindings
  }

  bind(...bindings) {
    return new FakeStatement(this.owner, this.sql, bindings)
  }

  async first() {
    if (this.sql.includes('FROM inventory_stocktake_sessions s')) return this.owner.boundary
    if (this.sql.includes('FROM inventory_stock_checks')) {
      return this.owner.laterCheckId ? { id: this.owner.laterCheckId } : null
    }
    throw new Error(`Unexpected fake query: ${this.sql.slice(0, 120)}`)
  }
}

class FakeD1 {
  constructor(boundary, laterCheckId = 0) {
    this.boundary = boundary
    this.laterCheckId = laterCheckId
  }

  prepare(sql) {
    return new FakeStatement(this, sql)
  }
}

function trustedBoundary(overrides = {}) {
  return {
    id: 'REV-TEST-F-1',
    started_at: '2026-08-26T08:00:00.000Z',
    completed_at: '2026-08-26T08:10:00.000Z',
    total_items: 4,
    counted_items: 4,
    applied_items: 4,
    full_check_rows: 4,
    active_session_id: null,
    ...overrides,
  }
}

function inboundEvent(createdAt, overrides = {}) {
  return {
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
  }
}

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

  // 1C.1 — Workshop production/completion stays outside physical Warehouse/Boutique stock.
  const updateWorkshop = section(workshop, 'export async function updateWorkshopTask(', 'export async function bulkUpdateWorkshopTasks(')
  for (const forbidden of ['inventory_stock', 'inventory_reservations', 'inventory_lifecycle_events', 'applyCanonicalInventoryLifecycleEvent']) {
    check(!updateWorkshop.includes(forbidden), `Workshop completion/status can mutate inventory via ${forbidden}`)
  }
  check(!workshop.includes('inventory_stock'), 'Workshop domain unexpectedly owns physical inventory writes')
  const blockers = section(reservations, 'export async function getOrderShipmentInventoryBlockers(', 'export async function fulfillOrderReservationsV2(')
  check(blockers.includes('COALESCE(oi.is_workshop, 0) = 0'), 'Ordinary Workshop lines became stock shipment blockers')

  // 1C.2 — A Workshop client return is no-stock unless Warehouse intake is explicitly requested.
  check(createReturn.includes("const explicitRestock = typeof rawItem?.restock === 'boolean' ? rawItem.restock : null"), 'Return transport lost explicit per-line disposition')
  check(createReturn.includes("const itemRestockRequested = isWorkshop ? selected.restock === true : selected.restock !== false"), 'Workshop omission no longer means no-stock')
  check(createReturn.includes("isWorkshop && itemRestockRequested && restockSource === 'boutique'"), 'Workshop -> Boutique backend guard missing')
  const returnRestockGate = createReturn.indexOf('if (wantsRestock) {')
  const returnResolve = createReturn.indexOf('resolveInventoryLifecycleCandidate(db, orderItem, isWorkshop)')
  check(returnRestockGate >= 0 && returnResolve > returnRestockGate, 'No-stock return can resolve/mutate inventory outside the explicit restock gate')
  check(!section(createReturn, 'const selectedItemMap', 'const validatedSelectedItems').includes('restock: true,'), 'Return backend again forces selected rows into stock')
  check(app.includes('restock: item.restock'), 'Frontend no longer sends the explicit return disposition')

  // 1C.3 — Stable keys + guarded lifecycle writes make lost-response replay one-shot.
  check(createReturn.includes('`return:${returnId}:item:${returnItemId}`'), 'Return lifecycle key is not stable per return item')
  check(createExchange.includes('eventKey: `exchange:${exchangeId}:old`'), 'Exchange old-item lifecycle key is not stable')
  check(insertLifecycle.includes('INSERT OR IGNORE INTO inventory_lifecycle_events'), 'Lifecycle event insertion is not replay-safe')
  check(insertLifecycle.includes('WHERE event_key = ? LIMIT 1'), 'Lifecycle replay does not recover the existing event')
  check(applyLifecycle.includes("cleanText(event.status) === 'applied'"), 'Applied lifecycle replay is not idempotent')
  check(applyLifecycle.includes("cleanText(event.status) === 'cancelled'"), 'Cancelled lifecycle event can be re-applied')
  check(count(applyLifecycle, "status = 'pending'") >= 4, 'Physical lifecycle mutation is not consistently guarded by pending status')
  check(applyLifecycle.includes('await db.batch(statements)'), 'Lifecycle physical mutation is not one guarded batch')
  check(createReturn.includes('if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse'), 'Return lost-response retry does not reuse completed response')
  check(createExchange.includes('if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse'), 'Exchange lost-response retry does not reuse completed response')

  // 1C.4 — Unknown no-stock Workshop return creates no identity task; explicit Warehouse may create exactly one pending lifecycle path.
  check(returnResolve > returnRestockGate, 'Workshop no-stock return can create catalog/lifecycle work')
  check(count(createReturn, 'insertInventoryLifecycleEvent(db, {') === 1, 'Return create has more than one lifecycle intake path')
  check(createReturn.includes('pendingInventory.push({'), 'Unknown explicit return intake no longer remains pending for one narrow resolution path')
  check(createReturn.includes('pendingInventoryCount: pendingInventory.length'), 'Return response lost pending inventory count')
  check(createExchange.includes("if (oldReturnSource !== 'none') {"), 'Exchange old item can enter lifecycle without an explicit stock destination')
  const exchangeOldGate = createExchange.indexOf("if (oldReturnSource !== 'none') {")
  const exchangeOldResolve = createExchange.indexOf('resolveInventoryLifecycleCandidate(db, oldItem, oldIsWorkshop)')
  check(exchangeOldGate >= 0 && exchangeOldResolve > exchangeOldGate, 'No-stock exchange old item can create identity/lifecycle work')
  check(createExchange.includes("oldItemIsWorkshop && oldReturnSource === 'boutique'"), 'Exchange Workshop -> Boutique guard missing')

  // 1C.5 — Explicit Workshop Warehouse intake retains the freshness barrier both automatically and after manual identity resolution.
  check(createReturn.includes('await canAutoApplyFreshWorkshopInbound(db, event, resolved.variantId)'), 'Return exact Workshop intake bypasses freshness check')
  check(createExchange.includes('await canAutoApplyFreshWorkshopInbound(db, oldEvent, resolvedOld.variantId)'), 'Exchange exact Workshop intake bypasses freshness check')
  for (const required of [
    "cleanText(event.direction) !== 'in'",
    "cleanText(event.status) !== 'pending'",
    '!boundary.trusted',
    'createdAt < boundary.startedAt',
    'createdAt <= boundary.completedAt',
    'inventory_stock_checks',
    'checked_at >= ?',
  ]) check(deferredInbound.includes(required), `Deferred intake freshness guard missing: ${required}`)
  check(resolveFacts.includes('const finalDisposition = await inventoryLifecycleDeferredInboundDisposition(db, event, combination.id)'), 'Manual identity resolution does not re-check physical freshness before stock mutation')
  check(resolveFacts.includes("if (finalDisposition.action === 'supersede')"), 'Manual resolution cannot supersede an older inbound event')

  // 1C.6 — Cancellation/reversal is one-shot and restores only lifecycle-backed stock.
  check(cancelReturn.includes("cleanText(ret.status) === 'cancelled'"), 'Repeated return cancellation does not short-circuit')
  check(cancelReturn.includes('NOT EXISTS (\n         SELECT 1 FROM inventory_lifecycle_events e'), 'Return cancellation lost legacy unsafe-stock guard')
  check(cancelReturn.includes("if (cleanText(event.status) !== 'applied') continue"), 'Return cancellation no longer preflights only applied stock events')
  check(cancelReturn.includes('await loadCanonicalVariantSnapshot(db, variantId)'), 'Return cancellation does not preflight canonical variants before first reversal')
  check(cancelReturn.includes('cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment)'), 'Return cancellation bypasses lifecycle reversal')
  check(cancelReturn.includes("WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'"), 'Return status cancellation is not guarded')
  check(cancelExchange.includes("cleanText(exchange.status) === 'cancelled'"), 'Repeated exchange cancellation does not short-circuit')
  check(cancelExchange.includes('baselineCaptured: true'), 'Exchange cancellation does not freeze restoration targets before mutation')
  check(cancelExchange.includes('cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment)'), 'Exchange cancellation bypasses lifecycle reversal')
  check(cancelExchange.indexOf('cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment)') < cancelExchange.indexOf('UPDATE order_items\n       SET quantity = 0'), 'Exchange restores/removes order rows before lifecycle reversal')
  check(cancelLifecycle.includes("cleanText(event.status) === 'cancelled'"), 'Lifecycle cancellation replay is not idempotent')
  check(cancelLifecycle.includes("cleanText(event.status) === 'pending'"), 'Pending lifecycle cancellation path missing')
  check(cancelLifecycle.includes('reversalDelta = -originalDelta'), 'Applied lifecycle cancellation no longer reverses the exact physical delta')
  check(count(cancelLifecycle, "status = 'applied'") >= 2, 'Applied reversal writes are not guarded by applied status')

  // 1C.7 — History distinguishes the customer return from actual stock intake state.
  check(activity.includes('ri.inventory_source AS return_item_inventory_source'), 'Return history lost requested inventory destination')
  check(activity.includes('ri.restocked AS return_item_restocked'), 'Return history lost actual restock state')
  check(activity.includes('lifecycle.status AS return_item_lifecycle_status'), 'Return history lost lifecycle state')
  check(activity.includes('lifecycle.pending_reason AS return_item_pending_reason'), 'Return history lost pending intake reason')
  check(types.includes("lifecycleStatus?: 'pending' | 'applied' | 'cancelled'"), 'Frontend return history type no longer models intake state')
  check(returnView.includes("item.lifecycleStatus === 'pending'"), 'Return history UI no longer distinguishes pending physical intake')
  check(returnView.includes("item.lifecycleStatus === 'cancelled'"), 'Return history UI no longer distinguishes cancelled/superseded intake')
  check(returnView.includes("item.restocked ? `Возвращён:"), 'Return history UI no longer distinguishes actual restock from client return')
  check(exchangeView.includes('Вещь из Цеха не попадает в остатки автоматически'), 'Exchange UI lost explicit Workshop disposition guidance')

  // 1C.8 — Execute the real deferred-freshness decision function against deterministic D1 reads.
  const stale = await inventoryLifecycleDeferredInboundDisposition(
    new FakeD1(trustedBoundary()),
    inboundEvent('2026-08-26T07:59:59.000Z'),
    11,
  )
  check(stale.action === 'supersede' && stale.reason === 'stale_before_full_stocktake', 'Older inbound event is not superseded by later full stocktake')

  const overlap = await inventoryLifecycleDeferredInboundDisposition(
    new FakeD1(trustedBoundary()),
    inboundEvent('2026-08-26T08:05:00.000Z'),
    11,
  )
  check(overlap.action === 'hold' && overlap.reason === 'overlaps_full_stocktake', 'Inbound event overlapping a full stocktake is not held')

  const laterCheck = await inventoryLifecycleDeferredInboundDisposition(
    new FakeD1(trustedBoundary(), 909),
    inboundEvent('2026-08-26T08:11:00.000Z'),
    11,
  )
  check(laterCheck.action === 'supersede' && laterCheck.reason === 'later_physical_check' && laterCheck.laterCheckId === 909, 'Later exact physical check does not supersede older inbound event')

  const fresh = await inventoryLifecycleDeferredInboundDisposition(
    new FakeD1(trustedBoundary()),
    inboundEvent('2026-08-26T08:11:00.000Z'),
    11,
  )
  check(fresh.action === 'apply' && fresh.reason === 'fresh', 'Fresh explicit inbound event is not allowed after trusted baseline')

  const activeStocktake = await inventoryLifecycleDeferredInboundDisposition(
    new FakeD1(trustedBoundary({ active_session_id: 'REV-ACTIVE' })),
    inboundEvent('2026-08-26T08:11:00.000Z'),
    11,
  )
  check(activeStocktake.action === 'hold' && activeStocktake.reason === 'active_stocktake', 'Active stocktake no longer blocks deferred inbound mutation')

  console.log('PHASE 1C WORKSHOP RETURN SAFETY PASSED — no-stock Workshop returns stay non-inventory, explicit Warehouse intake is one-shot/freshness-gated, cancellation is lifecycle-backed, and history preserves client-return vs stock-intake truth')
} catch (error) {
  console.error(`PHASE 1C WORKSHOP RETURN SAFETY FAILED: ${error?.message || error}`)
  process.exit(1)
}
