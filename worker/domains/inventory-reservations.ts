// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import type { InventoryReservationsResponse } from '../../shared/api-contracts.ts'
import { canonicalStockPositionValue, cleanText, normalizeSourceType, toInt } from '../core/text.ts'

export function isReversibleInventoryMovementReference(referenceType: unknown) {
  const type = cleanText(referenceType).toLowerCase();
  return new Set([
    'manual',
    'transfer_in',
    'transfer_out',
  ]).has(type);
}


export async function listInventoryReservations(db: D1Database, url: URL): Promise<InventoryReservationsResponse> {
  const source = normalizeSourceType(url.searchParams.get('source'));
  const variantId = Math.max(0, toInt(url.searchParams.get('variantId'), 0));
  const productId = Math.max(0, toInt(url.searchParams.get('productId'), 0));
  if (!variantId && !productId) return { ok: true, source, variantId: 0, productId: 0, totalQuantity: 0, reservations: [] };

  const where = variantId ? 'r.variant_id = ?' : 'r.product_id = ?';
  const targetId = variantId || productId;
  const result = await db.prepare(
    `SELECT
       r.id, r.order_id, r.order_item_id, r.inventory_source, r.product_id, r.variant_id, r.quantity, r.status,
       o.external_id, o.order_date, o.shipping_status,
       COALESCE(m.name, '') AS manager_name,
       COALESCE(c.display_name, '') AS customer_name,
       COALESCE(c.phone_normalized, '') AS customer_phone,
       oi.product_name_snapshot, oi.gender_snapshot, oi.color_snapshot, oi.material_snapshot,
       oi.length_snapshot, oi.size_snapshot
     FROM inventory_reservations r
     JOIN orders o ON o.id = r.order_id
     JOIN order_items oi ON oi.id = r.order_item_id
     LEFT JOIN managers m ON m.id = o.manager_id
     LEFT JOIN customers c ON c.id = o.customer_id
     WHERE r.inventory_source = ? AND ${where} AND r.status = 'active'
     ORDER BY o.order_date DESC, r.id DESC
     LIMIT 120`
  ).bind(source, targetId).all<Record<string, unknown>>();

  const reservations = (result.results || []).map(row => ({
    id: toInt(row.id, 0),
    orderId: toInt(row.order_id, 0),
    orderItemId: toInt(row.order_item_id, 0),
    source: cleanText(row.inventory_source),
    productId: toInt(row.product_id, 0),
    variantId: toInt(row.variant_id, 0),
    quantity: Math.max(0, toInt(row.quantity, 0)),
    status: cleanText(row.status),
    externalOrderId: cleanText(row.external_id),
    orderDate: cleanText(row.order_date),
    shippingStatus: cleanText(row.shipping_status),
    managerName: cleanText(row.manager_name),
    customerName: cleanText(row.customer_name),
    customerPhone: cleanText(row.customer_phone),
    productName: cleanText(row.product_name_snapshot),
    gender: cleanText(row.gender_snapshot),
    color: cleanText(row.color_snapshot),
    material: canonicalStockPositionValue(row.material_snapshot),
    length: canonicalStockPositionValue(row.length_snapshot),
    size: cleanText(row.size_snapshot),
  }));
  return {
    ok: true,
    source,
    variantId,
    productId,
    totalQuantity: reservations.reduce((sum, row) => sum + row.quantity, 0),
    reservations,
  };
}
