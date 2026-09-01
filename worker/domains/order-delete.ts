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
  input: { requestId?: string; comment?: string; physicalOutcome?: 'not_issued' },
  actor: AuthUser | null = null,
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
  const fulfilledRows = humanInventoryModelEnabled
    ? await db.prepare(
      `SELECT r.id, r.order_item_id, r.inventory_source, r.product_id, r.variant_id, r.quantity, r.fulfilled_at
       FROM inventory_reservations r
       WHERE r.order_id = ? AND r.status = 'fulfilled'
       ORDER BY r.id ASC`
    ).bind(orderId).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] }
  const fulfilledReservations = fulfilledRows.results || []
  const shippingWasSent = normalizeShippingStatus((order as any).shipping_status) === 'sent'
  const physicalOutcome = cleanText(input.physicalOutcome).toLowerCase()
  const hasPhysicalHandoverMarker = humanInventoryModelEnabled && (shippingWasSent || fulfilledReservations.length > 0)
  if (hasPhysicalHandoverMarker && physicalOutcome !== 'not_issued') {
    const confirmationRequired = new CriticalOperationConflictError(
      'Заказ отмечен как выданный / отправленный. Если это ошибочная отметка и товар фактически НЕ передавался клиенту, подтвердите это — система сама отменит ложную выдачу и продолжит удаление. Если товар реально передавался, удаление остановлено: сначала нужно отразить фактический возврат товара.'
    )
    confirmationRequired.code = 'order_delete_physical_confirmation_required'
    throw confirmationRequired
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

  let falseShipmentRestoredQuantity = 0
  let falseShipmentFreshnessProtectedQuantity = 0
  if (hasPhysicalHandoverMarker && physicalOutcome === 'not_issued') {
    const restoreGroups = new Map<string, { source: string; variantId: number; quantity: number }>()
    for (const reservation of fulfilledReservations) {
      const variantId = toInt(reservation.variant_id, 0)
      const quantity = Math.max(0, toInt(reservation.quantity, 0))
      const source = cleanText(reservation.inventory_source)
      const fulfilledAt = cleanText(reservation.fulfilled_at)
      if (!variantId || !source || !quantity) {
        throw new CriticalOperationConflictError('Ложную выдачу нельзя отменить автоматически: у проведённого складского списания потеряна точная товарная связь. Система ничего не изменила; нужна фактическая сверка этой позиции.')
      }
      if (!fulfilledAt) {
        throw new CriticalOperationConflictError('Ложную выдачу нельзя отменить автоматически: у складского списания нет времени выдачи, поэтому система не может проверить более новую физическую сверку. Система ничего не изменила.')
      }
      await loadCanonicalVariantSnapshot(db, variantId)
      const activeStocktake = await db.prepare(
        `SELECT id FROM inventory_stocktake_sessions
         WHERE inventory_source = ? AND status = 'active'
         LIMIT 1`
      ).bind(source).first<{ id: string }>()
      if (activeStocktake?.id) {
        throw new CriticalOperationConflictError('Сейчас идёт ревизия этого склада. Ложную выдачу нельзя отменять параллельно с физическим пересчётом. Завершите или отмените ревизию и повторите удаление.')
      }
      const newerPhysicalTruth = await db.prepare(
        `SELECT 1 AS found
         WHERE EXISTS (
           SELECT 1 FROM inventory_stock_checks
           WHERE inventory_source = ? AND variant_id = ?
             AND datetime(checked_at) > datetime(?)
         ) OR EXISTS (
           SELECT 1 FROM inventory_stocktake_sessions
           WHERE inventory_source = ? AND status = 'completed'
             AND completed_at IS NOT NULL
             AND id NOT LIKE 'REV-%-P-%'
             AND datetime(completed_at) > datetime(?)
         )
         LIMIT 1`
      ).bind(source, variantId, fulfilledAt, source, fulfilledAt).first<{ found: number }>()
      if (newerPhysicalTruth?.found) {
        falseShipmentFreshnessProtectedQuantity += quantity
        continue
      }
      const key = `${source}:${variantId}`
      const current = restoreGroups.get(key)
      if (current) current.quantity += quantity
      else restoreGroups.set(key, { source, variantId, quantity })
    }

    for (const group of restoreGroups.values()) {
      const stock = await db.prepare(
        `SELECT id FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
      ).bind(group.source, group.variantId).first<{ id: number }>()
      if (!stock?.id) {
        throw new CriticalOperationConflictError('Ложную выдачу нельзя отменить автоматически: для одной из проведённых позиций больше нет строки физического остатка. Система ничего не изменила; укажите фактическое количество через сверку.')
      }
      falseShipmentRestoredQuantity += group.quantity
    }

    const timestamp = new Date().toISOString()
    const externalId = cleanText((order as any).external_id)
    const restorePayload = JSON.stringify(Array.from(restoreGroups.values()))
    const statements: D1PreparedStatement[] = []
    if (restoreGroups.size) {
      statements.push(
        db.prepare(
          `WITH x AS (
             SELECT CAST(json_extract(j.value, '$.source') AS TEXT) AS source,
                    CAST(json_extract(j.value, '$.variantId') AS INTEGER) AS variant_id,
                    CAST(json_extract(j.value, '$.quantity') AS INTEGER) AS quantity
             FROM json_each(?) j
           )
           INSERT INTO inventory_movements (
             inventory_source, movement_type, product_id, variant_id, product_name_snapshot, gender_snapshot,
             color_snapshot, material_snapshot, length_snapshot, size_snapshot, quantity_delta, quantity_after,
             reference_type, reference_id, comment, created_at
           )
           SELECT s.inventory_source, 'revision', s.product_id, s.variant_id, s.product_name_snapshot, s.gender_snapshot,
                  s.color_snapshot, s.material_snapshot, s.length_snapshot, s.size_snapshot,
                  x.quantity, s.quantity + x.quantity, 'order_delete_void', ?, ?, ?
           FROM x
           JOIN inventory_stock s ON s.inventory_source = x.source AND s.variant_id = x.variant_id`
        ).bind(
          restorePayload,
          externalId,
          `Отмена ложной физической выдачи перед удалением ошибочного заказа ${externalId}`,
          timestamp,
        ),
        db.prepare(
          `WITH x AS (
             SELECT CAST(json_extract(j.value, '$.source') AS TEXT) AS source,
                    CAST(json_extract(j.value, '$.variantId') AS INTEGER) AS variant_id,
                    CAST(json_extract(j.value, '$.quantity') AS INTEGER) AS quantity
             FROM json_each(?) j
           )
           UPDATE inventory_stock
           SET quantity = quantity + (
                 SELECT x.quantity FROM x
                 WHERE x.source = inventory_stock.inventory_source AND x.variant_id = inventory_stock.variant_id
               ),
               last_action = 'Отмена ошибочной выдачи',
               last_source_ref = ?,
               updated_at = ?
           WHERE EXISTS (
             SELECT 1 FROM x
             WHERE x.source = inventory_stock.inventory_source AND x.variant_id = inventory_stock.variant_id
           )`
        ).bind(restorePayload, `order-delete-void:${externalId}`, timestamp),
      )
    }
    statements.push(
      db.prepare(
        `UPDATE order_items
         SET stock_writeoff_status = 'reversed_delete'
         WHERE order_id = ?
           AND EXISTS (
             SELECT 1 FROM inventory_reservations r
             WHERE r.order_id = ? AND r.order_item_id = order_items.id AND r.status = 'fulfilled'
           )`
      ).bind(orderId, orderId),
      db.prepare(
        `UPDATE inventory_reservations
         SET status = 'released', released_at = ?, updated_at = ?
         WHERE order_id = ? AND status = 'fulfilled'`
      ).bind(timestamp, timestamp, orderId),
      db.prepare(
        `UPDATE orders
         SET shipping_status = 'not_sent', shipping_date = NULL, updated_at = ?
         WHERE id = ? AND shipping_status = 'sent'`
      ).bind(timestamp, orderId),
    )
    await db.batch(statements)
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
    actor ?? null,
    checkedBy,
  )
  return {
    ...result,
    autoCancelledReturns,
    autoCancelledExchanges,
    falseShipmentRestoredQuantity,
    falseShipmentFreshnessProtectedQuantity,
    message: [
      `Заказ ${externalId} удалён.`,
      autoCancelledReturns ? `Ошибочных возвратов автоматически отменено: ${autoCancelledReturns}.` : '',
      autoCancelledExchanges ? `Обменов автоматически отменено: ${autoCancelledExchanges}.` : '',
    ].filter(Boolean).join(' '),
  }
}
