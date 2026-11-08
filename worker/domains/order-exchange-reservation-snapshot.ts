import { cleanText, normalizeSourceType, toInt } from '../core/text.ts'
import type { SourceType } from '../core/types.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { releaseOrderReservationV2 } from './order-reservations.ts'

export type ReservationSnapshot = {
  id: number
  source: SourceType
  variantId: number | null
  quantity: number
  status: string
  targetQuantity: number
  targetStatus: string
}

export type ExchangeOldReservationPlan = { orderItemId: number; quantity: number; reservationSnapshot: ReservationSnapshot | null }

export async function loadReservationSnapshot(
  db: D1Database,
  orderItemId: number,
  selectedQuantity: number,
  initialQuantity: number,
): Promise<ReservationSnapshot | null> {
  const row = await db.prepare(
    `SELECT id, inventory_source, variant_id, quantity, status
     FROM inventory_reservations
     WHERE order_item_id = ?
     LIMIT 1`
  ).bind(orderItemId).first<Record<string, unknown>>()
  if (!row?.id) return null
  const status = cleanText(row.status)
  const quantity = Math.max(0, toInt(row.quantity, 0))
  const source = normalizeSourceType(row.inventory_source)
  const variantId = toInt(row.variant_id, 0) || null
  if (status === 'fulfilled') {
    throw new CriticalOperationConflictError('Позиция уже отмечена как физически выданная клиенту и не может быть оформлена как «не выдавалась».')
  }
  if (!['active', 'unresolved', 'released'].includes(status)) {
    throw new CriticalOperationConflictError('Резерв старой позиции изменился. Обновите заказ и повторите обмен.')
  }
  if (status === 'released') {
    throw new CriticalOperationConflictError('Резерв старой позиции уже снят другой операцией. Обновите заказ и повторите обмен.')
  }
  if (quantity !== initialQuantity) {
    throw new CriticalOperationConflictError('Количество в резерве старой позиции не совпадает с активным количеством заказа. Обновите заказ.')
  }
  const targetQuantity = Math.max(0, quantity - selectedQuantity)
  return {
    id: toInt(row.id, 0),
    source,
    variantId,
    quantity,
    status,
    targetQuantity,
    targetStatus: targetQuantity > 0 ? status : 'released',
  }
}

export async function applyNotIssuedReservationReduction(
  db: D1Database,
  plan: ExchangeOldReservationPlan,
  timestamp: string,
  externalOrderId: string,
) {
  const snapshot = plan.reservationSnapshot
  if (!snapshot) return
  if (snapshot.targetQuantity <= 0) {
    const released = await releaseOrderReservationV2(
      db,
      plan.orderItemId,
      timestamp,
      `Обмен без физической выдачи старой позиции ${externalOrderId}`,
    )
    if (!released) {
      const current = await db.prepare(
        `SELECT status FROM inventory_reservations WHERE id = ? LIMIT 1`
      ).bind(snapshot.id).first<{ status: string }>()
      if (cleanText(current?.status) !== 'released') {
        throw new CriticalOperationConflictError('Не удалось безопасно снять резерв невыданной позиции. Обновите заказ и повторите.')
      }
    }
    return
  }

  const current = await db.prepare(
    `SELECT quantity, status FROM inventory_reservations WHERE id = ? AND order_item_id = ? LIMIT 1`
  ).bind(snapshot.id, plan.orderItemId).first<Record<string, unknown>>()
  const currentQuantity = Math.max(0, toInt(current?.quantity, 0))
  const currentStatus = cleanText(current?.status)
  if (currentQuantity === snapshot.targetQuantity && currentStatus === snapshot.targetStatus) return
  if (currentQuantity !== snapshot.quantity || currentStatus !== snapshot.status) {
    throw new CriticalOperationConflictError('Резерв старой позиции изменился во время обмена. Операция остановлена.')
  }

  const statements: D1PreparedStatement[] = []
  if (snapshot.status === 'active' && snapshot.variantId) {
    statements.push(db.prepare(
      `UPDATE inventory_stock
       SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - ?),
           last_action = 'Резерв уменьшен обменом',
           last_source_ref = ?,
           updated_at = ?
       WHERE inventory_source = ? AND variant_id = ?`
    ).bind(
      plan.quantity,
      `exchange-set:${externalOrderId}:old:${plan.orderItemId}`,
      timestamp,
      snapshot.source,
      snapshot.variantId,
    ))
  }
  statements.push(
    db.prepare(
      `UPDATE inventory_reservations
       SET quantity = ?, updated_at = ?
       WHERE id = ? AND order_item_id = ? AND status = ? AND quantity = ?`
    ).bind(snapshot.targetQuantity, timestamp, snapshot.id, plan.orderItemId, snapshot.status, snapshot.quantity),
  )
  await db.batch(statements)
}
