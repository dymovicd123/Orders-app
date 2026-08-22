// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.
import { cleanText, isArchivedOrder, normalizeDate, normalizeExchangeFinancialAction, normalizeExchangeReturnSource, normalizeOrderStatus, normalizeReturnRestockSource, normalizeSourceType, toInt, upperText } from '../core/text.ts'
import type { OrderInput, OrderItemSourceType, SourceType } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import { isHumanInventoryModelEnabled, loadCanonicalVariantSnapshot } from './catalog.ts'
import { orderItemWasPhysicallyIssued } from './catalog-review.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, criticalOperationEntityId, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext, refreshCriticalOperation, updateCriticalOperationTargetFromLastInsert } from './critical.ts'
import type { InventoryLifecycleEventRow } from './lifecycle.ts'
import { applyCanonicalInventoryLifecycleEvent, canAutoApplyFreshWorkshopInbound, cancelInventoryLifecycleEvent, getOrderItemForReturnOrExchange, insertInventoryLifecycleEvent, inventoryLifecyclePendingReason, resolveInventoryLifecycleCandidate } from './lifecycle.ts'
import { buildPaymentAndMoneyEventStatements, readOrderFinancialLedger, refundMoneyEventStatement, refundReversalMoneyEventStatement, removeSinglePaymentWithMoneyEvent, syncOrderFinancialLedger } from './money.ts'
import { normalizeOrderItems } from './order-core.ts'
import { resolveCatalogProductAndVariantV2 } from './order-reservations.ts'
import { getOrder, insertOrderContent } from './orders-write.ts'
import { normalizeWorkshopTaskStatus, refreshOrderWorkshopStatusFromTasks } from './workshop.ts'
import { assertWorkshopTaskDetailSchema } from './workshop-schema.ts'

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
    items?: Array<{ orderItemId?: number; quantity?: number; amount?: number; restock?: boolean }>;
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
  const existingReturn = await db.prepare(
    `SELECT id FROM returns
     WHERE order_id = ? AND COALESCE(status, 'completed') <> 'cancelled'
     ORDER BY id DESC LIMIT 1`
  ).bind(orderId).first<{ id: number }>();
  const operationReturnId = toInt(criticalOperation.row.target_id, 0);
  if (existingReturn?.id && existingReturn.id !== operationReturnId) {
    throw new Error('По этому заказу уже оформлен возврат. Сначала отмените его, если он был создан ошибочно.');
  }

  const returnDate = normalizeDate(input.returnDate || existing.order_date);
  const amount = Math.max(0, toInt(input.amount, 0));
  const paymentMethod = upperText(input.paymentMethod);
  const comment = cleanText(input.comment);
  // On a retry the return created by this same operation is already included in
  // order.return_amount. Add only that operation-owned amount back so the request
  // can resume without treating its own already-recorded refund as unavailable.
  const ownOperationReturnAmount = operationReturnId ? amount : 0;
  const availableAmount = Math.max(0, Number(existing.received_amount || 0) - Number(existing.return_amount || 0) + ownOperationReturnAmount);
  const restockSource = normalizeReturnRestockSource(input.restockSource);

  if (amount <= 0) {
    throw new Error('Return amount must be greater than zero.');
  }
  if (!paymentMethod) {
    throw new Error('Выберите способ возврата денег. Это нужно для корректного учёта наличных и финансов.');
  }

  if (amount > availableAmount) {
    throw new Error(`Return amount exceeds available received funds: ${availableAmount}.`);
  }

  const rawItems = Array.isArray(input.items) ? input.items : [];
  const selectedItemMap = new Map<number, { orderItemId: number; quantity: number; amount: number; restock: boolean }>();
  for (const rawItem of rawItems) {
    const orderItemId = toInt(rawItem?.orderItemId, 0);
    const quantity = Math.max(0, toInt(rawItem?.quantity, 0));
    if (!orderItemId || quantity <= 0) continue;
    const current = selectedItemMap.get(orderItemId);
    selectedItemMap.set(orderItemId, {
      orderItemId,
      quantity: (current?.quantity || 0) + quantity,
      amount: (current?.amount || 0) + Math.max(0, toInt(rawItem?.amount, 0)),
      restock: true,
    });
  }
  const selectedItems = Array.from(selectedItemMap.values());
  const validatedSelectedItems: Array<{
    selected: { orderItemId: number; quantity: number; amount: number; restock: boolean };
    orderItem: Record<string, unknown>;
    quantity: number;
    isWorkshop: boolean;
    wantsRestock: boolean;
  }> = [];
  const humanInventoryModelEnabled = await isHumanInventoryModelEnabled(db);

  // Validate every selected row before inserting the return or changing stock.
  // A bad second row must not leave a half-created return behind.
  for (const selected of selectedItems) {
    const orderItem = await getOrderItemForReturnOrExchange(db, orderId, selected.orderItemId);
    if (!orderItem) throw new Error(`Позиция заказа #${selected.orderItemId} не найдена.`);
    const maxQuantity = Math.max(0, toInt(orderItem.quantity, 0));
    if (maxQuantity <= 0) throw new Error(`Позиция ${cleanText(orderItem.product_name_snapshot)} уже возвращена или заменена.`);
    if (selected.quantity > maxQuantity) {
      throw new Error(`Для ${cleanText(orderItem.product_name_snapshot)} доступно только ${maxQuantity} шт., запрошено ${selected.quantity}.`);
    }
    const isWorkshop = Boolean(toInt(orderItem.is_workshop, 0));
    const wantsRestock = restockSource !== 'none' && selected.restock;
    if (humanInventoryModelEnabled && wantsRestock && !isWorkshop && !orderItemWasPhysicallyIssued(orderItem)) {
      throw new Error(`Позиция «${cleanText(orderItem.product_name_snapshot)}» по учёту ещё не была физически выдана / отправлена. Возвращать её в остаток нельзя — это удвоит товар. Для неотправленного заказа используйте редактирование/удаление заказа либо выберите возврат денег без приёма вещи.`);
    }
    validatedSelectedItems.push({
      selected,
      orderItem,
      quantity: selected.quantity,
      isWorkshop,
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
    const [insertReturn] = await db.batch([
      db.prepare(
        `INSERT INTO returns (order_id, manager_id, return_date, amount, payment_method, comment, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'completed', ?)`
      ).bind(orderId, managerRow?.manager_id ?? null, returnDate, amount, paymentMethod, comment || null, createdAt),
      db.prepare(
        `UPDATE critical_operations
         SET target_type = 'return', target_id = last_insert_rowid(), target_ref = ?, step = 'return_created',
             lease_until_ms = ?, updated_at = ?, last_error = NULL
         WHERE request_id = ? AND status = 'started' AND lease_token = ?`
      ).bind(cleanText((existing as any).external_id), leaseUntil, createdAt, criticalOperation.requestId, criticalOperation.leaseToken),
      refundMoneyEventStatement(db, {
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
      }),
    ]);
    returnId = toInt(insertReturn.meta?.last_row_id, 0);
    await refreshCriticalOperation(db, criticalOperation);
    returnId = toInt(criticalOperation.row.target_id, 0) || returnId;
  }
  if (!returnId) throw new Error('Return record was not created.');
  const stockReturns: unknown[] = [];
  const pendingInventory: unknown[] = [];
  for (const validated of validatedSelectedItems) {
    const { selected, orderItem, quantity, wantsRestock, isWorkshop } = validated;

    const returnItemMapped = await insertCriticalMappedEntity(
      db,
      criticalOperation,
      'return_item',
      `return:item:${validatedSelectedItems.indexOf(validated) + 1}`,
      db.prepare(
        `INSERT INTO return_items (
          return_id, order_item_id, product_name_snapshot, quantity, amount, inventory_source, restocked,
          gender_snapshot, color_snapshot, material_snapshot, length_snapshot, size_snapshot, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`
      ).bind(
        returnId, selected.orderItemId, cleanText(orderItem.product_name_snapshot), quantity, selected.amount,
        wantsRestock ? restockSource : null, cleanText(orderItem.gender_snapshot) || null,
        cleanText(orderItem.color_snapshot) || null, cleanText(orderItem.material_snapshot) || null,
        cleanText(orderItem.length_snapshot) || null, cleanText(orderItem.size_snapshot) || null, createdAt,
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
        inventorySource: restockSource as 'warehouse' | 'boutique',
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
          source: restockSource,
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
    const activeWorkshop = await db.prepare(`SELECT COUNT(*) AS count FROM workshop_tasks WHERE order_id = ? AND status = 'active' AND quantity > 0`).bind(orderId).first<{ count: number }>();
    const nextWorkshopStatus = toInt(activeWorkshop?.count, 0) > 0 ? 'in_workshop' : 'cancelled';
    await db.prepare(`UPDATE orders SET workshop_status = ?, updated_at = ? WHERE id = ?`).bind(nextWorkshopStatus, returnUpdateAt, orderId).run();
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
  try {
    await writeActivityLog(db, {
      eventType: 'return_created',
      entityType: 'return',
      entityId: returnId,
      orderId,
      externalOrderId: cleanText((existing as any).external_id),
      title: `Оформлен возврат по заказу ${cleanText((existing as any).external_id)}`,
      details: restockSource === 'none' ? (comment || 'Без возврата в остатки') : `Возврат в ${restockSource === 'warehouse' ? 'склад' : 'бутик'}${comment ? `: ${comment}` : ''}`,
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
    newItem?: NonNullable<OrderInput['items']>[number];
    newSourceWasManuallyChanged?: boolean;
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
  if (isArchivedOrder(existing)) throw new Error('Нельзя оформлять обмен по архивному заказу.');
  if (normalizeOrderStatus((existing as any).order_status) === 'deleted') throw new Error('Нельзя оформлять обмен по удалённому заказу.');
  if (!operationContext.baselineCaptured && await hasActiveStandaloneReturn(db, orderId)) {
    throw new Error('По заказу уже оформлен обычный возврат. Сначала отмените возврат, затем оформляйте обмен.');
  }

  const oldItemId = toInt(input.oldItemId, 0);
  if (!oldItemId) throw new Error('oldItemId is required.');
  const oldItem = await getOrderItemForReturnOrExchange(db, orderId, oldItemId);
  if (!oldItem) throw new Error('Old order item not found.');

  const availableOldQuantity = operationContext.baselineCaptured
    ? Math.max(0, toInt(operationContext.availableOldQuantity, 0))
    : Math.max(0, toInt(oldItem.quantity, 0));
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
  if (!operationContext.baselineCaptured && humanInventoryModelEnabled && !oldItemIsWorkshop && !orderItemWasPhysicallyIssued(oldItem)) {
    throw new Error(`Позиция «${cleanText(oldItem.product_name_snapshot)}» по учёту ещё не была физически выдана / отправлена. До выдачи это не обмен физической вещи — измените состав неотправленного заказа вместо обмена, иначе резерв и остаток разойдутся.`);
  }
  const oldReturnSource = normalizeExchangeReturnSource(input.oldReturnSource);
  const exchangeDate = normalizeDate(input.exchangeDate || (existing as any).order_date);
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
    unitPrice: 0,
    lineTotal: 0,
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

  if (!operationContext.baselineCaptured) {
    operationContext = {
      ...operationContext,
      baselineCaptured: true,
      startedAt: timestamp,
      availableOldQuantity,
      availableRefundAmount,
      baseTotalAmount: ledger.totalAmount,
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
        material_snapshot, length_snapshot, size_snapshot, quantity, inventory_source, created_at
      ) VALUES (?, 'old', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      exchangeId, oldItemId, cleanText(oldItem.product_name_snapshot), cleanText(oldItem.gender_snapshot) || null,
      cleanText(oldItem.color_snapshot) || null, cleanText(oldItem.material_snapshot) || null,
      cleanText(oldItem.length_snapshot) || null, cleanText(oldItem.size_snapshot) || null, oldQuantity,
      oldReturnSource === 'none' ? null : oldReturnSource, timestamp,
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

  const remainingOldQuantity = Math.max(0, Math.max(0, toInt(operationContext.availableOldQuantity, availableOldQuantity)) - oldQuantity);
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
    [{ ...newItem, unitPrice: 0, lineTotal: 0 }],
    [],
    timestamp,
    'exchange_new',
    String(exchangeId),
    `Списание новой позиции обмена #${exchangeId}`,
    preResolvedNewCatalog ? [preResolvedNewCatalog] : undefined,
    criticalOperation,
    'exchange_new',
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
  let nextTotalAmount = Math.max(0, toInt(operationContext.baseTotalAmount, ledger.totalAmount));

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
    nextTotalAmount = Math.max(0, toInt(operationContext.baseTotalAmount, ledger.totalAmount)) + financialAmount;
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
    nextTotalAmount = Math.max(0, Math.max(0, toInt(operationContext.baseTotalAmount, ledger.totalAmount)) - financialAmount);
  }

  if (financialAction !== 'none') {
    await db.prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`).bind(nextTotalAmount, timestamp, orderId).run();
    await db.prepare(`UPDATE exchanges SET payment_id = ?, refund_return_id = ? WHERE id = ?`).bind(paymentId, refundReturnId, exchangeId).run();
  }

  await syncOrderFinancialLedger(db, orderId, timestamp);
  await refreshOrderWorkshopStatusFromTasks(db, orderId, timestamp);

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
      COALESCE((SELECT product_name_snapshot FROM exchange_items WHERE exchange_id = e.id AND role = 'old' ORDER BY id LIMIT 1), '') || ' ' ||
      COALESCE((SELECT product_name_snapshot FROM exchange_items WHERE exchange_id = e.id AND role = 'new' ORDER BY id LIMIT 1), '')
    ), ?) > 0`);
    bindings.push(query);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const summary = await db.prepare(
    `SELECT COUNT(*) AS total_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') <> 'cancelled' THEN 1 ELSE 0 END) AS active_count,
            SUM(CASE WHEN COALESCE(e.status, 'completed') = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count
     FROM exchanges e JOIN orders o ON o.id = e.order_id
     LEFT JOIN managers m ON m.id = e.manager_id LEFT JOIN customers c ON c.id = o.customer_id ${whereSql}`
  ).bind(...bindings).first<Record<string, unknown>>();

  const result = await db.prepare(
    `SELECT e.*, o.external_id, o.order_date, m.name AS manager_name, m.color_key AS manager_color, c.phone_normalized AS customer_phone, c.display_name AS customer_name,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.product_name_snapshot ELSE old_item.product_name_snapshot END AS old_product_name,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.quantity ELSE e.old_quantity END AS old_item_quantity,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.gender_snapshot ELSE old_item.gender_snapshot END AS old_gender_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.color_snapshot ELSE old_item.color_snapshot END AS old_color_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.material_snapshot ELSE old_item.material_snapshot END AS old_material_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.length_snapshot ELSE old_item.length_snapshot END AS old_length_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.size_snapshot ELSE old_item.size_snapshot END AS old_size_snapshot,
       CASE WHEN old_snapshot.id IS NOT NULL THEN old_snapshot.inventory_source ELSE e.old_return_source END AS old_inventory_source,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.product_name_snapshot ELSE new_item.product_name_snapshot END AS new_product_name,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.quantity ELSE new_item.quantity END AS new_item_quantity,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.gender_snapshot ELSE new_item.gender_snapshot END AS new_gender_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.color_snapshot ELSE new_item.color_snapshot END AS new_color_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.material_snapshot ELSE new_item.material_snapshot END AS new_material_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.length_snapshot ELSE new_item.length_snapshot END AS new_length_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.size_snapshot ELSE new_item.size_snapshot END AS new_size_snapshot,
       CASE WHEN new_snapshot.id IS NOT NULL THEN new_snapshot.inventory_source ELSE e.new_source_type END AS new_inventory_source,
       old_lifecycle.status AS old_lifecycle_status, new_lifecycle.status AS new_lifecycle_status
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
  const rows = (result.results || []).map(row => ({
      id: row.id, orderId: row.order_id, externalId: row.external_id, orderDate: row.order_date,
      manager: row.manager_name || '—', managerColor: cleanText(row.manager_color) || null, customer: row.customer_name || row.customer_phone || '—', exchangeDate: row.exchange_date,
      oldItemId: row.old_order_item_id, oldProductName: row.old_product_name || '—', oldQuantity: row.old_item_quantity || row.old_quantity || 0,
      oldGender: row.old_gender_snapshot || '', oldColor: row.old_color_snapshot || '', oldMaterial: row.old_material_snapshot || '', oldLength: row.old_length_snapshot || '', oldSize: row.old_size_snapshot || '', oldReturnSource: row.old_inventory_source || row.old_return_source || 'none',
      newItemId: row.new_order_item_id, newProductName: row.new_product_name || '—', newQuantity: row.new_item_quantity || 0,
      newGender: row.new_gender_snapshot || '', newColor: row.new_color_snapshot || '', newMaterial: row.new_material_snapshot || '', newLength: row.new_length_snapshot || '', newSize: row.new_size_snapshot || '', newSourceType: row.new_inventory_source || row.new_source_type,
      oldLifecycleStatus: cleanText(row.old_lifecycle_status) || null, newLifecycleStatus: cleanText(row.new_lifecycle_status) || null,
      financialAction: row.financial_action || 'none', financialAmount: row.financial_amount || 0, paymentMethod: row.payment_method || '',
      status: row.status || 'completed', comment: row.comment || '', cancelledAt: row.cancelled_at || null, cancellationComment: row.cancellation_comment || null,
    }));
  const totalCount = Math.max(0, toInt(summary?.total_count, 0));
  return { ok: true, count: totalCount, offset, limit, hasMore: offset + rows.length < totalCount,
    summary: { activeCount: Math.max(0, toInt(summary?.active_count, 0)), cancelledCount: Math.max(0, toInt(summary?.cancelled_count, 0)) }, exchanges: rows };
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
    `SELECT workshop_task_id, previous_status, previous_quantity
     FROM return_workshop_task_reversals
     WHERE return_id = ?
     ORDER BY workshop_task_id ASC`
  ).bind(returnId).all<Record<string, unknown>>();

  for (const snapshot of taskSnapshots.results || []) {
    await db.prepare(
      `UPDATE workshop_tasks
       SET status = ?, quantity = ?, updated_at = ?
       WHERE id = ? AND order_id = ?`
    ).bind(
      normalizeWorkshopTaskStatus(snapshot.previous_status),
      Math.max(0, toInt(snapshot.previous_quantity, 0)),
      timestamp,
      toInt(snapshot.workshop_task_id, 0),
      toInt(ret.order_id, 0),
    ).run();
  }

  await db.batch([
    db.prepare(
      `UPDATE returns
       SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?
       WHERE id = ? AND COALESCE(status, 'completed') <> 'cancelled'`
    ).bind(timestamp, comment, returnId),
    refundReversalMoneyEventStatement(db, {
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
    }),
  ]);

  await syncOrderFinancialLedger(db, toInt(ret.order_id, 0), timestamp);
  await refreshOrderWorkshopStatusFromTasks(db, toInt(ret.order_id, 0), timestamp);

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
    `SELECT e.*, o.external_id, o.order_status
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
    const restoredTotalAmountTarget = cancelFinancialAction === 'extra_payment'
      ? Math.max(0, currentTotal - cancelFinancialAmount)
      : cancelFinancialAction === 'refund'
        ? currentTotal + cancelFinancialAmount
        : currentTotal;
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

    // A pending unresolved exchange reservation used to survive cancellation. Lifecycle cancel
    // releases it; this final update removes the cancelled replacement line from the order.
    await db.prepare(
      `UPDATE order_items
       SET quantity = 0, line_total = 0, stock_writeoff_status = 'cancelled'
       WHERE id = ? AND order_id = ?`
    ).bind(newItemId, orderId).run();
  }

  const restoredOldQuantity = Math.max(0, toInt(operationContext.restoredOldQuantityTarget, Math.max(0, toInt(oldItem.quantity, 0)) + oldQuantity));
  const restoredStockStatus = cleanText(exchange.old_item_stock_writeoff_status)
    || cleanText(oldItem.stock_writeoff_status)
    || (Boolean(toInt(oldItem.is_workshop, 0)) ? 'none' : 'written_off');
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
  await refreshOrderWorkshopStatusFromTasks(db, orderId, timestamp);
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
