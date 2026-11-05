import { cleanText, toInt } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import { CriticalOperationConflictError } from './critical.ts'

/**
 * Old "Выдать готовые товары" operations may have already consumed stock,
 * while the order-wide shipping marker is still not_sent. Confirm ONLY the
 * customer-facing shipping status, without a second stock or reservation write.
 * This is intentionally all-lines-only until mixed prior issues are represented
 * safely in the selective dispatch ledger.
 */
export async function confirmPriorIssuedOrderShipping(
  db: D1Database,
  orderId: number,
  input: { shippingDate: string; actor: string },
) {
  const now = new Date().toISOString()
  const proposed = cleanText(input.shippingDate)
  const shippingDate = /^\d{4}-\d{2}-\d{2}$/.test(proposed) ? proposed : now.slice(0, 10)

  // The entire proof is in the UPDATE predicate, not only in a stale GET plan.
  // No stock, reservation, movement, or order_item row is ever updated here.
  const result = await db.prepare(`
    UPDATE orders SET shipping_status='sent', shipping_date=?, updated_at=?
    WHERE id=? AND COALESCE(shipping_status,'not_sent')<>'sent'
      AND COALESCE(order_status,'') NOT IN ('deleted','archived')
      AND COALESCE(archived_at,'')=''
      AND EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id=orders.id AND oi.quantity>0
      )
      AND NOT EXISTS (
        SELECT 1 FROM order_dispatches d WHERE d.order_id=orders.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM exchanges e WHERE e.order_id=orders.id
          AND COALESCE(e.status,'completed')<>'cancelled'
      )
      AND NOT EXISTS (
        SELECT 1 FROM order_items oi
        WHERE oi.order_id=orders.id AND oi.quantity>0
          AND (
            COALESCE(oi.is_workshop,0)<>0
            OR COALESCE(oi.stock_writeoff_status,'')<>'fulfilled'
            OR (SELECT COUNT(*) FROM inventory_reservations r
                WHERE r.order_id=oi.order_id AND r.order_item_id=oi.id
                  AND r.status='fulfilled' AND r.quantity=oi.quantity)<>1
            OR EXISTS (SELECT 1 FROM inventory_reservations r
                WHERE r.order_item_id=oi.id AND r.status='active')
            OR EXISTS (
                SELECT 1 FROM return_items ri
                JOIN returns rt ON rt.id=ri.return_id
                WHERE rt.order_id=orders.id AND ri.order_item_id=oi.id
                  AND ri.quantity>0 AND COALESCE(rt.status,'completed')<>'cancelled'
            )
            OR EXISTS (
                SELECT 1 FROM inventory_lifecycle_events le
                WHERE le.order_id=orders.id AND le.order_item_id=oi.id
                  AND le.status='pending'
            )
          )
      )
  `).bind(shippingDate, now, orderId).run()

  if (toInt(result.meta?.changes, 0) !== 1) {
    throw new CriticalOperationConflictError(
      'Не все товары подтверждены как ранее выданные, либо заказ изменился. Обновите отправку. Повторного списания не было.',
    )
  }

  try {
    await writeActivityLog(db, {
      eventType: 'order_prior_issued_shipping_confirmed',
      entityType: 'order',
      entityId: orderId,
      orderId,
      title: 'Подтверждена отправка ранее выданных товаров',
      details: `Отмечено отправленным без повторного списания и изменения складских резервов. Исполнитель: ${cleanText(input.actor) || 'не указан'}.`,
      createdAt: now,
    })
  } catch (error) {
    console.warn('Prior-issued shipping activity log failed', error)
  }

  return { ok: true, statusOnly: true, stockDeducted: 0 }
}
