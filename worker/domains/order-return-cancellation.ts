// Return cancellation: restores physical/workshop state and reverses
// refund events through the existing D1 critical-operation lifecycle.
// Function implementation and its SQL are extracted unchanged.
import { cleanText, toInt } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import { loadCanonicalVariantSnapshot } from './catalog.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, failCriticalOperation, parseCriticalContext } from './critical.ts'
import type { InventoryLifecycleEventRow } from './lifecycle.ts'
import { cancelInventoryLifecycleEvent } from './lifecycle.ts'
import { refundReversalMoneyEventStatement, syncOrderFinancialLedger } from './money.ts'
import { getOrder } from './orders-write.ts'
import { normalizeWorkshopTaskStatus, refreshOrderWorkshopStatusFromTasks } from './workshop.ts'
import { splitRefundReversalStatements } from './return-exchange-payment-channels.ts'

export async function cancelReturn(db: D1Database, returnId: number, input: { requestId?: string; comment?: string }) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
  const operationStartedAt = new Date().toISOString();
  criticalOperation = await beginCriticalOperation(db, 'return_cancel', input.requestId, { returnId, ...input }, { startedAt: operationStartedAt });
  if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;
  if (!returnId) throw new Error('returnId is required.');
  const ret = await db.prepare(
    `SELECT r.*, o.external_id, o.order_status
     FROM returns r
     JOIN orders o ON o.id = r.order_id
     WHERE r.id = ?`
  ).bind(returnId).first<Record<string, unknown>>();
  if (!ret) throw new Error('Return not found.');
  if (cleanText(ret.status) === 'cancelled' && criticalOperation.row.step === 'started') {
    const cancelledOrderId = toInt(ret.order_id, 0);
    if (cancelledOrderId) {
      await syncOrderFinancialLedger(db, cancelledOrderId, operationStartedAt);
      try {
        await refreshOrderWorkshopStatusFromTasks(db, cancelledOrderId, operationStartedAt);
      } catch (error) {
        console.warn('Workshop status refresh failed while recovering already-cancelled Return', error);
      }
    }
    const completedResponse = { ok: true, returnId, alreadyCancelled: true, stockReversals: [], restoredWorkshopTasks: 0, refreshRequired: true };
    await completeCriticalOperation(db, criticalOperation, completedResponse);
    let order = null;
    try {
      order = await getOrder(db, cancelledOrderId);
    } catch (error) {
      console.warn('Order readback after already-cancelled return retry failed', error);
    }
    return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse;
  }

  const linkedExchange = await db.prepare(
    `SELECT id
     FROM exchanges
     WHERE refund_return_id = ?
       AND COALESCE(status, 'completed') <> 'cancelled'
     LIMIT 1`
  ).bind(returnId).first<{ id: number }>();
  if (linkedExchange?.id) {
    throw new Error(`Этот возврат создан обменом #${linkedExchange.id}. Отмените сам обмен, чтобы склад и деньги откатились вместе.`);
  }

  let operationContext = parseCriticalContext<Record<string, any>>(criticalOperation.row);
  const timestamp = cleanText(operationContext.startedAt) || operationStartedAt;
  const comment = cleanText(input.comment) || `Отмена возврата #${returnId}`;

  // Legacy rows that physically changed stock but were not adopted by 0051 are ambiguous by
  // definition. Do not revive the old snapshot guessing path during cancellation.
  const unsafeLegacy = await db.prepare(
    `SELECT ri.id, ri.product_name_snapshot
     FROM return_items ri
     WHERE ri.return_id = ?
       AND ri.restocked = 1
       AND ri.inventory_source IN ('warehouse', 'boutique')
       AND NOT EXISTS (
         SELECT 1 FROM inventory_lifecycle_events e
         WHERE e.operation_type = 'return' AND e.operation_id = ? AND e.operation_item_id = ri.id
       )
     LIMIT 1`
  ).bind(returnId, returnId).first<Record<string, unknown>>();
  if (unsafeLegacy?.id) {
    throw new Error(`Возврат содержит старое складское движение без надёжной canonical identity (${cleanText(unsafeLegacy.product_name_snapshot)}). Автоматическая отмена остановлена, чтобы не изменить неправильный остаток.`);
  }

  const taskSnapshots = await db.prepare(
    `SELECT rwt.workshop_task_id, rwt.previous_status, rwt.previous_quantity,
            wt.status AS current_status, wt.quantity AS current_quantity, wt.order_item_id,
            COALESCE((
              SELECT SUM(ri.quantity)
              FROM return_items ri
              WHERE ri.return_id = ? AND ri.order_item_id = wt.order_item_id
            ), 0) AS return_quantity
     FROM return_workshop_task_reversals rwt
     LEFT JOIN workshop_tasks wt ON wt.id = rwt.workshop_task_id
     WHERE rwt.return_id = ?
     ORDER BY rwt.workshop_task_id ASC`
  ).bind(returnId, returnId).all<Record<string, unknown>>();

  let workshopTargets = Array.isArray(operationContext.workshopTargets)
    ? operationContext.workshopTargets as Array<Record<string, unknown>>
    : null;
  if (!workshopTargets) {
    workshopTargets = (taskSnapshots.results || []).map((snapshot) => {
      const returnedTaskQuantity = Math.max(0, toInt(snapshot.return_quantity, 0));
      const baselineQuantity = Math.max(0, toInt(snapshot.current_quantity, 0));
      const fallbackQuantity = Math.max(0, toInt(snapshot.previous_quantity, 0));
      const targetQuantity = returnedTaskQuantity > 0 ? baselineQuantity + returnedTaskQuantity : fallbackQuantity;
      const baselineStatus = cleanText(snapshot.current_status) || cleanText(snapshot.previous_status) || 'active';
      const targetStatus = returnedTaskQuantity > 0
        && normalizeWorkshopTaskStatus(baselineStatus) === 'cancelled'
        && targetQuantity > 0
        ? (cleanText(snapshot.previous_status) || 'active')
        : baselineStatus;
      return {
        workshopTaskId: toInt(snapshot.workshop_task_id, 0),
        baselineQuantity,
        baselineStatus,
        targetQuantity,
        targetStatus,
      };
    });
    operationContext = { ...operationContext, workshopTargets };
    await advanceCriticalOperation(db, criticalOperation, 'validated', {
      targetType: 'return',
      targetId: returnId,
      context: operationContext,
    });
  } else if (criticalOperation.row.step === 'started') {
    await advanceCriticalOperation(db, criticalOperation, 'validated', {
      targetType: 'return',
      targetId: returnId,
      context: operationContext,
    });
  }

  // Prove every Workshop dependency is still either at the frozen baseline or already at
  // the idempotent target before touching physical stock. A missing/concurrently changed task
  // must not leave a Return half-cancelled with inventory already reversed.
  for (const snapshot of taskSnapshots.results || []) {
    const workshopTaskId = toInt(snapshot.workshop_task_id, 0);
    if (!workshopTaskId || !cleanText(snapshot.current_status)) {
      throw new CriticalOperationConflictError(
        'Связанная задача Цеха больше не найдена. Отмена возврата остановлена до изменения склада.'
      );
    }
    const target = workshopTargets.find((entry) => toInt(entry.workshopTaskId, 0) === workshopTaskId);
    if (!target) {
      throw new CriticalOperationConflictError('Не найден безопасный снимок восстановления задачи Цеха. Отмена возврата остановлена.');
    }
    const currentQuantity = Math.max(0, toInt(snapshot.current_quantity, 0));
    const currentStatus = cleanText(snapshot.current_status);
    const baselineQuantity = Math.max(0, toInt(target.baselineQuantity, 0));
    const baselineStatus = cleanText(target.baselineStatus) || 'active';
    const targetQuantity = Math.max(0, toInt(target.targetQuantity, 0));
    const targetStatus = cleanText(target.targetStatus) || baselineStatus;
    const atBaseline = currentQuantity === baselineQuantity && currentStatus === baselineStatus;
    const atTarget = currentQuantity === targetQuantity && currentStatus === targetStatus;
    if (!atBaseline && !atTarget) {
      throw new CriticalOperationConflictError(
        'Задача Цеха изменилась после начала отмены возврата. Склад не менялся; обновите данные и повторите.'
      );
    }
  }

  const lifecycleRows = await db.prepare(
    `SELECT * FROM inventory_lifecycle_events WHERE operation_type = 'return' AND operation_id = ? ORDER BY id ASC`
  ).bind(returnId).all<InventoryLifecycleEventRow>();
  for (const event of lifecycleRows.results || []) {
    if (cleanText(event.status) !== 'applied') continue;
    const variantId = toInt(event.variant_id, 0);
    if (!variantId) {
      throw new Error(`Возврат содержит применённое складское событие без canonical variant (${cleanText(event.event_key)}). Отмена остановлена без дальнейших изменений.`);
    }
    // Preflight every applied event before reversing the first one. A deleted/corrupt canonical
    // row must fail the whole cancellation before any physical stock has been touched.
    await loadCanonicalVariantSnapshot(db, variantId);
  }

  const stockReversals: unknown[] = [];
  for (const event of lifecycleRows.results || []) {
    const result = await cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment);
    if (result?.cancelled) stockReversals.push(result);
  }

  for (const snapshot of taskSnapshots.results || []) {
    const workshopTaskId = toInt(snapshot.workshop_task_id, 0);
    const target = workshopTargets.find((entry) => toInt(entry.workshopTaskId, 0) === workshopTaskId);
    if (!target) {
      throw new CriticalOperationConflictError('Не найден безопасный снимок восстановления задачи Цеха. Отмена возврата остановлена.');
    }

    const currentQuantity = Math.max(0, toInt(snapshot.current_quantity, 0));
    const currentStatus = cleanText(snapshot.current_status) || cleanText(snapshot.previous_status) || 'active';
    const baselineQuantity = Math.max(0, toInt(target.baselineQuantity, 0));
    const baselineStatus = cleanText(target.baselineStatus) || 'active';
    const targetQuantity = Math.max(0, toInt(target.targetQuantity, 0));
    const targetStatus = cleanText(target.targetStatus) || baselineStatus;

    if (currentQuantity === targetQuantity && currentStatus === targetStatus) continue;
    if (currentQuantity !== baselineQuantity || currentStatus !== baselineStatus) {
      throw new CriticalOperationConflictError(
        'Задача Цеха изменилась во время отмены возврата. Операция остановлена, чтобы не восстановить количество дважды.'
      );
    }

    const update = await db.prepare(
      `UPDATE workshop_tasks
       SET status = ?, quantity = ?, updated_at = ?
       WHERE id = ? AND order_id = ? AND quantity = ? AND status = ?`
    ).bind(
      targetStatus,
      targetQuantity,
      timestamp,
      workshopTaskId,
      toInt(ret.order_id, 0),
      baselineQuantity,
      baselineStatus,
    ).run();

    if (toInt(update.meta?.changes, 0) <= 0) {
      const latest = await db.prepare(
        `SELECT status, quantity FROM workshop_tasks WHERE id = ? AND order_id = ? LIMIT 1`
      ).bind(workshopTaskId, toInt(ret.order_id, 0)).first<Record<string, unknown>>();
      if (Math.max(0, toInt(latest?.quantity, 0)) !== targetQuantity || cleanText(latest?.status) !== targetStatus) {
        throw new CriticalOperationConflictError(
          'Задача Цеха изменилась параллельно. Отмена возврата остановлена без повторного прибавления количества.'
        );
      }
    }
  }

  const cancelStatements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE returns
       SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?
       WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
    ).bind(timestamp, comment, returnId),
  ];
  if (toInt(ret.amount, 0) > 0) {
    const splitReversals = await splitRefundReversalStatements(db, {
      orderId: toInt(ret.order_id, 0),
      externalOrderId: cleanText(ret.external_id),
      amount: toInt(ret.amount, 0),
      methodSummary: cleanText(ret.payment_method),
      timestamp, comment, reason: 'return_cancel', returnId,
    });
    cancelStatements.push(...(splitReversals || [refundReversalMoneyEventStatement(db, {
      eventKey: `189c:return:${returnId}:cancelled`,
      orderId: toInt(ret.order_id, 0),
      externalOrderId: cleanText(ret.external_id),
      amount: toInt(ret.amount, 0),
      paymentMethod: cleanText(ret.payment_method) || null,
      timestamp,
      relatedType: 'order_refund',
      sourceId: returnId,
      sourceRef: `returns:${returnId}`,
      reason: 'return_cancel',
      comment,
    })]));
  }
  await db.batch(cancelStatements);

  await syncOrderFinancialLedger(db, toInt(ret.order_id, 0), timestamp);
  try {
    await refreshOrderWorkshopStatusFromTasks(db, toInt(ret.order_id, 0), timestamp);
  } catch (error) {
    console.warn('Workshop order status cache refresh failed after committed return cancellation', error);
  }

  const completedResponse = {
    ok: true,
    returnId,
    stockReversals,
    restoredWorkshopTasks: (taskSnapshots.results || []).length,
    refreshRequired: true,
  };
  await completeCriticalOperation(db, criticalOperation, completedResponse);
  let updatedOrder = null;
  try {
    updatedOrder = await getOrder(db, toInt(ret.order_id, 0));
  } catch (error) {
    console.warn('Order readback after committed return cancellation failed', error);
  }
  const response = updatedOrder ? { ...completedResponse, order: updatedOrder, refreshRequired: false } : completedResponse;
  try {
    await writeActivityLog(db, {
      eventType: 'return_cancelled',
      entityType: 'return',
      entityId: returnId,
      orderId: toInt(ret.order_id, 0),
      externalOrderId: cleanText(ret.external_id),
      title: `Отменён возврат по заказу ${cleanText(ret.external_id)}`,
      details: comment,
      amount: toInt(ret.amount, 0),
      createdAt: timestamp,
    });
  } catch (error) {
    console.warn('Return cancellation activity log after committed cancellation failed', error);
  }
  return response;
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}
