// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { readJson } from '../core/http.ts'
import { cleanText, isArchivedOrder, normalizeDate, normalizeExchangeFinancialAction, normalizeExchangeReturnSource, normalizeOrderStatus, normalizeReturnRestockSource, normalizeSourceType, toInt, upperText } from '../core/text.ts'
import type { OrderInput, OrderItemSourceType, SourceType } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import { isHumanInventoryModelEnabled, loadCanonicalVariantSnapshot } from './catalog.ts'
import { orderItemWasPhysicallyIssued } from './catalog-review.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, criticalOperationEntityId, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext, refreshCriticalOperation, updateCriticalOperationTargetFromLastInsert } from './critical.ts'
import type { InventoryLifecycleEventRow } from './lifecycle.ts'
import { applyCanonicalInventoryLifecycleEvent, canAutoApplyFreshWorkshopInbound, cancelInventoryLifecycleEvent, getOrderItemForReturnOrExchange, insertInventoryLifecycleEvent, inventoryLifecyclePendingReason, resolveInventoryLifecycleCandidate } from './lifecycle.ts'
import { buildPaymentAndMoneyEventStatements, financialEventStatement, readOrderFinancialLedger, refundMoneyEventStatement, refundReversalMoneyEventStatement, removeSinglePaymentWithMoneyEvent, syncOrderFinancialLedger } from './money.ts'
import { normalizeOrderItems } from './order-core.ts'
import { buildItemizedOrderWritePlan, type ItemizedOrderWritePlan } from './order-pricing.ts'
import { correctMistakenOrderHandover, fulfillOrderReservationsV2, reactivateReleasedOrderReservationV2, releaseOrderReservationV2, resolveCatalogProductAndVariantV2 } from './order-reservations.ts'
import { getOrder, insertOrderContent } from './orders-write.ts'
import { normalizeWorkshopTaskStatus, refreshOrderWorkshopStatusFromTasks } from './workshop.ts'
import { assertWorkshopTaskDetailSchema } from './workshop-schema.ts'

export async function correctMistakenOrderHandoverWithCurrentExchange(
  db: D1Database,
  orderId: number,
  input: { physicalOutcome?: unknown; actor?: string } = {},
) {
  if (!orderId) throw new Error('Заказ не найден.');
  if (cleanText(input.physicalOutcome).toLowerCase() !== 'not_issued') {
    throw new Error('Снять отметку «Отправлен» можно только после подтверждения, что текущий товар фактически НЕ передавался клиенту.');
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


export async function createReturn(
  db: D1Database,
  input: {
    requestId?: string;
    orderId?: number;
    returnDate?: string;
    amount?: number;
    paymentMethod?: string;
    comment?: string;
    restockSource?: unknown;
    items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean; physicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock' }>;
  },
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
  const operationStartedAt = new Date().toISOString();
  criticalOperation = await beginCriticalOperation(db, 'return_create', input.requestId, input, { createdAt: operationStartedAt });
  if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;
  const operationContext = parseCriticalContext<{ createdAt?: string }>(criticalOperation.row);
  const orderId = toInt(input.orderId, 0);
  if (!orderId) {
    throw new Error('orderId is required.');
  }

  let existing = await getOrder(db, orderId);
  if (!existing) {
    throw new Error('Order not found.');
  }
  if (isArchivedOrder(existing)) {
    throw new Error('Нельзя оформлять возврат по архивному заказу.');
  }
  if (normalizeOrderStatus((existing as any).order_status) === 'deleted') {
    throw new Error('Нельзя оформлять возврат по удалённому заказу.');
  }

  await syncOrderFinancialLedger(db, orderId);
  existing = await getOrder(db, orderId);
  if (!existing) throw new Error('Order not found.');
  const operationReturnId = toInt(criticalOperation.row.target_id, 0);

  const rawReturnDate = cleanText(input.returnDate);
  if (!rawReturnDate) throw new Error('Укажите дату возврата.');
  const returnDate = normalizeDate(rawReturnDate);
  const amount = Math.max(0, toInt(input.amount, 0));
  const paymentMethod = upperText(input.paymentMethod);
  const comment = cleanText(input.comment);
  // On a retry the return created by this same operation is already included in
  // order.return_amount. Add only that operation-owned amount back so the request
  // can resume without treating its own already-recorded refund as unavailable.
  const ownOperationReturnAmount = operationReturnId ? amount : 0;
  const availableAmount = Math.max(0, Number(existing.received_amount || 0) - Number(existing.return_amount || 0) + ownOperationReturnAmount);
  const restockSource = normalizeReturnRestockSource(input.restockSource);

  if (amount > availableAmount) {
    throw new Error(`Return amount exceeds available received funds: ${availableAmount}.`);
  }

  const rawItems = Array.isArray(input.items) ? input.items : [];
  const selectedItemMap = new Map<number, { orderItemId: number; quantity: number; amount: number; restock: boolean | null; physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock' | null }>();
  for (const rawItem of rawItems) {
    const orderItemId = toInt(rawItem?.orderItemId, 0);
    const quantity = Math.max(0, toInt(rawItem?.quantity, 0));
    if (!orderItemId || quantity <= 0) continue;
    const explicitRestock = typeof rawItem?.restock === 'boolean' ? rawItem.restock : null;
    const rawPhysicalState = cleanText(rawItem?.physicalState);
    const physicalState = ['pending', 'warehouse', 'boutique', 'no_stock'].includes(rawPhysicalState)
      ? rawPhysicalState as 'pending' | 'warehouse' | 'boutique' | 'no_stock'
      : null;
    if (rawPhysicalState && !physicalState) throw new Error(`Неизвестный физический статус возврата для позиции #${orderItemId}.`);
    const current = selectedItemMap.get(orderItemId);
    if (current && current.restock !== null && explicitRestock !== null && current.restock !== explicitRestock) {
      throw new Error(`Для позиции #${orderItemId} переданы противоречивые решения по возврату в остаток.`);
    }
    if (current?.physicalState && physicalState && current.physicalState !== physicalState) {
      throw new Error(`Для позиции #${orderItemId} переданы противоречивые физические статусы.`);
    }
    selectedItemMap.set(orderItemId, {
      orderItemId,
      quantity: (current?.quantity || 0) + quantity,
      amount: (current?.amount || 0) + Math.max(0, toInt(rawItem?.amount, 0)),
      restock: explicitRestock ?? current?.restock ?? null,
      physicalState: physicalState ?? current?.physicalState ?? null,
    });
  }
  const selectedItems = Array.from(selectedItemMap.values());
  if (amount <= 0 && selectedItems.length === 0) {
    throw new Error('Для возврата без денег выберите хотя бы одну возвращаемую позицию.');
  }
  if (amount > 0 && !paymentMethod) {
    throw new Error('Выберите способ возврата денег. Это нужно для корректного учёта наличных и финансов.');
  }
  const validatedSelectedItems: Array<{
    selected: { orderItemId: number; quantity: number; amount: number; restock: boolean | null; physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock' | null };
    orderItem: Record<string, unknown>;
    quantity: number;
    isWorkshop: boolean;
    physicalTracking: boolean;
    physicalState: 'pending' | 'warehouse' | 'boutique' | 'no_stock' | null;
    inventorySource: 'warehouse' | 'boutique' | null;
    wantsRestock: boolean;
  }> = [];
  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);

  // Validate every selected row before inserting the return or changing stock.
  // A bad second row must not leave a half-created return behind.
  for (const selected of selectedItems) {
    const orderItem = await getOrderItemForReturnOrExchange(db, orderId, selected.orderItemId);
    if (!orderItem) throw new Error(`Позиция заказа #${selected.orderItemId} не найдена.`);
    const alreadyReturnedRow = await db.prepare(
      `SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE r.order_id = ?
         AND ri.order_item_id = ?
         AND COALESCE(r.status, 'completed') <> 'cancelled'
         AND ${noStandaloneReturnSql}
         AND (? = 0 OR r.id <> ?)`
    ).bind(orderId, selected.orderItemId, operationReturnId, operationReturnId).first<{ quantity: number }>();
    const alreadyReturnedQuantity = Math.max(0, toInt(alreadyReturnedRow?.quantity, 0));
    const maxQuantity = Math.max(0, toInt(orderItem.quantity, 0) - alreadyReturnedQuantity);
    if (maxQuantity <= 0) throw new Error(`Позиция ${cleanText(orderItem.product_name_snapshot)} уже возвращена или заменена.`);
    if (selected.quantity > maxQuantity) {
      throw new Error(`Для ${cleanText(orderItem.product_name_snapshot)} доступно только ${maxQuantity} шт., запрошено ${selected.quantity}.`);
    }
    const isWorkshop = Boolean(toInt(orderItem.is_workshop, 0));
    const physicalState = selected.physicalState;
    const physicalTracking = physicalState !== null;
    const trackedInventorySource = physicalState === 'warehouse' || physicalState === 'boutique' ? physicalState : null;
    // Legacy payloads keep the old restock semantics. New UI payloads are explicit:
    // pending = not physically received yet; no_stock = received but intentionally not stocked.
    const itemRestockRequested = isWorkshop ? selected.restock === true : selected.restock !== false;
    const inventorySource = physicalTracking ? trackedInventorySource : (restockSource !== 'none' && itemRestockRequested ? restockSource : null);
    const wantsRestock = inventorySource !== null;
    if (humanInventoryModelEnabled && wantsRestock && !isWorkshop && !orderItemWasPhysicallyIssued(orderItem)) {
      throw new Error(`Позиция «${cleanText(orderItem.product_name_snapshot)}» по учёту ещё не была физически выдана / отправлена. Возвращать её в остаток нельзя — это удвоит товар. Для неотправленного заказа используйте редактирование/удаление заказа либо выберите возврат денег без приёма вещи.`);
    }
    validatedSelectedItems.push({
      selected,
      orderItem,
      quantity: selected.quantity,
      isWorkshop,
      physicalTracking,
      physicalState,
      inventorySource,
      wantsRestock,
    });
  }

  const managerRow = await db
    .prepare('SELECT manager_id FROM orders WHERE id = ?')
    .bind(orderId)
    .first<{ manager_id: number | null }>();

  const createdAt = cleanText(operationContext.createdAt) || operationStartedAt;
  const returnEventKey = `1901:${criticalOperation.requestId}:return-refund`;
  let returnId = toInt(criticalOperation.row.target_id, 0);
  if (!returnId) {
    const leaseUntil = Date.now() + 45_000;
    const createStatements: D1PreparedStatement[] = [
      db.prepare(
        `INSERT INTO returns (order_id, manager_id, return_date, amount, payment_method, comment, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`
      ).bind(orderId, managerRow?.manager_id ?? null, returnDate, amount, amount > 0 ? paymentMethod : null, comment || null, createdAt),
      db.prepare(
        `UPDATE critical_operations
         SET target_type = 'return', target_id = last_insert_rowid(), target_ref = ?, step = 'return_created',
             lease_until_ms = ?, updated_at = ?, last_error = NULL
         WHERE request_id = ? AND status = 'started' AND lease_token = ?`
      ).bind(cleanText((existing as any).external_id), leaseUntil, createdAt, criticalOperation.requestId, criticalOperation.leaseToken),
    ];
    if (amount > 0) {
      createStatements.push(refundMoneyEventStatement(db, {
        eventKey: returnEventKey,
        orderId,
        externalOrderId: cleanText((existing as any).external_id),
        returnDate,
        amount,
        paymentMethod,
        timestamp: createdAt,
        eventType: 'order_refund',
        sourceRef: `critical-operation:${criticalOperation.requestId}`,
        comment: comment || null,
      }));
    }
    const [insertReturn] = await db.batch(createStatements);
    returnId = toInt(insertReturn.meta?.last_row_id, 0);
    await refreshCriticalOperation(db, criticalOperation);
    returnId = toInt(criticalOperation.row.target_id, 0) || returnId;
  }
  if (!returnId) throw new Error('Return record was not created.');
  const stockReturns: unknown[] = [];
  const pendingInventory: unknown[] = [];
  for (const validated of validatedSelectedItems) {
    const { selected, orderItem, quantity, wantsRestock, isWorkshop, physicalTracking, physicalState, inventorySource } = validated;

    const returnItemMapped = await insertCriticalMappedEntity(
      db,
      criticalOperation,
      'return_item',
      `return:item:${validatedSelectedItems.indexOf(validated) + 1}`,
      db.prepare(
        `INSERT INTO return_items (
          return_id, order_item_id, product_name_snapshot, quantity, amount, inventory_source, restocked,
          physical_tracking, physical_received_at,
          gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        returnId, selected.orderItemId, cleanText(orderItem.product_name_snapshot), quantity, selected.amount,
        inventorySource, physicalTracking ? 1 : 0, physicalTracking && physicalState !== 'pending' ? createdAt : null,
        cleanText(orderItem.gender_snapshot) || null, cleanText(orderItem.color_snapshot) || null,
        cleanText(orderItem.material_snapshot) || null, cleanText(orderItem.length_snapshot) || null,
        cleanText(orderItem.size_snapshot) || null, createdAt,
      ),
    );
    const returnItemId = returnItemMapped.id;

    if (wantsRestock) {
      const resolved = await resolveInventoryLifecycleCandidate(db, orderItem, isWorkshop);
      const event = await insertInventoryLifecycleEvent(db, {
        eventKey: `return:${returnId}:item:${returnItemId}`,
        operationType: 'return',
        operationId: returnId,
        operationItemId: returnItemId,
        orderId,
        orderItemId: selected.orderItemId,
        eventType: 'return_in',
        direction: 'in',
        inventorySource: inventorySource as 'warehouse' | 'boutique',
        quantity,
        item: orderItem,
        isWorkshop,
        productId: resolved.productId,
        variantId: resolved.variantId,
        pendingReason: inventoryLifecyclePendingReason(resolved, isWorkshop),
        timestamp: createdAt,
      });
      const autoApplyWorkshop = Boolean(isWorkshop && resolved.variantId && await canAutoApplyFreshWorkshopInbound(db, event, resolved.variantId));
      if (resolved.variantId && (!isWorkshop || autoApplyWorkshop)) {
        stockReturns.push(await applyCanonicalInventoryLifecycleEvent(
          db,
          event.id,
          resolved.variantId,
          createdAt,
          comment || `Возврат по заказу ${(existing as any).external_id}`,
        ));
      } else {
        pendingInventory.push({
          eventId: event.id,
          eventType: event.event_type,
          productName: cleanText(orderItem.product_name_snapshot),
          source: inventorySource,
          reason: cleanText(event.pending_reason),
        });
      }
    }
  }

  // Money-only returns intentionally have no return_items. The financial event is the complete history.

  const returnUpdateAt = new Date().toISOString();
  let touchedWorkshopTasks = 0;
  for (const validated of validatedSelectedItems) {
    if (!validated.isWorkshop) continue;
    const item = validated.orderItem;
    const task = await db.prepare(
      `SELECT id, status, quantity
       FROM workshop_tasks
       WHERE order_id = ? AND status = 'active'
         AND (order_item_id = ? OR (
           order_item_id IS NULL
           AND product_name_snapshot = ?
           AND COALESCE(gender_snapshot, '') = COALESCE(?, '')
           AND COALESCE(color_snapshot, '') = COALESCE(?, '')
           AND COALESCE(material_snapshot, '') = COALESCE(?, '')
           AND COALESCE(length_snapshot, '') = COALESCE(?, '')
           AND COALESCE(size_snapshot, '') = COALESCE(?, '')
         ))
       ORDER BY CASE WHEN order_item_id = ? THEN 0 ELSE 1 END, id ASC
       LIMIT 1`
    ).bind(
      orderId,
      validated.selected.orderItemId,
      cleanText(item.product_name_snapshot),
      cleanText(item.gender_snapshot) || null,
      cleanText(item.color_snapshot) || null,
      cleanText(item.material_snapshot) || null,
      cleanText(item.length_snapshot) || null,
      cleanText(item.size_snapshot) || null,
      validated.selected.orderItemId,
    ).first<Record<string, unknown>>();
    if (!task?.id) continue;
    const previousQuantity = Math.max(0, toInt(task.quantity, 0));
    await db.prepare(
      `INSERT OR IGNORE INTO return_workshop_task_reversals (return_id, workshop_task_id, previous_status, previous_quantity, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(returnId, toInt(task.id, 0), cleanText(task.status) || 'active', previousQuantity, returnUpdateAt).run();
    const savedSnapshot = await db.prepare(
      `SELECT previous_status, previous_quantity FROM return_workshop_task_reversals
       WHERE return_id = ? AND workshop_task_id = ? LIMIT 1`
    ).bind(returnId, toInt(task.id, 0)).first<{ previous_status: string; previous_quantity: number }>();
    const baselineQuantity = Math.max(0, toInt(savedSnapshot?.previous_quantity, previousQuantity));
    const baselineStatus = cleanText(savedSnapshot?.previous_status) || cleanText(task.status) || 'active';
    const nextQuantity = Math.max(0, baselineQuantity - validated.quantity);
    await db.prepare(
      `UPDATE workshop_tasks SET quantity = ?, status = ?, updated_at = ? WHERE id = ?`
    ).bind(nextQuantity, nextQuantity <= 0 ? 'cancelled' : baselineStatus, returnUpdateAt, toInt(task.id, 0)).run();
    touchedWorkshopTasks += 1;
  }

  await syncOrderFinancialLedger(db, orderId, returnUpdateAt);
  if (touchedWorkshopTasks > 0) {
    try {
      const activeWorkshop = await db.prepare(`SELECT COUNT(*) AS count FROM workshop_tasks WHERE order_id = ? AND status = 'active' AND quantity > 0`).bind(orderId).first<{ count: number }>();
      const nextWorkshopStatus = toInt(activeWorkshop?.count, 0) > 0 ? 'in_workshop' : 'cancelled';
      await db.prepare(`UPDATE orders SET workshop_status = ?, updated_at = ? WHERE id = ?`).bind(nextWorkshopStatus, returnUpdateAt, orderId).run();
    } catch (error) {
      console.warn('Workshop order status cache refresh failed after committed return', error);
    }
  }

  const completedResponse = {
    ok: true,
    returnId,
    stockReturns,
    pendingInventory,
    pendingInventoryCount: pendingInventory.length,
    refreshRequired: true,
  };
  await completeCriticalOperation(db, criticalOperation, completedResponse);
  let updated = null;
  try {
    updated = await getOrder(db, orderId);
  } catch (error) {
    console.warn('Order readback after committed return failed', error);
  }
  const response = updated ? { ...completedResponse, order: updated, refreshRequired: false } : completedResponse;
  const returnActivityItemDetails = validatedSelectedItems.map((entry) => {
    const itemLabel = `${cleanText(entry.orderItem.product_name_snapshot)} × ${entry.quantity}`;
    if (entry.physicalTracking) {
      if (entry.physicalState === 'pending') return `${itemLabel}: ещё не пришёл`;
      if (entry.physicalState === 'warehouse') return `${itemLabel}: получен → Склад`;
      if (entry.physicalState === 'boutique') return `${itemLabel}: получен → Бутик`;
      return `${itemLabel}: получен без добавления в остаток`;
    }
    if (entry.inventorySource === 'warehouse') return `${itemLabel}: возврат в Склад`;
    if (entry.inventorySource === 'boutique') return `${itemLabel}: возврат в Бутик`;
    return `${itemLabel}: без возврата в остатки`;
  });
  const returnActivityDetails = [
    returnActivityItemDetails.length ? returnActivityItemDetails.join('; ') : 'Возврат денег без списка товаров',
    comment,
  ].filter(Boolean).join(' · ');
  try {
    await writeActivityLog(db, {
      eventType: 'return_created',
      entityType: 'return',
      entityId: returnId,
      orderId,
      externalOrderId: cleanText((existing as any).external_id),
      title: `Оформлен возврат по заказу ${cleanText((existing as any).external_id)}`,
      details: returnActivityDetails,
      amount,
      createdAt,
    });
  } catch (error) {
    console.warn('Return activity log after committed return failed', error);
  }
  return response;
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}


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
             WHERE inventory_source = ? AND variant_id = ? AND datetime(checked_at) >= datetime(?)
             ORDER BY datetime(checked_at) DESC, id DESC
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

    if (operationType === 'exchange') {
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
        eventKey: operationType === 'return' ? `return:${operationId}:item:${operationItemId}` : `exchange:${operationId}:old`,
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


export const noStandaloneReturnSql = `NOT EXISTS (
  SELECT 1
  FROM exchanges e
  WHERE e.refund_return_id = r.id
    AND COALESCE(e.status, 'completed') <> 'cancelled'
)`;


export async function hasActiveStandaloneReturn(db: D1Database, orderId: number) {
  const row = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM returns r
     WHERE r.order_id = ?
       AND COALESCE(r.status, 'completed') <> 'cancelled'
       AND ${noStandaloneReturnSql}`
  ).bind(orderId).first<{ count: number }>();
  return toInt(row?.count, 0) > 0;
}


export async function ensureExchangeWorkshopReplacementTask(
  db: D1Database,
  input: {
    exchangeId: number;
    orderId: number;
    externalId: string;
    orderItemId: number;
    timestamp: string;
  },
) {
  const { exchangeId, orderId, externalId, orderItemId, timestamp } = input;
  await assertWorkshopTaskDetailSchema(db);
  const item = await db.prepare(
    `SELECT id, order_id, product_id, variant_id, product_name_snapshot,
            gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot,
            quantity, workshop_comment, workshop_urgent, workshop_due_date
     FROM order_items
     WHERE id = ? AND order_id = ? AND quantity > 0`
  ).bind(orderItemId, orderId).first<Record<string, unknown>>();
  if (!item) throw new Error('Новая цеховая позиция обмена не найдена после сохранения.');

  const exactTasks = await db.prepare(
    `SELECT id FROM workshop_tasks WHERE order_id = ? AND order_item_id = ? ORDER BY id ASC`
  ).bind(orderId, orderItemId).all<{ id: number }>();
  const keeperId = toInt(exactTasks.results?.[0]?.id, 0);
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE order_items
       SET is_workshop = 1,
           source_type = 'warehouse',
           stock_writeoff_status = 'workshop',
           stock_quantity_before = NULL,
           stock_quantity_after = NULL
       WHERE id = ? AND order_id = ? AND quantity > 0`
    ).bind(orderItemId, orderId),
    db.prepare(`UPDATE exchanges SET new_source_type = 'workshop', new_order_item_id = ? WHERE id = ? AND order_id = ?`)
      .bind(orderItemId, exchangeId, orderId),
    db.prepare(`UPDATE exchange_items SET inventory_source = 'workshop' WHERE exchange_id = ? AND role = 'new'`)
      .bind(exchangeId),
  ];

  if (keeperId) {
    statements.push(db.prepare(
      `UPDATE workshop_tasks
       SET external_order_id = ?, product_id = ?, variant_id = ?, product_name_snapshot = ?,
           gender_snapshot = ?, color_snapshot = ?, material_snapshot = ?, length_snapshot = ?, size_snapshot = ?,
           quantity = ?, comment = ?, urgent = ?, due_date = ?, status = 'active', updated_at = ?
       WHERE id = ? AND order_id = ? AND order_item_id = ?`
    ).bind(
      externalId,
      toInt(item.product_id, 0) || null,
      toInt(item.variant_id, 0) || null,
      cleanText(item.product_name_snapshot),
      cleanText(item.gender_snapshot) || null,
      cleanText(item.color_snapshot) || null,
      cleanText(item.material_snapshot) || null,
      cleanText(item.length_snapshot) || null,
      cleanText(item.size_snapshot) || null,
      Math.max(1, toInt(item.quantity, 1)),
      cleanText(item.workshop_comment) || null,
      toInt(item.workshop_urgent, 0) ? 1 : 0,
      cleanText(item.workshop_due_date) || null,
      timestamp,
      keeperId,
      orderId,
      orderItemId,
    ));
    statements.push(db.prepare(
      `UPDATE workshop_tasks
       SET quantity = 0, status = 'cancelled', updated_at = ?
       WHERE order_id = ? AND order_item_id = ? AND id <> ?`
    ).bind(timestamp, orderId, orderItemId, keeperId));
  } else {
    statements.push(db.prepare(
      `INSERT INTO workshop_tasks (
        order_id, external_order_id, order_item_id, product_id, variant_id, product_name_snapshot,
        gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot,
        quantity, comment, urgent, due_date, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(
      orderId,
      externalId,
      orderItemId,
      toInt(item.product_id, 0) || null,
      toInt(item.variant_id, 0) || null,
      cleanText(item.product_name_snapshot),
      cleanText(item.gender_snapshot) || null,
      cleanText(item.color_snapshot) || null,
      cleanText(item.material_snapshot) || null,
      cleanText(item.length_snapshot) || null,
      cleanText(item.size_snapshot) || null,
      Math.max(1, toInt(item.quantity, 1)),
      cleanText(item.workshop_comment) || null,
      toInt(item.workshop_urgent, 0) ? 1 : 0,
      cleanText(item.workshop_due_date) || null,
      timestamp,
      timestamp,
    ));
  }

  await db.batch(statements);
  const verification = await db.prepare(
    `SELECT COUNT(*) AS count
     FROM workshop_tasks
     WHERE order_id = ? AND order_item_id = ? AND status = 'active' AND quantity > 0`
  ).bind(orderId, orderItemId).first<{ count: number }>();
  if (toInt(verification?.count, 0) !== 1) {
    throw new Error('Не удалось закрепить новую позицию обмена в цехе. Обратитесь к администратору.');
  }
}


export async function createExchange(
  db: D1Database,
  input: {
    requestId?: string;
    orderId?: number;
    exchangeDate?: string;
    oldItemId?: number;
    oldQuantity?: number;
    oldReturnSource?: unknown;
    oldPhysicalState?: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock';
    newItem?: NonNullable<OrderInput['items']>[number];
    newSourceWasManuallyChanged?: boolean;
    expectedOrderTotal?: number;
    expectedOldActiveQuantity?: number;
    expectedOldUnitPrice?: number;
    expectedOldLineTotal?: number;
    expectedOldCatalogPriceSnapshot?: number | null;
    financialAction?: unknown;
    financialAmount?: number;
    paymentMethod?: string;
    comment?: string;
  },
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
  const operationStartedAt = new Date().toISOString();
  criticalOperation = await beginCriticalOperation(db, 'exchange_create', input.requestId, input, { startedAt: operationStartedAt });
  if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;
  let operationContext = parseCriticalContext<Record<string, any>>(criticalOperation.row);
  const orderId = toInt(input.orderId, 0);
  if (!orderId) throw new Error('orderId is required.');

  await syncOrderFinancialLedger(db, orderId);
  const existing = await getOrder(db, orderId);
  if (!existing) throw new Error('Order not found.');
  const isItemizedExchange = cleanText((existing as any).pricing_mode) === 'itemized_v1';
  if (isArchivedOrder(existing)) throw new Error('Нельзя оформлять обмен по архивному заказу.');
  if (normalizeOrderStatus((existing as any).order_status) === 'deleted') throw new Error('Нельзя оформлять обмен по удалённому заказу.');
  const oldItemId = toInt(input.oldItemId, 0);
  if (!oldItemId) throw new Error('oldItemId is required.');
  let oldItem = await getOrderItemForReturnOrExchange(db, orderId, oldItemId);
  if (!oldItem) throw new Error('Old order item not found.');

  const rawOldQuantity = operationContext.baselineCaptured
    ? Math.max(0, toInt(operationContext.rawOldQuantity, toInt(oldItem.quantity, 0)))
    : Math.max(0, toInt(oldItem.quantity, 0));
  let activeStandaloneReturnedQuantity = operationContext.baselineCaptured
    ? Math.max(0, toInt(operationContext.activeStandaloneReturnedQuantity, 0))
    : 0;
  if (!operationContext.baselineCaptured) {
    const activeStandaloneReturnedRow = await db.prepare(
      `SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
       FROM return_items ri
       JOIN returns r ON r.id = ri.return_id
       WHERE r.order_id = ?
         AND ri.order_item_id = ?
         AND COALESCE(r.status, 'completed') <> 'cancelled'
         AND ${noStandaloneReturnSql}`
    ).bind(orderId, oldItemId).first<{ quantity: number }>();
    activeStandaloneReturnedQuantity = Math.max(0, toInt(activeStandaloneReturnedRow?.quantity, 0));
  }
  const availableOldQuantity = operationContext.baselineCaptured
    ? Math.max(0, toInt(operationContext.availableOldQuantity, 0))
    : Math.max(0, rawOldQuantity - activeStandaloneReturnedQuantity);
  const requestedOldQuantity = Math.max(1, toInt(input.oldQuantity, 1));
  if (availableOldQuantity <= 0) {
    throw new Error('Эта позиция уже полностью заменена или возвращена.');
  }
  if (requestedOldQuantity > availableOldQuantity) {
    throw new Error(`Для обмена доступно ${availableOldQuantity} шт., запрошено ${requestedOldQuantity}.`);
  }
  const oldQuantity = requestedOldQuantity;
  const oldItemIsWorkshop = Boolean(toInt(oldItem.is_workshop, 0));
  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);
  const rawOldPhysicalState = cleanText(input.oldPhysicalState);
  const oldPhysicalState = ['not_issued', 'pending', 'warehouse', 'boutique', 'no_stock'].includes(rawOldPhysicalState)
    ? rawOldPhysicalState as 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'
    : null;
  if (rawOldPhysicalState && !oldPhysicalState) throw new Error('Неизвестный физический статус старой вещи обмена.');
  const oldWasNotIssued = oldPhysicalState === 'not_issued';
  const oldWasAlreadyIssued = orderItemWasPhysicallyIssued(oldItem);
  if (oldWasNotIssued && oldWasAlreadyIssued) {
    throw new CriticalOperationConflictError(
      'Эта позиция уже отмечена как выданная клиенту. Нельзя выбрать «Не выдавали клиенту». Если вещь вернулась, укажите, куда её приняли.'
    );
  }
  const oldItemNeedsHandoverReconciliation = Boolean(
    !operationContext.baselineCaptured && humanInventoryModelEnabled
    && !oldItemIsWorkshop
    && !oldWasNotIssued
    && !oldWasAlreadyIssued
  );
  const oldPhysicalTracking = oldPhysicalState !== null && !oldWasNotIssued;
  const trackedOldReturnSource = oldPhysicalState === 'warehouse' || oldPhysicalState === 'boutique' ? oldPhysicalState : 'none';
  const oldReturnSource = oldPhysicalTracking ? trackedOldReturnSource : normalizeExchangeReturnSource(input.oldReturnSource);
  const rawExchangeDate = cleanText(input.exchangeDate);
  if (!rawExchangeDate) throw new Error('Укажите дату обмена.');
  const exchangeDate = normalizeDate(rawExchangeDate);
  const comment = cleanText(input.comment);
  const financialAction = normalizeExchangeFinancialAction(input.financialAction);
  const financialAmount = Math.max(0, toInt(input.financialAmount, 0));
  const paymentMethod = cleanText(input.paymentMethod);
  const ledger = await readOrderFinancialLedger(db, orderId);
  const availableRefundAmount = operationContext.baselineCaptured
    ? Math.max(0, toInt(operationContext.availableRefundAmount, 0))
    : Math.max(0, ledger.receivedAmount - ledger.returnAmount);

  if (financialAction !== 'none' && financialAmount <= 0) {
    throw new Error('Укажите сумму доплаты или возврата больше нуля.');
  }
  if (financialAction !== 'none' && !paymentMethod) {
    throw new Error(financialAction === 'refund' ? 'Выберите способ возврата денег по обмену.' : 'Выберите способ оплаты для доплаты по обмену.');
  }
  if (financialAction === 'refund' && financialAmount > availableRefundAmount) {
    throw new Error(`Сумма возврата по обмену больше доступной суммы: ${availableRefundAmount}.`);
  }

  const timestamp = cleanText(operationContext.startedAt) || operationStartedAt;
  const managerRow = await db.prepare('SELECT manager_id FROM orders WHERE id = ?').bind(orderId).first<{ manager_id: number | null }>();
  const oldWorkshopTask = oldItemIsWorkshop
    ? await db.prepare(
      `SELECT id, status, quantity
       FROM workshop_tasks
       WHERE order_id = ?
         AND (order_item_id = ? OR (
           order_item_id IS NULL
           AND product_name_snapshot = ?
           AND COALESCE(gender_snapshot, '') = COALESCE(?, '')
           AND COALESCE(color_snapshot, '') = COALESCE(?, '')
           AND COALESCE(material_snapshot, '') = COALESCE(?, '')
           AND COALESCE(length_snapshot, '') = COALESCE(?, '')
           AND COALESCE(size_snapshot, '') = COALESCE(?, '')
         ))
       ORDER BY CASE WHEN order_item_id = ? THEN 0 ELSE 1 END,
                CASE status WHEN 'active' THEN 0 WHEN 'ready' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
                id ASC
       LIMIT 1`
    ).bind(
      orderId,
      oldItemId,
      cleanText(oldItem.product_name_snapshot),
      cleanText(oldItem.gender_snapshot) || null,
      cleanText(oldItem.color_snapshot) || null,
      cleanText(oldItem.material_snapshot) || null,
      cleanText(oldItem.length_snapshot) || null,
      cleanText(oldItem.size_snapshot) || null,
      oldItemId,
    ).first<Record<string, unknown>>()
    : null;

  const newItems = normalizeOrderItems(input.newItem ? [input.newItem] : [], normalizeSourceType((existing as any).source_type));
  if (!newItems.length) throw new Error('Новая позиция обмена не заполнена.');

  let itemizedExchangeWritePlan: ItemizedOrderWritePlan | null = null;
  let itemizedExchangePricingPlan = operationContext.itemizedExchangePricingPlan as {
    projectedTotalAmount: number;
    currentItemizedTotalAmount: number;
    oldUnitPrice: number;
    oldCatalogPriceSnapshot: number | null;
    newUnitPrice: number;
    newLineTotal: number;
    newCatalogPriceSnapshot: number | null;
  } | undefined;

  if (isItemizedExchange) {
    if (!input.newItem || !Object.prototype.hasOwnProperty.call(input.newItem, 'unitPrice')) {
      throw new CriticalOperationConflictError('Для itemized-обмена укажите фактическую цену продажи новой позиции.');
    }
    if (!Object.prototype.hasOwnProperty.call(input.newItem, 'catalogPriceSnapshot')) {
      throw new CriticalOperationConflictError('Для itemized-обмена передайте явный снимок цены Каталога новой позиции или null, если цены в Каталоге нет.');
    }
    itemizedExchangeWritePlan = buildItemizedOrderWritePlan([{
      quantity: input.newItem.quantity ?? 1,
      unitPrice: input.newItem.unitPrice,
      catalogPriceSnapshot: input.newItem.catalogPriceSnapshot ?? null,
    }], []);

    if (!itemizedExchangePricingPlan) {
      const expectedFields = [
        'expectedOrderTotal',
        'expectedOldActiveQuantity',
        'expectedOldUnitPrice',
        'expectedOldLineTotal',
        'expectedOldCatalogPriceSnapshot',
      ];
      if (!expectedFields.every((key) => Object.prototype.hasOwnProperty.call(input, key))) {
        throw new CriticalOperationConflictError('Обновите заказ перед обменом: для itemized-обмена нужен исходный снимок цены заменяемой позиции и итога заказа.');
      }

      const activePricingRows = await db.prepare(
        `SELECT id, quantity, unit_price, line_total, catalog_price_snapshot
         FROM order_items
         WHERE order_id = ? AND quantity > 0
         ORDER BY id ASC`
      ).bind(orderId).all<Record<string, unknown>>();
      const rows = activePricingRows.results || [];
      let currentItemizedTotalAmount = 0;
      let oldPricingRow: Record<string, unknown> | null = null;
      for (const row of rows) {
        const rowId = toInt(row.id, 0);
        const quantity = Number(row.quantity);
        const unitPrice = Number(row.unit_price);
        const lineTotal = Number(row.line_total);
        if (!rowId || !Number.isSafeInteger(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPrice) || unitPrice < 0) {
          throw new CriticalOperationConflictError('В itemized-заказе найдена повреждённая ценовая позиция. Обмен остановлен без изменений.');
        }
        const derivedLineTotal = quantity * unitPrice;
        if (!Number.isSafeInteger(derivedLineTotal) || derivedLineTotal < 0 || lineTotal !== derivedLineTotal) {
          throw new CriticalOperationConflictError('Сумма одной из позиций itemized-заказа не совпадает с количеством и ценой. Обмен остановлен без изменений.');
        }
        const nextTotal = currentItemizedTotalAmount + derivedLineTotal;
        if (!Number.isSafeInteger(nextTotal) || nextTotal < 0) {
          throw new CriticalOperationConflictError('Итог itemized-заказа слишком велик для точного расчёта обмена.');
        }
        currentItemizedTotalAmount = nextTotal;
        if (rowId === oldItemId) oldPricingRow = row;
      }

      if (!oldPricingRow) {
        throw new CriticalOperationConflictError('Заменяемая позиция больше не активна. Обновите заказ и повторите обмен.');
      }
      if (currentItemizedTotalAmount !== ledger.totalAmount) {
        throw new CriticalOperationConflictError('Итог itemized-заказа не совпадает с активными позициями. Обмен остановлен, чтобы не переписать финансовую историю.');
      }

      const oldActiveQuantity = Number(oldPricingRow.quantity);
      const oldUnitPrice = Number(oldPricingRow.unit_price);
      const oldLineTotal = Number(oldPricingRow.line_total);
      const oldCatalogPriceSnapshot = oldPricingRow.catalog_price_snapshot === null || oldPricingRow.catalog_price_snapshot === undefined
        ? null
        : Number(oldPricingRow.catalog_price_snapshot);
      const expectedCatalogSnapshot = input.expectedOldCatalogPriceSnapshot === null || input.expectedOldCatalogPriceSnapshot === undefined
        ? null
        : Number(input.expectedOldCatalogPriceSnapshot);
      const expectedOrderTotal = Number(input.expectedOrderTotal);
      const expectedOldActiveQuantity = Number(input.expectedOldActiveQuantity);
      const expectedOldUnitPrice = Number(input.expectedOldUnitPrice);
      const expectedOldLineTotal = Number(input.expectedOldLineTotal);
      const expectedSnapshotValid = expectedCatalogSnapshot === null || (Number.isSafeInteger(expectedCatalogSnapshot) && expectedCatalogSnapshot >= 0);
      if (!Number.isSafeInteger(expectedOrderTotal) || expectedOrderTotal < 0
        || !Number.isSafeInteger(expectedOldActiveQuantity) || expectedOldActiveQuantity <= 0
        || !Number.isSafeInteger(expectedOldUnitPrice) || expectedOldUnitPrice < 0
        || !Number.isSafeInteger(expectedOldLineTotal) || expectedOldLineTotal < 0
        || !expectedSnapshotValid) {
        throw new CriticalOperationConflictError('Исходный ценовой снимок itemized-обмена повреждён. Обновите заказ и повторите.');
      }
      if (expectedOrderTotal !== ledger.totalAmount
        || expectedOldActiveQuantity !== oldActiveQuantity
        || expectedOldUnitPrice !== oldUnitPrice
        || expectedOldLineTotal !== oldLineTotal
        || expectedCatalogSnapshot !== oldCatalogPriceSnapshot) {
        throw new CriticalOperationConflictError('Цена или состав заказа изменились после открытия обмена. Обновите заказ и повторите.');
      }

      const newLine = itemizedExchangeWritePlan.lines[0];
      const replacedOldValue = oldQuantity * oldUnitPrice;
      const projectedTotalAmount = currentItemizedTotalAmount - replacedOldValue + newLine.lineTotal;
      if (!Number.isSafeInteger(replacedOldValue) || replacedOldValue < 0
        || !Number.isSafeInteger(projectedTotalAmount) || projectedTotalAmount < 0) {
        throw new CriticalOperationConflictError('Не удалось безопасно рассчитать новый итог itemized-заказа.');
      }
      const currentNetPaid = Math.max(0, ledger.receivedAmount - ledger.returnAmount);
      const projectedNetPaid = financialAction === 'extra_payment'
        ? currentNetPaid + financialAmount
        : financialAction === 'refund'
          ? Math.max(0, currentNetPaid - financialAmount)
          : currentNetPaid;
      if (!Number.isSafeInteger(projectedNetPaid) || projectedNetPaid > projectedTotalAmount) {
        throw new CriticalOperationConflictError(
          `После обмена у заказа останется необъяснённая переплата ${Math.max(0, projectedNetPaid - projectedTotalAmount)}. Укажите достаточный возврат денег или скорректируйте фактическую цену новой позиции.`
        );
      }

      itemizedExchangePricingPlan = {
        projectedTotalAmount,
        currentItemizedTotalAmount,
        oldUnitPrice,
        oldCatalogPriceSnapshot,
        newUnitPrice: newLine.unitPrice,
        newLineTotal: newLine.lineTotal,
        newCatalogPriceSnapshot: newLine.catalogPriceSnapshot,
      };
    }
  }
  const inheritedReplacementSource: OrderItemSourceType = toInt(oldItem.is_workshop, 0)
    ? 'workshop'
    : normalizeSourceType(oldItem.source_type) === 'boutique'
      ? 'boutique'
      : 'warehouse';
  const requestedNewItem = newItems[0];
  const effectiveReplacementSource: OrderItemSourceType = input.newSourceWasManuallyChanged
    ? requestedNewItem.sourceType
    : inheritedReplacementSource;
  const newItem = {
    ...requestedNewItem,
    sourceType: effectiveReplacementSource,
    inventorySource: effectiveReplacementSource === 'boutique' ? 'boutique' : 'warehouse' as SourceType,
    isWorkshop: effectiveReplacementSource === 'workshop',
    unitPrice: isItemizedExchange ? itemizedExchangePricingPlan!.newUnitPrice : 0,
    lineTotal: isItemizedExchange ? itemizedExchangePricingPlan!.newLineTotal : 0,
  };

  // Resolve/check a canonical outgoing replacement before the exchange mutates the old item.
  // This prevents a normal "not enough on the shelf" case from leaving a half-created exchange.
  let preResolvedNewCatalog: { productId: number | null; variantId: number | null } | null = null;
  if (!toInt(criticalOperation.row.target_id, 0) && humanInventoryModelEnabled && !newItem.isWorkshop) {
    const resolved = await resolveCatalogProductAndVariantV2(db, newItem);
    preResolvedNewCatalog = { productId: resolved.productId, variantId: resolved.variantId };
    if (resolved.variantId) {
      const stock = await db.prepare(
        `SELECT quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
      ).bind(newItem.inventorySource, resolved.variantId).first<{ quantity: number }>();
      const physical = Math.max(0, toInt(stock?.quantity, 0));
      const observedPhysical = newItem.observedPhysicalQuantity;
      if (observedPhysical !== null && (!Number.isInteger(observedPhysical) || observedPhysical < 0)) {
        throw new Error('Фактический остаток новой позиции обмена должен быть целым числом не меньше нуля.');
      }
      if (observedPhysical !== null && observedPhysical < newItem.quantity) {
        throw new Error(`Для обмена требуется ${newItem.quantity} шт., но менеджер подтвердил физически только ${observedPhysical} шт.`);
      }
      if (physical < newItem.quantity && observedPhysical === null) {
        throw new Error(`По учёту новой позиции обмена на месте ${physical} шт., требуется ${newItem.quantity}. Если товар физически перед вами, укажите фактическое количество прямо в форме обмена — система исправит остаток и продолжит операцию.`);
      }
    }
  }

  if (!operationContext.baselineCaptured && humanInventoryModelEnabled && !oldItemIsWorkshop && oldWasNotIssued) {
    await releaseOrderReservationV2(
      db,
      oldItemId,
      timestamp,
      `Обмен без физической выдачи старой позиции ${cleanText((existing as any).external_id)}`,
    );
  }

  // Legacy recovery path: if the operator explicitly says that the customer has/returned the item
  // while the old reservation is still open, reconcile the missing handover before accepting it back.
  // The explicit "not_issued" state above never enters this path and therefore never performs a fake
  // stock -1/+1 round trip for an item that physically stayed in the shop.
  if (oldItemNeedsHandoverReconciliation) {
    const handover = await fulfillOrderReservationsV2(
      db,
      orderId,
      cleanText((existing as any).external_id),
      timestamp,
      { orderItemIds: [oldItemId], checkedBy: 'exchange_reconciliation' },
    );
    oldItem = await getOrderItemForReturnOrExchange(db, orderId, oldItemId);
    if (!oldItem || !orderItemWasPhysicallyIssued(oldItem)) {
      const unresolved = Math.max(0, toInt((handover as any)?.unresolved, 0));
      throw new Error(unresolved
        ? `Старая позиция обмена «${cleanText(oldItem?.product_name_snapshot)}» ещё не распознана складом. Сначала разберите эту позицию, чтобы обмен не потерял движение товара.`
        : `Не удалось безопасно восстановить выдачу старой позиции «${cleanText(oldItem?.product_name_snapshot)}». Обмен остановлен без приёма новой вещи.`);
    }
  }
  if (!operationContext.baselineCaptured) {
    operationContext = {
      ...operationContext,
      baselineCaptured: true,
      startedAt: timestamp,
      rawOldQuantity,
      activeStandaloneReturnedQuantity,
      availableOldQuantity,
      availableRefundAmount,
      baseTotalAmount: ledger.totalAmount,
      itemizedExchangePricingPlan: itemizedExchangePricingPlan || null,
      oldWorkshopTaskId: toInt(oldWorkshopTask?.id, 0) || null,
      oldWorkshopTaskStatus: cleanText(oldWorkshopTask?.status) || null,
      oldWorkshopTaskQuantity: toInt(oldWorkshopTask?.quantity, 0) || 0,
    };
    await advanceCriticalOperation(db, criticalOperation, 'validated', { context: operationContext });
  }

  let exchangeId = toInt(criticalOperation.row.target_id, 0);
  if (!exchangeId) {
    const exchangeStatement = db.prepare(
      `INSERT INTO exchanges (
        order_id, manager_id, exchange_date, old_order_item_id, old_quantity, old_return_source,
        new_source_type, financial_action, financial_amount, payment_method, status, comment, created_at,
        old_workshop_task_id, old_workshop_task_status, old_workshop_task_quantity,
        old_item_stock_writeoff_status, old_item_replaced_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      orderId, managerRow?.manager_id ?? null, exchangeDate, oldItemId, oldQuantity, oldReturnSource,
      newItem.sourceType, financialAction, financialAmount, paymentMethod || null, comment || null, timestamp,
      toInt(operationContext.oldWorkshopTaskId, 0) || null, cleanText(operationContext.oldWorkshopTaskStatus) || null,
      toInt(operationContext.oldWorkshopTaskQuantity, 0) || null, cleanText(oldItem.stock_writeoff_status) || null, timestamp,
    );
    exchangeId = await updateCriticalOperationTargetFromLastInsert(
      db, criticalOperation, 'exchange', cleanText((existing as any).external_id), exchangeStatement, 'exchange_created',
    );
  }
  if (!exchangeId) throw new Error('Exchange record was not created.');
  const oldExchangeItemMapped = await insertCriticalMappedEntity(
    db, criticalOperation, 'exchange_item', 'exchange:old',
    db.prepare(
      `INSERT INTO exchange_items (
        exchange_id, role, order_item_id, product_name_snapshot, gender_snapshot, color_snapshot,
        material_snapshot, length_snapshot, size_snapshot, quantity, inventory_source,
        physical_tracking, physical_received_at, created_at
      ) VALUES (?, 'old', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      exchangeId, oldItemId, cleanText(oldItem.product_name_snapshot), cleanText(oldItem.gender_snapshot) || null,
      cleanText(oldItem.color_snapshot) || null, cleanText(oldItem.material_snapshot) || null,
      cleanText(oldItem.length_snapshot) || null, cleanText(oldItem.size_snapshot) || null, oldQuantity,
      oldWasNotIssued ? 'not_issued' : (oldReturnSource === 'none' ? null : oldReturnSource),
      oldPhysicalTracking ? 1 : 0, oldPhysicalTracking && oldPhysicalState !== 'pending' ? timestamp : null, timestamp,
    ),
  );
  const oldExchangeItemId = oldExchangeItemMapped.id;

  const stockReturns: unknown[] = [];
  const pendingInventory: unknown[] = [];
  if (oldReturnSource !== 'none') {
    const oldIsWorkshop = oldItemIsWorkshop;
    const resolvedOld = await resolveInventoryLifecycleCandidate(db, oldItem, oldIsWorkshop);
    const oldEvent = await insertInventoryLifecycleEvent(db, {
      eventKey: `exchange:${exchangeId}:old`,
      operationType: 'exchange',
      operationId: exchangeId,
      operationItemId: oldExchangeItemId,
      orderId,
      orderItemId: oldItemId,
      eventType: 'exchange_old_in',
      direction: 'in',
      inventorySource: oldReturnSource,
      quantity: oldQuantity,
      item: oldItem,
      isWorkshop: oldIsWorkshop,
      productId: resolvedOld.productId,
      variantId: resolvedOld.variantId,
      pendingReason: inventoryLifecyclePendingReason(resolvedOld, oldIsWorkshop),
      timestamp,
    });
    const autoApplyWorkshop = Boolean(oldIsWorkshop && resolvedOld.variantId && await canAutoApplyFreshWorkshopInbound(db, oldEvent, resolvedOld.variantId));
    if (resolvedOld.variantId && (!oldIsWorkshop || autoApplyWorkshop)) {
      stockReturns.push(await applyCanonicalInventoryLifecycleEvent(
        db,
        oldEvent.id,
        resolvedOld.variantId,
        timestamp,
        comment || `Возврат старой позиции обмена ${(existing as any).external_id}`,
      ));
    } else {
      pendingInventory.push({ eventId: oldEvent.id, eventType: oldEvent.event_type, productName: cleanText(oldItem.product_name_snapshot), source: oldReturnSource });
    }
  }

  // order_items.quantity tracks exchange replacement only. Standalone returns stay in
  // return_items, so subtracting them here would make the next operation count them twice.
  const remainingOldQuantity = Math.max(0, rawOldQuantity - oldQuantity);
  await db.prepare(
    `UPDATE order_items
     SET quantity = ?,
         line_total = unit_price * ?,
         stock_writeoff_status = CASE WHEN ? <= 0 THEN 'exchanged' ELSE stock_writeoff_status END
     WHERE id = ? AND order_id = ?`
  ).bind(remainingOldQuantity, remainingOldQuantity, remainingOldQuantity, oldItemId, orderId).run();

  if (toInt(operationContext.oldWorkshopTaskId, 0)) {
    const previousTaskQuantity = Math.max(0, toInt(operationContext.oldWorkshopTaskQuantity, 0));
    const nextTaskQuantity = Math.max(0, previousTaskQuantity - oldQuantity);
    await db.prepare(
      `UPDATE workshop_tasks SET quantity = ?, status = ?, updated_at = ? WHERE id = ?`
    ).bind(
      nextTaskQuantity,
      nextTaskQuantity <= 0 ? 'cancelled' : cleanText(operationContext.oldWorkshopTaskStatus) || 'active',
      timestamp,
      toInt(operationContext.oldWorkshopTaskId, 0),
    ).run();
  }

  const insertedContent = await insertOrderContent(
    db,
    orderId,
    cleanText((existing as any).external_id),
    [newItem],
    [],
    timestamp,
    'exchange_new',
    String(exchangeId),
    `Списание новой позиции обмена #${exchangeId}`,
    preResolvedNewCatalog ? [preResolvedNewCatalog] : undefined,
    criticalOperation,
    'exchange_new',
    undefined,
    isItemizedExchange ? itemizedExchangeWritePlan : null,
  );

  const newOrderItemId = await criticalOperationEntityId(db, criticalOperation.requestId, 'order_item', 'exchange_new:item:1');

  await db.prepare(`UPDATE exchanges SET new_order_item_id = ? WHERE id = ?`).bind(newOrderItemId, exchangeId).run();
  const newExchangeItemMapped = await insertCriticalMappedEntity(
    db, criticalOperation, 'exchange_item', 'exchange:new',
    db.prepare(
      `INSERT INTO exchange_items (
        exchange_id, role, order_item_id, product_name_snapshot, gender_snapshot, color_snapshot,
        material_snapshot, length_snapshot, size_snapshot, quantity, inventory_source, created_at
      ) VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      exchangeId, newOrderItemId, newItem.productName, newItem.gender || null, newItem.color || null,
      newItem.material || null, newItem.length || null, newItem.size || null, newItem.quantity,
      newItem.isWorkshop ? 'workshop' : newItem.inventorySource, timestamp,
    ),
  );
  const newExchangeItemId = newExchangeItemMapped.id;

  let newStockWriteOff: unknown = null;
  if (newOrderItemId && !newItem.isWorkshop && humanInventoryModelEnabled) {
    const insertedNewOrderItem = await getOrderItemForReturnOrExchange(db, orderId, newOrderItemId);
    if (!insertedNewOrderItem) throw new Error('Новая позиция обмена не найдена после сохранения.');
    const resolvedNew = await resolveInventoryLifecycleCandidate(db, insertedNewOrderItem, false);
    const newEvent = await insertInventoryLifecycleEvent(db, {
      eventKey: `exchange:${exchangeId}:new`,
      operationType: 'exchange',
      operationId: exchangeId,
      operationItemId: newExchangeItemId,
      orderId,
      orderItemId: newOrderItemId,
      eventType: 'exchange_new_out',
      direction: 'out',
      inventorySource: newItem.inventorySource,
      quantity: newItem.quantity,
      item: insertedNewOrderItem,
      isWorkshop: false,
      productId: resolvedNew.productId,
      variantId: resolvedNew.variantId,
      pendingReason: inventoryLifecyclePendingReason(resolvedNew, false),
      timestamp,
    });
    if (resolvedNew.variantId) {
      newStockWriteOff = await applyCanonicalInventoryLifecycleEvent(
        db,
        newEvent.id,
        resolvedNew.variantId,
        timestamp,
        `Физическое списание новой позиции обмена #${exchangeId}`,
      );
    } else {
      pendingInventory.push({ eventId: newEvent.id, eventType: newEvent.event_type, productName: cleanText(insertedNewOrderItem.product_name_snapshot), source: newItem.inventorySource });
    }
  }

  if (newItem.isWorkshop && newOrderItemId) {
    await ensureExchangeWorkshopReplacementTask(db, {
      exchangeId,
      orderId,
      externalId: cleanText((existing as any).external_id),
      orderItemId: newOrderItemId,
      timestamp,
    });
  }

  let paymentId: number | null = null;
  let refundReturnId: number | null = null;
  let nextTotalAmount = isItemizedExchange
    ? Math.max(0, toInt(itemizedExchangePricingPlan?.projectedTotalAmount, ledger.totalAmount))
    : Math.max(0, toInt(operationContext.baseTotalAmount, ledger.totalAmount));

  if (financialAction === 'extra_payment') {
    const paymentComment = comment || `Доплата по обмену #${exchangeId}`;
    const paymentEntityKey = 'exchange:extra-payment';
    paymentId = await criticalOperationEntityId(db, criticalOperation.requestId, 'payment', paymentEntityKey);
    if (!paymentId) {
      const pair = buildPaymentAndMoneyEventStatements(db, {
        orderId, externalOrderId: cleanText((existing as any).external_id), paymentDate: exchangeDate, method: paymentMethod,
        amount: financialAmount, paymentKind: 'extra', comment: paymentComment, timestamp, eventType: 'exchange_extra',
        sourceType: 'exchange', sourceId: exchangeId, sourceRef: `exchanges:${exchangeId}`, reason: 'exchange_created',
        eventKey: `1901:${criticalOperation.requestId}:exchange-extra`,
      });
      const [paymentInsert] = await db.batch([
        pair.payment,
        db.prepare(
          `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
           VALUES (?, 'payment', ?, last_insert_rowid(), ?)
           ON CONFLICT(request_id, entity_type, entity_key) DO NOTHING`
        ).bind(criticalOperation.requestId, paymentEntityKey, timestamp),
        pair.event,
      ]);
      paymentId = await criticalOperationEntityId(db, criticalOperation.requestId, 'payment', paymentEntityKey) || toInt(paymentInsert.meta?.last_row_id, 0) || null;
    }
    if (!isItemizedExchange) {
      nextTotalAmount = Math.max(0, toInt(operationContext.baseTotalAmount, ledger.totalAmount)) + financialAmount;
    }
  } else if (financialAction === 'refund') {
    const refundComment = comment || `Возврат средств по обмену #${exchangeId}`;
    const refundEntityKey = 'exchange:refund-return';
    refundReturnId = await criticalOperationEntityId(db, criticalOperation.requestId, 'return', refundEntityKey);
    if (!refundReturnId) {
      const [returnInsert] = await db.batch([
        db.prepare(
          `INSERT INTO returns (order_id, manager_id, return_date, amount, payment_method, comment, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`
        ).bind(orderId, managerRow?.manager_id ?? null, exchangeDate, financialAmount, paymentMethod, refundComment, timestamp),
        db.prepare(
          `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
           VALUES (?, 'return', ?, last_insert_rowid(), ?)
           ON CONFLICT(request_id, entity_type, entity_key) DO NOTHING`
        ).bind(criticalOperation.requestId, refundEntityKey, timestamp),
        refundMoneyEventStatement(db, {
          eventKey: `1901:${criticalOperation.requestId}:exchange-refund`, orderId, externalOrderId: cleanText((existing as any).external_id),
          returnDate: exchangeDate, amount: financialAmount, paymentMethod, timestamp, eventType: 'exchange_refund', sourceId: exchangeId,
          sourceRef: `exchanges:${exchangeId}`, comment: refundComment, reason: 'exchange_created',
        }),
      ]);
      refundReturnId = await criticalOperationEntityId(db, criticalOperation.requestId, 'return', refundEntityKey) || Number(returnInsert.meta?.last_row_id || 0) || null;
    }
    if (refundReturnId) {
      const existingRefundItem = await criticalOperationEntityId(db, criticalOperation.requestId, 'return_item', 'exchange:refund-item');
      if (!existingRefundItem) {
        await insertCriticalMappedEntity(
          db, criticalOperation, 'return_item', 'exchange:refund-item',
          db.prepare(
            `INSERT INTO return_items (
              return_id, order_item_id, product_name_snapshot, quantity, amount, inventory_source, restocked,
              gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, created_at
            ) VALUES (?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, ?, ?, ?)`
          ).bind(
            refundReturnId, oldItemId, cleanText(oldItem.product_name_snapshot), oldQuantity, financialAmount,
            cleanText(oldItem.gender_snapshot) || null, cleanText(oldItem.color_snapshot) || null,
            cleanText(oldItem.material_snapshot) || null, cleanText(oldItem.length_snapshot) || null,
            cleanText(oldItem.size_snapshot) || null, timestamp,
          ),
        );
      }
    }
    if (!isItemizedExchange) {
      nextTotalAmount = Math.max(0, Math.max(0, toInt(operationContext.baseTotalAmount, ledger.totalAmount)) - financialAmount);
    }
  }

  if (isItemizedExchange || financialAction !== 'none') {
    await db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`).bind(nextTotalAmount, timestamp, orderId).run();
  }
  if (financialAction !== 'none') {
    await db.prepare(`UPDATE exchanges SET payment_id = ?, refund_return_id = ? WHERE id = ?`).bind(paymentId, refundReturnId, exchangeId).run();
  }

  await syncOrderFinancialLedger(db, orderId, timestamp);
  try {
    await refreshOrderWorkshopStatusFromTasks(db, orderId, timestamp);
  } catch (error) {
    console.warn('Workshop order status cache refresh failed after committed exchange', error);
  }

  const completedResponse = {
    ok: true,
    exchangeId,
    oldStockReturn: stockReturns,
    newStockWriteOff,
    pendingInventory,
    pendingInventoryCount: pendingInventory.length,
    workshopCount: insertedContent.workshopCount,
    financialAction,
    financialAmount,
    refreshRequired: true,
  };
  await completeCriticalOperation(db, criticalOperation, completedResponse);
  let updatedOrder = null;
  try {
    updatedOrder = await getOrder(db, orderId);
  } catch (error) {
    console.warn('Order readback after committed exchange failed', error);
  }
  const response = updatedOrder ? { ...completedResponse, order: updatedOrder, refreshRequired: false } : completedResponse;
  try {
    await writeActivityLog(db, {
      eventType: 'exchange_created',
      entityType: 'exchange',
      entityId: exchangeId,
      orderId,
      externalOrderId: cleanText((existing as any).external_id),
      title: `Оформлен обмен по заказу ${cleanText((existing as any).external_id)}`,
      details: `Старый товар: ${cleanText(oldItem.product_name_snapshot)} × ${oldQuantity}; новый источник: ${newItem.sourceType}; финансы: ${financialAction}`,
      amount: financialAmount,
      createdAt: timestamp,
    });
  } catch (error) {
    console.warn('Exchange activity log after committed exchange failed', error);
  }
  return response;
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}



export async function correctExchangeFinancials(
  db: D1Database,
  exchangeId: number,
  input: {
    requestId?: string;
    exchangeDate?: string;
    financialAmount?: number;
    paymentMethod?: string;
    comment?: string;
    expectedExchangeDate?: string;
    expectedFinancialAmount?: number;
    expectedPaymentMethod?: string;
    expectedComment?: string;
  },
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
    if (!exchangeId) throw new Error('exchangeId is required.');
    const timestamp = new Date().toISOString();
    criticalOperation = await beginCriticalOperation(db, 'exchange_financial_correction', input.requestId, input, { exchangeId, createdAt: timestamp });
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;

    const row = await db.prepare(
      `SELECT e.id, e.order_id, e.exchange_date, e.financial_action, e.financial_amount, e.payment_method,
              e.payment_id, e.refund_return_id, e.comment, e.status,
              o.external_id, o.order_status, o.pricing_mode,
              p.id AS linked_payment_id, p.payment_date AS linked_payment_date, p.method AS linked_payment_method,
              p.amount AS linked_payment_amount, p.comment AS linked_payment_comment,
              r.id AS linked_return_id, r.return_date AS linked_return_date, r.payment_method AS linked_return_method,
              r.amount AS linked_return_amount, r.comment AS linked_return_comment, r.status AS linked_return_status
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       LEFT JOIN payments p ON p.id = e.payment_id AND p.order_id = e.order_id
       LEFT JOIN returns r ON r.id = e.refund_return_id AND r.order_id = e.order_id
       WHERE e.id = ?`
    ).bind(exchangeId).first<any>();
    if (!row) throw new Error('Обмен не найден.');
    if (cleanText(row.status) === 'cancelled') throw new Error('Отменённый обмен нельзя исправлять.');
    if (normalizeOrderStatus(row.order_status) === 'deleted') throw new Error('Нельзя исправлять обмен удалённого заказа.');

    const financialAction = normalizeExchangeFinancialAction(row.financial_action);
    if (financialAction !== 'extra_payment' && financialAction !== 'refund') {
      throw new Error('У этого обмена нет денежной операции для исправления.');
    }

    const rawExchangeDate = cleanText(input.exchangeDate);
    if (!rawExchangeDate) throw new Error('Укажите дату денежной операции обмена.');
    const nextExchangeDate = normalizeDate(rawExchangeDate);
    const nextAmountRaw = Number(input.financialAmount);
    if (!Number.isInteger(nextAmountRaw) || nextAmountRaw <= 0) throw new Error('Укажите целую сумму больше нуля.');
    const nextAmount = Math.trunc(nextAmountRaw);
    const nextMethod = upperText(input.paymentMethod);
    if (!nextMethod) throw new Error(financialAction === 'refund' ? 'Выберите способ возврата денег.' : 'Выберите способ оплаты доплаты.');
    const nextComment = cleanText(input.comment);

    const oldExchangeDate = normalizeDate(row.exchange_date);
    const oldAmount = Math.max(0, toInt(row.financial_amount, 0));
    const oldMethod = upperText(row.payment_method);
    const oldComment = cleanText(row.comment);
    if (!oldAmount || !oldMethod) throw new Error('У обмена повреждены данные денежной операции. Отмена обмена остаётся безопасным вариантом.');

    const expectedProvided = ['expectedExchangeDate', 'expectedFinancialAmount', 'expectedPaymentMethod', 'expectedComment']
      .every((key) => Object.prototype.hasOwnProperty.call(input, key));
    if (!expectedProvided) {
      throw new CriticalOperationConflictError('Обновите историю обменов перед исправлением: не хватает исходного снимка операции.');
    }
    const expectedMatches = normalizeDate(input.expectedExchangeDate) === oldExchangeDate
      && Math.max(0, toInt(input.expectedFinancialAmount, 0)) === oldAmount
      && upperText(input.expectedPaymentMethod) === oldMethod
      && cleanText(input.expectedComment) === oldComment;

    const linkedId = financialAction === 'extra_payment' ? toInt(row.linked_payment_id, 0) : toInt(row.linked_return_id, 0);
    const linkedDate = normalizeDate(financialAction === 'extra_payment' ? row.linked_payment_date : row.linked_return_date);
    const linkedAmount = Math.max(0, toInt(financialAction === 'extra_payment' ? row.linked_payment_amount : row.linked_return_amount, 0));
    const linkedMethod = upperText(financialAction === 'extra_payment' ? row.linked_payment_method : row.linked_return_method);
    if (!linkedId) throw new Error(financialAction === 'extra_payment' ? 'Связанная доплата обмена не найдена.' : 'Связанный возврат обмена не найден.');
    if (financialAction === 'refund' && cleanText(row.linked_return_status) === 'cancelled') throw new Error('Связанный возврат этого обмена уже отменён.');
    if (linkedDate !== oldExchangeDate || linkedAmount !== oldAmount || linkedMethod !== oldMethod) {
      throw new CriticalOperationConflictError('Денежные данные обмена изменились отдельно. Обновите историю и повторите исправление.');
    }

    const alreadyDesired = oldExchangeDate === nextExchangeDate
      && oldAmount === nextAmount
      && oldMethod === nextMethod
      && oldComment === nextComment;
    if (!alreadyDesired && !expectedMatches) {
      throw new CriticalOperationConflictError('Обмен уже изменился после открытия формы. Обновите историю и повторите исправление.');
    }

    const orderId = toInt(row.order_id, 0);
    const externalOrderId = cleanText(row.external_id);
    if (alreadyDesired) {
      await syncOrderFinancialLedger(db, orderId);
      const completedResponse = { ok: true, exchangeId, unchanged: true, refreshRequired: true };
      await completeCriticalOperation(db, criticalOperation, completedResponse);
      let order = null;
      try {
        order = await getOrder(db, orderId);
      } catch (error) {
        console.warn('Order readback after unchanged exchange financial correction failed', error);
      }
      return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse;
    }

    await syncOrderFinancialLedger(db, orderId);
    const ledger = await readOrderFinancialLedger(db, orderId);
    const isItemizedExchange = cleanText(row.pricing_mode) === 'itemized_v1';
    let nextTotalAmount = ledger.totalAmount;
    let projectedReceivedAmount = ledger.receivedAmount;
    let projectedReturnAmount = ledger.returnAmount;
    if (financialAction === 'extra_payment') {
      projectedReceivedAmount = Math.max(0, ledger.receivedAmount - oldAmount + nextAmount);
      if (!isItemizedExchange) {
        nextTotalAmount = ledger.totalAmount - oldAmount + nextAmount;
      }
    } else {
      const otherReturns = Math.max(0, ledger.returnAmount - oldAmount);
      const availableRefund = Math.max(0, ledger.receivedAmount - otherReturns);
      if (nextAmount > availableRefund) {
        throw new Error(`Сумма возврата ${nextAmount} больше доступной суммы ${availableRefund}.`);
      }
      projectedReturnAmount = otherReturns + nextAmount;
      if (!isItemizedExchange) {
        nextTotalAmount = ledger.totalAmount + oldAmount - nextAmount;
      }
    }
    if (!Number.isSafeInteger(nextTotalAmount) || nextTotalAmount < 0) throw new Error('Исправление привело бы к некорректной сумме заказа.');
    if (isItemizedExchange) {
      const projectedNetPaid = Math.max(0, projectedReceivedAmount - projectedReturnAmount);
      if (!Number.isSafeInteger(projectedNetPaid) || projectedNetPaid > nextTotalAmount) {
        throw new CriticalOperationConflictError(
          `После исправления денежной части обмена у itemized-заказа останется необъяснённая переплата ${Math.max(0, projectedNetPaid - nextTotalAmount)}. Увеличьте возврат или уменьшите доплату.`
        );
      }
    }

    const cashSettings = await db.prepare(
      `SELECT auto_tracking_enabled FROM cash_register_settings WHERE id = 1`
    ).first<any>();
    const baseCashKey = financialAction === 'extra_payment' ? `payment:${linkedId}` : `return:${linkedId}`;
    const cashTrackedRow = await db.prepare(
      `SELECT id FROM cash_register_entries
       WHERE source_key = ?
          OR (source_type = 'exchange_financial_correction' AND source_id = ?)
       ORDER BY id DESC LIMIT 1`
    ).bind(baseCashKey, String(exchangeId)).first<any>();
    const cashTrackingEnabled = toInt(cashSettings?.auto_tracking_enabled, 0) === 1;
    const cashWasTracked = Boolean(cashTrackedRow?.id);
    const isCashMethod = (value: unknown) => {
      const method = upperText(value);
      return method === 'НАЛИЧКА' || method === 'НАЛИЧНЫЕ' || method === 'CASH' || method.includes('НАЛИЧ');
    };
    const oldCashTrackedAmount = isCashMethod(oldMethod) && cashWasTracked ? oldAmount : 0;
    const newCashTrackedAmount = isCashMethod(nextMethod) && (cashWasTracked || cashTrackingEnabled) ? nextAmount : 0;
    const sign = financialAction === 'extra_payment' ? 1 : -1;
    const cashDelta = (newCashTrackedAmount * sign) - (oldCashTrackedAmount * sign);

    const requestId = cleanText(criticalOperation.requestId);
    const eventSourceRef = `exchanges:${exchangeId}:financial-correction:${requestId}`;
    const auditComment = [
      `Исправление денег обмена #${exchangeId}`,
      `${oldExchangeDate} → ${nextExchangeDate}`,
      `${oldAmount} → ${nextAmount}`,
      `${oldMethod} → ${nextMethod}`,
      oldComment !== nextComment ? `Комментарий: «${oldComment || '—'}» → «${nextComment || '—'}»` : '',
    ].filter(Boolean).join(' · ');

    const statements: D1PreparedStatement[] = [];
    statements.push(financialEventStatement(db, {
      eventKey: `189c:exchange:${exchangeId}:financial-correction:${requestId}:old`,
      orderId,
      externalOrderId,
      eventDate: oldExchangeDate,
      eventAt: timestamp,
      eventType: financialAction === 'extra_payment' ? 'payment_reversal' : 'refund_reversal',
      relatedType: financialAction === 'extra_payment' ? 'exchange_extra' : 'exchange_refund',
      amountDelta: financialAction === 'extra_payment' ? -oldAmount : oldAmount,
      paymentMethod: oldMethod,
      sourceType: 'exchange',
      sourceId: exchangeId,
      sourceRef: eventSourceRef,
      reason: 'exchange_financial_correction',
      comment: auditComment,
    }));
    statements.push(financialEventStatement(db, {
      eventKey: `189c:exchange:${exchangeId}:financial-correction:${requestId}:new`,
      orderId,
      externalOrderId,
      eventDate: nextExchangeDate,
      eventAt: timestamp,
      eventType: financialAction === 'extra_payment' ? 'exchange_extra' : 'exchange_refund',
      amountDelta: financialAction === 'extra_payment' ? nextAmount : -nextAmount,
      paymentMethod: nextMethod,
      sourceType: 'exchange',
      sourceId: exchangeId,
      sourceRef: eventSourceRef,
      reason: 'exchange_financial_correction',
      comment: auditComment,
    }));

    if (financialAction === 'extra_payment') {
      statements.push(db.prepare(
        `UPDATE payments
         SET payment_date = ?, method = ?, amount = ?, comment = ?
         WHERE id = ? AND order_id = ?`
      ).bind(nextExchangeDate, nextMethod, nextAmount, nextComment || `Доплата по обмену #${exchangeId}`, linkedId, orderId));
    } else {
      statements.push(db.prepare(
        `UPDATE returns
         SET return_date = ?, amount = ?, payment_method = ?, comment = ?
         WHERE id = ? AND order_id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
      ).bind(nextExchangeDate, nextAmount, nextMethod, nextComment || `Возврат денег по обмену #${exchangeId}`, linkedId, orderId));
      statements.push(db.prepare(`UPDATE return_items SET amount = ? WHERE return_id = ?`).bind(nextAmount, linkedId));
    }

    statements.push(db.prepare(
      `UPDATE exchanges
       SET exchange_date = ?, financial_amount = ?, payment_method = ?, comment = ?
       WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
    ).bind(nextExchangeDate, nextAmount, nextMethod, nextComment || null, exchangeId));
    if (!isItemizedExchange) {
      statements.push(db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`).bind(nextTotalAmount, timestamp, orderId));
    }

    if (cashDelta) {
      const cashDirection = cashDelta > 0 ? 'in' : 'out';
      statements.push(db.prepare(
        `INSERT OR IGNORE INTO cash_register_entries (
           occurred_at, business_date, direction, amount, entry_type,
           source_type, source_id, source_key, order_id, external_order_id,
           payment_method, comment, created_by, created_at
         ) VALUES (?, date('now', '+5 hours'), ?, ?, 'exchange_financial_correction',
                   'exchange_financial_correction', ?, ?, ?, ?, ?, ?, 'Автоучёт', ?)`
      ).bind(
        timestamp, cashDirection, Math.abs(cashDelta), String(exchangeId),
        `exchange-financial-correction:${requestId}:cash-delta`, orderId, externalOrderId,
        nextMethod, auditComment, timestamp,
      ));
    }

    await db.batch(statements);
    await syncOrderFinancialLedger(db, orderId);
    const completedResponse = {
      ok: true,
      exchangeId,
      financialAction,
      financialAmount: nextAmount,
      exchangeDate: nextExchangeDate,
      paymentMethod: nextMethod,
      refreshRequired: true,
    };
    // All business writes are committed at this point. Complete the idempotent operation
    // before secondary readback/logging so a transient read failure cannot report a
    // successful money correction as failed and invite a misleading retry.
    await completeCriticalOperation(db, criticalOperation, completedResponse);
    let order = null;
    try {
      order = await getOrder(db, orderId);
    } catch (error) {
      console.warn('Order readback after committed exchange financial correction failed', error);
    }
    try {
      await writeActivityLog(db, {
        eventType: 'exchange_financial_corrected',
        entityType: 'exchange',
        entityId: exchangeId,
        orderId,
        externalOrderId,
        title: `Исправлена денежная часть обмена #${exchangeId}`,
        details: auditComment,
        amount: nextAmount,
        createdAt: timestamp,
      });
    } catch (error) {
      console.warn('Exchange financial correction activity log failed after committed correction', error);
    }
    return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse;
  } catch (error) {
    if (criticalOperation) await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}

export async function listExchanges(db: D1Database, url: URL) {
  const orderId = toInt(url.searchParams.get('orderId'), 0);
  const limit = Math.min(100, Math.max(20, toInt(url.searchParams.get('limit'), 50)));
  const offset = Math.max(0, toInt(url.searchParams.get('offset'), 0));
  const query = upperText(url.searchParams.get('q'));
  const dateFrom = cleanText(url.searchParams.get('dateFrom'));
  const dateTo = cleanText(url.searchParams.get('dateTo'));
  const status = cleanText(url.searchParams.get('status')).toLowerCase();
  const where: string[] = [];
  const bindings: Array<string | number> = [];
  if (orderId) { where.push('e.order_id = ?'); bindings.push(orderId); }
  if (dateFrom) { where.push('e.exchange_date >= ?'); bindings.push(normalizeDate(dateFrom)); }
  if (dateTo) { where.push('e.exchange_date <= ?'); bindings.push(normalizeDate(dateTo)); }
  if (status === 'completed') where.push("COALESCE(e.status, 'completed') <> 'cancelled'");
  if (status === 'cancelled') where.push("COALESCE(e.status, 'completed') = 'cancelled'");
  if (query) {
    where.push(`INSTR(UPPER(
      COALESCE(o.external_id, '') || ' ' || COALESCE(m.name, '') || ' ' || COALESCE(c.display_name, '') || ' ' || COALESCE(c.phone_normalized, '') || ' ' ||
      COALESCE(e.comment, '') || ' ' || COALESCE(e.cancellation_comment, '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(product_name_snapshot, ' ') FROM exchange_items WHERE exchange_id = e.id AND role = 'old'), '') || ' ' ||
      COALESCE((SELECT GROUP_CONCAT(product_name_snapshot, ' ') FROM exchange_items WHERE exchange_id = e.id AND role = 'new'), '')
    ), ?) > 0`);
    bindings.push(query);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const summary = await db.prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') <> 'cancelled' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
            COALESCE(SUM(CASE
              WHEN COALESCE(e.status, 'completed') <> 'cancelled'
              THEN COALESCE((
                SELECT SUM(ei.quantity)
                FROM exchange_items ei
                WHERE ei.exchange_id = e.id
                  AND ei.role = 'old'
                  AND COALESCE(ei.physical_tracking, 0) = 1
                  AND ei.physical_received_at IS NULL
              ), 0)
              ELSE 0
            END), 0) AS pending_physical_quantity
     FROM exchanges e JOIN orders o ON o.id = e.order_id
     LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id
     ${whereSql}`
  ).bind(...bindings).first<Record<string, unknown>>();

  const result = await db.prepare(
    `SELECT e.*, o.external_id, o.order_date, m.name AS manager_name, m.color_key AS manager_color, c.phone_normalized AS customer_phone, c.display_name AS customer_name,
       EXISTS(
         SELECT 1 FROM critical_operations co
         WHERE co.operation_type = 'exchange_set_create' AND co.target_type = 'exchange' AND co.target_id = e.id
       ) AS is_set_exchange,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.product_name_snapshot ELSE old_item.product_name_snapshot END AS old_product_name,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.quantity ELSE e.old_quantity END AS old_item_quantity,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.gender_snapshot ELSE old_item.gender_snapshot END AS old_gender_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.color_snapshot ELSE old_item.color_snapshot END AS old_color_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.material_snapshot ELSE old_item.material_snapshot END AS old_material_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.length_snapshot ELSE old_item.length_snapshot END AS old_length_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.size_snapshot ELSE old_item.size_snapshot END AS old_size_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.inventory_source ELSE e.old_return_source END AS old_inventory_source,
       old_snapshot.id AS old_operation_item_id,
       old_snapshot.physical_tracking AS old_physical_tracking,
       old_snapshot.physical_received_at AS old_physical_received_at,
       COALESCE(old_item.is_workshop, 0) AS old_is_workshop,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.quantity ELSE new_item.quantity END AS new_item_quantity,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.gender_snapshot ELSE new_item.gender_snapshot END AS new_gender_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.color_snapshot ELSE new_item.color_snapshot END AS new_color_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.material_snapshot ELSE new_item.material_snapshot END AS new_material_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.length_snapshot ELSE new_item.length_snapshot END AS new_length_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.size_snapshot ELSE new_item.size_snapshot END AS new_size_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.inventory_source ELSE e.new_source_type END AS new_inventory_source,
       old_lifecycle.id AS old_lifecycle_id, old_lifecycle.variant_id AS old_lifecycle_variant_id, old_lifecycle.status AS old_lifecycle_status,
       old_item.variant_id AS old_current_variant_id,
       new_lifecycle.id AS new_lifecycle_id, new_lifecycle.status AS new_lifecycle_status
     FROM exchanges e JOIN orders o ON o.id = e.order_id
     LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id
     LEFT JOIN exchange_items old_snapshot ON old_snapshot.id = (SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'old' ORDER BY ei.id ASC LIMIT 1)
     LEFT JOIN exchange_items new_snapshot ON new_snapshot.id = (SELECT ei.id FROM exchange_items ei WHERE ei.exchange_id = e.id AND ei.role = 'new' ORDER BY ei.id ASC LIMIT 1)
     LEFT JOIN order_items old_item ON old_item.id = e.old_order_item_id LEFT JOIN order_items new_item ON new_item.id = e.new_order_item_id
     LEFT JOIN inventory_lifecycle_events old_lifecycle ON old_lifecycle.id = (SELECT le.id FROM inventory_lifecycle_events le WHERE le.operation_type = 'exchange' AND le.operation_id = e.id AND le.event_type = 'exchange_old_in' ORDER BY le.id DESC LIMIT 1)
     LEFT JOIN inventory_lifecycle_events new_lifecycle ON new_lifecycle.id = (SELECT le.id FROM inventory_lifecycle_events le WHERE le.operation_type = 'exchange' AND le.operation_id = e.id AND le.event_type = 'exchange_new_out' ORDER BY le.id DESC LIMIT 1)
     ${whereSql}
     ORDER BY e.exchange_date DESC, e.id DESC LIMIT ? OFFSET ?`
  ).bind(...bindings, limit, offset).all<Record<string, unknown>>();
  const baseRows = result.results || [];
  const pageExchangeIds = baseRows.map((row) => toInt(row.id, 0)).filter(Boolean);
  const exchangeItems = pageExchangeIds.length
    ? await db.prepare(
        `SELECT ei.*, oi.unit_price, oi.catalog_price_snapshot, oi.is_workshop, oi.variant_id AS current_variant_id,
                le.id AS lifecycle_id, le.variant_id AS lifecycle_variant_id, le.status AS lifecycle_status
         FROM exchange_items ei
         LEFT JOIN order_items oi ON oi.id = ei.order_item_id
         LEFT JOIN inventory_lifecycle_events le ON le.id = (
           SELECT child.id
           FROM inventory_lifecycle_events child
           WHERE child.operation_type = 'exchange'
             AND child.operation_id = ei.exchange_id
             AND child.operation_item_id = ei.id
           ORDER BY child.id DESC
           LIMIT 1
         )
         WHERE ei.exchange_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
         ORDER BY ei.exchange_id DESC, ei.role ASC, ei.id ASC`
      ).bind(JSON.stringify(pageExchangeIds)).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };

  const itemGroups = new Map<number, { oldItems: Record<string, unknown>[]; newItems: Record<string, unknown>[] }>();
  for (const item of exchangeItems.results || []) {
    const exchangeId = toInt(item.exchange_id, 0);
    if (!exchangeId) continue;
    const group = itemGroups.get(exchangeId) || { oldItems: [], newItems: [] };
    const serialized = {
      id: toInt(item.id, 0),
      orderItemId: toInt(item.order_item_id, 0) || null,
      productName: cleanText(item.product_name_snapshot) || '—',
      quantity: Math.max(0, toInt(item.quantity, 0)),
      gender: cleanText(item.gender_snapshot),
      color: cleanText(item.color_snapshot),
      material: cleanText(item.material_snapshot),
      length: cleanText(item.length_snapshot),
      size: cleanText(item.size_snapshot),
      inventorySource: cleanText(item.inventory_source) || null,
      physicalTracking: Boolean(toInt(item.physical_tracking, 0)),
      physicalReceivedAt: cleanText(item.physical_received_at) || null,
      isWorkshop: Boolean(toInt(item.is_workshop, 0)),
      unitPrice: Math.max(0, toInt(item.unit_price, 0)),
      catalogPriceSnapshot: item.catalog_price_snapshot == null ? null : Math.max(0, toInt(item.catalog_price_snapshot, 0)),
      currentVariantId: toInt(item.current_variant_id, 0) || null,
      lifecycleId: toInt(item.lifecycle_id, 0) || null,
      lifecycleVariantId: toInt(item.lifecycle_variant_id, 0) || null,
      lifecycleStatus: cleanText(item.lifecycle_status) || null,
      wasNotIssued: cleanText(item.inventory_source) === 'not_issued',
    };
    if (cleanText(item.role) === 'old') group.oldItems.push(serialized);
    else if (cleanText(item.role) === 'new') group.newItems.push(serialized);
    itemGroups.set(exchangeId, group);
  }

  const rows = baseRows.map(row => {
    const itemGroup = itemGroups.get(toInt(row.id, 0)) || { oldItems: [], newItems: [] };
    return {
      id: row.id, orderId: row.order_id, externalId: row.external_id, orderDate: row.order_date,
      manager: row.manager_name || '—', managerColor: cleanText(row.manager_color) || null, customer: row.customer_name || row.customer_phone || '—', exchangeDate: row.exchange_date,
      isSetExchange: Boolean(toInt(row.is_set_exchange, 0)),
      oldItems: itemGroup.oldItems,
      newItems: itemGroup.newItems,
      oldItemId: row.old_order_item_id, oldProductName: row.old_product_name || itemGroup.oldItems[0]?.productName || '—', oldQuantity: row.old_item_quantity || row.old_quantity || itemGroup.oldItems[0]?.quantity || 0,
      oldGender: row.old_gender_snapshot || itemGroup.oldItems[0]?.gender || '', oldColor: row.old_color_snapshot || itemGroup.oldItems[0]?.color || '', oldMaterial: row.old_material_snapshot || itemGroup.oldItems[0]?.material || '', oldLength: row.old_length_snapshot || itemGroup.oldItems[0]?.length || '', oldSize: row.old_size_snapshot || itemGroup.oldItems[0]?.size || '', oldReturnSource: row.old_inventory_source || row.old_return_source || itemGroup.oldItems[0]?.inventorySource || 'none',
      oldOperationItemId: row.old_operation_item_id == null ? (itemGroup.oldItems[0]?.id || null) : toInt(row.old_operation_item_id, 0) || null,
      oldPhysicalTracking: row.old_physical_tracking == null ? Boolean(itemGroup.oldItems[0]?.physicalTracking) : Boolean(toInt(row.old_physical_tracking, 0)),
      oldPhysicalReceivedAt: cleanText(row.old_physical_received_at) || itemGroup.oldItems[0]?.physicalReceivedAt || null,
      oldWasNotIssued: cleanText(row.old_inventory_source) === 'not_issued' || Boolean(itemGroup.oldItems[0]?.wasNotIssued),
      oldIsWorkshop: row.old_is_workshop == null ? Boolean(itemGroup.oldItems[0]?.isWorkshop) : Boolean(toInt(row.old_is_workshop, 0)),
      newItemId: row.new_order_item_id, newProductName: row.new_product_name || itemGroup.newItems[0]?.productName || '—', newQuantity: row.new_item_quantity || itemGroup.newItems[0]?.quantity || 0,
      newGender: row.new_gender_snapshot || itemGroup.newItems[0]?.gender || '', newColor: row.new_color_snapshot || itemGroup.newItems[0]?.color || '', newMaterial: row.new_material_snapshot || itemGroup.newItems[0]?.material || '', newLength: row.new_length_snapshot || itemGroup.newItems[0]?.length || '', newSize: row.new_size_snapshot || itemGroup.newItems[0]?.size || '', newSourceType: row.new_inventory_source || row.new_source_type || itemGroup.newItems[0]?.inventorySource,
      oldCurrentVariantId: toInt(row.old_current_variant_id, 0) || Number(itemGroup.oldItems[0]?.currentVariantId || 0) || null,
      oldLifecycleId: toInt(row.old_lifecycle_id, 0) || null,
      oldLifecycleVariantId: toInt(row.old_lifecycle_variant_id, 0) || null,
      newLifecycleId: toInt(row.new_lifecycle_id, 0) || null,
      oldLifecycleStatus: cleanText(row.old_lifecycle_status) || String(itemGroup.oldItems[0]?.lifecycleStatus || '') || null,
      newLifecycleStatus: cleanText(row.new_lifecycle_status) || String(itemGroup.newItems[0]?.lifecycleStatus || '') || null,
      financialAction: row.financial_action || 'none', financialAmount: row.financial_amount || 0, paymentMethod: row.payment_method || '',
      status: row.status || 'completed', comment: row.comment || '', cancelledAt: row.cancelled_at || null, cancellationComment: row.cancellation_comment || null,
    };
  });
  const totalCount = Math.max(0, toInt(summary?.total_count, 0));
  return { ok: true, count: totalCount, offset, limit, hasMore: offset + rows.length < totalCount,
    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)), pendingPhysicalQuantity: Math.max(0, toInt(summary?.pending_physical_quantity, 0)) }, exchanges: rows };
}



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
    const completedResponse = { ok: true, returnId, alreadyCancelled: true, stockReversals: [], restoredWorkshopTasks: 0, refreshRequired: true };
    await completeCriticalOperation(db, criticalOperation, completedResponse);
    let order = null;
    try {
      order = await getOrder(db, toInt(ret.order_id, 0));
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

  const operationContext = parseCriticalContext<Record<string, any>>(criticalOperation.row);
  const timestamp = cleanText(operationContext.startedAt) || operationStartedAt;
  const comment = cleanText(input.comment) || `Отмена возврата #${returnId}`;

  // Legacy rows that physically changed stock but were not adopted by 0051 are ambiguous by
  // definition. Do not revive the old snapshot guessing path during cancellation.
  if (criticalOperation.row.step === 'started') await advanceCriticalOperation(db, criticalOperation, 'validated', { targetType: 'return', targetId: returnId });

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

  for (const snapshot of taskSnapshots.results || []) {
    const returnedTaskQuantity = Math.max(0, toInt(snapshot.return_quantity, 0));
    const currentTaskQuantity = Math.max(0, toInt(snapshot.current_quantity, 0));
    const fallbackQuantity = Math.max(0, toInt(snapshot.previous_quantity, 0));
    const nextQuantity = returnedTaskQuantity > 0 ? currentTaskQuantity + returnedTaskQuantity : fallbackQuantity;
    const currentStatus = normalizeWorkshopTaskStatus(snapshot.current_status || snapshot.previous_status);
    const nextStatus = returnedTaskQuantity > 0 && currentStatus === 'cancelled' && nextQuantity > 0
      ? normalizeWorkshopTaskStatus(snapshot.previous_status)
      : currentStatus;
    await db.prepare(
      `UPDATE workshop_tasks
       SET status = ?, quantity = ?, updated_at = ?
       WHERE id = ? AND order_id = ?`
    ).bind(
      nextStatus,
      nextQuantity,
      timestamp,
      toInt(snapshot.workshop_task_id, 0),
      toInt(ret.order_id, 0),
    ).run();
  }

  const cancelStatements: D1PreparedStatement[] = [
    db.prepare(
      `UPDATE returns
       SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?
       WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
    ).bind(timestamp, comment, returnId),
  ];
  if (toInt(ret.amount, 0) > 0) {
    cancelStatements.push(refundReversalMoneyEventStatement(db, {
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
    }));
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
export type ExchangeSetOldInput = {
  orderItemId?: number
  quantity?: number
  physicalState?: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'
  expectedActiveQuantity?: number
  expectedUnitPrice?: number
  expectedLineTotal?: number
  expectedCatalogPriceSnapshot?: number | null
}

export type ExchangeSetNewInput = NonNullable<OrderInput['items']>[number]

export type ExchangeSetInput = {
  requestId?: string
  orderId?: number
  exchangeDate?: string
  expectedOrderTotal?: number
  oldItems?: ExchangeSetOldInput[]
  newItems?: ExchangeSetNewInput[]
  paymentAmount?: number
  paymentMethod?: string
  refundMethod?: string
  comment?: string
}

type ReservationSnapshot = {
  id: number
  source: SourceType
  variantId: number | null
  quantity: number
  status: string
  targetQuantity: number
  targetStatus: string
}

type WorkshopSnapshot = {
  id: number
  quantity: number
  status: string
  targetQuantity: number
  targetStatus: string
} | null

type ExchangeSetOldPlan = {
  inputIndex: number
  orderItemId: number
  quantity: number
  physicalState: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'
  returnSource: 'none' | 'warehouse' | 'boutique'
  initialQuantity: number
  targetQuantity: number
  unitPrice: number
  lineTotal: number
  catalogPriceSnapshot: number | null
  removedValue: number
  originalStockStatus: string
  isWorkshop: boolean
  wasIssued: boolean
  needsHandoverReconciliation: boolean
  reservationSnapshot: ReservationSnapshot | null
  workshopSnapshot: WorkshopSnapshot
}

type ExchangeSetNewPlan = {
  inputIndex: number
  item: NonNullable<ReturnType<typeof normalizeOrderItems>[number]>
  productId: number | null
  variantId: number | null
  inventorySource: SourceType | null
  stockKey: string | null
  observedPhysicalQuantity: number | null
}

type ExchangeSetExecutionPlan = {
  orderId: number
  externalOrderId: string
  exchangeDate: string
  comment: string
  baselineTotalAmount: number
  baselineNetPaid: number
  removedValue: number
  addedValue: number
  finalTotalAmount: number
  dueBeforeSettlement: number
  paymentAmount: number
  paymentMethod: string
  refundAmount: number
  refundMethod: string
  finalNetPaid: number
  financialAction: 'none' | 'extra_payment' | 'refund'
  financialAmount: number
  financialMethod: string
  oldItems: ExchangeSetOldPlan[]
  newItems: ExchangeSetNewPlan[]
  workshopCount: number
}

type ExchangeSetOperationContext = {
  startedAt?: string
  executionPlan?: ExchangeSetExecutionPlan
  completedOld?: number
  newContentInserted?: boolean
  completedNew?: number
  financesCompleted?: boolean
}

function requiredSafeMoney(value: unknown, label: string, minimum = 0) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new CriticalOperationConflictError(`${label} должна быть целым числом не меньше ${minimum}.`)
  }
  return number
}

function optionalCatalogPriceSnapshot(value: unknown, label: string) {
  if (value === null || value === undefined || String(value).trim() === '') return null
  return requiredSafeMoney(value, label)
}

async function loadReservationSnapshot(
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

async function applyNotIssuedReservationReduction(
  db: D1Database,
  plan: ExchangeSetOldPlan,
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

async function restoreNotIssuedReservation(
  db: D1Database,
  plan: ExchangeSetOldPlan,
  timestamp: string,
  exchangeId: number,
) {
  const snapshot = plan.reservationSnapshot
  if (!snapshot) return
  if (snapshot.targetQuantity <= 0) {
    const restored = await reactivateReleasedOrderReservationV2(
      db,
      plan.orderItemId,
      timestamp,
      `Отмена обмена #${exchangeId}: восстановление резерва невыданной позиции`,
    )
    if (!restored) {
      throw new CriticalOperationConflictError('Не удалось безопасно восстановить резерв невыданной позиции. Обновите заказ.')
    }
    return
  }

  const current = await db.prepare(
    `SELECT quantity, status FROM inventory_reservations WHERE id = ? AND order_item_id = ? LIMIT 1`
  ).bind(snapshot.id, plan.orderItemId).first<Record<string, unknown>>()
  if (!current?.status) throw new CriticalOperationConflictError('Резерв старой позиции больше не найден.')
  const currentQuantity = Math.max(0, toInt(current.quantity, 0))
  const currentStatus = cleanText(current.status)
  if (currentQuantity === snapshot.quantity && currentStatus === snapshot.status) return
  if (currentQuantity !== snapshot.targetQuantity || currentStatus !== snapshot.targetStatus) {
    throw new CriticalOperationConflictError('Резерв старой позиции уже изменился после обмена. Автоматическая отмена остановлена.')
  }

  const statements: D1PreparedStatement[] = []
  if (snapshot.status === 'active' && snapshot.variantId) {
    await loadCanonicalVariantSnapshot(db, snapshot.variantId, { activeOnly: true })
    statements.push(db.prepare(
      `UPDATE inventory_stock
       SET reserved_quantity = COALESCE(reserved_quantity, 0) + ?,
           last_action = 'Резерв восстановлен после отмены обмена',
           last_source_ref = ?,
           updated_at = ?
       WHERE inventory_source = ? AND variant_id = ?`
    ).bind(
      plan.quantity,
      `exchange_cancel:${exchangeId}:old:${plan.orderItemId}`,
      timestamp,
      snapshot.source,
      snapshot.variantId,
    ))
  }
  statements.push(db.prepare(
    `UPDATE inventory_reservations
     SET quantity = ?, status = ?, released_at = NULL, updated_at = ?
     WHERE id = ? AND order_item_id = ? AND quantity = ? AND status = ?`
  ).bind(snapshot.quantity, snapshot.status, timestamp, snapshot.id, plan.orderItemId, snapshot.targetQuantity, snapshot.targetStatus))
  await db.batch(statements)
}

async function loadWorkshopSnapshot(
  db: D1Database,
  orderId: number,
  oldItem: Record<string, unknown>,
  selectedQuantity: number,
): Promise<WorkshopSnapshot> {
  if (!toInt(oldItem.is_workshop, 0)) return null
  const row = await db.prepare(
    `SELECT id, status, quantity
     FROM workshop_tasks
     WHERE order_id = ?
       AND (order_item_id = ? OR (
         order_item_id IS NULL
         AND product_name_snapshot = ?
         AND COALESCE(gender_snapshot, '') = COALESCE(?, '')
         AND COALESCE(color_snapshot, '') = COALESCE(?, '')
         AND COALESCE(material_snapshot, '') = COALESCE(?, '')
         AND COALESCE(length_snapshot, '') = COALESCE(?, '')
         AND COALESCE(size_snapshot, '') = COALESCE(?, '')
       ))
     ORDER BY CASE WHEN order_item_id = ? THEN 0 ELSE 1 END,
              CASE status WHEN 'active' THEN 0 WHEN 'ready' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
              id ASC
     LIMIT 1`
  ).bind(
    orderId,
    toInt(oldItem.id, 0),
    cleanText(oldItem.product_name_snapshot),
    cleanText(oldItem.gender_snapshot) || null,
    cleanText(oldItem.color_snapshot) || null,
    cleanText(oldItem.material_snapshot) || null,
    cleanText(oldItem.length_snapshot) || null,
    cleanText(oldItem.size_snapshot) || null,
    toInt(oldItem.id, 0),
  ).first<Record<string, unknown>>()
  if (!row?.id) return null
  const quantity = Math.max(0, toInt(row.quantity, 0))
  const targetQuantity = Math.max(0, quantity - selectedQuantity)
  return {
    id: toInt(row.id, 0),
    quantity,
    status: cleanText(row.status) || 'active',
    targetQuantity,
    targetStatus: targetQuantity <= 0 ? 'cancelled' : (cleanText(row.status) || 'active'),
  }
}

async function setWorkshopTarget(db: D1Database, snapshot: WorkshopSnapshot, timestamp: string) {
  if (!snapshot) return
  const current = await db.prepare(
    `SELECT quantity, status FROM workshop_tasks WHERE id = ? LIMIT 1`
  ).bind(snapshot.id).first<Record<string, unknown>>()
  if (!current) throw new CriticalOperationConflictError('Цеховая позиция старого товара больше не найдена.')
  if (toInt(current.quantity, 0) === snapshot.targetQuantity && cleanText(current.status) === snapshot.targetStatus) return
  if (toInt(current.quantity, 0) !== snapshot.quantity || cleanText(current.status) !== snapshot.status) {
    throw new CriticalOperationConflictError('Цеховая позиция изменилась во время обмена. Обновите заказ.')
  }
  await db.prepare(
    `UPDATE workshop_tasks SET quantity = ?, status = ?, updated_at = ? WHERE id = ? AND quantity = ? AND status = ?`
  ).bind(snapshot.targetQuantity, snapshot.targetStatus, timestamp, snapshot.id, snapshot.quantity, snapshot.status).run()
}

async function restoreWorkshopSnapshot(db: D1Database, snapshot: WorkshopSnapshot, timestamp: string) {
  if (!snapshot) return
  const current = await db.prepare(
    `SELECT quantity, status FROM workshop_tasks WHERE id = ? LIMIT 1`
  ).bind(snapshot.id).first<Record<string, unknown>>()
  if (!current) throw new CriticalOperationConflictError('Цеховая позиция старого товара больше не найдена.')
  if (toInt(current.quantity, 0) === snapshot.quantity && cleanText(current.status) === snapshot.status) return
  if (toInt(current.quantity, 0) !== snapshot.targetQuantity || cleanText(current.status) !== snapshot.targetStatus) {
    throw new CriticalOperationConflictError('Цеховая позиция уже изменилась после обмена. Автоматическая отмена остановлена.')
  }
  await db.prepare(
    `UPDATE workshop_tasks SET quantity = ?, status = ?, updated_at = ? WHERE id = ? AND quantity = ? AND status = ?`
  ).bind(snapshot.quantity, snapshot.status, timestamp, snapshot.id, snapshot.targetQuantity, snapshot.targetStatus).run()
}

export function deriveExchangeSetSettlement(input: {
  currentTotalAmount: number
  currentNetPaid: number
  removedValue: number
  addedValue: number
  paymentAmount: number
}) {
  const currentTotalAmount = requiredSafeMoney(input.currentTotalAmount, 'Текущий итог заказа')
  const currentNetPaid = requiredSafeMoney(input.currentNetPaid, 'Уже оплачено')
  const removedValue = requiredSafeMoney(input.removedValue, 'Стоимость убираемых товаров')
  const addedValue = requiredSafeMoney(input.addedValue, 'Стоимость новых товаров')
  const paymentAmount = requiredSafeMoney(input.paymentAmount, 'Оплата сейчас')

  const finalTotalAmount = currentTotalAmount - removedValue + addedValue
  if (!Number.isSafeInteger(finalTotalAmount) || finalTotalAmount < 0) {
    throw new CriticalOperationConflictError('Итог заказа после обмена получился некорректным.')
  }

  const rawBalance = finalTotalAmount - currentNetPaid
  const dueBeforeSettlement = Math.max(0, rawBalance)
  const refundAmount = Math.max(0, -rawBalance)
  if (refundAmount > 0 && paymentAmount > 0) {
    throw new CriticalOperationConflictError('После пересчёта клиенту нужно вернуть деньги. Одновременно принимать оплату нельзя.')
  }
  if (paymentAmount > dueBeforeSettlement) {
    throw new CriticalOperationConflictError(`Оплата сейчас (${paymentAmount}) больше долга после обмена (${dueBeforeSettlement}).`)
  }

  const finalNetPaid = currentNetPaid + paymentAmount - refundAmount
  if (!Number.isSafeInteger(finalNetPaid) || finalNetPaid < 0 || finalNetPaid > finalTotalAmount) {
    throw new CriticalOperationConflictError('Денежный итог обмена не сходится с новой стоимостью заказа.')
  }

  return {
    finalTotalAmount,
    dueBeforeSettlement,
    refundAmount,
    finalNetPaid,
    remainingDebt: Math.max(0, finalTotalAmount - finalNetPaid),
  }
}

export async function createExchangeSetV2(db: D1Database, input: ExchangeSetInput) {
  let criticalOperation: CriticalOperationHandle | null = null
  try {
    const startedAt = new Date().toISOString()
    criticalOperation = await beginCriticalOperation(db, 'exchange_set_create', input.requestId, input, { startedAt })
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse

    let operationContext = parseCriticalContext<ExchangeSetOperationContext>(criticalOperation.row)
    let executionPlan = operationContext.executionPlan

    if (!executionPlan) {
      const orderId = toInt(input.orderId, 0)
      if (!orderId) throw new Error('orderId is required.')
      const rawOldItems = Array.isArray(input.oldItems) ? input.oldItems : []
      const rawNewItems = Array.isArray(input.newItems) ? input.newItems : []
      if (!rawOldItems.length) throw new CriticalOperationConflictError('Выберите хотя бы один товар, который клиент меняет.')
      if (!rawNewItems.length) throw new CriticalOperationConflictError('Добавьте хотя бы один товар, который клиент получит.')
      if (rawOldItems.length > 20 || rawNewItems.length > 20) {
        throw new CriticalOperationConflictError('За один обмен можно безопасно обработать не больше 20 старых и 20 новых позиций.')
      }

      const exchangeDateText = cleanText(input.exchangeDate)
      if (!exchangeDateText) throw new Error('Укажите дату обмена.')
      const exchangeDate = normalizeDate(exchangeDateText)
      const comment = cleanText(input.comment)

      await syncOrderFinancialLedger(db, orderId)
      const existing = await getOrder(db, orderId)
      if (!existing) throw new Error('Order not found.')
      if (cleanText((existing as any).pricing_mode) !== 'itemized_v1') {
        throw new CriticalOperationConflictError('Новый умный обмен доступен только для заказов с ценой по позициям. Старый заказ пока оформляйте через совместимый режим.')
      }
      if (isArchivedOrder(existing)) throw new Error('Нельзя оформлять обмен по архивному заказу.')
      if (normalizeOrderStatus((existing as any).order_status) === 'deleted') throw new Error('Нельзя оформлять обмен по удалённому заказу.')

      const ledger = await readOrderFinancialLedger(db, orderId)
      const expectedOrderTotal = requiredSafeMoney(input.expectedOrderTotal, 'Исходный итог заказа')
      if (expectedOrderTotal !== ledger.totalAmount) {
        throw new CriticalOperationConflictError('Итог заказа изменился после открытия обмена. Обновите заказ и повторите.')
      }

      const activePricingRows = await db.prepare(
        `SELECT id, quantity, unit_price, line_total, catalog_price_snapshot
         FROM order_items
         WHERE order_id = ? AND quantity > 0
         ORDER BY id ASC`
      ).bind(orderId).all<Record<string, unknown>>()
      let derivedCurrentTotal = 0
      const pricingById = new Map<number, Record<string, unknown>>()
      for (const row of activePricingRows.results || []) {
        const id = toInt(row.id, 0)
        const quantity = requiredSafeMoney(row.quantity, 'Количество активной позиции', 1)
        const unitPrice = requiredSafeMoney(row.unit_price, 'Цена активной позиции')
        const lineTotal = requiredSafeMoney(row.line_total, 'Сумма активной позиции')
        if (lineTotal !== quantity * unitPrice) {
          throw new CriticalOperationConflictError('Сумма одной из позиций заказа не совпадает с количеством и ценой.')
        }
        derivedCurrentTotal += lineTotal
        if (!Number.isSafeInteger(derivedCurrentTotal)) throw new CriticalOperationConflictError('Итог заказа слишком велик для точного расчёта.')
        pricingById.set(id, row)
      }
      if (derivedCurrentTotal !== ledger.totalAmount) {
        throw new CriticalOperationConflictError('Итог заказа не совпадает с активными позициями. Обмен остановлен без изменений.')
      }

      const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db)
      const oldIds = new Set<number>()
      const oldPlans: ExchangeSetOldPlan[] = []
      let removedValue = 0

      for (let index = 0; index < rawOldItems.length; index += 1) {
        const raw = rawOldItems[index] || {}
        const orderItemId = toInt(raw.orderItemId, 0)
        if (!orderItemId || oldIds.has(orderItemId)) {
          throw new CriticalOperationConflictError(`Старая позиция ${index + 1}: выберите уникальный товар заказа.`)
        }
        oldIds.add(orderItemId)
        const pricingRow = pricingById.get(orderItemId)
        const oldItem = await getOrderItemForReturnOrExchange(db, orderId, orderItemId)
        if (!pricingRow || !oldItem) {
          throw new CriticalOperationConflictError(`Старая позиция ${index + 1} больше не активна. Обновите заказ.`)
        }

        const initialQuantity = requiredSafeMoney(pricingRow.quantity, `Количество старой позиции ${index + 1}`, 1)
        const unitPrice = requiredSafeMoney(pricingRow.unit_price, `Цена старой позиции ${index + 1}`)
        const lineTotal = requiredSafeMoney(pricingRow.line_total, `Сумма старой позиции ${index + 1}`)
        const catalogPriceSnapshot = optionalCatalogPriceSnapshot(pricingRow.catalog_price_snapshot, `Цена Каталога старой позиции ${index + 1}`)
        const expectedCatalog = optionalCatalogPriceSnapshot(raw.expectedCatalogPriceSnapshot, `Исходная цена Каталога старой позиции ${index + 1}`)
        if (Number(raw.expectedActiveQuantity) !== initialQuantity
          || Number(raw.expectedUnitPrice) !== unitPrice
          || Number(raw.expectedLineTotal) !== lineTotal
          || expectedCatalog !== catalogPriceSnapshot) {
          throw new CriticalOperationConflictError(`Старая позиция ${index + 1}: цена или количество изменились после открытия формы.`)
        }

        const returned = await db.prepare(
          `SELECT COALESCE(SUM(ri.quantity), 0) AS quantity
           FROM return_items ri
           JOIN returns r ON r.id = ri.return_id
           WHERE r.order_id = ?
             AND ri.order_item_id = ?
             AND COALESCE(r.status, 'completed') <> 'cancelled'
             AND ${noStandaloneReturnSql}`
        ).bind(orderId, orderItemId).first<{ quantity: number }>()
        const availableQuantity = Math.max(0, initialQuantity - Math.max(0, toInt(returned?.quantity, 0)))
        const quantity = Math.max(1, toInt(raw.quantity, 1))
        if (quantity > availableQuantity) {
          throw new CriticalOperationConflictError(`Для «${cleanText(oldItem.product_name_snapshot)}» доступно ${availableQuantity} шт., выбрано ${quantity}.`)
        }

        const physicalStateText = cleanText(raw.physicalState)
        if (!['not_issued', 'pending', 'warehouse', 'boutique', 'no_stock'].includes(physicalStateText)) {
          throw new CriticalOperationConflictError(`Для «${cleanText(oldItem.product_name_snapshot)}» выберите фактическое состояние возвращаемой вещи.`)
        }
        const physicalState = physicalStateText as ExchangeSetOldPlan['physicalState']
        const isWorkshop = Boolean(toInt(oldItem.is_workshop, 0))
        const wasIssued = orderItemWasPhysicallyIssued(oldItem)
        if (physicalState === 'not_issued' && wasIssued) {
          throw new CriticalOperationConflictError(`«${cleanText(oldItem.product_name_snapshot)}» уже отмечен как выданный клиенту. Нельзя выбрать «не выдавался».`)
        }
        const reservationSnapshot = physicalState === 'not_issued' && !isWorkshop
          ? await loadReservationSnapshot(db, orderItemId, quantity, initialQuantity)
          : null
        const workshopSnapshot = await loadWorkshopSnapshot(db, orderId, oldItem, quantity)
        const removed = quantity * unitPrice
        if (!Number.isSafeInteger(removed) || removed < 0) {
          throw new CriticalOperationConflictError(`Не удалось рассчитать стоимость старой позиции ${index + 1}.`)
        }
        removedValue += removed
        if (!Number.isSafeInteger(removedValue)) throw new CriticalOperationConflictError('Стоимость выбранных старых товаров слишком велика.')

        oldPlans.push({
          inputIndex: index,
          orderItemId,
          quantity,
          physicalState,
          returnSource: physicalState === 'warehouse' || physicalState === 'boutique' ? physicalState : 'none',
          initialQuantity,
          targetQuantity: Math.max(0, initialQuantity - quantity),
          unitPrice,
          lineTotal,
          catalogPriceSnapshot,
          removedValue: removed,
          originalStockStatus: cleanText(oldItem.stock_writeoff_status) || (isWorkshop ? 'workshop' : ''),
          isWorkshop,
          wasIssued,
          needsHandoverReconciliation: Boolean(
            humanInventoryModelEnabled && !isWorkshop && physicalState !== 'not_issued' && !wasIssued
          ),
          reservationSnapshot,
          workshopSnapshot,
        })
      }

      const normalizedNew = normalizeOrderItems(rawNewItems, normalizeSourceType((existing as any).source_type))
      if (normalizedNew.length !== rawNewItems.length) {
        throw new CriticalOperationConflictError('Заполните все новые товары обмена.')
      }
      const writePlan = buildItemizedOrderWritePlan(rawNewItems.map((item) => ({
        quantity: item.quantity ?? 1,
        unitPrice: item.unitPrice,
        catalogPriceSnapshot: Object.prototype.hasOwnProperty.call(item, 'catalogPriceSnapshot') ? item.catalogPriceSnapshot ?? null : undefined,
      })), [])
      const newPlans: ExchangeSetNewPlan[] = []
      const stockGroups = new Map<string, { source: SourceType; variantId: number; productName: string; quantity: number; observed: number | null }>()
      let addedValue = 0
      let workshopCount = 0

      for (let index = 0; index < normalizedNew.length; index += 1) {
        const normalized = normalizedNew[index]
        const priceLine = writePlan.lines[index]
        const requested = rawNewItems[index]
        if (!Object.prototype.hasOwnProperty.call(requested, 'unitPrice')
          || !Object.prototype.hasOwnProperty.call(requested, 'catalogPriceSnapshot')) {
          throw new CriticalOperationConflictError(`Новая позиция ${index + 1}: цена продажи и снимок цены Каталога должны быть зафиксированы явно.`)
        }
        const effectiveItem = {
          ...normalized,
          sourceType: normalized.sourceType as OrderItemSourceType,
          inventorySource: normalized.sourceType === 'boutique' ? 'boutique' : 'warehouse' as SourceType,
          isWorkshop: normalized.sourceType === 'workshop',
          unitPrice: priceLine.unitPrice,
          lineTotal: priceLine.lineTotal,
          catalogPriceSnapshot: priceLine.catalogPriceSnapshot,
        } as NonNullable<ReturnType<typeof normalizeOrderItems>[number]>
        addedValue += priceLine.lineTotal
        if (!Number.isSafeInteger(addedValue)) throw new CriticalOperationConflictError('Стоимость новых товаров слишком велика.')

        if (effectiveItem.isWorkshop) {
          workshopCount += 1
          newPlans.push({
            inputIndex: index,
            item: effectiveItem,
            productId: null,
            variantId: null,
            inventorySource: null,
            stockKey: null,
            observedPhysicalQuantity: null,
          })
          continue
        }

        const resolved = await resolveCatalogProductAndVariantV2(db, effectiveItem)
        const variantId = toInt(resolved.variantId, 0) || null
        const productId = toInt(resolved.productId, 0) || null
        const inventorySource: SourceType = effectiveItem.sourceType === 'boutique' ? 'boutique' : 'warehouse'
        const observedRaw = (requested as any).observedPhysicalQuantity
        const observed = observedRaw === null || observedRaw === undefined || observedRaw === '' ? null : Number(observedRaw)
        if (observed !== null && (!Number.isInteger(observed) || observed < 0)) {
          throw new CriticalOperationConflictError(`Новая позиция ${index + 1}: фактический остаток должен быть целым числом от 0.`)
        }
        let stockKey: string | null = null
        if (variantId) {
          stockKey = `${inventorySource}:${variantId}`
          const group = stockGroups.get(stockKey) || {
            source: inventorySource,
            variantId,
            productName: cleanText(effectiveItem.productName),
            quantity: 0,
            observed: null,
          }
          group.quantity += Math.max(1, toInt(effectiveItem.quantity, 1))
          if (observed !== null) {
            if (group.observed !== null && group.observed !== observed) {
              throw new CriticalOperationConflictError(`Для «${group.productName}» указаны разные фактические остатки.`)
            }
            group.observed = observed
          }
          stockGroups.set(stockKey, group)
        }
        newPlans.push({ inputIndex: index, item: effectiveItem, productId, variantId, inventorySource, stockKey, observedPhysicalQuantity: observed })
      }

      for (const group of stockGroups.values()) {
        const stock = await db.prepare(
          `SELECT quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
        ).bind(group.source, group.variantId).first<{ quantity: number }>()
        const physical = Math.max(0, toInt(stock?.quantity, 0))
        const effectivePhysical = group.observed === null ? physical : group.observed
        if (effectivePhysical < group.quantity) {
          throw new CriticalOperationConflictError(group.observed === null
            ? `Для «${group.productName}» нужно ${group.quantity} шт., а по учёту физически есть ${physical}. Подтвердите фактическое количество, если товар перед вами.`
            : `Для «${group.productName}» нужно ${group.quantity} шт., подтверждено только ${group.observed}.`)
        }
      }

      const currentNetPaid = Math.max(0, ledger.receivedAmount - ledger.returnAmount)
      const paymentAmount = Math.max(0, toInt(input.paymentAmount, 0))
      const settlement = deriveExchangeSetSettlement({
        currentTotalAmount: ledger.totalAmount,
        currentNetPaid,
        removedValue,
        addedValue,
        paymentAmount,
      })
      const paymentMethod = cleanText(input.paymentMethod)
      const refundMethod = cleanText(input.refundMethod)
      if (paymentAmount > 0 && !paymentMethod) throw new CriticalOperationConflictError('Выберите способ оплаты денег, полученных сейчас.')
      if (settlement.refundAmount > 0 && !refundMethod) throw new CriticalOperationConflictError('Выберите способ возврата денег клиенту.')

      const financialAction: ExchangeSetExecutionPlan['financialAction'] = paymentAmount > 0
        ? 'extra_payment'
        : settlement.refundAmount > 0
          ? 'refund'
          : 'none'
      const financialAmount = paymentAmount > 0 ? paymentAmount : settlement.refundAmount
      const financialMethod = paymentAmount > 0 ? paymentMethod : settlement.refundAmount > 0 ? refundMethod : ''

      executionPlan = {
        orderId,
        externalOrderId: cleanText((existing as any).external_id),
        exchangeDate,
        comment,
        baselineTotalAmount: ledger.totalAmount,
        baselineNetPaid: currentNetPaid,
        removedValue,
        addedValue,
        finalTotalAmount: settlement.finalTotalAmount,
        dueBeforeSettlement: settlement.dueBeforeSettlement,
        paymentAmount,
        paymentMethod,
        refundAmount: settlement.refundAmount,
        refundMethod,
        finalNetPaid: settlement.finalNetPaid,
        financialAction,
        financialAmount,
        financialMethod,
        oldItems: oldPlans,
        newItems: newPlans,
        workshopCount,
      }
      operationContext = { ...operationContext, executionPlan, completedOld: 0, newContentInserted: false, completedNew: 0, financesCompleted: false }
      await advanceCriticalOperation(db, criticalOperation, 'validated', { context: operationContext })
    }

    const timestamp = cleanText(operationContext.startedAt) || startedAt
    const managerRow = await db.prepare('SELECT manager_id FROM orders WHERE id = ?').bind(executionPlan.orderId).first<{ manager_id: number | null }>()
    let exchangeId = toInt(criticalOperation.row.target_id, 0)
    if (!exchangeId) {
      const firstNewSource = executionPlan.newItems[0]?.item.sourceType === 'workshop'
        ? 'workshop'
        : executionPlan.newItems[0]?.item.sourceType === 'boutique'
          ? 'boutique'
          : 'warehouse'
      exchangeId = await updateCriticalOperationTargetFromLastInsert(
        db,
        criticalOperation,
        'exchange',
        executionPlan.externalOrderId,
        db.prepare(
          `INSERT INTO exchanges (
             order_id, manager_id, exchange_date, old_order_item_id, old_quantity, old_return_source,
             new_order_item_id, new_source_type, financial_action, financial_amount, payment_method,
             status, comment, created_at, old_item_replaced_at
           ) VALUES (?, ?, ?, NULL, 0, 'none', NULL, ?, ?, ?, ?, 'completed', ?, ?, ?)`
        ).bind(
          executionPlan.orderId,
          managerRow?.manager_id ?? null,
          executionPlan.exchangeDate,
          firstNewSource,
          executionPlan.financialAction,
          executionPlan.financialAmount,
          executionPlan.financialMethod || null,
          executionPlan.comment || null,
          timestamp,
          timestamp,
        ),
        'exchange_created',
      )
    }

    const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db)
    const stockReturns: unknown[] = []
    const pendingInventory: unknown[] = []
    let completedOld = Math.max(0, toInt(operationContext.completedOld, 0))

    for (let index = completedOld; index < executionPlan.oldItems.length; index += 1) {
      const plan = executionPlan.oldItems[index]
      let oldItem = await getOrderItemForReturnOrExchange(db, executionPlan.orderId, plan.orderItemId)
      if (!oldItem) throw new CriticalOperationConflictError('Старая позиция обмена больше не найдена.')

      if (plan.physicalState === 'not_issued' && !plan.isWorkshop) {
        await applyNotIssuedReservationReduction(db, plan, timestamp, executionPlan.externalOrderId)
      }

      if (plan.needsHandoverReconciliation) {
        await fulfillOrderReservationsV2(
          db,
          executionPlan.orderId,
          executionPlan.externalOrderId,
          timestamp,
          { orderItemIds: [plan.orderItemId], checkedBy: 'exchange_set_reconciliation' },
        )
        oldItem = await getOrderItemForReturnOrExchange(db, executionPlan.orderId, plan.orderItemId)
        if (!oldItem || !orderItemWasPhysicallyIssued(oldItem)) {
          throw new CriticalOperationConflictError(`Не удалось безопасно подтвердить выдачу «${cleanText(oldItem?.product_name_snapshot)}». Обмен остановлен.`)
        }
      }

      const currentQuantity = Math.max(0, toInt(oldItem.quantity, 0))
      if (currentQuantity !== plan.targetQuantity) {
        if (currentQuantity !== plan.initialQuantity) {
          throw new CriticalOperationConflictError(`Количество «${cleanText(oldItem.product_name_snapshot)}» изменилось во время обмена.`)
        }
        await db.prepare(
          `UPDATE order_items
           SET quantity = ?, line_total = unit_price * ?,
               stock_writeoff_status = CASE WHEN ? <= 0 THEN 'exchanged' ELSE stock_writeoff_status END
           WHERE id = ? AND order_id = ? AND quantity = ?`
        ).bind(plan.targetQuantity, plan.targetQuantity, plan.targetQuantity, plan.orderItemId, executionPlan.orderId, plan.initialQuantity).run()
      }

      await setWorkshopTarget(db, plan.workshopSnapshot, timestamp)

      const physicalTracking = plan.physicalState !== 'not_issued'
      const receivedAt = physicalTracking && plan.physicalState !== 'pending' ? timestamp : null
      const inventorySource = plan.physicalState === 'not_issued'
        ? 'not_issued'
        : plan.returnSource === 'none'
          ? null
          : plan.returnSource
      const mapped = await insertCriticalMappedEntity(
        db,
        criticalOperation,
        'exchange_item',
        `exchange:set:old:${index + 1}`,
        db.prepare(
          `INSERT INTO exchange_items (
             exchange_id, role, order_item_id, product_name_snapshot, gender_snapshot, color_snapshot,
             material_snapshot, length_snapshot, size_snapshot, quantity, inventory_source,
             physical_tracking, physical_received_at, created_at
           ) VALUES (?, 'old', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          exchangeId,
          plan.orderItemId,
          cleanText(oldItem.product_name_snapshot),
          cleanText(oldItem.gender_snapshot) || null,
          cleanText(oldItem.color_snapshot) || null,
          cleanText(oldItem.material_snapshot) || null,
          cleanText(oldItem.length_snapshot) || null,
          cleanText(oldItem.size_snapshot) || null,
          plan.quantity,
          inventorySource,
          physicalTracking ? 1 : 0,
          receivedAt,
          timestamp,
        ),
      )

      if (plan.returnSource !== 'none') {
        const resolved = await resolveInventoryLifecycleCandidate(db, oldItem, plan.isWorkshop)
        const event = await insertInventoryLifecycleEvent(db, {
          eventKey: `exchange:${exchangeId}:old:${mapped.id}`,
          operationType: 'exchange',
          operationId: exchangeId,
          operationItemId: mapped.id,
          orderId: executionPlan.orderId,
          orderItemId: plan.orderItemId,
          eventType: 'exchange_old_in',
          direction: 'in',
          inventorySource: plan.returnSource,
          quantity: plan.quantity,
          item: oldItem,
          isWorkshop: plan.isWorkshop,
          productId: resolved.productId,
          variantId: resolved.variantId,
          pendingReason: inventoryLifecyclePendingReason(resolved, plan.isWorkshop),
          timestamp,
        })
        const autoApplyWorkshop = Boolean(plan.isWorkshop && resolved.variantId && await canAutoApplyFreshWorkshopInbound(db, event, resolved.variantId))
        if (resolved.variantId && (!plan.isWorkshop || autoApplyWorkshop)) {
          stockReturns.push(await applyCanonicalInventoryLifecycleEvent(
            db,
            event.id,
            resolved.variantId,
            timestamp,
            executionPlan.comment || `Возврат старой позиции обмена #${exchangeId}`,
          ))
        } else {
          pendingInventory.push({ eventId: event.id, eventType: event.event_type, productName: cleanText(oldItem.product_name_snapshot), source: plan.returnSource })
        }
      }

      completedOld = index + 1
      operationContext = { ...operationContext, completedOld }
      await advanceCriticalOperation(db, criticalOperation, `old_${completedOld}_done`, { context: operationContext })
    }

    if (!operationContext.newContentInserted) {
      const writePlan = buildItemizedOrderWritePlan(executionPlan.newItems.map((plan) => ({
        quantity: plan.item.quantity,
        unitPrice: plan.item.unitPrice,
        catalogPriceSnapshot: plan.item.catalogPriceSnapshot ?? null,
      })), [])
      const preResolved = executionPlan.newItems.map((plan) => ({ productId: plan.productId, variantId: plan.variantId }))
      await insertOrderContent(
        db,
        executionPlan.orderId,
        executionPlan.externalOrderId,
        executionPlan.newItems.map((plan) => plan.item),
        [],
        timestamp,
        'exchange_new',
        String(exchangeId),
        `Новые позиции обмена #${exchangeId}`,
        preResolved,
        criticalOperation,
        'exchange_set_new',
        undefined,
        writePlan,
      )
      operationContext = { ...operationContext, newContentInserted: true }
      await advanceCriticalOperation(db, criticalOperation, 'new_content_inserted', { context: operationContext })
    }

    let completedNew = Math.max(0, toInt(operationContext.completedNew, 0))
    for (let index = completedNew; index < executionPlan.newItems.length; index += 1) {
      const plan = executionPlan.newItems[index]
      const orderItemId = await criticalOperationEntityId(db, criticalOperation.requestId, 'order_item', `exchange_set_new:item:${index + 1}`)
      if (!orderItemId) throw new Error('Новая позиция обмена не найдена после сохранения.')
      const inserted = await getOrderItemForReturnOrExchange(db, executionPlan.orderId, orderItemId)
      if (!inserted) throw new Error('Новая позиция обмена не загрузилась после сохранения.')

      const mapped = await insertCriticalMappedEntity(
        db,
        criticalOperation,
        'exchange_item',
        `exchange:set:new:${index + 1}`,
        db.prepare(
          `INSERT INTO exchange_items (
             exchange_id, role, order_item_id, product_name_snapshot, gender_snapshot, color_snapshot,
             material_snapshot, length_snapshot, size_snapshot, quantity, inventory_source, created_at
           ) VALUES (?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          exchangeId,
          orderItemId,
          cleanText(inserted.product_name_snapshot),
          cleanText(inserted.gender_snapshot) || null,
          cleanText(inserted.color_snapshot) || null,
          cleanText(inserted.material_snapshot) || null,
          cleanText(inserted.length_snapshot) || null,
          cleanText(inserted.size_snapshot) || null,
          Math.max(1, toInt(inserted.quantity, 1)),
          plan.item.isWorkshop ? 'workshop' : plan.inventorySource,
          timestamp,
        ),
      )

      if (!plan.item.isWorkshop && humanInventoryModelEnabled) {
        const resolved = await resolveInventoryLifecycleCandidate(db, inserted, false)
        const event = await insertInventoryLifecycleEvent(db, {
          eventKey: `exchange:${exchangeId}:new:${mapped.id}`,
          operationType: 'exchange',
          operationId: exchangeId,
          operationItemId: mapped.id,
          orderId: executionPlan.orderId,
          orderItemId,
          eventType: 'exchange_new_out',
          direction: 'out',
          inventorySource: plan.inventorySource || 'warehouse',
          quantity: Math.max(1, toInt(inserted.quantity, 1)),
          item: inserted,
          isWorkshop: false,
          productId: resolved.productId,
          variantId: resolved.variantId,
          pendingReason: inventoryLifecyclePendingReason(resolved, false),
          timestamp,
        })
        if (resolved.variantId) {
          await applyCanonicalInventoryLifecycleEvent(
            db,
            event.id,
            resolved.variantId,
            timestamp,
            `Физическое списание новой позиции обмена #${exchangeId}`,
          )
        } else {
          pendingInventory.push({ eventId: event.id, eventType: event.event_type, productName: cleanText(inserted.product_name_snapshot), source: plan.inventorySource })
        }
      }

      completedNew = index + 1
      operationContext = { ...operationContext, completedNew }
      await advanceCriticalOperation(db, criticalOperation, `new_${completedNew}_done`, { context: operationContext })
    }

    if (!operationContext.financesCompleted) {
      let paymentId: number | null = null
      let refundReturnId: number | null = null
      if (executionPlan.financialAction === 'extra_payment') {
        const entityKey = 'exchange:set:payment'
        paymentId = await criticalOperationEntityId(db, criticalOperation.requestId, 'payment', entityKey)
        if (!paymentId) {
          const pair = buildPaymentAndMoneyEventStatements(db, {
            orderId: executionPlan.orderId,
            externalOrderId: executionPlan.externalOrderId,
            paymentDate: executionPlan.exchangeDate,
            method: executionPlan.paymentMethod,
            amount: executionPlan.paymentAmount,
            paymentKind: 'extra',
            comment: executionPlan.comment || `Оплата при обмене #${exchangeId}`,
            timestamp,
            eventType: 'exchange_extra',
            sourceType: 'exchange',
            sourceId: exchangeId,
            sourceRef: `exchanges:${exchangeId}`,
            reason: 'exchange_set_created',
            eventKey: `1901:${criticalOperation.requestId}:exchange-set-payment`,
          })
          const [insert] = await db.batch([
            pair.payment,
            db.prepare(
              `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
               VALUES (?, 'payment', ?, last_insert_rowid(), ?)
               ON CONFLICT(request_id, entity_type, entity_key) DO NOTHING`
            ).bind(criticalOperation.requestId, entityKey, timestamp),
            pair.event,
          ])
          paymentId = await criticalOperationEntityId(db, criticalOperation.requestId, 'payment', entityKey) || toInt(insert.meta?.last_row_id, 0) || null
        }
      } else if (executionPlan.financialAction === 'refund') {
        const entityKey = 'exchange:set:refund'
        refundReturnId = await criticalOperationEntityId(db, criticalOperation.requestId, 'return', entityKey)
        if (!refundReturnId) {
          const [insert] = await db.batch([
            db.prepare(
              `INSERT INTO returns (order_id, manager_id, return_date, amount, payment_method, comment, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`
            ).bind(
              executionPlan.orderId,
              managerRow?.manager_id ?? null,
              executionPlan.exchangeDate,
              executionPlan.refundAmount,
              executionPlan.refundMethod,
              executionPlan.comment || `Возврат переплаты по обмену #${exchangeId}`,
              timestamp,
            ),
            db.prepare(
              `INSERT INTO critical_operation_entities (request_id, entity_type, entity_key, entity_id, created_at)
               VALUES (?, 'return', ?, last_insert_rowid(), ?)
               ON CONFLICT(request_id, entity_type, entity_key) DO NOTHING`
            ).bind(criticalOperation.requestId, entityKey, timestamp),
            refundMoneyEventStatement(db, {
              eventKey: `1901:${criticalOperation.requestId}:exchange-set-refund`,
              orderId: executionPlan.orderId,
              externalOrderId: executionPlan.externalOrderId,
              returnDate: executionPlan.exchangeDate,
              amount: executionPlan.refundAmount,
              paymentMethod: executionPlan.refundMethod,
              timestamp,
              eventType: 'exchange_refund',
              sourceId: exchangeId,
              sourceRef: `exchanges:${exchangeId}`,
              comment: executionPlan.comment || `Возврат переплаты по обмену #${exchangeId}`,
              reason: 'exchange_set_created',
            }),
          ])
          refundReturnId = await criticalOperationEntityId(db, criticalOperation.requestId, 'return', entityKey) || toInt(insert.meta?.last_row_id, 0) || null
        }
      }

      await db.batch([
        db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`)
          .bind(executionPlan.finalTotalAmount, timestamp, executionPlan.orderId),
        db.prepare(
          `UPDATE exchanges
           SET financial_action = ?, financial_amount = ?, payment_method = ?, payment_id = ?, refund_return_id = ?
           WHERE id = ?`
        ).bind(
          executionPlan.financialAction,
          executionPlan.financialAmount,
          executionPlan.financialMethod || null,
          paymentId,
          refundReturnId,
          exchangeId,
        ),
      ])
      await syncOrderFinancialLedger(db, executionPlan.orderId, timestamp)
      operationContext = { ...operationContext, financesCompleted: true }
      await advanceCriticalOperation(db, criticalOperation, 'finances_done', { context: operationContext })
    }

    try {
      await refreshOrderWorkshopStatusFromTasks(db, executionPlan.orderId, timestamp)
    } catch (error) {
      console.warn('Workshop status refresh failed after set exchange', error)
    }

    const completedResponse = {
      ok: true,
      setExchange: true,
      exchangeId,
      oldItemCount: executionPlan.oldItems.length,
      newItemCount: executionPlan.newItems.length,
      removedValue: executionPlan.removedValue,
      addedValue: executionPlan.addedValue,
      finalTotalAmount: executionPlan.finalTotalAmount,
      paymentAmount: executionPlan.paymentAmount,
      refundAmount: executionPlan.refundAmount,
      finalNetPaid: executionPlan.finalNetPaid,
      remainingDebt: Math.max(0, executionPlan.finalTotalAmount - executionPlan.finalNetPaid),
      pendingInventoryCount: pendingInventory.length,
      workshopCount: executionPlan.workshopCount,
      refreshRequired: true,
    }
    await completeCriticalOperation(db, criticalOperation, completedResponse)

    let order = null
    try { order = await getOrder(db, executionPlan.orderId) } catch { order = null }
    try {
      await writeActivityLog(db, {
        eventType: 'exchange_created',
        entityType: 'exchange',
        entityId: exchangeId,
        orderId: executionPlan.orderId,
        externalOrderId: executionPlan.externalOrderId,
        title: `Оформлен обмен по заказу ${executionPlan.externalOrderId}`,
        details: `Убрано ${executionPlan.oldItems.length} поз.; добавлено ${executionPlan.newItems.length} поз.; итог заказа ${executionPlan.finalTotalAmount}; деньги: ${executionPlan.financialAction} ${executionPlan.financialAmount}.`,
        amount: executionPlan.financialAmount,
        createdAt: timestamp,
      })
    } catch (error) {
      console.warn('Set exchange activity log failed', error)
    }
    return order ? { ...completedResponse, order, refreshRequired: false } : completedResponse
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error)
    throw error
  }
}

export async function createExchangeSetV2FromRequest(db: D1Database, request: Request) {
  const input = await readJson<ExchangeSetInput>(request)
  input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined
  return await createExchangeSetV2(db, input)
}

async function loadSetCreatePlan(db: D1Database, exchangeId: number): Promise<ExchangeSetExecutionPlan> {
  const row = await db.prepare(
    `SELECT context_json
     FROM critical_operations
     WHERE operation_type = 'exchange_set_create'
       AND target_type = 'exchange'
       AND target_id = ?
     ORDER BY created_at DESC
     LIMIT 1`
  ).bind(exchangeId).first<{ context_json: string | null }>()
  if (!row?.context_json) {
    throw new CriticalOperationConflictError('Для этого нового обмена не найден безопасный снимок создания. Автоматическая отмена остановлена.')
  }
  try {
    const parsed = JSON.parse(row.context_json) as ExchangeSetOperationContext
    if (!parsed.executionPlan) throw new Error('missing plan')
    return parsed.executionPlan
  } catch {
    throw new CriticalOperationConflictError('Снимок нового обмена повреждён. Автоматическая отмена остановлена.')
  }
}

export async function isExchangeSetV2(db: D1Database, exchangeId: number) {
  const row = await db.prepare(
    `SELECT 1 AS found
     FROM critical_operations
     WHERE operation_type = 'exchange_set_create'
       AND target_type = 'exchange'
       AND target_id = ?
     LIMIT 1`
  ).bind(exchangeId).first<{ found: number }>()
  return Boolean(toInt(row?.found, 0))
}

export async function cancelExchangeSetV2(
  db: D1Database,
  exchangeId: number,
  input: { requestId?: string; comment?: string },
) {
  let criticalOperation: CriticalOperationHandle | null = null
  try {
    const startedAt = new Date().toISOString()
    criticalOperation = await beginCriticalOperation(db, 'exchange_set_cancel', input.requestId, { exchangeId, ...input }, { startedAt })
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse
    if (!exchangeId) throw new Error('exchangeId is required.')

    const exchange = await db.prepare(
      `SELECT e.*, o.external_id, o.order_status, o.pricing_mode
       FROM exchanges e
       JOIN orders o ON o.id = e.order_id
       WHERE e.id = ?`
    ).bind(exchangeId).first<Record<string, unknown>>()
    if (!exchange) throw new Error('Exchange not found.')
    if (!await isExchangeSetV2(db, exchangeId)) {
      throw new CriticalOperationConflictError('Это обмен старого формата. Используйте совместимую отмену.')
    }
    if (cleanText(exchange.status) === 'cancelled') {
      const completed = { ok: true, exchangeId, alreadyCancelled: true, refreshRequired: true }
      await completeCriticalOperation(db, criticalOperation, completed)
      let order = null
      try { order = await getOrder(db, toInt(exchange.order_id, 0)) } catch { order = null }
      return order ? { ...completed, order, refreshRequired: false } : completed
    }

    const plan = await loadSetCreatePlan(db, exchangeId)
    const orderId = toInt(exchange.order_id, 0)
    if (orderId !== plan.orderId) throw new CriticalOperationConflictError('Снимок обмена не совпадает с заказом.')
    const timestamp = startedAt
    const comment = cleanText(input.comment) || `Отмена обмена #${exchangeId}`

    const itemRows = await db.prepare(
      `SELECT ei.*, oi.quantity AS current_quantity, oi.unit_price AS current_unit_price,
              oi.line_total AS current_line_total, oi.is_workshop AS current_is_workshop,
              oi.stock_writeoff_status AS current_stock_status
       FROM exchange_items ei
       LEFT JOIN order_items oi ON oi.id = ei.order_item_id
       WHERE ei.exchange_id = ?
       ORDER BY ei.role ASC, ei.id ASC`
    ).bind(exchangeId).all<Record<string, unknown>>()
    const oldRows = (itemRows.results || []).filter((row) => cleanText(row.role) === 'old')
    const newRows = (itemRows.results || []).filter((row) => cleanText(row.role) === 'new')
    if (oldRows.length !== plan.oldItems.length || newRows.length !== plan.newItems.length) {
      throw new CriticalOperationConflictError('Состав обмена не совпадает с исходным безопасным снимком. Отмена остановлена.')
    }

    const newOrderItemIds = newRows.map((row) => toInt(row.order_item_id, 0)).filter(Boolean)
    if (newOrderItemIds.length) {
      const dependent = await db.prepare(
        `SELECT e.id
         FROM exchange_items ei
         JOIN exchanges e ON e.id = ei.exchange_id
         WHERE ei.role = 'old'
           AND ei.order_item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
           AND e.id <> ?
           AND COALESCE(e.status, 'completed') <> 'cancelled'
         ORDER BY e.id DESC
         LIMIT 1`
      ).bind(JSON.stringify(newOrderItemIds), exchangeId).first<{ id: number }>()
      if (dependent?.id) {
        throw new CriticalOperationConflictError(`Одна из новых позиций этого обмена уже использована в обмене #${dependent.id}. Сначала отмените более поздний обмен.`)
      }
    }

    const lifecycleRows = await db.prepare(
      `SELECT * FROM inventory_lifecycle_events
       WHERE operation_type = 'exchange' AND operation_id = ?
       ORDER BY id ASC`
    ).bind(exchangeId).all<InventoryLifecycleEventRow>()
    for (const event of lifecycleRows.results || []) {
      if (cleanText(event.status) === 'applied' && toInt(event.variant_id, 0)) {
        await loadCanonicalVariantSnapshot(db, toInt(event.variant_id, 0))
      }
    }

    const stockReversals: unknown[] = []
    for (const event of lifecycleRows.results || []) {
      const result = await cancelInventoryLifecycleEvent(db, toInt(event.id, 0), timestamp, comment)
      if (result?.cancelled) stockReversals.push(result)
    }

    for (let index = 0; index < newRows.length; index += 1) {
      const row = newRows[index]
      const orderItemId = toInt(row.order_item_id, 0)
      if (!orderItemId) continue
      if (toInt(row.current_is_workshop, 0)) {
        await db.prepare(
          `UPDATE workshop_tasks
           SET quantity = 0, status = 'cancelled', updated_at = ?
           WHERE order_id = ? AND order_item_id = ? AND status <> 'cancelled'`
        ).bind(timestamp, orderId, orderItemId).run()
      }
      await releaseOrderReservationV2(db, orderItemId, timestamp, `Отмена обмена #${exchangeId}`)
      await db.prepare(
        `UPDATE order_items
         SET quantity = 0, line_total = 0, stock_writeoff_status = 'cancelled'
         WHERE id = ? AND order_id = ?`
      ).bind(orderItemId, orderId).run()
    }

    for (const planItem of plan.oldItems) {
      const current = await getOrderItemForReturnOrExchange(db, orderId, planItem.orderItemId)
      if (!current) throw new CriticalOperationConflictError('Старая позиция обмена больше не найдена.')
      const currentQuantity = Math.max(0, toInt(current.quantity, 0))
      const nextQuantity = currentQuantity + planItem.quantity
      if (!Number.isSafeInteger(nextQuantity) || nextQuantity < 0) throw new CriticalOperationConflictError('Не удалось восстановить количество старой позиции.')
      await db.prepare(
        `UPDATE order_items
         SET quantity = ?, line_total = unit_price * ?, stock_writeoff_status = ?
         WHERE id = ? AND order_id = ?`
      ).bind(
        nextQuantity,
        nextQuantity,
        planItem.originalStockStatus || (planItem.isWorkshop ? 'workshop' : 'reserved'),
        planItem.orderItemId,
        orderId,
      ).run()
      if (planItem.physicalState === 'not_issued' && !planItem.isWorkshop) {
        await restoreNotIssuedReservation(db, planItem, timestamp, exchangeId)
      }
      await restoreWorkshopSnapshot(db, planItem.workshopSnapshot, timestamp)
    }

    const financialAction = cleanText(exchange.financial_action)
    const financialAmount = Math.max(0, toInt(exchange.financial_amount, 0))
    if (financialAction === 'extra_payment' && financialAmount > 0) {
      const paymentId = toInt(exchange.payment_id, 0)
      if (paymentId) {
        await removeSinglePaymentWithMoneyEvent(db, {
          paymentId,
          orderId,
          externalOrderId: cleanText(exchange.external_id),
          timestamp,
          relatedType: 'exchange_extra',
          reason: 'exchange_set_cancel',
          comment,
        })
      }
    } else if (financialAction === 'refund' && financialAmount > 0) {
      const refundReturnId = toInt(exchange.refund_return_id, 0)
      if (refundReturnId) {
        await db.batch([
          db.prepare(
            `UPDATE returns
             SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?
             WHERE id = ? AND order_id = ?`
          ).bind(timestamp, comment, refundReturnId, orderId),
          refundReversalMoneyEventStatement(db, {
            eventKey: `189c:exchange-set:${exchangeId}:refund-cancelled`,
            orderId,
            externalOrderId: cleanText(exchange.external_id),
            amount: financialAmount,
            paymentMethod: cleanText(exchange.payment_method) || null,
            timestamp,
            relatedType: 'exchange_refund',
            sourceId: exchangeId,
            sourceRef: `exchanges:${exchangeId}`,
            reason: 'exchange_set_cancel',
            comment,
          }),
        ])
      }
    }

    const totalRow = await db.prepare(
      `SELECT COALESCE(SUM(line_total), 0) AS total_amount
       FROM order_items
       WHERE order_id = ? AND quantity > 0`
    ).bind(orderId).first<{ total_amount: number }>()
    const restoredTotal = Math.max(0, toInt(totalRow?.total_amount, 0))
    await db.batch([
      db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`).bind(restoredTotal, timestamp, orderId),
      db.prepare(
        `UPDATE exchanges
         SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?, old_item_replacement_reversed_at = ?
         WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
      ).bind(timestamp, comment, timestamp, exchangeId),
    ])
    await syncOrderFinancialLedger(db, orderId, timestamp)
    try {
      await refreshOrderWorkshopStatusFromTasks(db, orderId, timestamp)
    } catch (error) {
      console.warn('Workshop status refresh failed after set exchange cancellation', error)
    }

    const completed = { ok: true, exchangeId, setExchange: true, stockReversals, financialAction, financialAmount, refreshRequired: true }
    await completeCriticalOperation(db, criticalOperation, completed)
    let order = null
    try { order = await getOrder(db, orderId) } catch { order = null }
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
      })
    } catch (error) {
      console.warn('Set exchange cancellation activity log failed', error)
    }
    return order ? { ...completed, order, refreshRequired: false } : completed
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error)
    throw error
  }
}
