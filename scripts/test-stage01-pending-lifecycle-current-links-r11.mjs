import fs from 'node:fs'

const lifecycle = fs.readFileSync('worker/domains/lifecycle.ts', 'utf8')
const attention = fs.readFileSync('worker/domains/warehouse-attention.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const section = (source, startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(start >= 0 && end > start, 'Missing section: ' + startMarker)
  return source.slice(start, end)
}

const reconcile = section(lifecycle, 'export async function reconcileKnownPendingInventoryInbound(', 'export async function insertInventoryLifecycleEvent(')
const listPending = section(lifecycle, 'export async function listInventoryLifecyclePending(', 'export async function getInventoryLifecycleContext(')
const context = section(lifecycle, 'export async function getInventoryLifecycleContext(', 'export async function resolveInventoryLifecycleFacts(')

for (const [name, block] of [['reconcile', reconcile], ['list', listPending], ['context', context]]) {
  check(block.includes('LEFT JOIN order_items oi ON oi.id = e.order_item_id AND oi.order_id = e.order_id'), name + ' pending lifecycle path does not read repaired linked order item truth')
  check(block.includes('current_order_product_id') && block.includes('current_order_variant_id'), name + ' pending lifecycle path does not expose current canonical FKs')
}

const resolutionEventPos = reconcile.indexOf('const resolutionEvent = {')
const currentVariantPos = reconcile.indexOf('variant_id: toInt(event.current_order_variant_id, 0) || event.variant_id')
const resolvePos = reconcile.indexOf('resolveInventoryLifecycleCandidate(db, resolutionEvent')
check(resolutionEventPos >= 0 && currentVariantPos > resolutionEventPos && resolvePos > currentVariantPos, 'Known-intake reconciliation still resolves the stale event before current order links')
check(reconcile.includes('product_id: toInt(event.current_order_product_id, 0) || event.product_id'), 'Known-intake reconciliation ignores repaired base-product link')
check(!reconcile.includes('UPDATE order_items'), 'Known-intake hydration unexpectedly rewrites order item identity')

check(listPending.includes('productId: toInt(row.current_order_product_id, 0) || toInt(row.product_id, 0) || null'), 'Pending lifecycle list does not expose current product link first')
check(listPending.includes('variantId: toInt(row.current_order_variant_id, 0) || toInt(row.variant_id, 0) || null'), 'Pending lifecycle list does not expose current variant link first')
check(listPending.includes('productName: cleanText(row.product_name_snapshot)'), 'Pending lifecycle list stopped preserving event-time text evidence')

check(context.includes('const currentVariantId = toInt(event.current_order_variant_id, 0)'), 'Lifecycle context ignores repaired exact variant link')
check(context.includes('currentCanonical = await loadCanonicalVariantSnapshot(db, currentVariantId)'), 'Lifecycle context does not validate repaired exact variant canonically')
check(context.includes('const effectiveProductId = toInt(currentCanonical?.productId, 0)') && context.includes('|| toInt(event.current_order_product_id, 0)'), 'Lifecycle context ignores repaired current product link')
check(context.includes('let existingVariant: { id: number } | null = currentCanonical?.variantId ? { id: currentCanonical.variantId } : null'), 'Lifecycle context does not surface repaired exact variant as existing')
check(context.includes('productName: currentCanonical.productName'), 'Lifecycle working context still pre-fills stale snapshot identity after exact repair')
for (const immutable of ['product_name_snapshot', 'gender_snapshot', 'color_snapshot', 'material_snapshot', 'length_snapshot', 'size_snapshot']) {
  check(!new RegExp('UPDATE inventory_lifecycle_events[^;]*' + immutable, 's').test(reconcile + listPending + context), 'R11 rewrites immutable lifecycle snapshot field: ' + immutable)
}

const exactStart = attention.indexOf('const exactLifecycleVariantSql = `COALESCE(')
const exactEnd = attention.indexOf('const exactFoundVariantSql', exactStart)
check(exactStart >= 0 && exactEnd > exactStart, 'Warehouse attention lifecycle exact-variant SQL missing')
const exact = attention.slice(exactStart, exactEnd)
const linkedVariant = exact.indexOf('JOIN catalog_variants v_link ON v_link.id = oi_link.variant_id')
const eventVariant = exact.indexOf('v0.id = e.variant_id')
check(linkedVariant >= 0 && eventVariant > linkedVariant, 'Warehouse attention does not prefer repaired linked exact variant over stale event identity')
check(exact.includes('oi_product.product_id') && exact.includes('e.product_id'), 'Warehouse attention does not use repaired base-product link before event fallback')
check(attention.includes("e.status = 'pending' AND e.direction = 'in' AND ${exactLifecycleVariantSql} IS NOT NULL"), 'Known-intake classification no longer uses exact lifecycle identity')

console.log('STAGE01 PENDING LIFECYCLE CURRENT LINKS R11 PASSED — pending intake follows repaired order-item canonical links while immutable event snapshots remain historical evidence')
