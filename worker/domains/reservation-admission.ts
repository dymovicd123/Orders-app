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


// Recover a confirmed SKU only on an explicit shipment retry after stock arrival.
// Keep the same reservation/item identity. Never manufacture physical inventory.
export async function recoverPendingOrderReservationsBeforeShipping(
  db: D1Database, orderId: number, timestamp: string,
) {
  if (!Number.isSafeInteger(orderId) || orderId <= 0) return { attempted: 0, activated: 0 };
  const pending = await db.prepare(
    `SELECT r.id AS reservation_id, r.order_item_id, r.inventory_source, r.variant_id,
            r.product_id, r.quantity, stock.id AS stock_id
     FROM inventory_reservations r
     JOIN order_items oi ON oi.id = r.order_item_id AND oi.order_id = r.order_id
     JOIN orders o ON o.id = r.order_id
     JOIN catalog_variants v ON v.id = r.variant_id AND v.product_id = r.product_id AND v.is_active = 1
     JOIN catalog_products p ON p.id = r.product_id AND p.is_active = 1
     JOIN inventory_stock stock ON stock.inventory_source = r.inventory_source AND stock.variant_id = r.variant_id
     WHERE r.order_id = ?
       AND r.status = 'unresolved' AND r.unresolved_reason = 'concurrent_shortage'
       AND r.inventory_source IN ('warehouse', 'boutique') AND r.quantity > 0
       AND oi.quantity = r.quantity AND oi.variant_id = r.variant_id AND oi.product_id = r.product_id
       AND COALESCE(oi.is_workshop, 0) = 0 AND oi.stock_writeoff_status = 'pending_reservation'
       AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'
       AND COALESCE(o.order_status, 'active') = 'active' AND COALESCE(o.archived_at, '') = ''
       AND NOT EXISTS (
         SELECT 1 FROM return_items ri JOIN returns ret ON ret.id = ri.return_id
         WHERE ri.order_item_id = oi.id AND COALESCE(ret.status, 'completed') <> 'cancelled'
       )
     ORDER BY r.id ASC LIMIT 100`
  ).bind(orderId).all<{
    reservation_id: number; order_item_id: number; inventory_source: string;
    variant_id: number; product_id: number; quantity: number; stock_id: number;
  }>();
  let activated = 0;
  for (const row of pending.results || []) {
    const reservationId = Number(row.reservation_id);
    const itemId = Number(row.order_item_id);
    const stockId = Number(row.stock_id);
    const quantity = Number(row.quantity);
    if (![reservationId, itemId, stockId, quantity, Number(row.product_id), Number(row.variant_id)]
      .every(v => Number.isSafeInteger(v) && v > 0)) continue;
    // The order's state, original identity and return evidence are rechecked
    // in the same transaction as the stock claim; concurrent retry is harmless.
    const eligible = `EXISTS (
      SELECT 1 FROM inventory_reservations r
      JOIN order_items oi ON oi.id = r.order_item_id AND oi.order_id = r.order_id
      JOIN orders o ON o.id = r.order_id
      JOIN catalog_variants v ON v.id = r.variant_id AND v.product_id = r.product_id AND v.is_active = 1
      JOIN catalog_products p ON p.id = r.product_id AND p.is_active = 1
      WHERE r.id = ? AND r.order_id = ? AND r.order_item_id = ?
        AND r.status = 'unresolved' AND r.unresolved_reason = 'concurrent_shortage'
        AND r.inventory_source = inventory_stock.inventory_source
        AND r.variant_id = inventory_stock.variant_id
        AND r.product_id = ? AND r.variant_id = ? AND r.quantity = ?
        AND oi.product_id = r.product_id AND oi.variant_id = r.variant_id
        AND oi.quantity = r.quantity AND COALESCE(oi.is_workshop, 0) = 0
        AND oi.stock_writeoff_status = 'pending_reservation'
        AND COALESCE(o.shipping_status, 'not_sent') <> 'sent'
        AND COALESCE(o.order_status, 'active') = 'active'
        AND COALESCE(o.archived_at, '') = ''
        AND NOT EXISTS (
          SELECT 1 FROM return_items ri JOIN returns ret ON ret.id = ri.return_id
          WHERE ri.order_item_id = oi.id AND COALESCE(ret.status, 'completed') <> 'cancelled'
        )
    )`;
    await db.batch([
      db.prepare(
        `UPDATE inventory_stock
         SET reserved_quantity = COALESCE(reserved_quantity, 0) + ?,
             last_action = 'Резерв восстановлен', last_source_ref = ?, updated_at = ?
         WHERE id = ? AND quantity >= COALESCE(reserved_quantity, 0) + ?
           AND ` + eligible
      ).bind(
        quantity, 'order-item:' + itemId, timestamp, stockId, quantity,
        reservationId, orderId, itemId, Number(row.product_id), Number(row.variant_id), quantity,
      ),
      db.prepare(
        `UPDATE inventory_reservations
         SET status = CASE WHEN changes() = 1 THEN 'active' ELSE status END,
             unresolved_reason = CASE WHEN changes() = 1 THEN NULL ELSE unresolved_reason END,
             updated_at = CASE WHEN changes() = 1 THEN ? ELSE updated_at END
         WHERE id = ? AND order_id = ? AND order_item_id = ?
           AND status = 'unresolved' AND unresolved_reason = 'concurrent_shortage'`
      ).bind(timestamp, reservationId, orderId, itemId),
      db.prepare(
        `UPDATE order_items SET stock_writeoff_status = 'reserved',
             stock_quantity_before = NULL, stock_quantity_after = NULL
         WHERE id = ? AND order_id = ? AND stock_writeoff_status = 'pending_reservation'
           AND EXISTS (
             SELECT 1 FROM inventory_reservations r
             WHERE r.id = ? AND r.order_item_id = order_items.id AND r.status = 'active'
           )`
      ).bind(itemId, orderId, reservationId),
    ]);
    const persisted = await db.prepare(
      `SELECT status FROM inventory_reservations WHERE id = ? AND order_id = ? AND order_item_id = ?`
    ).bind(reservationId, orderId, itemId).first<{status:string}>();
    if (persisted?.status === 'active') activated += 1;
  }
  return { attempted: (pending.results || []).length, activated };
}
