import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  check(start >= 0, `Marker missing: ${startMarker}`)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(end > start, `End marker missing after: ${startMarker}`)
  return source.slice(start, end)
}

try {
  const worker = read('worker/index.ts')
  const lifecycle = read('worker/domains/lifecycle.ts')
  const attention = read('worker/domains/warehouse-attention.ts')
  const reservations = read('worker/domains/order-reservations.ts')
  const contracts = read('shared/api-contracts.ts')
  const app = read('src/App.tsx')
  const attentionHook = read('src/features/inventory/useInventoryAttentionActions.ts')
  const panel = read('src/features/inventory/views/renderInventoryAttentionPanel.tsx')
  const inventory = read('src/features/sections/InventorySection.tsx')
  const css = read('src/styles/192b2a-warehouse-attention-actions.css')

  check(worker.includes("warehouseAttentionContextFix: '192b2a2'"), '192B2A2 health marker missing')

  // Natural recovery keeps clarification secondary: only true ambiguity remains there.
  for (const marker of [
    "type AttentionCategory = 'handover' | 'intake' | 'identify'",
    "{ value: 'handover', label: 'Выдача' }",
    "{ value: 'identify', label: 'Товар' }",
    "attentionCategory === 'handover'",
    "attentionCategory === 'intake'",
    "attentionCategory === 'identify'",
  ]) check(attentionHook.includes(marker) || panel.includes(marker), `Attention category UI missing: ${marker}`)
  check(!panel.includes("{ value: 'count', label: 'Количество' }") && !panel.includes("{ value: 'revision', label: 'Проверка' }"), 'Routine shortage/revision returned to clarification tabs')
  check(panel.includes('inventory-attention-tabs') && css.includes('.inventory-attention-tabs'), 'Clarification tabs are not styled/mounted')
  check(panel.includes('Нехватка и ревизии решаются в своих обычных разделах.'), 'Natural-recovery routing is not explained in clarification')

  // Handover context must identify the actual order before a historical decision is made.
  for (const marker of ['customerName', 'orderDate', 'orderCreatedAt', 'itemCreatedAt', 'reviewReason']) {
    check(contracts.includes(marker), `Handover API context missing: ${marker}`)
  }
  check(reservations.includes('o.created_at AS order_created_at') && reservations.includes('customer.display_name AS customer_name'), 'Canonical handover query does not return order/customer context')
  check(attention.includes("cleanText(b.row.order_date).localeCompare(cleanText(a.row.order_date))"), 'Handover questions are not ordered newest business-date first')
  for (const marker of ['Заказ ', ' · от ', 'Позиция в учёте с ', 'Причина: позиция была внесена после физической проверки.', 'Причина: смешанный заказ']) {
    check(panel.includes(marker), `Attention handover context missing: ${marker}`)
  }
  for (const marker of ['Заказ от ', 'Внесён в систему ', 'Позиция в учёте с ', 'клиент уже получил этот товар?']) {
    check(app.includes(marker), `Handover decision modal context missing: ${marker}`)
  }

  // A shortage is de-duplicated by quantities, not by hiding the whole SKU when any handover exists.
  check(attention.includes('reviewReserved') && attention.includes('ordinaryReserved') && attention.includes('countRelevantReserved'), 'Quantity-aware handover/shortage split is missing')
  check(attention.includes('reserved - reviewReserved'), 'Ordinary reservation quantity is not separated from handover reservation quantity')
  check(attention.includes('row.physical < 0 || row.countRelevantReserved > row.physical'), 'A mixed SKU can be hidden even when ordinary reservations still exceed physical stock')
  check(!panel.includes('В остальных заказах') && !panel.includes('разбираются отдельно во вкладке «Выдача»'), 'Shortage/count explanation leaked back into secondary clarification')

  // Known exact inbound is intake, unknown identity stays identify. No six-field form for an exact known SKU.
  check(attention.includes('exactKnown: Boolean') && attention.includes("cleanText(row.direction) === 'in'"), 'Exact known inbound classification missing')
  check(attention.includes('intake: lifecycleItems.filter((row) => row.exactKnown)') && attention.includes('lifecycle: lifecycleItems.filter((row) => !row.exactKnown)'), 'Known intake and unknown identity are not separated')
  check(panel.includes('Принять в остаток') && panel.includes('Товар уже известен.') && panel.includes('Принимайте только если вещь действительно находится у вас.'), 'Known intake no longer communicates known identity plus physical confirmation')
  check(panel.includes('Здесь только позиции, которым действительно не хватает точной идентичности.'), 'Identify tab still mixes known intake')

  const reconcile = between(lifecycle, 'export async function reconcileKnownPendingInventoryInbound(', 'export async function insertInventoryLifecycleEvent(')
  for (const marker of ['resolveInventoryLifecycleCandidate', 'inventoryLifecycleDeferredInboundDisposition', "disposition.action === 'supersede'", "disposition.action !== 'apply'", 'applyCanonicalInventoryLifecycleEvent']) {
    check(reconcile.includes(marker), `Known intake safety gate missing: ${marker}`)
  }
  const route = between(worker, "const inventoryLifecycleKnownMatch = url.pathname.match", "if (url.pathname === '/api/catalog/review/reconcile'")
  check(route.includes('reconcileKnownPendingInventoryInbound'), 'Known intake endpoint is not wired to the guarded reconciler')
  check(!route.includes('requireAdminAccess'), 'Exact known intake unexpectedly depends on permanent admin availability')

  // Direct handoff from Attention to admin review must load and select the target immediately.
  const openLifecycle = between(attentionHook, 'async function openAttentionLifecycle', 'async function openAttentionCatalog')
  check(openLifecycle.includes('await loadInventoryLifecycle(true)') && openLifecycle.includes('findIndex') && openLifecycle.includes('setInventoryLifecycleTaskIndex'), 'Lifecycle “Разобрать” still requires a second manual Refresh')
  const openCatalog = between(attentionHook, 'async function openAttentionCatalog', 'async function openAttentionIntake')
  check(openCatalog.includes('await loadCatalogReview(true)') && openCatalog.includes('findIndex') && openCatalog.includes('setCatalogReviewTaskIndex'), 'Catalog “Разобрать” still requires a second manual Refresh')

  // All 34 current handover rows must fit in one bounded working window; future overflow self-reveals after refresh.
  check(attention.includes('ATTENTION_DETAIL_LIMIT = 50') && attention.includes('Math.min(50'), 'Attention working window is not bounded at 50')
  check(!/warehouse_tasks|warehouse_cases|case_owner|deadline|\bSLA\b/i.test(attention + panel), 'B2A2 introduced a persistent task/SLA system')

  check(inventory.includes('renderInventoryAttentionPanel'), 'Attention panel disappeared from Inventory')
  check(!/Step\s*192B2A2|D1|migration|variant_id|forensic/i.test(panel), 'Developer-facing implementation wording leaked into Warehouse Attention UI')

  console.log('STEP 192B2A2 ATTENTION CONTEXT / DEDUP TESTS PASSED — separate question tabs, quantity-aware shortage/handover split, order context, known-intake fast path, direct review loading')
} catch (error) {
  console.error(`STEP 192B2A2 ATTENTION CONTEXT / DEDUP TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
