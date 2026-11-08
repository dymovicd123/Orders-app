// Create a standalone Return: reserve the returned quantity, refund exact
// payment channels, and record inventory lifecycle under one critical operation.
// Original implementation/SQL extracted without modification.
import { cleanText, isArchivedOrder, normalizeDate, normalizeOrderStatus, normalizeReturnRestockSource, toInt } from '../core/text.ts'
import { writeActivityLog } from './activity.ts'
import { orderItemWasPhysicallyIssued } from './catalog-review.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, criticalOperationEntityId, failCriticalOperation, parseCriticalContext, refreshCriticalOperation } from './critical.ts'
import { applyCanonicalInventoryLifecycleEvent, canAutoApplyFreshWorkshopInbound, getOrderItemForReturnOrExchange, insertInventoryLifecycleEvent, inventoryLifecyclePendingReason, resolveInventoryLifecycleCandidate } from './lifecycle.ts'
import { refundMoneyEventStatement, syncOrderFinancialLedger } from './money.ts'
import { getOrder } from './orders-write.ts'
import { moneyMethodsSummary, normalizeMoneyParts } from './return-exchange-payment-channels.ts'
import type { MoneyPartInput } from './return-exchange-payment-channels.ts'
import { noStandaloneReturnSql } from './order-return-capacity.ts'

// Item-level dispatch is authoritative even while another item of the same
// order has not been shipped. In particular, ready Workshop goods have no
// stock_writeoff_status='fulfilled' warehouse movement to infer from.
async function orderItemWasActuallyDispatched(db:D1Database, item:Record<string,unknown>|null) {
  if(!item) return false
  if(orderItemWasPhysicallyIssued(item)) return true
  const orderItemId=toInt(item.id,0)
  if(!orderItemId) return false
  const row=await db.prepare(
    `SELECT COALESCE(SUM(di.quantity-di.cancelled_quantity),0) AS issued
     FROM order_dispatch_items di
     WHERE di.order_item_id=?`
  ).bind(orderItemId).first<{issued:number}>()
  return toInt(row?.issued,0)>0
}

export async function createReturn(
  db: D1Database,
  input: {
    requestId?: string;
    orderId?: number;
    returnDate?: string;
    amount?: number;
    paymentMethod?: string;
    paymentParts?: MoneyPartInput[];
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
  const paymentParts = normalizeMoneyParts(input.paymentParts, amount, input.paymentMethod);
  const paymentMethod = moneyMethodsSummary(paymentParts);
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
    const stockStatus = cleanText(orderItem.stock_writeoff_status);
    const sentFallback = cleanText((existing as any).shipping_status) === 'sent' && (isWorkshop || !stockStatus);
    const issuedToClient = await orderItemWasActuallyDispatched(db,orderItem) || sentFallback;
    // A historical item can claim to be issued while its original stock obligation
    // still has an active/unresolved reservation. Crediting a physical return in
    // that contradictory state would leave the same SKU both returned and reserved,
    // allowing a later shipment to deduct it again. Fail closed BEFORE creating
    // the Return, refund event, or any stock movement; money-only refunds remain valid.
    if (!isWorkshop && issuedToClient) {
      const dangling = await db.prepare(
        `SELECT id, status, quantity
         FROM inventory_reservations
         WHERE order_item_id = ? AND status IN ('active', 'unresolved')
         ORDER BY id DESC LIMIT 1`
      ).bind(selected.orderItemId).first<{ id: number; status: string; quantity: number }>();
      if (dangling?.id) {
        throw new CriticalOperationConflictError(
          `Позиция «${cleanText(orderItem.product_name_snapshot)}» отмечена как выданная, но по ней ещё действует резерв ${Math.max(0, toInt(dangling.quantity, 0))} шт. Физический возврат остановлен без изменения склада и денег. Сначала уточните фактическую выдачу этой позиции в заказе; возврат только денег доступен отдельно.`
        );
      }
    }
    const physicalState = selected.physicalState;
    const physicalTracking = physicalState !== null;
    const trackedInventorySource = physicalState === 'warehouse' || physicalState === 'boutique' ? physicalState : null;
    // Legacy payloads keep the old restock semantics. New UI payloads are explicit:
    // pending = not physically received yet; no_stock = received but intentionally not stocked.
    const itemRestockRequested = isWorkshop ? selected.restock === true : selected.restock !== false;
    const inventorySource = physicalTracking ? trackedInventorySource : (restockSource !== 'none' && itemRestockRequested ? restockSource : null);
    const wantsRestock = inventorySource !== null;
    if (!issuedToClient) {
      throw new CriticalOperationConflictError(
        `Позиция «${cleanText(orderItem.product_name_snapshot)}» не была выдана клиенту. Физический возврат для неё оформлять нельзя: товар уже остаётся у вас. Сначала измените состав заказа; если нужно вернуть только деньги, оформите возврат без выбора товара.`
      );
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
  // Claim the remaining returnable units inside the SAME D1 transaction as
  // the Return and refund. Two workers may both pass the read-only preflight:
  // only the first guarded INSERT can then claim the last unit.
  const returnItemClaim = (validated: typeof validatedSelectedItems[number], currentReturnId: number | null) => {
    const { selected, orderItem, quantity, inventorySource, physicalTracking, physicalState } = validated;
    const targetIdSql = currentReturnId
      ? '?'
      : '(SELECT target_id FROM critical_operations WHERE request_id = ?)';
    return db.prepare(
      `INSERT INTO return_items (
         return_id, order_item_id, product_name_snapshot, quantity, amount, inventory_source, restocked,
         physical_tracking, physical_received_at,
         gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, created_at
       )
       SELECT ${targetIdSql}, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?
       WHERE EXISTS (
         SELECT 1 FROM order_items oi
         WHERE oi.id = ? AND oi.order_id = ? AND oi.quantity >= ?
           + COALESCE((
             SELECT SUM(ri.quantity)
             FROM return_items ri
             JOIN returns r ON r.id = ri.return_id
             WHERE r.order_id = ? AND ri.order_item_id = ?
               AND COALESCE(r.status, 'completed') <> 'cancelled'
               AND ${noStandaloneReturnSql}
           ), 0)
       )`
    ).bind(
      currentReturnId || criticalOperation!.requestId,
      selected.orderItemId, cleanText(orderItem.product_name_snapshot), quantity, selected.amount,
      inventorySource, physicalTracking ? 1 : 0, physicalTracking && physicalState !== 'pending' ? createdAt : null,
      cleanText(orderItem.gender_snapshot) || null, cleanText(orderItem.color_snapshot) || null,
      cleanText(orderItem.material_snapshot) || null, cleanText(orderItem.length_snapshot) || null,
      cleanText(orderItem.size_snapshot) || null, createdAt,
      selected.orderItemId, orderId, quantity, orderId, selected.orderItemId,
    );
  };
  const returnItemClaimMapping = (index: number) => db.prepare(
    `INSERT INTO critical_operation_entities
       (request_id, entity_type, entity_key, entity_id, created_at)
     VALUES (?, 'return_item', ?, CASE WHEN changes() = 1 THEN last_insert_rowid() ELSE NULL END, ?)`
  ).bind(criticalOperation!.requestId, `return:item:${index + 1}`, createdAt);

  const claimConflict = (error: unknown): never => {
    const message = cleanText(error instanceof Error ? error.message : error);
    if (/NOT NULL constraint failed.*critical_operation_entities\.entity_id/i.test(message)) {
      throw new CriticalOperationConflictError(
        'Количество для возврата уже изменилось в другом действии. Обновите заказ и повторите. Деньги и склад этим запросом не изменены.'
      );
    }
    throw error;
  };

  let returnId = toInt(criticalOperation.row.target_id, 0);
  if (!returnId) {
    const leaseUntil = Date.now() + 45_000;
    const createStatements: D1PreparedStatement[] = [
      db.prepare(
        `INSERT INTO returns (order_id, manager_id, return_date, amount, payment_method, comment, status, created_at)
         VALUES (?, ?, ?,
           CASE WHEN ? = 0 OR EXISTS (
             SELECT 1 FROM orders o
             WHERE o.id = ? AND o.order_status NOT IN ('deleted', 'archived')
               AND o.archived_at IS NULL
               AND ? <= MAX(0, COALESCE((
                 SELECT SUM(CASE WHEN p.amount > 0 THEN p.amount ELSE 0 END)
                 FROM payments p WHERE p.order_id = o.id
               ), 0) - COALESCE((
                 SELECT SUM(CASE WHEN ret.amount > 0 THEN ret.amount ELSE 0 END)
                 FROM returns ret WHERE ret.order_id = o.id
                   AND COALESCE(ret.status, 'completed') <> 'cancelled'
               ), 0))
           ) THEN ? ELSE NULL END,
           ?, ?, 'completed', ?)`
      ).bind(
        orderId, managerRow?.manager_id ?? null, returnDate,
        amount, orderId, amount, amount,
        amount > 0 ? paymentMethod : null, comment || null, createdAt,
      ),
      db.prepare(
        `UPDATE critical_operations
         SET target_type = 'return', target_id = last_insert_rowid(), target_ref = ?, step = 'return_created',
             lease_until_ms = ?, updated_at = ?, last_error = NULL
         WHERE request_id = ? AND status = 'started' AND lease_token = ?`
      ).bind(cleanText((existing as any).external_id), leaseUntil, createdAt, criticalOperation.requestId, criticalOperation.leaseToken),
    ];
    // Claim each physical item atomically before any money or stock event.
    // A concurrent Exchange that retires the original item makes the claim fail.
    for (const [index, validated] of validatedSelectedItems.entries()) {
      createStatements.push(returnItemClaim(validated, null), returnItemClaimMapping(index));
    }
    if (amount > 0) {
      for (const [index, part] of paymentParts.entries()) {
        createStatements.push(refundMoneyEventStatement(db, {
          eventKey: paymentParts.length === 1 ? returnEventKey : returnEventKey + ':part:' + (index + 1),
          orderId,
          externalOrderId: cleanText((existing as any).external_id),
          returnDate,
          amount: part.amount,
          paymentMethod: part.method,
          timestamp: createdAt,
          eventType: 'order_refund',
          sourceRef: `critical-operation:${criticalOperation.requestId}`,
          comment: comment || null,
        }));
      }
    }
    // The refund limit must be enforced atomically with Return creation.
    // If two employees both read the same refundable amount, the losing batch
    // intentionally fails returns.amount NOT NULL before recording money,
    // stock obligations or the critical operation's target.
    try {
      await db.batch(createStatements);
    } catch (error) {
      const raw = cleanText(error instanceof Error ? error.message : error);
      if (/not null constraint failed:\s*returns\.amount/i.test(raw)) {
        throw new CriticalOperationConflictError(
          'Доступная сумма возврата изменилась: другой сотрудник уже оформил возврат денег. Ничего не списано. Обновите заказ.',
        );
      }
      claimConflict(error);
    }
    await refreshCriticalOperation(db, criticalOperation);
    returnId = toInt(criticalOperation.row.target_id, 0) || returnId;
  }
  if (!returnId) throw new Error('Return record was not created.');
  const stockReturns: unknown[] = [];
  const pendingInventory: unknown[] = [];
  for (const validated of validatedSelectedItems) {
    const { selected, orderItem, quantity, wantsRestock, isWorkshop, inventorySource } = validated;

    // Previously committed claim remains mapped after uncertain HTTP responses.
    // Old interrupted requests are guarded by a fresh atomic claim, never replayed blindly.
    const itemIndex = validatedSelectedItems.indexOf(validated);
    const itemKey = `return:item:${itemIndex + 1}`;
    let returnItemId = await criticalOperationEntityId(db, criticalOperation.requestId, 'return_item', itemKey);
    if (!returnItemId) {
      try {
        await db.batch([returnItemClaim(validated, returnId), returnItemClaimMapping(itemIndex)]);
      } catch (error) {
        claimConflict(error);
      }
      returnItemId = await criticalOperationEntityId(db, criticalOperation.requestId, 'return_item', itemKey) || 0;
    }
    if (!returnItemId) throw new CriticalOperationConflictError('Не удалось безопасно зафиксировать позицию возврата.');

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
