// Reserve a known SKU and record the result in one SQLite transaction.
// The INSERT uses changes() from the immediately preceding conditional UPDATE.
// A failed admission leaves the order with an explicit unresolved obligation,
// not a silently oversubscribed active reservation.
export type ReservationAdmission = {
  orderId: number; orderItemId: number; source: 'warehouse' | 'boutique';
  stockId: number; productId: number; variantId: number; quantity: number;
  productName: string; gender: string; color: string; material: string;
  length: string; size: string; referenceType: string; referenceId: string;
  timestamp: string; shortageAcknowledged: boolean;
  shortageDecision?: {
    inventorySource: 'warehouse' | 'boutique'; variantId: number;
    physicalQuantity: number; reservedQuantity: number; requestedQuantity: number;
  } | null;
}

export async function admitOrderReservationAtomically(db: D1Database, p: ReservationAdmission) {
  const decision = p.shortageAcknowledged
    && p.shortageDecision?.inventorySource === p.source
    && p.shortageDecision.variantId === p.variantId
    && Number.isSafeInteger(p.shortageDecision.physicalQuantity)
    && Number.isSafeInteger(p.shortageDecision.reservedQuantity)
    && Number.isSafeInteger(p.shortageDecision.requestedQuantity)
    && p.shortageDecision.requestedQuantity >= p.quantity
    && p.shortageDecision.physicalQuantity >= 0
    && p.shortageDecision.reservedQuantity >= 0
    ? p.shortageDecision : null;

  // Own reservations from earlier lines of this order do not invalidate a
  // group-level shortage decision. Other managers' reservations do.
  const guardedUpdate = db.prepare(
    `UPDATE inventory_stock
     SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) + ?),
         product_id = ?, variant_id = ?, product_name_snapshot = ?, gender_snapshot = ?,
         color_snapshot = ?, material_snapshot = ?, length_snapshot = ?, size_snapshot = ?,
         last_action = 'Резерв заказа', last_source_ref = ?, updated_at = ?
     WHERE id = ? AND inventory_source = ? AND variant_id = ?
       AND (
         quantity >= COALESCE(reserved_quantity, 0) + ?
         OR (
           ? = 1 AND quantity = ?
           AND COALESCE(reserved_quantity, 0) -
             COALESCE((
               SELECT SUM(r.quantity) FROM inventory_reservations r
               WHERE r.order_id = ? AND r.inventory_source = ?
                 AND r.variant_id = ? AND r.status = 'active'
             ), 0) = ?
         )
       )`
  ).bind(
    p.quantity, p.productId, p.variantId, p.productName, p.gender,
    p.color, p.material, p.length, p.size,
    `${p.referenceType}:${p.referenceId}`, p.timestamp,
    p.stockId, p.source, p.variantId, p.quantity,
    decision ? 1 : 0, decision?.physicalQuantity ?? -1,
    p.orderId, p.source, p.variantId, decision?.reservedQuantity ?? -1,
  );

  // In the same D1.batch transaction, changes() reports the number of stock
  // rows updated by guardedUpdate. No remote read or separate write in between.
  const insert = db.prepare(
    `INSERT INTO inventory_reservations (
       order_id, order_item_id, inventory_source, product_id, variant_id,
       quantity, status, reference_type, reference_id, unresolved_reason,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?,
       CASE WHEN changes() > 0 THEN 'active' ELSE 'unresolved' END,
       ?, ?,
       CASE WHEN changes() > 0 THEN NULL ELSE 'concurrent_shortage' END,
       ?, ?)`
  ).bind(
    p.orderId, p.orderItemId, p.source, p.productId, p.variantId, p.quantity,
    p.referenceType, p.referenceId, p.timestamp, p.timestamp,
  );
  const markItem = db.prepare(
    `UPDATE order_items
     SET stock_writeoff_status = CASE
         WHEN EXISTS (
           SELECT 1 FROM inventory_reservations r
           WHERE r.order_item_id = ? AND r.status = 'active'
         ) THEN 'reserved' ELSE 'pending_reservation' END,
         stock_quantity_before = NULL, stock_quantity_after = NULL
     WHERE id = ? AND order_id = ?`
  ).bind(p.orderItemId, p.orderItemId, p.orderId);

  await db.batch([guardedUpdate, insert, markItem]);
  const persisted = await db.prepare(
    `SELECT status, unresolved_reason FROM inventory_reservations
     WHERE order_item_id = ? LIMIT 1`
  ).bind(p.orderItemId).first<{ status: string; unresolved_reason: string | null }>();
  if (!persisted || !['active', 'unresolved'].includes(persisted.status)) {
    throw new Error('Результат атомарного резерва не зафиксирован. Требуется проверка заказа.');
  }
  return { status: persisted.status as 'active' | 'unresolved', reason: persisted.unresolved_reason };
}
