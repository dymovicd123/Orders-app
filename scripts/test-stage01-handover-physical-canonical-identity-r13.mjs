import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/order-reservations.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }
const block = (startMarker, endMarker) => {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  check(start >= 0 && end > start, 'Missing block: ' + startMarker)
  return source.slice(start, end)
}

const fetch = block('export async function fetchOrderStockHandoverRows(', 'export function stockHandoverItemFromRow(')
const project = block('export function stockHandoverItemFromRow(', 'export async function countOrderStockHandoverReviewCandidates(')
const fulfill = block('export async function fulfillOrderReservationsV2(', 'export async function correctMistakenOrderHandover(')
const blockers = block('export async function getOrderShipmentInventoryBlockers(', 'export function orderShipmentInventoryBlockerMessage(')

check(fetch.includes('LEFT JOIN catalog_variants reservation_variant ON reservation_variant.id = r.variant_id'), 'Detailed handover does not resolve the physically reserved SKU')
check(fetch.includes('LEFT JOIN catalog_products reservation_product ON reservation_product.id = reservation_variant.product_id'), 'Detailed handover does not resolve the reserved product')
check(fetch.includes('LEFT JOIN catalog_variants order_variant ON order_variant.id = oi.variant_id'), 'Handover fallback lost current order exact identity')
check(fetch.includes('LEFT JOIN catalog_products order_product ON order_product.id = COALESCE(oi.product_id, order_variant.product_id)'), 'Handover fallback lost current order product identity')
check(fetch.includes('WHEN reservation_variant.id IS NOT NULL THEN reservation_product.name'), 'Physical reservation is not first product-name truth in handover')
check(fetch.includes('WHEN reservation_variant.id IS NOT NULL THEN reservation_variant.gender'), 'Physical reservation is not first SKU-detail truth in handover')
check(fetch.includes('WHEN order_variant.id IS NOT NULL THEN order_variant.size_label'), 'Exact order variant is not the second SKU-detail fallback')
check(fetch.includes('ELSE oi.size_snapshot'), 'Immutable order snapshot is no longer final handover fallback')

check(project.includes('const details = [row.working_gender, row.working_color, row.working_material, row.working_length, row.working_size]'), 'Handover UI model still renders stale snapshot SKU details')
check(project.includes('productName: cleanText(row.working_product_name) || cleanText(row.product_name_snapshot)'), 'Handover UI model still renders stale snapshot product name first')

check(fulfill.includes('LEFT JOIN catalog_variants reservation_variant ON reservation_variant.id = r.variant_id'), 'Shipment preparation does not read canonical reserved SKU')
check(fulfill.includes('AS working_product_name'), 'Shipment preparation lacks canonical working product label')
check(fulfill.includes('cleanText(reservation.working_product_name) || cleanText(reservation.product_name_snapshot)'), 'Shipment validation/error labels still prefer order-time snapshot')
check(fulfill.includes('LEFT JOIN catalog_products p ON p.id = v.product_id'), 'Final stock mutation still loads canonical catalog identity before writing movements')

check(blockers.includes('COALESCE(variant_product.name, order_product.name, oi.product_name_snapshot) AS product_name_snapshot'), 'Unresolved shipment blocker still reports stale product identity when current catalog links exist')
check(blockers.includes('MIN(COALESCE(reservation_product.name, oi.product_name_snapshot)) AS product_name_snapshot'), 'Physical-shortage diagnostic does not prefer the reserved canonical product')
check(blockers.includes('LEFT JOIN catalog_products reservation_product ON reservation_product.id = reservation_variant.product_id'), 'Physical-shortage diagnostic lacks reserved canonical product join')

// R13 is read/presentation truth only. It must not rewrite order-time evidence.
for (const immutable of ['product_name_snapshot', 'gender_snapshot', 'color_snapshot', 'material_snapshot', 'length_snapshot', 'size_snapshot']) {
  check(!new RegExp('UPDATE order_items[^;]*' + immutable, 's').test(fetch + project + blockers), 'R13 rewrites order snapshot field: ' + immutable)
}

console.log('STAGE01 HANDOVER PHYSICAL CANONICAL IDENTITY R13 PASSED — live handover and shipping diagnostics display the canonical SKU that is physically reserved, with current order identity and immutable snapshots only as fallbacks')
