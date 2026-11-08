// Correction of an incorrectly marked shipment where an Exchange has replaced
// the current order item. This module owns the compensation workflow only;
// Return/Exchange creation and finance remain in returns-exchanges.ts.
import { cleanText, normalizeSourceType, toInt } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { cancelInventoryLifecycleEvent } from './lifecycle.ts'
import { correctMistakenOrderHandover } from './order-reservations.ts'
import { readStandaloneItemReturnBlocker } from './order-delete-return-blocker.ts'
import { correctShippingMarkerAfterStandaloneReturn } from './order-shipping-scoped-correction.ts'

export async function correctMistakenOrderHandoverWithCurrentExchange(
  db: D1Database,
  orderId: number,
  input: { physicalOutcome?: unknown; actor?: string } = {},
) {
  if (!orderId) throw new Error('Заказ не найден.');
  if (cleanText(input.physicalOutcome).toLowerCase() !== 'not_issued') {
    throw new Error('Снять отметку «Отправлен» можно только после подтверждения, что текущий товар фактически НЕ передавался клиенту.');
  }

  // A past standalone physical Return does not prohibit correcting a later
  // mistaken status-only send. Never replay or undo the older Return movement.
  const standaloneReturn = await readStandaloneItemReturnBlocker(db, orderId)
  if (standaloneReturn) {
    const activeExchange = await db.prepare(
      `SELECT EXISTS(SELECT 1 FROM exchanges e
        WHERE e.order_id = ? AND COALESCE(e.status,'completed') <> 'cancelled') AS active_exchange`,
    ).bind(orderId).first<{ active_exchange: number }>()
    if (toInt(activeExchange?.active_exchange, 0)) {
      throw new CriticalOperationConflictError('В заказе одновременно возврат и обмен. Для исправления выберите конкретную отправку.')
    }
    return correctShippingMarkerAfterStandaloneReturn(db, orderId, { actor: input.actor })
  }
  const downstream = await db.prepare(
    `SELECT
       EXISTS(
         SELECT 1
         FROM returns r
         JOIN return_items ri ON ri.return_id = r.id AND COALESCE(ri.quantity, 0) > 0
         WHERE r.order_id = ?
           AND COALESCE(r.status, 'completed') <> 'cancelled'
           AND NOT EXISTS (
             SELECT 1 FROM exchanges linked_exchange
             WHERE linked_exchange.refund_return_id = r.id
               AND COALESCE(linked_exchange.status, 'completed') <> 'cancelled'
           )
       ) AS has_item_return,
       EXISTS(
         SELECT 1 FROM exchanges e
         WHERE e.order_id = ? AND COALESCE(e.status, 'completed') <> 'cancelled'
       ) AS has_exchange`
  ).bind(orderId, orderId).first<{ has_item_return: number; has_exchange: number }>();

  if (toInt(downstream?.has_item_return, 0)) {
    throw new Error('По текущему товару уже проведён отдельный возврат. Сначала исправьте сам возврат: он изменил физическую историю и не должен переписываться снятием отметки отправки.');
  }
  if (!toInt(downstream?.has_exchange, 0)) {
    return await correctMistakenOrderHandover(db, orderId, input);
  }

  const currentRows = await db.prepare(
    `SELECT e.id AS exchange_id, e.new_order_item_id,
            oi.quantity AS current_quantity, oi.is_workshop,
            le.id AS lifecycle_id, le.status AS lifecycle_status,
            le.variant_id AS lifecycle_variant_id, le.quantity AS lifecycle_quantity,
            r.id AS reservation_id, r.status AS reservation_status,
            r.inventory_source AS reservation_source, r.product_id AS reservation_product_id,
            r.variant_id AS reservation_variant_id, r.quantity AS reservation_quantity
     FROM exchanges e
     JOIN order_items oi ON oi.id = e.new_order_item_id AND oi.order_id = e.order_id
     LEFT JOIN inventory_lifecycle_events le ON le.id = (
       SELECT candidate.id
       FROM inventory_lifecycle_events candidate
       WHERE candidate.operation_type = 'exchange'
         AND candidate.operation_id = e.id
         AND candidate.event_type = 'exchange_new_out'
         AND candidate.order_item_id = e.new_order_item_id
       ORDER BY candidate.id DESC
       LIMIT 1
     )
     LEFT JOIN inventory_reservations r ON r.order_item_id = e.new_order_item_id
     WHERE e.order_id = ?
       AND COALESCE(e.status, 'completed') <> 'cancelled'
       AND oi.quantity > 0
     ORDER BY e.id ASC`
  ).bind(orderId).all<Record<string, unknown>>();
  const currentExchangeRows = currentRows.results || [];
  const currentExchangeItemIds = Array.from(new Set(currentExchangeRows.map(row => toInt(row.new_order_item_id, 0)).filter(Boolean)));

  // First validate every non-exchange current position. Nothing is mutated during this pass.
  await correctMistakenOrderHandover(db, orderId, {
    ...input,
    allowCommittedExchangeCurrentTruth: true,
    excludeOrderItemIds: currentExchangeItemIds,
    preflightOnly: true,
  });

  // Then validate the current replacement positions. We intentionally reject partial/chained
  // quantities here rather than guessing how much of an old exchange lifecycle event is still current.
  for (const row of currentExchangeRows) {
    if (toInt(row.is_workshop, 0)) continue;
    const itemId = toInt(row.new_order_item_id, 0);
    const currentQuantity = Math.max(0, toInt(row.current_quantity, 0));
    const lifecycleId = toInt(row.lifecycle_id, 0);
    const lifecycleStatus = cleanText(row.lifecycle_status);
    const lifecycleQuantity = Math.max(0, toInt(row.lifecycle_quantity, 0));
    const reservationId = toInt(row.reservation_id, 0);
    const reservationQuantity = Math.max(0, toInt(row.reservation_quantity, 0));
    if (!itemId || !currentQuantity || !lifecycleId || !reservationId) {
      throw new Error('У текущей обменённой позиции нет полной безопасной связи со складским событием и резервом. Система ничего не изменила; нужна точечная проверка этой позиции.');
    }
    if (!['applied', 'pending', 'cancelled'].includes(lifecycleStatus)) {
      throw new Error('У текущей обменённой позиции неизвестное состояние складского события. Система ничего не изменила.');
    }
    if (lifecycleQuantity !== currentQuantity || reservationQuantity !== currentQuantity) {
      throw new Error('Текущая позиция участвует в частичной или цепочной замене. Автоматически снимать отправку нельзя: нужно сначала точно определить количество текущего товара, чтобы не задвоить остаток.');
    }
    if (lifecycleStatus === 'applied' && !toInt(row.lifecycle_variant_id, 0)) {
      throw new Error('У проведённой выдачи обмена отсутствует каноническая складская комбинация. Система ничего не изменила.');
    }
    const reservationVariantId = toInt(row.reservation_variant_id, 0);
    if (reservationVariantId) {
      const stock = await db.prepare(
        `SELECT id FROM inventory_stock
         WHERE inventory_source = ? AND variant_id = ?
         ORDER BY id ASC LIMIT 1`
      ).bind(normalizeSourceType(row.reservation_source), reservationVariantId).first<{ id: number }>();
      if (!stock?.id) {
        throw new Error('Для текущей обменённой позиции больше нет строки физического остатка. Система ничего не изменила; нужна точечная сверка.');
      }
    }
  }

  const timestamp = new Date().toISOString();
  let reopenedExchangeItems = 0;
  let protectedExchangePhysicalTruth = 0;

  for (const row of currentExchangeRows) {
    if (toInt(row.is_workshop, 0)) continue;
    const itemId = toInt(row.new_order_item_id, 0);
    const lifecycleId = toInt(row.lifecycle_id, 0);
    const lifecycleStatus = cleanText(row.lifecycle_status);
    const reservationId = toInt(row.reservation_id, 0);
    const reservationQuantity = Math.max(1, toInt(row.reservation_quantity, 1));
    const reservationSource = normalizeSourceType(row.reservation_source);
    const reservationProductId = toInt(row.reservation_product_id, 0) || null;
    const reservationVariantId = toInt(row.reservation_variant_id, 0) || null;

    if (lifecycleStatus !== 'cancelled') {
      const reversed = await cancelInventoryLifecycleEvent(
        db,
        lifecycleId,
        timestamp,
        `Снята ошибочная отметка «Отправлен»: текущая позиция обмена #${toInt(row.exchange_id, 0)} остаётся товаром заказа и снова ожидает выдачи.`,
      );
      if (reversed?.physicalReversalSkipped) protectedExchangePhysicalTruth += reservationQuantity;
    }

    if (reservationVariantId) {
      await db.batch([
        db.prepare(
          `UPDATE inventory_stock
           SET reserved_quantity = COALESCE(reserved_quantity, 0) + ?,
               last_action = 'Резерв восстановлен после снятия ошибочной отправки',
               last_source_ref = ?, updated_at = ?
           WHERE inventory_source = ? AND variant_id = ?
             AND EXISTS (
               SELECT 1 FROM inventory_reservations
               WHERE id = ? AND status <> 'active'
             )`
        ).bind(
          reservationQuantity,
          `order-handover-correction:${orderId}:exchange-current`,
          timestamp,
          reservationSource,
          reservationVariantId,
          reservationId,
        ),
        db.prepare(
          `UPDATE inventory_reservations
           SET product_id = ?, variant_id = ?, status = 'active', unresolved_reason = NULL,
               fulfilled_at = NULL, released_at = NULL, updated_at = ?
           WHERE id = ? AND status <> 'active'`
        ).bind(reservationProductId, reservationVariantId, timestamp, reservationId),
        db.prepare(
          `UPDATE order_items
           SET stock_writeoff_status = 'reserved', stock_quantity_before = NULL, stock_quantity_after = NULL
           WHERE id = ? AND order_id = ? AND quantity > 0`
        ).bind(itemId, orderId),
      ]);
    } else {
      await db.batch([
        db.prepare(
          `UPDATE inventory_reservations
           SET status = 'unresolved', fulfilled_at = NULL, released_at = NULL, updated_at = ?
           WHERE id = ? AND status <> 'unresolved'`
        ).bind(timestamp, reservationId),
        db.prepare(
          `UPDATE order_items
           SET stock_writeoff_status = 'catalog_unresolved', stock_quantity_before = NULL, stock_quantity_after = NULL
           WHERE id = ? AND order_id = ? AND quantity > 0`
        ).bind(itemId, orderId),
      ]);
    }
    reopenedExchangeItems += 1;
  }

  const corrected = await correctMistakenOrderHandover(db, orderId, {
    ...input,
    allowCommittedExchangeCurrentTruth: true,
    excludeOrderItemIds: currentExchangeItemIds,
  });

  try {
    await writeActivityLog(db, {
      eventType: 'order_false_handover_rebased_after_exchange',
      entityType: 'order',
      entityId: orderId,
      orderId,
      title: `Снята ошибочная отправка после обмена`,
      details: `Обмен не отменялся. Текущими товарами остались активные заменённые позиции; снова ожидают выдачи: ${reopenedExchangeItems}. Более новая физическая сверка защищена для ${protectedExchangePhysicalTruth} шт.`,
      createdAt: timestamp,
    });
  } catch (error) {
    console.warn('Exchange-aware false handover activity log failed', error);
  }

  return {
    ...corrected,
    exchangeCurrentTruth: true,
    reopenedExchangeItems,
    protectedExchangePhysicalTruth,
  };
}
