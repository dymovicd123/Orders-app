import { cleanText, normalizeExchangeFinancialAction, normalizeExchangeReturnSource, normalizeSourceType, toInt } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import { loadCanonicalVariantSnapshot } from './catalog.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, failCriticalOperation, parseCriticalContext } from './critical.ts'
import type { InventoryLifecycleEventRow } from './lifecycle.ts'
import { cancelInventoryLifecycleEvent, getOrderItemForReturnOrExchange } from './lifecycle.ts'
import { readOrderFinancialLedger, refundReversalMoneyEventStatement, removeSinglePaymentWithMoneyEvent, syncOrderFinancialLedger } from './money.ts'
import { reactivateReleasedOrderReservationV2 } from './order-reservations.ts'
import { getOrder } from './orders-write.ts'
import { normalizeWorkshopTaskStatus, refreshOrderWorkshopStatusFromTasks } from './workshop.ts'
import type { ReservationSnapshot } from './order-exchange-reservation-snapshot.ts'
import { restoreNotIssuedReservation } from './order-exchange-reservation-snapshot.ts'

export async function cancelExchange(db: D1Database, exchangeId: number, input: { requestId?: string; comment?: string }) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
  const operationStartedAt = new Date().toISOString();
  criticalOperation = await beginCriticalOperation(db, 'exchange_cancel', input.requestId, { exchangeId, ...input }, { startedAt: operationStartedAt });
  if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;
  let operationContext = parseCriticalContext<Record<string, any>>(criticalOperation.row);
  if (!exchangeId) throw new Error('exchangeId is required.');
  const exchange = await db.prepare(
    `SELECT e.*, o.external_id, o.order_status, o.pricing_mode,
            EXISTS(
              SELECT 1
              FROM exchange_items marker
              WHERE marker.exchange_id = e.id
                AND marker.role = 'old'
                AND marker.inventory_source = 'not_issued'
            ) AS old_not_issued
     FROM exchanges e
     JOIN orders o ON o.id = e.order_id
     WHERE e.id = ?`
  ).bind(exchangeId).first<Record<string, unknown>>();
  if (!exchange) throw new Error('Exchange not found.');
  if (cleanText(exchange.status) === 'cancelled' && !operationContext.baselineCaptured) {
    const completedResponse = { ok: true, exchangeId, alreadyCancelled: true, stockReversals: [], financialAction: normalizeExchangeFinancialAction(exchange.financial_action), financialAmount: Math.max(0, toInt(exchange.financial_amount, 0)), refreshRequired: true };
    await completeCriticalOperation(db, criticalOperation, completedResponse);
    let order = null;
    try {
      order = await getOrder(db, toInt(exchange.order_id, 0));
    } catch (error) {
      console.warn('Order readback after already-cancelled exchange retry failed', error);
    }
    return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse;
  }

  const dependentExchange = await db.prepare(
    `SELECT id
     FROM exchanges
     WHERE old_order_item_id = ?
       AND id <> ?
       AND COALESCE(status, 'completed') <> 'cancelled'
     ORDER BY id DESC
     LIMIT 1`
  ).bind(toInt(exchange.new_order_item_id, 0), exchangeId).first<{ id: number }>();
  if (dependentExchange?.id && !operationContext.baselineCaptured) {
    throw new Error(`Новая позиция этого обмена уже использована в обмене #${dependentExchange.id}. Сначала отмените более поздний обмен.`);
  }

  const timestamp = cleanText(operationContext.startedAt) || operationStartedAt;
  const comment = cleanText(input.comment) || `Отмена обмена #${exchangeId}`;
  const stockReversals: unknown[] = [];
  const orderId = toInt(exchange.order_id, 0);
  const oldQuantity = Math.max(1, toInt(exchange.old_quantity, 1));

  const oldItem = await getOrderItemForReturnOrExchange(db, orderId, toInt(exchange.old_order_item_id, 0));
  if (!oldItem) throw new Error('Старая позиция обмена не найдена. Отмена остановлена без изменений.');
  const newItemId = toInt(exchange.new_order_item_id, 0);
  const newItem = newItemId ? await getOrderItemForReturnOrExchange(db, orderId, newItemId) : null;

  if (!operationContext.baselineCaptured) {
    const oldWorkshopTaskIdForCancel = toInt(exchange.old_workshop_task_id, 0);
    const currentOldTaskForCancel = oldWorkshopTaskIdForCancel
      ? await db.prepare(`SELECT quantity FROM workshop_tasks WHERE id = ? AND order_id = ?`).bind(oldWorkshopTaskIdForCancel, orderId).first<{ quantity: number }>()
      : null;
    const currentOrderTotalRow = await db.prepare(`SELECT total_amount FROM orders WHERE id = ?`).bind(orderId).first<{ total_amount: number }>();
    const cancelFinancialAction = normalizeExchangeFinancialAction(exchange.financial_action);
    const cancelFinancialAmount = Math.max(0, toInt(exchange.financial_amount, 0));
    const currentTotal = Math.max(0, toInt(currentOrderTotalRow?.total_amount, 0));
    const isItemizedExchange = cleanText(exchange.pricing_mode) === 'itemized_v1';
    let restoredTotalAmountTarget = cancelFinancialAction === 'extra_payment'
      ? Math.max(0, currentTotal - cancelFinancialAmount)
      : cancelFinancialAction === 'refund'
        ? currentTotal + cancelFinancialAmount
        : currentTotal;
    if (isItemizedExchange) {
      if (!newItem) {
        throw new CriticalOperationConflictError('Новая позиция itemized-обмена не найдена. Отмена остановлена без изменения финансов.');
      }
      const activePricingRows = await db.prepare(
        `SELECT id, quantity, unit_price, line_total
         FROM order_items
         WHERE order_id = ? AND quantity > 0
         ORDER BY id ASC`
      ).bind(orderId).all<Record<string, unknown>>();
      let derivedCurrentTotal = 0;
      for (const pricingRow of activePricingRows.results || []) {
        const quantity = Number(pricingRow.quantity);
        const unitPrice = Number(pricingRow.unit_price);
        const lineTotal = Number(pricingRow.line_total);
        const derivedLineTotal = quantity * unitPrice;
        if (!Number.isSafeInteger(quantity) || quantity <= 0
          || !Number.isSafeInteger(unitPrice) || unitPrice < 0
          || !Number.isSafeInteger(derivedLineTotal) || derivedLineTotal < 0
          || lineTotal !== derivedLineTotal) {
          throw new CriticalOperationConflictError('Itemized-заказ содержит повреждённую ценовую позицию. Отмена обмена остановлена без изменений.');
        }
        const nextDerivedTotal = derivedCurrentTotal + derivedLineTotal;
        if (!Number.isSafeInteger(nextDerivedTotal) || nextDerivedTotal < 0) {
          throw new CriticalOperationConflictError('Итог itemized-заказа слишком велик для точного расчёта отмены обмена.');
        }
        derivedCurrentTotal = nextDerivedTotal;
      }
      if (derivedCurrentTotal !== currentTotal) {
        throw new CriticalOperationConflictError('Итог itemized-заказа не совпадает с активными позициями. Отмена обмена остановлена без изменений.');
      }
      const restoredOldValue = oldQuantity * Number(oldItem.unit_price);
      const removedNewValue = Number(newItem.line_total);
      restoredTotalAmountTarget = currentTotal - removedNewValue + restoredOldValue;
      if (!Number.isSafeInteger(restoredOldValue) || restoredOldValue < 0
        || !Number.isSafeInteger(removedNewValue) || removedNewValue < 0
        || !Number.isSafeInteger(restoredTotalAmountTarget) || restoredTotalAmountTarget < 0) {
        throw new CriticalOperationConflictError('Не удалось безопасно восстановить итог itemized-заказа при отмене обмена.');
      }
    }
    operationContext = {
      ...operationContext, baselineCaptured: true, startedAt: timestamp,
      restoredOldQuantityTarget: Math.max(0, toInt(oldItem.quantity, 0)) + oldQuantity,
      restoredTaskQuantityTarget: currentOldTaskForCancel ? Math.max(0, toInt(currentOldTaskForCancel.quantity, 0)) + oldQuantity : null,
      restoredTotalAmountTarget,
    };
    await advanceCriticalOperation(db, criticalOperation, 'validated', { targetType: 'exchange', targetId: exchangeId, context: operationContext });
  }

  const lifecycleRows = await db.prepare(
    `SELECT * FROM inventory_lifecycle_events WHERE operation_type = 'exchange' AND operation_id = ? ORDER BY id ASC`
  ).bind(exchangeId).all<InventoryLifecycleEventRow>();
  const lifecycleEvents = lifecycleRows.results || [];
  const oldReturnSource = normalizeExchangeReturnSource(exchange.old_return_source);
  if (oldReturnSource !== 'none' && !lifecycleEvents.some((event) => cleanText(event.event_type) === 'exchange_old_in')) {
    throw new Error('У старой позиции обмена есть старое складское действие без безопасной lifecycle-связи. Автоматическая отмена остановлена, чтобы не угадывать остаток по snapshot.');
  }
  if (newItem && !Boolean(toInt(newItem.is_workshop, 0)) && !lifecycleEvents.some((event) => cleanText(event.event_type) === 'exchange_new_out')) {
    throw new Error('У новой позиции обмена нет безопасной lifecycle-связи со складским списанием. Автоматическая отмена остановлена без изменений.');
  }
  for (const event of lifecycleEvents) {
    if (cleanText(event.status) !== 'applied') continue;
    const variantId = toInt(event.variant_id, 0);
    if (!variantId) {
      throw new Error(`Обмен содержит применённое складское событие без canonical variant (${cleanText(event.event_key)}). Отмена остановлена без дальнейших изменений.`);
    }
    await loadCanonicalVariantSnapshot(db, variantId);
  }

  // Exact lifecycle reversal happens before order/financial snapshots are restored. Pending
  // events simply become cancelled and never touch physical stock.
  for (const event of lifecycleEvents) {
    const result = await cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment);
    if (result?.cancelled) stockReversals.push(result);
  }

  if (newItemId && newItem) {
    if (Boolean(toInt(newItem.is_workshop, 0))) {
      const exactTask = await db.prepare(
        `SELECT id
         FROM workshop_tasks
         WHERE order_id = ? AND order_item_id = ?
         ORDER BY id DESC LIMIT 1`
      ).bind(orderId, newItemId).first<{ id: number }>();
      if (exactTask?.id) {
        await db.prepare(
          `UPDATE workshop_tasks SET status = 'cancelled', quantity = 0, updated_at = ? WHERE id = ?`
        ).bind(timestamp, exactTask.id).run();
      } else {
        await db.prepare(
          `UPDATE workshop_tasks
           SET status = 'cancelled', quantity = 0, updated_at = ?
           WHERE id IN (
             SELECT id FROM workshop_tasks
             WHERE order_id = ?
               AND product_name_snapshot = ?
               AND COALESCE(gender_snapshot, '') = COALESCE(?, '')
               AND COALESCE(color_snapshot, '') = COALESCE(?, '')
               AND COALESCE(material_snapshot, '') = COALESCE(?, '')
               AND COALESCE(length_snapshot, '') = COALESCE(?, '')
               AND COALESCE(size_snapshot, '') = COALESCE(?, '')
             ORDER BY id DESC LIMIT 1
           )`
        ).bind(
          timestamp,
          orderId,
          cleanText(newItem.product_name_snapshot),
          cleanText(newItem.gender_snapshot) || null,
          cleanText(newItem.color_snapshot) || null,
          cleanText(newItem.material_snapshot) || null,
          cleanText(newItem.length_snapshot) || null,
          cleanText(newItem.size_snapshot) || null,
        ).run();
      }
    }

    // If a previous false-handover correction kept the exchange but reopened the current
    // replacement as a reservation, cancelling the exchange must release that reservation too.
    const reopenedReservation = await db.prepare(
      `SELECT id, status, inventory_source, variant_id, quantity
       FROM inventory_reservations
       WHERE order_item_id = ?
       LIMIT 1`
    ).bind(newItemId).first<Record<string, unknown>>();
    if (reopenedReservation?.id && ['active', 'unresolved'].includes(cleanText(reopenedReservation.status))) {
      const reopenedVariantId = toInt(reopenedReservation.variant_id, 0);
      const reopenedQuantity = Math.max(1, toInt(reopenedReservation.quantity, 1));
      const reservationStatements: D1PreparedStatement[] = [];
      if (cleanText(reopenedReservation.status) === 'active' && reopenedVariantId) {
        reservationStatements.push(db.prepare(
          `UPDATE inventory_stock
           SET reserved_quantity = MAX(0, COALESCE(reserved_quantity, 0) - ?),
               last_action = 'Резерв отменён вместе с обменом', last_source_ref = ?, updated_at = ?
           WHERE inventory_source = ? AND variant_id = ?
             AND EXISTS (SELECT 1 FROM inventory_reservations WHERE id = ? AND status = 'active')`
        ).bind(
          reopenedQuantity,
          `exchange_cancel:${exchangeId}`,
          timestamp,
          normalizeSourceType(reopenedReservation.inventory_source),
          reopenedVariantId,
          toInt(reopenedReservation.id, 0),
        ));
      }
      reservationStatements.push(db.prepare(
        `UPDATE inventory_reservations
         SET status = 'released', released_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('active', 'unresolved')`
      ).bind(timestamp, timestamp, toInt(reopenedReservation.id, 0)));
      await db.batch(reservationStatements);
    }

    // Lifecycle cancellation releases the ordinary pending/fulfilled reservation. This final
    // update removes the cancelled replacement line from the active order view.
    await db.prepare(
      `UPDATE order_items
       SET quantity = 0, line_total = 0, stock_writeoff_status = 'cancelled'
       WHERE id = ? AND order_id = ?`
    ).bind(newItemId, orderId).run();
  }

  const restoredOldQuantity = Math.max(0, toInt(operationContext.restoredOldQuantityTarget, Math.max(0, toInt(oldItem.quantity, 0)) + oldQuantity));
  const exchangeOldWasNotIssued = Boolean(toInt(exchange.old_not_issued, 0));
  const restoredStockStatus = cleanText(exchange.old_item_stock_writeoff_status)
    || cleanText(oldItem.stock_writeoff_status)
    || (Boolean(toInt(oldItem.is_workshop, 0)) ? 'none' : exchangeOldWasNotIssued ? 'reservation_released' : 'written_off');
  await db.prepare(
    `UPDATE order_items
     SET quantity = ?, line_total = unit_price * ?, stock_writeoff_status = ?
     WHERE id = ? AND order_id = ?`
  ).bind(
    restoredOldQuantity,
    restoredOldQuantity,
    restoredStockStatus,
    toInt(exchange.old_order_item_id, 0),
    orderId,
  ).run();

  if (exchangeOldWasNotIssued && !Boolean(toInt(oldItem.is_workshop, 0))) {
    // For a partial never-issued legacy exchange, the original reservation
    // remains active but smaller. Re-activating it is insufficient: restore
    // exactly the exchanged quantity using the persisted creation snapshot.
    const creator = await db.prepare(
      `SELECT context_json FROM critical_operations
       WHERE operation_type = 'exchange_create' AND target_type = 'exchange' AND target_id = ?
       ORDER BY created_at DESC LIMIT 1`
    ).bind(exchangeId).first<{ context_json: string | null }>();
    let savedPartial: ReservationSnapshot | null = null;
    if (creator?.context_json) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(creator.context_json) as Record<string, unknown>;
      } catch {
        throw new CriticalOperationConflictError('Снимок исходного обмена повреждён. Отмена остановлена без дальнейшего изменения резерва.');
      }
      savedPartial = (parsed.legacyPartialReservationSnapshot as ReservationSnapshot | null) || null;
    }
    if (savedPartial) {
      if (savedPartial.quantity !== restoredOldQuantity || savedPartial.targetQuantity !== restoredOldQuantity - oldQuantity) {
        throw new CriticalOperationConflictError('Количество исходного резерва не совпадает с отменяемым обменом.');
      }
      await restoreNotIssuedReservation(
        db,
        { orderItemId: toInt(exchange.old_order_item_id, 0), quantity: oldQuantity, reservationSnapshot: savedPartial },
        timestamp,
        exchangeId,
      );
    } else {
      // Existing fully released/historical exchanges preserve their original path.
      const reactivated = await reactivateReleasedOrderReservationV2(
        db,
        toInt(exchange.old_order_item_id, 0),
        timestamp,
        `Отмена обмена #${exchangeId}: восстановление резерва невыданной позиции`,
      );
      if (!reactivated) {
        throw new CriticalOperationConflictError(
          'Не удалось безопасно восстановить резерв старой невыданной позиции. Отмена остановлена — обновите заказ и повторите.'
        );
      }
    }
  }

  const oldWorkshopTaskId = toInt(exchange.old_workshop_task_id, 0);
  if (oldWorkshopTaskId) {
    const currentTask = await db.prepare(
      `SELECT quantity FROM workshop_tasks WHERE id = ? AND order_id = ?`
    ).bind(oldWorkshopTaskId, orderId).first<{ quantity: number }>();
    if (currentTask) {
      const restoredTaskQuantity = Math.max(0, toInt(operationContext.restoredTaskQuantityTarget, Math.max(0, toInt(currentTask.quantity, 0)) + oldQuantity));
      await db.prepare(
        `UPDATE workshop_tasks
         SET quantity = ?, status = ?, updated_at = ?
         WHERE id = ? AND order_id = ?`
      ).bind(
        restoredTaskQuantity,
        normalizeWorkshopTaskStatus(exchange.old_workshop_task_status || 'active'),
        timestamp,
        oldWorkshopTaskId,
        orderId,
      ).run();
    }
  }

  const financialAction = normalizeExchangeFinancialAction(exchange.financial_action);
  const financialAmount = Math.max(0, toInt(exchange.financial_amount, 0));
  const ledgerBeforeCancel = await readOrderFinancialLedger(db, orderId);
  let restoredTotalAmount = Math.max(0, toInt(operationContext.restoredTotalAmountTarget, ledgerBeforeCancel.totalAmount));

  if (financialAction === 'extra_payment' && financialAmount > 0) {
    const paymentId = toInt(exchange.payment_id, 0);
    if (paymentId) {
      await removeSinglePaymentWithMoneyEvent(db, {
        paymentId,
        orderId,
        externalOrderId: cleanText(exchange.external_id),
        timestamp,
        relatedType: 'exchange_extra',
        reason: 'exchange_cancel',
        comment,
      });
    }
    restoredTotalAmount = Math.max(0, toInt(operationContext.restoredTotalAmountTarget, restoredTotalAmount));
  } else if (financialAction === 'refund' && financialAmount > 0) {
    const refundReturnId = toInt(exchange.refund_return_id, 0);
    if (refundReturnId) {
      await db.batch([
        db.prepare(
          `UPDATE returns
           SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?
           WHERE id = ? AND order_id = ?`
        ).bind(timestamp, comment, refundReturnId, orderId),
        refundReversalMoneyEventStatement(db, {
          eventKey: `189c:exchange:${exchangeId}:refund-cancelled`,
          orderId,
          externalOrderId: cleanText(exchange.external_id),
          amount: financialAmount,
          paymentMethod: cleanText(exchange.payment_method) || null,
          timestamp,
          relatedType: 'exchange_refund',
          sourceId: exchangeId,
          sourceRef: `exchanges:${exchangeId}`,
          reason: 'exchange_cancel',
          comment,
        }),
      ]);
    }
    restoredTotalAmount = Math.max(0, toInt(operationContext.restoredTotalAmountTarget, restoredTotalAmount));
  }

  await db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`).bind(restoredTotalAmount, timestamp, orderId).run();
  await db.prepare(
    `UPDATE exchanges
     SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?, old_item_replacement_reversed_at = ?
     WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
  ).bind(timestamp, comment, timestamp, exchangeId).run();

  await syncOrderFinancialLedger(db, orderId, timestamp);
  try {
    await refreshOrderWorkshopStatusFromTasks(db, orderId, timestamp);
  } catch (error) {
    console.warn('Workshop order status cache refresh failed after committed exchange cancellation', error);
  }
  const completedResponse = { ok: true, exchangeId, stockReversals, financialAction, financialAmount, refreshRequired: true };
  await completeCriticalOperation(db, criticalOperation, completedResponse);
  let updatedOrder = null;
  try {
    updatedOrder = await getOrder(db, orderId);
  } catch (error) {
    console.warn('Order readback after committed exchange cancellation failed', error);
  }
  const response = updatedOrder ? { ...completedResponse, order: updatedOrder, refreshRequired: false } : completedResponse;
  try {
    await writeActivityLog(db, {
      eventType: 'exchange_cancelled',
      entityType: 'exchange',
      entityId: exchangeId,
      orderId,
      externalOrderId: cleanText(exchange.external_id),
      title: `Отменён обмен по заказу ${cleanText(exchange.external_id)}`,
      details: comment,
      amount: financialAmount,
      createdAt: timestamp,
    });
  } catch (error) {
    console.warn('Exchange cancellation activity log after committed cancellation failed', error);
  }
  return response;
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}


// Exchange Set V2 — independent old/new item sets with server-derived settlement.
