// A dedicated, order-scoped way to resolve a known-SKU shortage after a
// competing save. No catalog recreation, arrival, physical stock adjustment
// or order-content rewrite is permitted in this path.
type PendingRow = {
  reservation_id: number; order_item_id: number; order_id: number;
  order_status: string; archived_at: string | null; shipping_status: string;
  stock_writeoff_status: string; is_workshop: number; item_quantity: number;
  item_source: string; item_variant_id: number | null;
  reservation_quantity: number; reservation_source: string;
  reservation_variant_id: number; reservation_status: string;
  unresolved_reason: string | null; reference_type: string; reference_id: string;
  stock_id: number | null; physical_quantity: number | null;
  reserved_quantity: number | null; external_id: string;
  product_name: string; returned_quantity: number;
}
export type PendingReservationSnapshot = {
  inventorySource: 'warehouse' | 'boutique';
  variantId: number;
  requestedQuantity: number;
  physicalQuantity: number;
  reservedQuantity: number;
}
export class PendingReservationError extends Error {
  code = 'pending_reservation_conflict';
  status = 409;
  snapshot: PendingReservationSnapshot | null;
  constructor(message: string, snapshot: PendingReservationSnapshot | null = null) {
    super(message);
    this.snapshot = snapshot;
  }
}
const qty = (n: unknown) => {
  const value = Number(n);
  return Number.isSafeInteger(value) ? value : 0;
}

// Only a live, still-unshipped replacement may reuse the shortage recovery
// path after a protected dispatch correction. The exchange itself is immutable.
const replacementGuard = `EXISTS(
  SELECT 1 FROM inventory_lifecycle_events le
  JOIN exchanges e ON e.id=le.operation_id AND e.order_id=le.order_id
  WHERE e.id=CAST(r.reference_id AS INTEGER) AND e.order_id=o.id
    AND COALESCE(e.status,'completed')<>'cancelled'
    AND le.operation_type='exchange' AND le.event_type='exchange_new_out'
    AND le.order_item_id=oi.id AND le.status='pending'
    AND le.pending_reason='awaiting_dispatch'
    AND le.variant_id=r.variant_id AND le.inventory_source=r.inventory_source
    AND le.quantity=r.quantity
    AND (e.new_order_item_id=oi.id OR EXISTS(
      SELECT 1 FROM exchange_items ei WHERE ei.exchange_id=e.id
        AND ei.role='new' AND ei.order_item_id=oi.id AND ei.id=le.operation_item_id
        AND ei.quantity=oi.quantity))
)`;

export async function inspectPendingReservation(db: D1Database, orderId: number, itemId: number) {
  const row = await db.prepare(
    `SELECT r.id AS reservation_id, oi.id AS order_item_id, o.id AS order_id,
            o.order_status, o.archived_at, o.shipping_status, o.external_id,
            oi.stock_writeoff_status, oi.is_workshop, oi.quantity AS item_quantity,
            oi.source_type AS item_source, oi.variant_id AS item_variant_id,
            oi.product_name_snapshot AS product_name,
            r.quantity AS reservation_quantity, r.inventory_source AS reservation_source,
            r.variant_id AS reservation_variant_id, r.status AS reservation_status,
            r.unresolved_reason, r.reference_type, r.reference_id,
            st.id AS stock_id, st.quantity AS physical_quantity,
            st.reserved_quantity,
            (SELECT COALESCE(SUM(ri.quantity),0) FROM return_items ri
              JOIN returns ret ON ret.id=ri.return_id
              WHERE ri.order_item_id=oi.id AND ret.status <> 'cancelled') AS returned_quantity
     FROM order_items oi
     JOIN orders o ON o.id=oi.order_id
     JOIN inventory_reservations r ON r.order_item_id=oi.id
     LEFT JOIN inventory_stock st
       ON st.inventory_source=r.inventory_source AND st.variant_id=r.variant_id
     WHERE o.id=? AND oi.id=? AND r.reference_type IN ('order','exchange_new')
     LIMIT 1`
  ).bind(orderId, itemId).first<PendingRow>();
  if (!row) throw new PendingReservationError('Резерв этой позиции не найден. Обновите заказ.');
  const isReplacement = row.reference_type === 'exchange_new';
  if (isReplacement) {
    const linked = await db.prepare(`SELECT r.id FROM inventory_reservations r
      JOIN order_items oi ON oi.id=r.order_item_id JOIN orders o ON o.id=oi.order_id
      WHERE r.id=? AND o.id=? AND oi.id=? AND ${replacementGuard}`)
      .bind(row.reservation_id,orderId,itemId).first<{id:number}>();
    if (!linked) throw new PendingReservationError('Обмен изменился или уже закрыт. Обновите заказ.');
  }
  if (row.reservation_status === 'active') {
    return { ok: true, alreadyResolved: true, pending: false, orderId, orderItemId:itemId };
  }
  if (row.reservation_status !== 'unresolved' || row.unresolved_reason !== 'concurrent_shortage'
    || row.stock_writeoff_status !== 'pending_reservation'
    || row.order_status === 'archived' || row.order_status === 'deleted'
    || Boolean(row.archived_at) || row.shipping_status === 'sent'
    || qty(row.is_workshop) !== 0 || qty(row.item_quantity) <= 0
    || qty(row.returned_quantity) > 0 || !row.stock_id
    || row.item_source !== row.reservation_source
    || row.item_variant_id !== row.reservation_variant_id
    || qty(row.item_quantity) !== qty(row.reservation_quantity)) {
    throw new PendingReservationError(
      'Позиция изменилась, отправлена или связана с возвратом. Обновите заказ и разберите её отдельно.',
    );
  }
  const source = row.reservation_source === 'boutique' ? 'boutique' : 'warehouse';
  const snapshot: PendingReservationSnapshot = {
    inventorySource: source,
    variantId: qty(row.reservation_variant_id),
    requestedQuantity: qty(row.item_quantity),
    physicalQuantity: Math.max(0, qty(row.physical_quantity)),
    reservedQuantity: Math.max(0, qty(row.reserved_quantity)),
  };
  if (!snapshot.variantId) throw new PendingReservationError('Не установлен точный вариант товара. Требуется разбор каталога.');
  return {
    ok:true, pending:true, alreadyResolved:false, orderId, orderItemId:itemId,
    reservationId:qty(row.reservation_id), stockId:qty(row.stock_id),
    externalId:row.external_id, productName:row.product_name, isReplacement,
    snapshot, freeQuantity:snapshot.physicalQuantity-snapshot.reservedQuantity,
    shortage:Math.max(0,snapshot.requestedQuantity-(snapshot.physicalQuantity-snapshot.reservedQuantity)),
  };
}

export async function resolvePendingReservation(
  db: D1Database, orderId: number, itemId: number,
  input: { snapshot?: PendingReservationSnapshot; allowShortage?: boolean },
  actor: { id: number; displayName: string },
) {
  const preview = await inspectPendingReservation(db,orderId,itemId);
  if (preview.alreadyResolved) return preview;
  if (!preview.pending || !preview.snapshot || !preview.reservationId || !preview.stockId) {
    throw new PendingReservationError('Не удалось определить актуальное состояние резерва.');
  }
  const snap = preview.snapshot;
  const expected = input.snapshot;
  if (!expected || expected.inventorySource !== snap.inventorySource
    || expected.variantId !== snap.variantId
    || expected.requestedQuantity !== snap.requestedQuantity
    || expected.physicalQuantity !== snap.physicalQuantity
    || expected.reservedQuantity !== snap.reservedQuantity) {
    throw new PendingReservationError('Остаток изменился. Проверьте новые значения перед подтверждением.',snap);
  }
  if (preview.shortage > 0 && input.allowShortage !== true) {
    throw new PendingReservationError('Свободного количества недостаточно. Нужно отдельное подтверждение нехватки.',snap);
  }
  const timestamp=new Date().toISOString();
  const auditDetails=JSON.stringify({
    actorId:actor.id, actor:actor.displayName, decision:input.allowShortage===true?'confirmed_shortage':'free_stock',
    source:snap.inventorySource,variantId:snap.variantId,
    requested:snap.requestedQuantity,physical:snap.physicalQuantity,reserved:snap.reservedQuantity,
  });
  // One batch: the guarded stock write, conditional transition of exactly one
  // pending reservation, corresponding item, and durable audit event.
  // If the snapshot changes, not one active reservation or evidence row is created.
  const writes=[
    db.prepare(
      `UPDATE inventory_stock
       SET reserved_quantity=COALESCE(reserved_quantity,0)+?,updated_at=?,
           last_action='Разбор резерва заказа',last_source_ref=?
       WHERE id=? AND inventory_source=? AND variant_id=?
         AND quantity=? AND COALESCE(reserved_quantity,0)=?
         AND (?=1 OR quantity>=COALESCE(reserved_quantity,0)+?)
         AND EXISTS(
           SELECT 1 FROM inventory_reservations r
           JOIN order_items oi ON oi.id=r.order_item_id
           JOIN orders o ON o.id=oi.order_id
           WHERE r.id=? AND r.order_item_id=? AND r.order_id=?
             AND r.status='unresolved' AND r.unresolved_reason='concurrent_shortage'
             AND r.reference_type='${preview.isReplacement ? 'exchange_new' : 'order'}'
             AND r.quantity=? AND oi.quantity=r.quantity
             AND oi.variant_id=r.variant_id AND oi.source_type=r.inventory_source
             AND oi.stock_writeoff_status='pending_reservation'
             AND COALESCE(oi.is_workshop,0)=0
             AND COALESCE(o.shipping_status,'not_sent')<>'sent'
             AND COALESCE(o.order_status,'active') NOT IN ('deleted','archived')
             AND COALESCE(o.archived_at,'')=''
             AND NOT EXISTS(SELECT 1 FROM return_items ri JOIN returns ret
               ON ret.id=ri.return_id WHERE ri.order_item_id=oi.id
               AND ret.status<>'cancelled')
             ${preview.isReplacement ? `AND ${replacementGuard}` : ''}
         )`
    ).bind(snap.requestedQuantity,timestamp,'order:'+orderId,
      preview.stockId,snap.inventorySource,snap.variantId,
      snap.physicalQuantity,snap.reservedQuantity,
      input.allowShortage===true?1:0,snap.requestedQuantity,
      preview.reservationId,itemId,orderId,snap.requestedQuantity),
    db.prepare(
      `UPDATE inventory_reservations
       SET status='active',unresolved_reason=NULL,updated_at=?
       WHERE id=? AND order_id=? AND order_item_id=?
         AND status='unresolved' AND unresolved_reason='concurrent_shortage'
         AND changes()=1`
    ).bind(timestamp,preview.reservationId,orderId,itemId),
    db.prepare(
      `UPDATE order_items SET stock_writeoff_status='reserved',
          stock_quantity_before=NULL,stock_quantity_after=NULL
       WHERE id=? AND order_id=? AND stock_writeoff_status='pending_reservation'
         AND EXISTS(SELECT 1 FROM inventory_reservations
           WHERE id=? AND status='active')`
    ).bind(itemId,orderId,preview.reservationId),
    db.prepare(
      `INSERT INTO activity_log
       (event_type,entity_type,entity_id,order_id,external_order_id,title,details,amount,created_at)
       SELECT 'order_pending_reservation_resolved','order_item',?,?,
              ?,'Подтверждён резерв заказа',?,0,?
       WHERE changes()=1 AND EXISTS(SELECT 1 FROM inventory_reservations r
         JOIN order_items oi ON oi.id=r.order_item_id
         WHERE r.id=? AND r.status='active'
           AND oi.stock_writeoff_status='reserved')`
    ).bind(itemId,orderId,preview.externalId,auditDetails,timestamp,preview.reservationId),
  ];
  const results=await db.batch(writes);
  const changed=qty(results[0]?.meta?.changes);
  if (changed!==1) {
    throw new PendingReservationError('Остаток или заказ изменились. Повторно проверьте значения.',snap);
  }
  const current=await inspectPendingReservation(db,orderId,itemId);
  if (!current.alreadyResolved) {
    throw new PendingReservationError('Результат подтверждения не совпал с записью. Требуется проверка заказа.');
  }
  return {ok:true,alreadyResolved:false,resolved:true,orderId,orderItemId:itemId};
}
