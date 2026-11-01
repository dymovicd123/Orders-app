import { cleanText, normalizeOrderStatus, normalizeShippingStatus, toInt } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import { CriticalOperationConflictError } from './critical.ts'

/**
 * Correct only the last full-order "sent" marker when an earlier partial handover
 * and a completed standalone Return have already occurred. Those past physical
 * movements and Returns are independent facts and must NEVER be undone here.
 *
 * This narrow path is intentionally unavailable when the last send performed a
 * warehouse issue. In that case a future item-scoped physical undo is needed.
 */
export async function correctShippingMarkerAfterStandaloneReturn(
  db: D1Database,
  orderId: number,
  input: { actor?: string } = {},
) {
  const order = await db.prepare(
    `SELECT id, external_id, shipping_status, order_status, archived_at
     FROM orders WHERE id = ? LIMIT 1`,
  ).bind(orderId).first<Record<string, unknown>>()
  if (!order?.id) throw new CriticalOperationConflictError('Заказ не найден.')
  if (normalizeOrderStatus(order.order_status) === 'deleted'
    || normalizeOrderStatus(order.order_status) === 'archived' || cleanText(order.archived_at)) {
    throw new CriticalOperationConflictError('Архивный или удалённый заказ нельзя исправлять в текущих операциях.')
  }
  if (normalizeShippingStatus(order.shipping_status) !== 'sent') {
    return {
      ok: true, alreadyCorrected: true, statusOnly: true,
      restoredPhysicalQuantity: 0, freshnessProtectedQuantity: 0, reactivatedReservations: 0,
    }
  }
  const externalId = cleanText(order.external_id)
  const lastShipping = await db.prepare(
    `SELECT created_at FROM activity_log
     WHERE order_id = ? AND event_type = 'order_shipping_updated'
     ORDER BY created_at DESC, id DESC LIMIT 1`,
  ).bind(orderId).first<{ created_at: string }>()
  const lastShippingAt = cleanText(lastShipping?.created_at)
  if (!lastShippingAt) {
    throw new CriticalOperationConflictError(
      'Нельзя установить, какие складские движения относятся к последней отправке. Предыдущие выдачи и возвраты не изменены. Требуется точечное исправление отправки.',
    )
  }

  // The full-send handler stamps fulfilled reservations and sale movements with
  // exactly the same ISO timestamp as order_shipping_updated. Early handovers
  // have an older timestamp; no inference from a coarse shipping DATE is allowed.
  const committedFinalPhysical = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM inventory_reservations
        WHERE order_id = ? AND status = 'fulfilled'
          AND (fulfilled_at IS NULL OR julianday(fulfilled_at) >= julianday(?))) AS reservations,
       (SELECT COUNT(*) FROM inventory_movements
        WHERE reference_id = ? AND movement_type = 'sale'
          AND (created_at IS NULL OR julianday(created_at) >= julianday(?))) AS movements`,
  ).bind(orderId, lastShippingAt, externalId, lastShippingAt).first<{
    reservations: number; movements: number;
  }>()
  if (toInt(committedFinalPhysical?.reservations, 0) || toInt(committedFinalPhysical?.movements, 0)) {
    throw new CriticalOperationConflictError(
      'Последняя отправка действительно списала складские вещи. Общую отметку нельзя снять как только статус: нужно исправить точную последнюю выдачу, не трогая оформленный возврат.',
    )
  }

  // One atomic update with the same evidence checks protects against another
  // worker completing a physical issue between the preflight and correction.
  const timestamp = new Date().toISOString()
  const update = await db.prepare(
    `UPDATE orders
     SET shipping_status = 'not_sent', shipping_date = NULL, updated_at = ?
     WHERE id = ? AND shipping_status = 'sent'
       AND EXISTS (
         SELECT 1 FROM activity_log a
         WHERE a.order_id = orders.id AND a.event_type = 'order_shipping_updated'
           AND a.created_at = ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM inventory_reservations r
         WHERE r.order_id = orders.id AND r.status = 'fulfilled'
           AND (r.fulfilled_at IS NULL OR julianday(r.fulfilled_at) >= julianday(?))
       )
       AND NOT EXISTS (
         SELECT 1 FROM inventory_movements m
         WHERE m.reference_id = orders.external_id AND m.movement_type = 'sale'
           AND (m.created_at IS NULL OR julianday(m.created_at) >= julianday(?))
       )`,
  ).bind(timestamp, orderId, lastShippingAt, lastShippingAt, lastShippingAt).run()
  if (toInt(update.meta?.changes, 0) !== 1) {
    throw new CriticalOperationConflictError(
      'Состояние заказа изменилось во время исправления. Обновите заказ: повторного складского движения не было.',
    )
  }
  try {
    await writeActivityLog(db, {
      eventType: 'order_partial_final_shipping_corrected',
      entityType: 'order',
      entityId: orderId,
      orderId,
      externalOrderId: externalId,
      title: `Исправлена последняя полная отправка заказа ${externalId}`,
      details: `Последняя отправка не проводила новых складских списаний. Ранние выдачи и оформленные возвраты сохранены. Фактически последнюю часть клиенту не передавали. Исполнитель: ${cleanText(input.actor) || 'не записан'}.`,
      createdAt: timestamp,
    })
  } catch (error) {
    console.warn('Scoped shipping correction activity log failed', error)
  }
  return {
    ok: true, statusOnly: true,
    restoredPhysicalQuantity: 0, freshnessProtectedQuantity: 0, reactivatedReservations: 0,
    preservedEarlierIssuesAndReturns: true,
  }
}
