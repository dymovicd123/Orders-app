import { cleanText, isArchivedOrder, normalizeOrderStatus, normalizeShippingStatus, toInt } from '../core/text.ts'
import type { AuthUser } from '../core/types.ts'
import { isHumanInventoryModelEnabled, loadCanonicalVariantSnapshot } from './catalog.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { restoreArchivedOrder } from './orders-read.ts'
import { getOrder, updateOrderCritical } from './orders-write.ts'
import { cancelExchange, cancelReturn } from './returns-exchanges.ts'

export async function deleteOrderSafely(
  db: D1Database,
  orderId: number,
  input: { requestId?: string; comment?: string },
  actor?: AuthUser | null,
  checkedBy = '',
) {
  if (!orderId) throw new CriticalOperationConflictError('Заказ не найден. Обновите список и повторите действие.')
  const requestId = cleanText(input.requestId) || `order-delete-${orderId}-${crypto.randomUUID()}`
  let order = await getOrder(db, orderId)
  if (!order) throw new CriticalOperationConflictError('Заказ не найден. Возможно, он уже был удалён.')
  if (normalizeOrderStatus((order as any).order_status) === 'deleted') {
    return { ok: true, alreadyDeleted: true, autoCancelledReturns: 0, autoCancelledExchanges: 0, refreshRequired: true, message: 'Заказ уже удалён.' }
  }

  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db)
  if (humanInventoryModelEnabled) {
    const fulfilled = await db.prepare(
      `SELECT COUNT(*) AS count FROM inventory_reservations WHERE order_id = ? AND status = 'fulfilled'`
    ).bind(orderId).first<{ count: number }>()
    if (normalizeShippingStatus((order as any).shipping_status) === 'sent' || toInt(fulfilled?.count, 0) > 0) {
      throw new CriticalOperationConflictError(
        'Этот заказ уже физически выдавался клиенту. Система ничего не изменила: такой заказ нельзя просто стереть вместе с движением товара. Если заказ ошибочный, сначала зафиксируйте фактический возврат товара; отдельный сценарий аннулирования после полного возврата будет разбираться без ожидания администратора.'
      )
    }
  }

  const activeExchangeRows = await db.prepare(
    `SELECT e.id, e.old_order_item_id, e.new_order_item_id, e.old_return_source,
            old_item.id AS old_item_exists,
            new_item.id AS new_item_exists,
            COALESCE(new_item.is_workshop, 0) AS new_is_workshop
     FROM exchanges e
     LEFT JOIN order_items old_item ON old_item.id = e.old_order_item_id AND old_item.order_id = e.order_id
     LEFT JOIN order_items new_item ON new_item.id = e.new_order_item_id AND new_item.order_id = e.order_id
     WHERE e.order_id = ? AND COALESCE(e.status, 'completed') <> 'cancelled'
     ORDER BY e.id DESC`
  ).bind(orderId).all<Record<string, unknown>>()
  const activeExchanges = activeExchangeRows.results || []
  for (const exchange of activeExchanges) {
    const exchangeId = toInt(exchange.id, 0)
    if (!exchangeId || !toInt(exchange.old_item_exists, 0)) {
      throw new CriticalOperationConflictError('Удаление остановлено без изменений: у одного из обменов потеряна исходная позиция. Нужна точечная проверка истории, а не угадывание остатка.')
    }
    const oldReturnSource = cleanText(exchange.old_return_source)
    if (oldReturnSource && oldReturnSource !== 'none') {
      const oldLifecycle = await db.prepare(
        `SELECT id FROM inventory_lifecycle_events
         WHERE operation_type = 'exchange' AND operation_id = ? AND event_type = 'exchange_old_in'
         LIMIT 1`
      ).bind(exchangeId).first<{ id: number }>()
      if (!oldLifecycle?.id) {
        throw new CriticalOperationConflictError(`Удаление остановлено без изменений: обмен #${exchangeId} содержит старое складское действие без надёжной lifecycle-связи.`)
      }
    }
    if (toInt(exchange.new_item_exists, 0) && !toInt(exchange.new_is_workshop, 0)) {
      const newLifecycle = await db.prepare(
        `SELECT id FROM inventory_lifecycle_events
         WHERE operation_type = 'exchange' AND operation_id = ? AND event_type = 'exchange_new_out'
         LIMIT 1`
      ).bind(exchangeId).first<{ id: number }>()
      if (!newLifecycle?.id) {
        throw new CriticalOperationConflictError(`Удаление остановлено без изменений: обмен #${exchangeId} не имеет надёжной связи с физическим списанием новой позиции.`)
      }
    }
  }

  const unsafeReturn = await db.prepare(
    `SELECT r.id, ri.product_name_snapshot
     FROM returns r
     JOIN return_items ri ON ri.return_id = r.id
     WHERE r.order_id = ?
       AND COALESCE(r.status, 'completed') <> 'cancelled'
       AND ri.restocked = 1
       AND ri.inventory_source IN ('warehouse', 'boutique')
       AND NOT EXISTS (
         SELECT 1 FROM inventory_lifecycle_events le
         WHERE le.operation_type = 'return' AND le.operation_id = r.id AND le.operation_item_id = ri.id
       )
     LIMIT 1`
  ).bind(orderId).first<Record<string, unknown>>()
  if (unsafeReturn?.id) {
    throw new CriticalOperationConflictError(
      `Удаление остановлено без изменений: возврат #${toInt(unsafeReturn.id, 0)} содержит старое складское движение без надёжной связи с каталогом (${cleanText(unsafeReturn.product_name_snapshot) || 'позиция'}).`
    )
  }

  const appliedLifecycle = await db.prepare(
    `SELECT le.id, le.variant_id, le.event_key
     FROM inventory_lifecycle_events le
     WHERE le.status = 'applied'
       AND (
         (le.operation_type = 'return' AND le.operation_id IN (
           SELECT id FROM returns WHERE order_id = ? AND COALESCE(status, 'completed') <> 'cancelled'
         ))
         OR
         (le.operation_type = 'exchange' AND le.operation_id IN (
           SELECT id FROM exchanges WHERE order_id = ? AND COALESCE(status, 'completed') <> 'cancelled'
         ))
       )
     ORDER BY le.id ASC`
  ).bind(orderId, orderId).all<Record<string, unknown>>()
  for (const lifecycle of appliedLifecycle.results || []) {
    const variantId = toInt(lifecycle.variant_id, 0)
    if (!variantId) {
      throw new CriticalOperationConflictError(`Удаление остановлено без изменений: складское событие ${cleanText(lifecycle.event_key) || lifecycle.id} не связано с точной вариацией товара.`)
    }
    await loadCanonicalVariantSnapshot(db, variantId)
  }

  if (isArchivedOrder(order)) {
    const restored = await restoreArchivedOrder(db, orderId, cleanText(actor?.displayName || actor?.email) || checkedBy || 'employee')
    if (!(restored as any).ok) throw new CriticalOperationConflictError(cleanText((restored as any).message) || 'Не удалось безопасно вернуть заказ из архива перед удалением.')
    order = await getOrder(db, orderId)
    if (!order) throw new CriticalOperationConflictError('Заказ не загрузился после выхода из архива. Повторите удаление — повтор безопасен.')
  }

  let autoCancelledExchanges = 0
  for (const exchange of activeExchanges) {
    const exchangeId = toInt(exchange.id, 0)
    await cancelExchange(db, exchangeId, {
      requestId: `${requestId}:exchange:${exchangeId}`,
      comment: `Автоматически отменено перед удалением ошибочного заказа ${(order as any).external_id}`,
    })
    autoCancelledExchanges += 1
  }

  const activeReturns = await db.prepare(
    `SELECT id FROM returns
     WHERE order_id = ? AND COALESCE(status, 'completed') <> 'cancelled'
     ORDER BY id DESC`
  ).bind(orderId).all<{ id: number }>()
  let autoCancelledReturns = 0
  for (const ret of activeReturns.results || []) {
    const returnId = toInt(ret.id, 0)
    await cancelReturn(db, returnId, {
      requestId: `${requestId}:return:${returnId}`,
      comment: `Автоматически отменено перед удалением ошибочного заказа ${(order as any).external_id}`,
    })
    autoCancelledReturns += 1
  }

  const externalId = cleanText((order as any).external_id)
  const result = await updateOrderCritical(
    db,
    orderId,
    {
      requestId: `${requestId}:order`,
      orderStatus: 'deleted',
      comment: cleanText(input.comment) || `Ошибочный заказ ${externalId} удалён сотрудником`,
    },
    actor,
    checkedBy,
  )
  return {
    ...result,
    autoCancelledReturns,
    autoCancelledExchanges,
    message: [
      `Заказ ${externalId} удалён.`,
      autoCancelledReturns ? `Ошибочных возвратов автоматически отменено: ${autoCancelledReturns}.` : '',
      autoCancelledExchanges ? `Обменов автоматически отменено: ${autoCancelledExchanges}.` : '',
    ].filter(Boolean).join(' '),
  }
}
