import { readJson } from '../core/http.ts'
import { cleanText, isArchivedOrder, normalizeDate, normalizeExchangeFinancialAction, normalizeOrderStatus, normalizeSourceType, toInt } from '../core/text.ts'
import type { OrderInput, OrderItemSourceType, SourceType } from '../core/types.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, failCriticalOperation, parseCriticalContext } from './critical.ts'
import { readOrderFinancialLedger, syncOrderFinancialLedger } from './money.ts'
import { normalizeOrderItems } from './order-core.ts'
import { buildItemizedOrderWritePlan } from './order-pricing.ts'
import { resolveCatalogProductAndVariantV2 } from './order-reservations.ts'
import { getOrder } from './orders-write.ts'
import { createExchange, noStandaloneReturnSql } from './returns-exchanges.ts'

export type ItemizedExchangeBatchPairInput = {
  oldItemId?: number;
  oldQuantity?: number;
  oldReturnSource?: unknown;
  oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock';
  newItem?: NonNullable<OrderInput['items']>[number];
  newSourceWasManuallyChanged?: boolean;
  expectedOldActiveQuantity?: number;
  expectedOldUnitPrice?: number;
  expectedOldLineTotal?: number;
  expectedOldCatalogPriceSnapshot?: number | null;
};

type ItemizedExchangeBatchExecutionPair = {
  inputIndex: number;
  oldItemId: number;
  oldQuantity: number;
  oldReturnSource: unknown;
  oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock';
  newItem: NonNullable<OrderInput['items']>[number];
  newSourceWasManuallyChanged: boolean;
  expectedOrderTotal: number;
  expectedOldActiveQuantity: number;
  expectedOldUnitPrice: number;
  expectedOldLineTotal: number;
  expectedOldCatalogPriceSnapshot: number | null;
  financialAction: 'none' | 'extra_payment' | 'refund';
  financialAmount: number;
  paymentMethod: string;
  delta: number;
  stockKey: string | null;
};

export type ItemizedExchangeBatchInput = {
  requestId?: string;
  orderId?: number;
  exchangeDate?: string;
  expectedOrderTotal?: number;
  pairs?: ItemizedExchangeBatchPairInput[];
  financialAction?: unknown;
  financialAmount?: number;
  paymentMethod?: string;
  comment?: string;
};

export async function createItemizedExchangeBatch(
  db: D1Database,
  input: ItemizedExchangeBatchInput,
) {
  let criticalOperation: CriticalOperationHandle | null = null;
  try {
    const startedAt = new Date().toISOString();
    criticalOperation = await beginCriticalOperation(db, 'exchange_itemized_batch_create', input.requestId, input, { startedAt });
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse;

    let operationContext = parseCriticalContext<Record<string, any>>(criticalOperation.row);
    let executionPlan = operationContext.executionPlan as {
      orderId: number;
      externalOrderId: string;
      exchangeDate: string;
      comment: string;
      finalTotalAmount: number;
      finalNetPaid: number;
      pairs: ItemizedExchangeBatchExecutionPair[];
    } | undefined;

    if (!executionPlan) {
      const orderId = toInt(input.orderId, 0);
      if (!orderId) throw new Error('orderId is required.');
      const rawPairs = Array.isArray(input.pairs) ? input.pairs : [];
      if (rawPairs.length < 2) {
        throw new CriticalOperationConflictError('Для пакетного itemized-обмена выберите минимум две позиции.');
      }
      if (rawPairs.length > 20) {
        throw new CriticalOperationConflictError('За один обмен можно безопасно обработать не больше 20 позиций.');
      }

      const rawExchangeDate = cleanText(input.exchangeDate);
      if (!rawExchangeDate) throw new Error('Укажите дату обмена.');
      const exchangeDate = normalizeDate(rawExchangeDate);
      const comment = cleanText(input.comment);

      await syncOrderFinancialLedger(db, orderId);
      const existing = await getOrder(db, orderId);
      if (!existing) throw new Error('Order not found.');
      if (cleanText((existing as any).pricing_mode) !== 'itemized_v1') {
        throw new CriticalOperationConflictError('Пакетный путь предназначен только для заказов с построчной ценой.');
      }
      if (isArchivedOrder(existing)) throw new Error('Нельзя оформлять обмен по архивному заказу.');
      if (normalizeOrderStatus((existing as any).order_status) === 'deleted') throw new Error('Нельзя оформлять обмен по удалённому заказу.');

      const ledger = await readOrderFinancialLedger(db, orderId);
      if (!Object.prototype.hasOwnProperty.call(input, 'expectedOrderTotal')) {
        throw new CriticalOperationConflictError('Обновите заказ перед обменом: отсутствует исходный итог заказа.');
      }
      const expectedOrderTotal = Number(input.expectedOrderTotal);
      if (!Number.isSafeInteger(expectedOrderTotal) || expectedOrderTotal < 0 || expectedOrderTotal !== ledger.totalAmount) {
        throw new CriticalOperationConflictError('Итог заказа изменился после открытия обмена. Обновите заказ и повторите.');
      }

      const activeRows = await db.prepare(
        `SELECT
           oi.id, oi.quantity, oi.unit_price, oi.line_total, oi.catalog_price_snapshot,
           oi.is_workshop, oi.source_type, oi.product_name_snapshot,
           (
             SELECT COALESCE(SUM(ri.quantity), 0)
             FROM return_items ri
             JOIN returns r ON r.id = ri.return_id
             WHERE r.order_id = oi.order_id
               AND ri.order_item_id = oi.id
               AND COALESCE(r.status, 'completed') <> 'cancelled'
               AND ${noStandaloneReturnSql}
           ) AS standalone_returned_quantity
         FROM order_items oi
         WHERE oi.order_id = ? AND oi.quantity > 0
         ORDER BY oi.id ASC`
      ).bind(orderId).all<Record<string, unknown>>();

      const rowById = new Map<number, Record<string, unknown>>();
      let derivedCurrentTotal = 0;
      for (const row of activeRows.results || []) {
        const id = toInt(row.id, 0);
        const quantity = Number(row.quantity);
        const unitPrice = Number(row.unit_price);
        const lineTotal = Number(row.line_total);
        const catalogSnapshot = row.catalog_price_snapshot === null || row.catalog_price_snapshot === undefined
          ? null
          : Number(row.catalog_price_snapshot);
        if (!id
          || !Number.isSafeInteger(quantity) || quantity <= 0
          || !Number.isSafeInteger(unitPrice) || unitPrice < 0
          || !Number.isSafeInteger(lineTotal) || lineTotal !== quantity * unitPrice
          || (catalogSnapshot !== null && (!Number.isSafeInteger(catalogSnapshot) || catalogSnapshot < 0))) {
          throw new CriticalOperationConflictError('В itemized-заказе найдена повреждённая ценовая позиция. Обмен остановлен без изменений.');
        }
        derivedCurrentTotal += lineTotal;
        if (!Number.isSafeInteger(derivedCurrentTotal) || derivedCurrentTotal < 0) {
          throw new CriticalOperationConflictError('Итог itemized-заказа слишком велик для точного расчёта обмена.');
        }
        rowById.set(id, row);
      }
      if (derivedCurrentTotal !== ledger.totalAmount) {
        throw new CriticalOperationConflictError('Итог itemized-заказа не совпадает с активными позициями. Обмен остановлен, чтобы не переписать финансовую историю.');
      }

      const requestedByOldItem = new Map<number, number>();
      const preparedPairs: Array<{
        inputIndex: number;
        oldItemId: number;
        oldQuantity: number;
        oldReturnSource: unknown;
        oldPhysicalState?: 'pending' | 'warehouse' | 'boutique' | 'no_stock';
        newItem: NonNullable<OrderInput['items']>[number];
        newSourceWasManuallyChanged: boolean;
        oldInitialQuantity: number;
        oldUnitPrice: number;
        oldCatalogPriceSnapshot: number | null;
        delta: number;
        stockKey: string | null;
        resolvedVariantId: number | null;
        inventorySource: SourceType | null;
        observedPhysicalQuantity: number | null;
      }> = [];
      const stockGroups = new Map<string, {
        inventorySource: SourceType;
        variantId: number;
        productName: string;
        requestedQuantity: number;
        observedPhysicalQuantity: number | null;
      }>();

      for (let inputIndex = 0; inputIndex < rawPairs.length; inputIndex += 1) {
        const pair = rawPairs[inputIndex] || {};
        const oldItemId = toInt(pair.oldItemId, 0);
        const row = rowById.get(oldItemId);
        if (!oldItemId || !row) {
          throw new CriticalOperationConflictError(`Позиция обмена ${inputIndex + 1}: старая вещь больше не активна. Обновите заказ.`);
        }
        const oldInitialQuantity = Number(row.quantity);
        const oldUnitPrice = Number(row.unit_price);
        const oldLineTotal = Number(row.line_total);
        const oldCatalogPriceSnapshot = row.catalog_price_snapshot === null || row.catalog_price_snapshot === undefined
          ? null
          : Number(row.catalog_price_snapshot);
        const expectedFields = [
          'expectedOldActiveQuantity',
          'expectedOldUnitPrice',
          'expectedOldLineTotal',
          'expectedOldCatalogPriceSnapshot',
        ];
        if (!expectedFields.every((key) => Object.prototype.hasOwnProperty.call(pair, key))) {
          throw new CriticalOperationConflictError(`Позиция обмена ${inputIndex + 1}: отсутствует исходный ценовой снимок. Обновите заказ.`);
        }
        const expectedCatalogSnapshot = pair.expectedOldCatalogPriceSnapshot === null || pair.expectedOldCatalogPriceSnapshot === undefined
          ? null
          : Number(pair.expectedOldCatalogPriceSnapshot);
        if (Number(pair.expectedOldActiveQuantity) !== oldInitialQuantity
          || Number(pair.expectedOldUnitPrice) !== oldUnitPrice
          || Number(pair.expectedOldLineTotal) !== oldLineTotal
          || expectedCatalogSnapshot !== oldCatalogPriceSnapshot) {
          throw new CriticalOperationConflictError(`Позиция обмена ${inputIndex + 1}: цена или количество старой вещи изменились после открытия формы. Обновите заказ.`);
        }

        const oldQuantity = Math.max(1, toInt(pair.oldQuantity, 1));
        const alreadyRequested = requestedByOldItem.get(oldItemId) || 0;
        const nextRequested = alreadyRequested + oldQuantity;
        const returnedQuantity = Math.max(0, toInt(row.standalone_returned_quantity, 0));
        const availableQuantity = Math.max(0, oldInitialQuantity - returnedQuantity);
        if (nextRequested > availableQuantity) {
          throw new CriticalOperationConflictError(`Позиция обмена ${inputIndex + 1}: суммарно выбрано ${nextRequested} шт., доступно ${availableQuantity} шт.`);
        }
        requestedByOldItem.set(oldItemId, nextRequested);

        if (!pair.newItem || !Object.prototype.hasOwnProperty.call(pair.newItem, 'unitPrice')) {
          throw new CriticalOperationConflictError(`Позиция обмена ${inputIndex + 1}: укажите фактическую цену продажи новой позиции.`);
        }
        if (!Object.prototype.hasOwnProperty.call(pair.newItem, 'catalogPriceSnapshot')) {
          throw new CriticalOperationConflictError(`Позиция обмена ${inputIndex + 1}: обновите выбор нового товара, чтобы зафиксировать цену Каталога или её отсутствие.`);
        }
        const normalizedNewItems = normalizeOrderItems([pair.newItem], normalizeSourceType((existing as any).source_type));
        if (normalizedNewItems.length !== 1) {
          throw new Error(`Позиция обмена ${inputIndex + 1}: новая вещь не заполнена.`);
        }
        const pricePlan = buildItemizedOrderWritePlan([{
          quantity: pair.newItem.quantity ?? 1,
          unitPrice: pair.newItem.unitPrice,
          catalogPriceSnapshot: pair.newItem.catalogPriceSnapshot ?? null,
        }], []);
        const newLine = pricePlan.lines[0];
        const normalizedNewItem = normalizedNewItems[0];
        const inheritedSource: OrderItemSourceType = toInt(row.is_workshop, 0)
          ? 'workshop'
          : normalizeSourceType(row.source_type) === 'boutique'
            ? 'boutique'
            : 'warehouse';
        const effectiveSource: OrderItemSourceType = pair.newSourceWasManuallyChanged
          ? normalizedNewItem.sourceType
          : inheritedSource;
        const effectiveNewItem = {
          ...pair.newItem,
          sourceType: effectiveSource,
          unitPrice: newLine.unitPrice,
          catalogPriceSnapshot: newLine.catalogPriceSnapshot,
          quantity: newLine.quantity,
        } as NonNullable<OrderInput['items']>[number];

        const replacedValue = oldQuantity * oldUnitPrice;
        const delta = newLine.lineTotal - replacedValue;
        if (!Number.isSafeInteger(replacedValue) || replacedValue < 0 || !Number.isSafeInteger(delta)) {
          throw new CriticalOperationConflictError(`Позиция обмена ${inputIndex + 1}: не удалось безопасно рассчитать изменение суммы.`);
        }

        let stockKey: string | null = null;
        let resolvedVariantId: number | null = null;
        let inventorySource: SourceType | null = null;
        let observedPhysicalQuantity: number | null = null;
        if (effectiveSource !== 'workshop') {
          const normalizedEffective = normalizeOrderItems([effectiveNewItem], normalizeSourceType((existing as any).source_type))[0];
          const resolved = await resolveCatalogProductAndVariantV2(db, normalizedEffective);
          resolvedVariantId = toInt(resolved.variantId, 0) || null;
          inventorySource = effectiveSource === 'boutique' ? 'boutique' : 'warehouse';
          const observedRaw = (effectiveNewItem as any).observedPhysicalQuantity;
          observedPhysicalQuantity = observedRaw === null || observedRaw === undefined ? null : Number(observedRaw);
          if (observedPhysicalQuantity !== null && (!Number.isInteger(observedPhysicalQuantity) || observedPhysicalQuantity < 0)) {
            throw new Error(`Позиция обмена ${inputIndex + 1}: фактический остаток должен быть целым числом от 0.`);
          }
          if (resolvedVariantId) {
            stockKey = `${inventorySource}:${resolvedVariantId}`;
            const group = stockGroups.get(stockKey) || {
              inventorySource,
              variantId: resolvedVariantId,
              productName: cleanText((effectiveNewItem as any).productName),
              requestedQuantity: 0,
              observedPhysicalQuantity: null,
            };
            group.requestedQuantity += Math.max(1, toInt((effectiveNewItem as any).quantity, 1));
            if (observedPhysicalQuantity !== null) {
              if (group.observedPhysicalQuantity !== null && group.observedPhysicalQuantity !== observedPhysicalQuantity) {
                throw new Error(`Для одной новой позиции указаны разные фактические остатки (${group.observedPhysicalQuantity} и ${observedPhysicalQuantity}). Оставьте одно подтверждённое значение.`);
              }
              group.observedPhysicalQuantity = observedPhysicalQuantity;
            }
            stockGroups.set(stockKey, group);
          }
        }

        preparedPairs.push({
          inputIndex,
          oldItemId,
          oldQuantity,
          oldReturnSource: pair.oldReturnSource,
          oldPhysicalState: pair.oldPhysicalState,
          newItem: effectiveNewItem,
          newSourceWasManuallyChanged: Boolean(pair.newSourceWasManuallyChanged),
          oldInitialQuantity,
          oldUnitPrice,
          oldCatalogPriceSnapshot,
          delta,
          stockKey,
          resolvedVariantId,
          inventorySource,
          observedPhysicalQuantity,
        });
      }

      const financialAction = normalizeExchangeFinancialAction(input.financialAction);
      const financialAmount = Math.max(0, toInt(input.financialAmount, 0));
      const paymentMethod = cleanText(input.paymentMethod);
      if (financialAction !== 'none' && financialAmount <= 0) {
        throw new Error('Укажите сумму доплаты или возврата больше нуля.');
      }
      if (financialAction !== 'none' && !paymentMethod) {
        throw new Error(financialAction === 'refund' ? 'Выберите способ возврата денег по обмену.' : 'Выберите способ оплаты для доплаты по обмену.');
      }
      const availableRefundAmount = Math.max(0, ledger.receivedAmount - ledger.returnAmount);
      if (financialAction === 'refund' && financialAmount > availableRefundAmount) {
        throw new Error(`Сумма возврата по обмену больше доступной суммы: ${availableRefundAmount}.`);
      }

      let finalTotalAmount = ledger.totalAmount;
      for (const pair of preparedPairs) {
        finalTotalAmount += pair.delta;
        if (!Number.isSafeInteger(finalTotalAmount) || finalTotalAmount < 0) {
          throw new CriticalOperationConflictError('Итог заказа после выбранных замен некорректен. Обмен остановлен без изменений.');
        }
      }
      const currentNetPaid = Math.max(0, ledger.receivedAmount - ledger.returnAmount);
      const finalNetPaid = financialAction === 'extra_payment'
        ? currentNetPaid + financialAmount
        : financialAction === 'refund'
          ? Math.max(0, currentNetPaid - financialAmount)
          : currentNetPaid;
      if (!Number.isSafeInteger(finalNetPaid) || finalNetPaid > finalTotalAmount) {
        throw new CriticalOperationConflictError(
          `После всего обмена останется необъяснённая переплата ${Math.max(0, finalNetPaid - finalTotalAmount)}. Увеличьте возврат денег или скорректируйте фактические цены новых позиций.`
        );
      }

      for (const group of stockGroups.values()) {
        const stock = await db.prepare(
          'SELECT quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1'
        ).bind(group.inventorySource, group.variantId).first<{ quantity: number }>();
        const physical = Math.max(0, toInt(stock?.quantity, 0));
        const physicalForBatch = group.observedPhysicalQuantity === null ? physical : group.observedPhysicalQuantity;
        if (physicalForBatch < group.requestedQuantity) {
          const missing = group.requestedQuantity - physicalForBatch;
          throw new Error(group.observedPhysicalQuantity === null
            ? `Для «${group.productName}» в этом обмене суммарно нужно ${group.requestedQuantity} шт., а по учёту физически есть ${physical} шт. Уточните фактический остаток в форме и повторите.`
            : `Для «${group.productName}» в этом обмене суммарно нужно ${group.requestedQuantity} шт., но подтверждено физически только ${group.observedPhysicalQuantity} шт. Не хватает ${missing} шт.`);
        }
      }

      // Positive/neutral price deltas go first, negative deltas last. This keeps every
      // resumable child exchange financially valid even if transport fails mid-batch.
      const orderedPairs = [...preparedPairs].sort((left, right) => (
        right.delta - left.delta || left.inputIndex - right.inputIndex
      ));
      const remainingOldQuantity = new Map<number, number>();
      for (const [id, row] of rowById.entries()) remainingOldQuantity.set(id, Number(row.quantity));
      const observedAssigned = new Set<string>();
      let runningTotal = ledger.totalAmount;
      const executionPairs: ItemizedExchangeBatchExecutionPair[] = [];

      for (let position = 0; position < orderedPairs.length; position += 1) {
        const pair = orderedPairs[position];
        const currentOldQuantity = remainingOldQuantity.get(pair.oldItemId) || 0;
        const currentOldLineTotal = currentOldQuantity * pair.oldUnitPrice;
        if (currentOldQuantity <= 0 || !Number.isSafeInteger(currentOldLineTotal) || currentOldLineTotal < 0) {
          throw new CriticalOperationConflictError('Не удалось построить безопасный порядок пакетного обмена.');
        }

        const nextNewItem = { ...pair.newItem } as NonNullable<OrderInput['items']>[number];
        if (pair.stockKey) {
          const groupObservation = stockGroups.get(pair.stockKey)?.observedPhysicalQuantity ?? null;
          if (groupObservation !== null && !observedAssigned.has(pair.stockKey)) {
            (nextNewItem as any).observedPhysicalQuantity = groupObservation;
            observedAssigned.add(pair.stockKey);
          } else {
            (nextNewItem as any).observedPhysicalQuantity = null;
          }
        }

        const childFinancialAction: 'none' | 'extra_payment' | 'refund' =
          financialAction === 'refund' && position === 0
            ? 'refund'
            : financialAction === 'extra_payment' && position === orderedPairs.length - 1
              ? 'extra_payment'
              : 'none';
        const childFinancialAmount = childFinancialAction === 'none' ? 0 : financialAmount;
        const childPaymentMethod = childFinancialAction === 'none' ? '' : paymentMethod;

        executionPairs.push({
          inputIndex: pair.inputIndex,
          oldItemId: pair.oldItemId,
          oldQuantity: pair.oldQuantity,
          oldReturnSource: pair.oldReturnSource,
          oldPhysicalState: pair.oldPhysicalState,
          newItem: nextNewItem,
          newSourceWasManuallyChanged: pair.newSourceWasManuallyChanged,
          expectedOrderTotal: runningTotal,
          expectedOldActiveQuantity: currentOldQuantity,
          expectedOldUnitPrice: pair.oldUnitPrice,
          expectedOldLineTotal: currentOldLineTotal,
          expectedOldCatalogPriceSnapshot: pair.oldCatalogPriceSnapshot,
          financialAction: childFinancialAction,
          financialAmount: childFinancialAmount,
          paymentMethod: childPaymentMethod,
          delta: pair.delta,
          stockKey: pair.stockKey,
        });

        runningTotal += pair.delta;
        remainingOldQuantity.set(pair.oldItemId, currentOldQuantity - pair.oldQuantity);
      }
      if (runningTotal !== finalTotalAmount) {
        throw new CriticalOperationConflictError('План пакетного обмена не совпал с рассчитанным итогом. Ничего не изменено.');
      }

      executionPlan = {
        orderId,
        externalOrderId: cleanText((existing as any).external_id),
        exchangeDate,
        comment,
        finalTotalAmount,
        finalNetPaid,
        pairs: executionPairs,
      };
      operationContext = { ...operationContext, executionPlan, completedPairs: 0 };
      await advanceCriticalOperation(db, criticalOperation, 'validated', { context: operationContext });
    }

    const exchangeIds: number[] = [];
    let pendingInventoryCount = 0;
    let workshopCount = 0;
    let lastOrder: unknown = null;
    let completedPairs = Math.max(0, toInt(operationContext.completedPairs, 0));

    for (let position = 0; position < executionPlan.pairs.length; position += 1) {
      const pair = executionPlan.pairs[position];
      const childRequestId = `${criticalOperation.requestId}:p${position + 1}`;
      const childResponse = await createExchange(db, {
        requestId: childRequestId,
        orderId: executionPlan.orderId,
        exchangeDate: executionPlan.exchangeDate,
        oldItemId: pair.oldItemId,
        oldQuantity: pair.oldQuantity,
        oldReturnSource: pair.oldReturnSource,
        oldPhysicalState: pair.oldPhysicalState,
        newItem: pair.newItem,
        newSourceWasManuallyChanged: pair.newSourceWasManuallyChanged,
        expectedOrderTotal: pair.expectedOrderTotal,
        expectedOldActiveQuantity: pair.expectedOldActiveQuantity,
        expectedOldUnitPrice: pair.expectedOldUnitPrice,
        expectedOldLineTotal: pair.expectedOldLineTotal,
        expectedOldCatalogPriceSnapshot: pair.expectedOldCatalogPriceSnapshot,
        financialAction: pair.financialAction,
        financialAmount: pair.financialAmount,
        paymentMethod: pair.paymentMethod,
        comment: executionPlan.comment,
      }) as any;

      const exchangeId = toInt(childResponse?.exchangeId, 0);
      if (exchangeId) exchangeIds.push(exchangeId);
      pendingInventoryCount += Math.max(0, toInt(childResponse?.pendingInventoryCount, 0));
      workshopCount += Math.max(0, toInt(childResponse?.workshopCount, 0));
      if (childResponse?.order) lastOrder = childResponse.order;

      if (position + 1 > completedPairs) {
        completedPairs = position + 1;
        operationContext = { ...operationContext, completedPairs };
        await advanceCriticalOperation(db, criticalOperation, `pair_${completedPairs}_done`, { context: operationContext });
      }
    }

    if (!lastOrder) {
      try { lastOrder = await getOrder(db, executionPlan.orderId); } catch { lastOrder = null; }
    }
    const response = {
      ok: true,
      batch: true,
      exchangeIds,
      exchangeCount: executionPlan.pairs.length,
      pendingInventoryCount,
      workshopCount,
      finalTotalAmount: executionPlan.finalTotalAmount,
      finalNetPaid: executionPlan.finalNetPaid,
      order: lastOrder,
      refreshRequired: !lastOrder,
    };
    await completeCriticalOperation(db, criticalOperation, response);
    return response;
  } catch (error) {
    await failCriticalOperation(db, criticalOperation, error);
    throw error;
  }
}



export async function createItemizedExchangeBatchFromRequest(db: D1Database, request: Request) {
  const input = await readJson<ItemizedExchangeBatchInput>(request);
  input.requestId = cleanText(input.requestId) || cleanText(request.headers.get('X-Idempotency-Key')) || undefined;
  return await createItemizedExchangeBatch(db, input);
}
