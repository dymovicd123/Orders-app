import { cleanText, toInt } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, failCriticalOperation, parseCriticalContext } from './critical.ts'
import { applyCanonicalInventoryLifecycleEvent, canAutoApplyFreshWorkshopInbound, insertInventoryLifecycleEvent, inventoryLifecyclePendingReason, resolveInventoryLifecycleCandidate } from './lifecycle.ts'

export async function receiveReturnedItem(
  db: D1Database,
  input: {
    requestId?: string;
    operationType?: 'return' | 'exchange';
    operationId?: number;
    operationItemId?: number;
    destination?: 'warehouse' | 'boutique' | 'no_stock';
    freshnessDecision?: 'already_counted' | 'arrived_after_check';
  },
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
    const operationType = cleanText(input.operationType).toLowerCase();
    if (operationType !== 'return' && operationType !== 'exchange') throw new Error('Не выбран тип возвратной операции.');
    const operationId = toInt(input.operationId, 0);
    const operationItemId = toInt(input.operationItemId, 0);
    if (!operationId || !operationItemId) throw new Error('Не выбрана возвращаемая позиция.');
    const destination = cleanText(input.destination).toLowerCase();
    if (!['warehouse', 'boutique', 'no_stock'].includes(destination)) throw new Error('Выберите, куда принять вернувшийся товар.');
    const freshnessDecision = cleanText(input.freshnessDecision).toLowerCase();
    if (freshnessDecision && !['already_counted', 'arrived_after_check'].includes(freshnessDecision)) {
      throw new Error('Неизвестное решение по свежей сверке товара.');
    }

    // Delayed intake can cross a newer physical count. Before mutating anything, detect that
    // ambiguity and ask the operator whether the returning unit was already included in the count.
    // Never silently add or silently suppress a unit across a newer physical truth.
    let intakeFreshnessCheck: { id: number; checkedAt: string; expectedQuantity: number; countedQuantity: number } | null = null;
    if (destination === 'warehouse' || destination === 'boutique') {
      const pendingItem = operationType === 'return'
        ? await db.prepare(
          `SELECT ri.id AS operation_item_id, ri.return_id AS operation_id, ri.order_item_id,
                  ri.product_name_snapshot, ri.gender_snapshot, ri.color_snapshot, ri.material_snapshot,
                  ri.length_snapshot, ri.size_snapshot, ri.quantity, ri.inventory_source,
                  ri.physical_tracking, ri.physical_received_at, ri.created_at AS operation_item_created_at,
                  r.order_id, COALESCE(r.status, 'completed') AS operation_status,
                  o.external_id, oi.product_id, oi.variant_id, oi.audience_type, oi.is_workshop, oi.source_type
           FROM return_items ri
           JOIN returns r ON r.id = ri.return_id
           JOIN orders o ON o.id = r.order_id
           LEFT JOIN order_items oi ON oi.id = ri.order_item_id
           WHERE ri.id = ? AND ri.return_id = ?
           LIMIT 1`
        ).bind(operationItemId, operationId).first<Record<string, unknown>>()
        : await db.prepare(
          `SELECT ei.id AS operation_item_id, ei.exchange_id AS operation_id, ei.order_item_id,
                  ei.product_name_snapshot, ei.gender_snapshot, ei.color_snapshot, ei.material_snapshot,
                  ei.length_snapshot, ei.size_snapshot, ei.quantity, ei.inventory_source,
                  ei.physical_tracking, ei.physical_received_at, ei.created_at AS operation_item_created_at,
                  e.order_id, COALESCE(e.status, 'completed') AS operation_status,
                  o.external_id, oi.product_id, oi.variant_id, oi.audience_type, oi.is_workshop, oi.source_type
           FROM exchange_items ei
           JOIN exchanges e ON e.id = ei.exchange_id
           JOIN orders o ON o.id = e.order_id
           LEFT JOIN order_items oi ON oi.id = ei.order_item_id
           WHERE ei.id = ? AND ei.exchange_id = ? AND ei.role = 'old'
           LIMIT 1`
        ).bind(operationItemId, operationId).first<Record<string, unknown>>();

      if (pendingItem
        && cleanText(pendingItem.operation_status) !== 'cancelled'
        && toInt(pendingItem.physical_tracking, 0)
        && !cleanText(pendingItem.physical_received_at)) {
        const resolved = await resolveInventoryLifecycleCandidate(db, pendingItem, Boolean(toInt(pendingItem.is_workshop, 0)));
        const variantId = toInt(resolved.variantId, 0);
        const registeredAt = cleanText(pendingItem.operation_item_created_at);
        if (variantId && registeredAt) {
          const check = await db.prepare(
            `SELECT id, checked_at, expected_quantity, counted_quantity
             FROM inventory_stock_checks
             WHERE inventory_source = ? AND variant_id = ? AND julianday(checked_at) >= julianday(?)
             ORDER BY julianday(checked_at) DESC, id DESC
             LIMIT 1`
          ).bind(destination, variantId, registeredAt).first<Record<string, unknown>>();
          if (check?.id) {
            intakeFreshnessCheck = {
              id: toInt(check.id, 0),
              checkedAt: cleanText(check.checked_at),
              expectedQuantity: Math.max(0, toInt(check.expected_quantity, 0)),
              countedQuantity: Math.max(0, toInt(check.counted_quantity, 0)),
            };
          }
        }

        if (intakeFreshnessCheck && !freshnessDecision) {
          return {
            ok: false,
            code: 'intake_freshness_confirmation_required',
            message: 'После оформления возврата эту позицию уже пересчитывали. Нужно уточнить, была ли возвращённая вещь включена в ту сверку.',
            operationType,
            operationId,
            operationItemId,
            destination,
            productName: cleanText(pendingItem.product_name_snapshot),
            quantity: Math.max(1, toInt(pendingItem.quantity, 1)),
            latestCheck: intakeFreshnessCheck,
          };
        }
        if (freshnessDecision && !intakeFreshnessCheck) {
          throw new CriticalOperationConflictError('Свежая сверка больше не подтверждается текущими данными. Обновите очередь приёмки и повторите действие.');
        }
      }
    }

    const startedAt = new Date().toISOString();
    const criticalPayload = { operationType, operationId, operationItemId, destination, freshnessDecision: freshnessDecision || null };
    criticalOperation = await beginCriticalOperation(db, 'returned_item_receive', input.requestId, criticalPayload, { startedAt });
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;
    const operationContext = parseCriticalContext<{ startedAt?: string }>(criticalOperation.row);
    const timestamp = cleanText(operationContext.startedAt) || startedAt;

    const loadItem = async () => operationType === 'return'
      ? await db.prepare(
        `SELECT ri.id AS operation_item_id, ri.return_id AS operation_id, ri.order_item_id,
                ri.product_name_snapshot, ri.gender_snapshot, ri.color_snapshot, ri.material_snapshot,
                ri.length_snapshot, ri.size_snapshot, ri.quantity, ri.inventory_source, ri.restocked,
                ri.physical_tracking, ri.physical_received_at, ri.created_at AS operation_item_created_at,
                r.order_id, COALESCE(r.status, 'completed') AS operation_status,
                o.external_id, oi.product_id, oi.variant_id, oi.audience_type, oi.is_workshop, oi.source_type
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         JOIN orders o ON o.id = r.order_id
         LEFT JOIN order_items oi ON oi.id = ri.order_item_id
         WHERE ri.id = ? AND ri.return_id = ?
         LIMIT 1`
      ).bind(operationItemId, operationId).first<Record<string, unknown>>()
      : await db.prepare(
        `SELECT ei.id AS operation_item_id, ei.exchange_id AS operation_id, ei.order_item_id,
                ei.product_name_snapshot, ei.gender_snapshot, ei.color_snapshot, ei.material_snapshot,
                ei.length_snapshot, ei.size_snapshot, ei.quantity, ei.inventory_source, 0 AS restocked,
                ei.physical_tracking, ei.physical_received_at, ei.created_at AS operation_item_created_at,
                e.order_id, COALESCE(e.status, 'completed') AS operation_status,
                EXISTS(
                  SELECT 1 FROM critical_operations co
                  WHERE co.operation_type = 'exchange_set_create'
                    AND co.target_type = 'exchange'
                    AND co.target_id = e.id
                ) AS is_set_exchange,
                o.external_id, oi.product_id, oi.variant_id, oi.audience_type, oi.is_workshop, oi.source_type
         FROM exchange_items ei
         JOIN exchanges e ON e.id = ei.exchange_id
         JOIN orders o ON o.id = e.order_id
         LEFT JOIN order_items oi ON oi.id = ei.order_item_id
         WHERE ei.id = ? AND ei.exchange_id = ? AND ei.role = 'old'
         LIMIT 1`
      ).bind(operationItemId, operationId).first<Record<string, unknown>>();

    let item = await loadItem();
    if (!item) throw new Error('Возвращаемая позиция не найдена. Обновите историю и повторите действие.');
    if (cleanText(item.operation_status) === 'cancelled') throw new CriticalOperationConflictError('Эта операция уже отменена. Принимать товар по ней нельзя.');
    if (!toInt(item.physical_tracking, 0)) {
      throw new CriticalOperationConflictError('Это старая запись: физическое получение по ней раньше не отслеживалось. Автоматически менять остаток нельзя.');
    }
    const isWorkshop = Boolean(toInt(item.is_workshop, 0));
    // A Return may have been registered days before physical receipt. Re-check
    // the original SKU's active obligation at the moment of intake, not only
    // at Return creation. Historical rows can carry both a completed Return
    // and an active order reserve (cf. order #1563). Adding Physical would
    // duplicate stock truth while the old reservation remains shippable.
    // A previously received item is left on its idempotent replay path.
    if (operationType === 'return' && !isWorkshop && !cleanText(item.physical_received_at)) {
      const activeReservation = await db.prepare(
        `SELECT id, quantity, status
         FROM inventory_reservations
         WHERE order_item_id = ? AND status IN ('active', 'unresolved')
         ORDER BY id DESC LIMIT 1`
      ).bind(toInt(item.order_item_id, 0)).first<{ id: number; quantity: number; status: string }>();
      if (activeReservation?.id) {
        throw new CriticalOperationConflictError(
          `Нельзя принять позицию «${cleanText(item.product_name_snapshot)}»: по ней ещё открыт резерв ${Math.max(0, toInt(activeReservation.quantity, 0))} шт. Уточните фактическую выдачу этой позиции в заказе. Приёмка остановлена без изменения склада.`
        );
      }
    }


    const persistedDestination = () => {
      const source = cleanText(item?.inventory_source);
      return source === 'warehouse' || source === 'boutique' ? source : 'no_stock';
    };

    if (cleanText(item.physical_received_at)) {
      if (persistedDestination() !== destination) {
        throw new CriticalOperationConflictError('Товар уже отмечен полученным с другим решением по остатку. Обновите историю.');
      }
    } else {
      const source = destination === 'warehouse' || destination === 'boutique' ? destination : null;
      const update = operationType === 'return'
        ? await db.prepare(
          `UPDATE return_items
           SET physical_received_at = ?, inventory_source = ?
           WHERE id = ? AND return_id = ? AND physical_tracking = 1 AND physical_received_at IS NULL`
        ).bind(timestamp, source, operationItemId, operationId).run()
        : await db.prepare(
          `UPDATE exchange_items
           SET physical_received_at = ?, inventory_source = ?
           WHERE id = ? AND exchange_id = ? AND role = 'old' AND physical_tracking = 1 AND physical_received_at IS NULL`
        ).bind(timestamp, source, operationItemId, operationId).run();
      item = await loadItem();
      if (!item || !cleanText(item.physical_received_at)) {
        throw new CriticalOperationConflictError('Не удалось зафиксировать получение товара. Обновите историю и повторите действие.');
      }
      if (persistedDestination() !== destination) {
        throw new CriticalOperationConflictError('Товар одновременно приняли с другим решением по остатку. Обновите историю.');
      }
      if (toInt(update.meta?.changes, 0) <= 0 && !cleanText(item.physical_received_at)) {
        throw new CriticalOperationConflictError('Получение товара уже обрабатывается другим запросом. Обновите историю.');
      }
    }

    const setExchangeItem = operationType === 'exchange' && Boolean(toInt(item.is_set_exchange, 0));
    if (operationType === 'exchange' && !setExchangeItem) {
      // Legacy exchanges have one old item, so the parent field is meaningful there.
      // Set V2 stores disposition independently on each exchange_item; the last line
      // received must never overwrite a fake operation-wide destination.
      await db.prepare(`UPDATE exchanges SET old_return_source = ? WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`)
        .bind(destination === 'no_stock' ? 'none' : destination, operationId).run();
    }

    let stockApplied = false;
    let stockAlreadyApplied = false;
    let freshnessProtected = false;
    let pendingInventory: Record<string, unknown> | null = null;

    if (destination !== 'no_stock') {
      const resolved = await resolveInventoryLifecycleCandidate(db, item, isWorkshop);
      const event = await insertInventoryLifecycleEvent(db, {
        eventKey: operationType === 'return'
          ? `return:${operationId}:item:${operationItemId}`
          : setExchangeItem
            ? `exchange:${operationId}:old:${operationItemId}`
            : `exchange:${operationId}:old`,
        operationType,
        operationId,
        operationItemId,
        orderId: toInt(item.order_id, 0),
        orderItemId: toInt(item.order_item_id, 0) || null,
        eventType: operationType === 'return' ? 'return_in' : 'exchange_old_in',
        direction: 'in',
        inventorySource: destination as 'warehouse' | 'boutique',
        quantity: Math.max(1, toInt(item.quantity, 1)),
        item,
        isWorkshop,
        productId: resolved.productId,
        variantId: resolved.variantId,
        pendingReason: inventoryLifecyclePendingReason(resolved, isWorkshop),
        timestamp,
      });
      const eventStatus = cleanText(event.status);
      if (eventStatus === 'cancelled') {
        if (freshnessDecision === 'already_counted') {
          freshnessProtected = true;
        } else {
          throw new CriticalOperationConflictError('Складское событие этой позиции уже отменено. Автоматическое проведение остановлено.');
        }
      } else if (eventStatus === 'applied') {
        stockAlreadyApplied = true;
      } else if (freshnessDecision === 'already_counted') {
        if (!resolved.variantId || !intakeFreshnessCheck) {
          throw new CriticalOperationConflictError('Не удалось подтвердить более свежую физическую сверку для этой позиции. Обновите очередь и повторите действие.');
        }
        const protectedAt = new Date().toISOString();
        const protectedComment = `При приёмке подтверждено: вещь уже была включена в физическую сверку ${intakeFreshnessCheck.checkedAt || ''}. Повторно в остаток не добавлялась.`;
        await db.prepare(
          `UPDATE inventory_lifecycle_events
           SET product_id = COALESCE(product_id, ?), variant_id = ?, status = 'cancelled', pending_reason = NULL,
               resolution_comment = ?, cancelled_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        ).bind(toInt(resolved.productId, 0) || null, resolved.variantId, protectedComment, protectedAt, protectedAt, event.id).run();
        freshnessProtected = true;
      } else {
        const autoApplyWorkshop = Boolean(isWorkshop && resolved.variantId && await canAutoApplyFreshWorkshopInbound(db, event, resolved.variantId));
        if (resolved.variantId && (!isWorkshop || autoApplyWorkshop)) {
          const applied = await applyCanonicalInventoryLifecycleEvent(
            db,
            event.id,
            resolved.variantId,
            timestamp,
            `Физически получен товар по ${operationType === 'return' ? 'возврату' : 'обмену'} ${cleanText(item.external_id)}`,
          );
          stockApplied = Boolean(applied.applied);
          stockAlreadyApplied = Boolean(applied.already);
        } else {
          pendingInventory = {
            eventId: event.id,
            eventType: event.event_type,
            productName: cleanText(item.product_name_snapshot),
            source: destination,
            reason: cleanText(event.pending_reason),
          };
        }
      }
    }

    const completedResponse = {
      ok: true,
      operationType,
      operationId,
      operationItemId,
      destination,
      receivedAt: cleanText(item.physical_received_at) || timestamp,
      stockApplied,
      stockAlreadyApplied,
      freshnessProtected,
      pendingInventory,
      pendingInventoryCount: pendingInventory ? 1 : 0,
    };
    await completeCriticalOperation(db, criticalOperation, completedResponse);

    try {
      const destinationLabel = destination === 'warehouse' ? 'Склад' : destination === 'boutique' ? 'Бутик' : 'без возврата в остаток';
      await writeActivityLog(db, {
        eventType: 'returned_item_received',
        entityType: operationType === 'return' ? 'return_item' : 'exchange_item',
        entityId: operationItemId,
        orderId: toInt(item.order_id, 0),
        externalOrderId: cleanText(item.external_id),
        title: `Физически получен товар по ${operationType === 'return' ? 'возврату' : 'обмену'} ${cleanText(item.external_id)}`,
        details: `${cleanText(item.product_name_snapshot)} × ${Math.max(1, toInt(item.quantity, 1))}; ${destinationLabel}`,
        createdAt: timestamp,
      });
    } catch (error) {
      console.warn('Returned item receipt activity log failed after committed receive', error);
    }

    return completedResponse;
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}
