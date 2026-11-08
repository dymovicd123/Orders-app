import { cleanText, isArchivedOrder, normalizeDate, normalizeExchangeFinancialAction, normalizeExchangeReturnSource, normalizeOrderStatus, normalizeSourceType, toInt } from '../core/text.ts'
import type { OrderInput, OrderItemSourceType, SourceType } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import { isHumanInventoryModelEnabled } from './catalog.ts'
import { orderItemWasPhysicallyIssued } from './catalog-review.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, criticalOperationEntityId, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext, updateCriticalOperationTargetFromLastInsert } from './critical.ts'
import { applyCanonicalInventoryLifecycleEvent, canAutoApplyFreshWorkshopInbound, getOrderItemForReturnOrExchange, insertInventoryLifecycleEvent, inventoryLifecyclePendingReason, resolveInventoryLifecycleCandidate } from './lifecycle.ts'
import { buildPaymentAndMoneyEventStatements, readOrderFinancialLedger, refundMoneyEventStatement, syncOrderFinancialLedger } from './money.ts'
import { normalizeOrderItems } from './order-core.ts'
import { buildItemizedOrderWritePlan, type ItemizedOrderWritePlan } from './order-pricing.ts'
import { fulfillOrderReservationsV2, releaseOrderReservationV2, resolveCatalogProductAndVariantV2 } from './order-reservations.ts'
import { getOrder, insertOrderContent } from './orders-write.ts'
import { refreshOrderWorkshopStatusFromTasks } from './workshop.ts'
import { noStandaloneReturnSql } from './order-return-capacity.ts'
import { ensureExchangeWorkshopReplacementTask } from './order-exchange-workshop-task.ts'

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
  const oldWasAlreadyIssued = orderItemWasPhysicallyIssued(oldItem)
    || (oldItemIsWorkshop && cleanText((existing as any).shipping_status) === 'sent');
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

  if (input.newItem?.observedPhysicalQuantity != null) {
    throw new Error('Обмен больше не принимает полный остаток товара. Обновите форму и подтвердите только выдаваемые вещи.');
  }
  const physicalIssueConfirmed = (input.newItem as any)?.issuePossessionConfirmed === true;
  const shipmentState = cleanText((input.newItem as any)?.shipmentState);
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
  if (!requestedNewItem.isWorkshop && shipmentState !== 'sent' && shipmentState !== 'pending') {
    throw new CriticalOperationConflictError('Укажите, отправлен ли новый товар клиенту.');
  }
  const newItem = {
    ...requestedNewItem,
    sourceType: effectiveReplacementSource,
    inventorySource: effectiveReplacementSource === 'boutique' ? 'boutique' : 'warehouse' as SourceType,
    isWorkshop: effectiveReplacementSource === 'workshop',
    unitPrice: isItemizedExchange ? itemizedExchangePricingPlan!.newUnitPrice : 0,
    lineTotal: isItemizedExchange ? itemizedExchangePricingPlan!.newLineTotal : 0,
    observedPhysicalQuantity: null,
    shortageAcknowledged: true,
  };

  // Resolve/check a canonical outgoing replacement before the exchange mutates the old item.
  // This prevents a normal "not enough on the shelf" case from leaving a half-created exchange.
  let preResolvedNewCatalog: { productId: number | null; variantId: number | null } | null = null;
  if (!toInt(criticalOperation.row.target_id, 0) && humanInventoryModelEnabled && !newItem.isWorkshop) {
    const resolved = await resolveCatalogProductAndVariantV2(db, newItem, { createMissing: false });
    preResolvedNewCatalog = { productId: resolved.productId, variantId: resolved.variantId };
    if (resolved.variantId) {
      const stock = await db.prepare(
        `SELECT quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
      ).bind(newItem.inventorySource, resolved.variantId).first<{ quantity: number }>();
      const physical = Math.max(0, toInt(stock?.quantity, 0));
      if (physical < newItem.quantity && !physicalIssueConfirmed) {
        throw new Error(`По учёту новой позиции обмена на месте ${physical} шт., требуется ${newItem.quantity}. Подтвердите, что именно эти вещи физически у вас для выдачи. Общий остаток не будет пересчитан.`);
      }
    }
  }

  if (!operationContext.baselineCaptured && humanInventoryModelEnabled && !oldItemIsWorkshop && oldWasNotIssued) {
    if (oldQuantity < rawOldQuantity) {
      // Historical pair exchanges must preserve the reservation of the unexchanged remainder.
      // Persist the BEFORE snapshot ahead of any stock mutation so a retry after a lost
      // response does not subtract reserved_quantity twice.
      let snapshot = operationContext.legacyPartialReservationSnapshot as ReservationSnapshot | undefined;
      if (!snapshot) {
        snapshot = await loadReservationSnapshot(db, oldItemId, oldQuantity, rawOldQuantity) || undefined;
        if (!snapshot) {
          throw new CriticalOperationConflictError('У оставшегося невыданного товара нет действующего резерва. Обмен остановлен без изменений.');
        }
        operationContext = { ...operationContext, legacyPartialReservationSnapshot: snapshot };
        await advanceCriticalOperation(db, criticalOperation, 'legacy_partial_reservation_validated', { context: operationContext });
      }
      await applyNotIssuedReservationReduction(
        db,
        { orderItemId: oldItemId, quantity: oldQuantity, reservationSnapshot: snapshot },
        timestamp,
        cleanText((existing as any).external_id),
      );
    } else {
      await releaseOrderReservationV2(
        db,
        oldItemId,
        timestamp,
        `Обмен без физической выдачи старой позиции ${cleanText((existing as any).external_id)}`,
      );
    }
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
    // The Legacy endpoint also shares the original sold units with standalone
    // Returns. Claim the old quantity in the SAME transaction as its Exchange
    // header, before any old-item physical intake can execute. This closes the
    // Return-first and Exchange-first preflight race without orphan exchanges.
    const claimTargetQuantity = Math.max(0, rawOldQuantity - oldQuantity);
    const oldItemClaims: D1PreparedStatement[] = [
      db.prepare(
        `UPDATE order_items
         SET quantity = ?, line_total = unit_price * ?,
             stock_writeoff_status = CASE WHEN ? <= 0 THEN 'exchanged' ELSE stock_writeoff_status END
         WHERE id = ? AND order_id = ? AND quantity = ?
           AND quantity >= ? + COALESCE((
             SELECT SUM(ri.quantity)
             FROM return_items ri
             JOIN returns r ON r.id = ri.return_id
             WHERE r.order_id = ? AND ri.order_item_id = ?
               AND COALESCE(r.status, 'completed') <> 'cancelled'
               AND ${noStandaloneReturnSql}
           ), 0)`
      ).bind(
        claimTargetQuantity, claimTargetQuantity, claimTargetQuantity,
        oldItemId, orderId, rawOldQuantity, oldQuantity, orderId, oldItemId,
      ),
      db.prepare(`SELECT json('LEGACY_EXCHANGE_OLD_ITEM_CLAIM_CONFLICT') WHERE changes() <> 1`),
    ];
    try {
      exchangeId = await updateCriticalOperationTargetFromLastInsert(
        db, criticalOperation, 'exchange', cleanText((existing as any).external_id),
        exchangeStatement, 'exchange_created', oldItemClaims,
      );
    } catch (error) {
      const message = cleanText(error instanceof Error ? error.message : error);
      if (/LEGACY_EXCHANGE_OLD_ITEM_CLAIM_CONFLICT|malformed JSON/i.test(message)) {
        throw new CriticalOperationConflictError(
          'Старая вещь уже занята другим возвратом или обменом. Обновите заказ: второй обмен остановлен без складских и денежных действий.'
        );
      }
      throw error;
    }
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
  // New critical operations already claimed the old units atomically above.
  // An interrupted pre-upgrade Legacy exchange may still need to apply its
  // original mutation. Never overwrite a quantity changed by another actor.
  const claimState = await db.prepare('SELECT quantity FROM order_items WHERE id = ? AND order_id = ?')
    .bind(oldItemId, orderId).first<{ quantity: number }>();
  const currentOldQuantity = Math.max(0, toInt(claimState?.quantity, -1));
  if (currentOldQuantity === rawOldQuantity) {
    const changed = await db.prepare(
      `UPDATE order_items
       SET quantity = ?, line_total = unit_price * ?,
           stock_writeoff_status = CASE WHEN ? <= 0 THEN 'exchanged' ELSE stock_writeoff_status END
       WHERE id = ? AND order_id = ? AND quantity = ?`
    ).bind(remainingOldQuantity, remainingOldQuantity, remainingOldQuantity, oldItemId, orderId, rawOldQuantity).run();
    if (toInt(changed.meta?.changes, 0) !== 1) {
      throw new CriticalOperationConflictError('Количество старой вещи изменилось во время обмена. Обновите заказ.');
    }
  } else if (currentOldQuantity !== remainingOldQuantity) {
    throw new CriticalOperationConflictError('Старая вещь уже изменена другим действием. Обновите заказ перед продолжением обмена.');
  }

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
      pendingReason: shipmentState === 'pending' ? 'awaiting_dispatch' : inventoryLifecyclePendingReason(resolvedNew, false),
      timestamp,
    });
    if (shipmentState === 'sent' && resolvedNew.variantId) {
      newStockWriteOff = await applyCanonicalInventoryLifecycleEvent(
        db,
        newEvent.id,
        resolvedNew.variantId,
        timestamp,
        `Физическое списание новой позиции обмена #${exchangeId}`,
        { outboundPossessionConfirmed: physicalIssueConfirmed },
      );
    } else if (shipmentState === 'sent') {
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
