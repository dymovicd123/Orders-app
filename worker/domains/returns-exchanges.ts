// Step 190.6A: structural module extracted from worker/index.ts.
// Business behavior is intentionally unchanged.


import { readJson } from '../core/http.ts'
import { cleanText, isArchivedOrder, normalizeDate, normalizeOrderStatus, normalizeSourceType, toInt } from '../core/text.ts'
import type { OrderInput, OrderItemSourceType, SourceType } from '../core/types.ts'
import { writeActivityLog } from './activity.ts'
import { isHumanInventoryModelEnabled, loadCanonicalVariantSnapshot } from './catalog.ts'
import { orderItemWasPhysicallyIssued } from './catalog-review.ts'
import { isApprovedExchangePriceLineage } from './exchange-price-history.ts'
import type { CriticalOperationHandle } from './critical.ts'
import { advanceCriticalOperation, beginCriticalOperation, completeCriticalOperation, CriticalOperationConflictError, criticalOperationEntityId, failCriticalOperation, insertCriticalMappedEntity, parseCriticalContext, updateCriticalOperationTargetFromLastInsert } from './critical.ts'
import type { InventoryLifecycleEventRow } from './lifecycle.ts'
import { applyCanonicalInventoryLifecycleEvent, canAutoApplyFreshWorkshopInbound, cancelInventoryLifecycleEvent, getOrderItemForReturnOrExchange, insertInventoryLifecycleEvent, inventoryLifecyclePendingReason, resolveInventoryLifecycleCandidate } from './lifecycle.ts'
import { buildPaymentAndMoneyEventStatements, readOrderFinancialLedger, refundMoneyEventStatement, refundReversalMoneyEventStatement, removeSinglePaymentWithMoneyEvent, syncOrderFinancialLedger } from './money.ts'
import { normalizeOrderItems } from './order-core.ts'
import { buildItemizedOrderWritePlan } from './order-pricing.ts'
import { fulfillOrderReservationsV2, releaseOrderReservationV2, resolveCatalogProductAndVariantV2 } from './order-reservations.ts'
import { getOrder, insertOrderContent } from './orders-write.ts'
import { refreshOrderWorkshopStatusFromTasks } from './workshop.ts'
import { exchangeSetPaymentIds, moneyMethodsSummary, normalizeMoneyParts, splitRefundReversalStatements } from './return-exchange-payment-channels.ts'
import type { MoneyPart, MoneyPartInput } from './return-exchange-payment-channels.ts'
import { noStandaloneReturnSql } from './order-return-capacity.ts'
import type { ReservationSnapshot } from './order-exchange-reservation-snapshot.ts'
import { applyNotIssuedReservationReduction, loadReservationSnapshot, restoreNotIssuedReservation } from './order-exchange-reservation-snapshot.ts'

export { correctMistakenOrderHandoverWithCurrentExchange } from './order-handover-exchange-correction.ts'
export { normalizeMoneyParts } from './return-exchange-payment-channels.ts'
export { cancelReturn } from './order-return-cancellation.ts'
export { createReturn } from './order-return-creation.ts'
export { listExchanges } from './order-exchange-list.ts'
export { receiveReturnedItem } from './order-returned-item-receipt.ts'
export { ensureExchangeWorkshopReplacementTask } from './order-exchange-workshop-task.ts'
export { correctExchangeFinancials } from './order-exchange-financial-correction.ts'
export { createExchange } from './order-exchange-creation.ts'
export { cancelExchange } from './order-exchange-cancellation.ts'
export { noStandaloneReturnSql, hasActiveStandaloneReturn } from './order-return-capacity.ts'

export type ExchangeSetOldInput = {
  orderItemId?: number
  quantity?: number
  physicalState?: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'
  expectedActiveQuantity?: number
  expectedUnitPrice?: number
  expectedLineTotal?: number
  expectedCatalogPriceSnapshot?: number | null
}

export type ExchangeSetNewInput = NonNullable<OrderInput['items']>[number] & { shipmentState?: 'sent' | 'pending' }

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
  paymentParts?: MoneyPartInput[]
  refundParts?: MoneyPartInput[]
  comment?: string
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
  shipmentState: 'sent' | 'pending'
  item: NonNullable<ReturnType<typeof normalizeOrderItems>[number]> & { catalogPriceSnapshot: number | null }
  productId: number | null
  variantId: number | null
  inventorySource: SourceType | null
  stockKey: string | null
  physicalIssueConfirmed: boolean
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
  paymentParts?: MoneyPart[]
  refundAmount: number
  refundMethod: string
  refundParts?: MoneyPart[]
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

type ExchangeSetCancelContext = {
  startedAt?: string
  preflight?: {
    projectedRestoredTotal: number
    projectedNetPaid: number
    oldTargets: Array<{ orderItemId: number; baselineQuantity: number; targetQuantity: number; originalUnitPrice: number; expectedCurrentUnitPrice: number; restoredUnitPrice: number }>
    newSnapshots: Array<{ orderItemId: number; quantity: number; unitPrice: number; lineTotal: number }>
  }
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
          || (isWorkshop && cleanText((existing as any).shipping_status) === 'sent')
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
      const stockGroups = new Map<string, { source: SourceType; variantId: number; productName: string; quantity: number; allConfirmed: boolean }>()
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
        } as ExchangeSetNewPlan['item']
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
            physicalIssueConfirmed: false,
            shipmentState: 'pending',
          })
          continue
        }
        const shipmentState = cleanText((requested as any).shipmentState)
        if (shipmentState !== 'sent' && shipmentState !== 'pending') {
          throw new CriticalOperationConflictError(`Новая позиция ${index + 1}: укажите, отправлен ли товар клиенту.`)
        }
        const resolved = await resolveCatalogProductAndVariantV2(db, effectiveItem, { createMissing: false })
        const variantId = toInt(resolved.variantId, 0) || null
        const productId = toInt(resolved.productId, 0) || null
        const inventorySource: SourceType = effectiveItem.sourceType === 'boutique' ? 'boutique' : 'warehouse'
        if ((requested as any).observedPhysicalQuantity != null) {
          throw new CriticalOperationConflictError('Обмен больше не принимает полный остаток. Обновите форму и подтвердите конкретную выдачу.')
        }
        const physicalIssueConfirmed = (requested as any).issuePossessionConfirmed === true
        let stockKey: string | null = null
        if (variantId && shipmentState === 'sent') {
          stockKey = `${inventorySource}:${variantId}`
          const group = stockGroups.get(stockKey) || {
            source: inventorySource,
            variantId,
            productName: cleanText(effectiveItem.productName),
            quantity: 0,
            allConfirmed: true,
          }
          group.quantity += Math.max(1, toInt(effectiveItem.quantity, 1))
          group.allConfirmed = group.allConfirmed && physicalIssueConfirmed
          stockGroups.set(stockKey, group)
        }
        newPlans.push({ inputIndex: index, item: effectiveItem, productId, variantId, inventorySource, stockKey, physicalIssueConfirmed, shipmentState })
      }

      for (const group of stockGroups.values()) {
        const stock = await db.prepare(
          `SELECT quantity FROM inventory_stock WHERE inventory_source = ? AND variant_id = ? ORDER BY id ASC LIMIT 1`
        ).bind(group.source, group.variantId).first<{ quantity: number }>()
        const physical = Math.max(0, toInt(stock?.quantity, 0))
        if (physical < group.quantity && !group.allConfirmed) {
          throw new CriticalOperationConflictError(`Для «${group.productName}» нужно ${group.quantity} шт., по учёту на месте ${physical}. Подтвердите наличие выдаваемых вещей; общий остаток не пересчитывается.`)
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
      const paymentParts = normalizeMoneyParts(input.paymentParts, paymentAmount, input.paymentMethod)
      const refundParts = normalizeMoneyParts(input.refundParts, settlement.refundAmount, input.refundMethod)
      const paymentMethod = moneyMethodsSummary(paymentParts)
      const refundMethod = moneyMethodsSummary(refundParts)

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
        paymentParts,
        refundAmount: settlement.refundAmount,
        refundMethod,
        refundParts,
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
      // Claim every original unit in the same atomic D1 transaction as the
      // exchange header. A standalone Return and a Set V2 exchange may both
      // validate the same preflight state; only one can reserve the last unit.
      // The order-item quantity is the shared committed claim seen by Return.
      // This is resumable: the original Exchange plan keeps initial/target
      // quantities and its next step is exchange_created in the SAME batch.
      const oldItemClaims: D1PreparedStatement[] = executionPlan.oldItems.flatMap((plan) => [
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
          plan.targetQuantity, plan.targetQuantity, plan.targetQuantity,
          plan.orderItemId, executionPlan.orderId, plan.initialQuantity,
          plan.quantity, executionPlan.orderId, plan.orderItemId,
        ),
        // SQLite changes() is exactly the direct-row count in the preceding
        // statement (unlike D1 meta.changes, which can count triggers).
        // A stale claim must abort the entire header transaction; otherwise a
        // phantom Exchange and double physical old-item intake can survive.
        db.prepare(`SELECT json('EXCHANGE_OLD_ITEM_CLAIM_CONFLICT') WHERE changes() <> 1`),
      ])
      try {
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
        oldItemClaims,
      )
      } catch (error) {
        // The fail-closed SQL assertion throws 'malformed JSON' when a
        // Return/another Exchange has already claimed an original unit.
        const message = cleanText(error instanceof Error ? error.message : error)
        if (/EXCHANGE_OLD_ITEM_CLAIM_CONFLICT|malformed JSON/i.test(message)) {
          throw new CriticalOperationConflictError(
            'Одна из старых вещей уже оформлена другим возвратом или обменом. Обновите заказ: второй обмен остановлен без складских и денежных действий.'
          )
        }
        throw error
      }
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
          pendingReason: plan.shipmentState === 'pending' ? 'awaiting_dispatch' : inventoryLifecyclePendingReason(resolved, false),
          timestamp,
        })
        if (plan.shipmentState === 'sent' && resolved.variantId) {
          await applyCanonicalInventoryLifecycleEvent(
            db,
            event.id,
            resolved.variantId,
            timestamp,
            `Физическое списание новой позиции обмена #${exchangeId}`,
            { outboundPossessionConfirmed: plan.physicalIssueConfirmed },
          )
        } else if (plan.shipmentState === 'sent') {
          pendingInventory.push({ eventId: event.id, eventType: event.event_type, productName: cleanText(inserted.product_name_snapshot), source: plan.inventorySource })
        }
        // Unsent exchange replacements retain their active reserve and do not affect physical stock.
      }

      completedNew = index + 1
      operationContext = { ...operationContext, completedNew }
      await advanceCriticalOperation(db, criticalOperation, `new_${completedNew}_done`, { context: operationContext })
    }

    if (!operationContext.financesCompleted) {
      let paymentId: number | null = null
      let refundReturnId: number | null = null
      if (executionPlan.financialAction === 'extra_payment') {
        const parts = executionPlan.paymentParts || normalizeMoneyParts(undefined, executionPlan.paymentAmount, executionPlan.paymentMethod)
        for (const [index, part] of parts.entries()) {
          const entityKey = index === 0 ? 'exchange:set:payment' : 'exchange:set:payment:' + (index + 1)
          let currentPaymentId = await criticalOperationEntityId(db, criticalOperation.requestId, 'payment', entityKey)
          if (!currentPaymentId) {
            const pair = buildPaymentAndMoneyEventStatements(db, {
              orderId: executionPlan.orderId,
              externalOrderId: executionPlan.externalOrderId,
              paymentDate: executionPlan.exchangeDate,
              method: part.method,
              amount: part.amount,
              paymentKind: 'extra',
              comment: executionPlan.comment || `Оплата при обмене #${exchangeId}`,
              timestamp,
              eventType: 'exchange_extra',
              sourceType: 'exchange',
              sourceId: exchangeId,
              sourceRef: `exchanges:${exchangeId}`,
              reason: 'exchange_set_created',
              eventKey: `1901:${criticalOperation.requestId}:exchange-set-payment` + (index ? ':part:' + (index + 1) : ''),
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
            currentPaymentId = await criticalOperationEntityId(db, criticalOperation.requestId, 'payment', entityKey) || toInt(insert.meta?.last_row_id, 0) || null
          }
          if (index === 0) paymentId = currentPaymentId
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
            ...(executionPlan.refundParts || normalizeMoneyParts(undefined, executionPlan.refundAmount, executionPlan.refundMethod))
              .map((part, index) => refundMoneyEventStatement(db, {
                eventKey: `1901:${criticalOperation!.requestId}:exchange-set-refund` + (index ? ':part:' + (index + 1) : ''),
                orderId: executionPlan.orderId,
                externalOrderId: executionPlan.externalOrderId,
                returnDate: executionPlan.exchangeDate,
                amount: part.amount,
                paymentMethod: part.method,
                timestamp,
                eventType: 'exchange_refund',
                sourceId: exchangeId,
                sourceRef: `exchanges:${exchangeId}`,
                comment: executionPlan.comment || `Возврат переплаты по обмену #${exchangeId}`,
                reason: 'exchange_set_created',
              })),
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
    criticalOperation = await beginCriticalOperation(db, 'exchange_set_cancel', input.requestId, { exchangeId, ...input }, { startedAt, exchangeId })
    if (criticalOperation.cachedResponse) return criticalOperation.cachedResponse
    if (!exchangeId) throw new Error('exchangeId is required.')
    let cancelContext = parseCriticalContext<ExchangeSetCancelContext>(criticalOperation.row)

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
      const cancelledOrderId = toInt(exchange.order_id, 0)
      if (cancelledOrderId) await syncOrderFinancialLedger(db, cancelledOrderId, startedAt)
      const completed = { ok: true, exchangeId, alreadyCancelled: true, refreshRequired: true }
      await completeCriticalOperation(db, criticalOperation, completed)
      let order = null
      try { order = await getOrder(db, cancelledOrderId) } catch { order = null }
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
      const newItemIdJson = JSON.stringify(newOrderItemIds)
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
      ).bind(newItemIdJson, exchangeId).first<{ id: number }>()
      if (dependent?.id) {
        throw new CriticalOperationConflictError(`Одна из новых позиций этого обмена уже использована в обмене #${dependent.id}. Сначала отмените более поздний обмен.`)
      }

      const dependentReturn = await db.prepare(
        `SELECT r.id
         FROM return_items ri
         JOIN returns r ON r.id = ri.return_id
         WHERE ri.order_item_id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
           AND COALESCE(r.status, 'completed') <> 'cancelled'
           AND ${noStandaloneReturnSql}
         ORDER BY r.id DESC
         LIMIT 1`
      ).bind(newItemIdJson).first<{ id: number }>()
      if (dependentReturn?.id) {
        throw new CriticalOperationConflictError(`Одна из новых позиций этого обмена уже участвовала в возврате #${dependentReturn.id}. Сначала отмените более поздний возврат.`)
      }
    }

    if (!cancelContext.preflight) {
      const ledger = await readOrderFinancialLedger(db, orderId)
      const activeTotalRow = await db.prepare(
        `SELECT COALESCE(SUM(line_total), 0) AS total_amount
         FROM order_items
         WHERE order_id = ? AND quantity > 0`
      ).bind(orderId).first<{ total_amount: number }>()
      const activeTotal = requiredSafeMoney(activeTotalRow?.total_amount, 'Текущий итог активных позиций')
      if (activeTotal !== ledger.totalAmount) {
        throw new CriticalOperationConflictError('Итог заказа уже не совпадает с активными позициями. Отмена обмена остановлена без изменений.')
      }

      const newSnapshots: Array<{ orderItemId: number; quantity: number; unitPrice: number; lineTotal: number }> = []
      let removedNewValue = 0
      for (let index = 0; index < plan.newItems.length; index += 1) {
        const row = newRows[index]
        const planItem = plan.newItems[index]
        const orderItemId = toInt(row?.order_item_id, 0)
        const quantity = Math.max(0, toInt(row?.current_quantity, 0))
        const unitPrice = requiredSafeMoney(row?.current_unit_price, `Цена новой позиции ${index + 1}`)
        const lineTotal = requiredSafeMoney(row?.current_line_total, `Сумма новой позиции ${index + 1}`)
        const expectedQuantity = Math.max(1, toInt(planItem?.item?.quantity, 1))
        const expectedUnitPrice = requiredSafeMoney(planItem?.item?.unitPrice, `Исходная цена новой позиции ${index + 1}`)
        const expectedLineTotal = expectedQuantity * unitPrice
        // The original execution plan remains immutable. Recognize an explicitly
        // recorded price typo fix ONLY if its append-only lineage bridges from
        // the original sale price to the current item value.
        const authorizedPrice = unitPrice === expectedUnitPrice
          || (orderItemId > 0 && await isApprovedExchangePriceLineage(
            db, exchangeId, orderItemId, expectedUnitPrice, unitPrice,
          ))
        if (!orderItemId
          || quantity !== expectedQuantity
          || !authorizedPrice
          || lineTotal !== expectedLineTotal) {
          throw new CriticalOperationConflictError(
            `Новая позиция обмена ${index + 1} изменилась без подтверждённой истории цены или количества. Автоматическая отмена остановлена.`
          )
        }
        removedNewValue += lineTotal
        if (!Number.isSafeInteger(removedNewValue)) {
          throw new CriticalOperationConflictError('Стоимость новых позиций слишком велика для безопасной отмены.')
        }
        newSnapshots.push({ orderItemId, quantity, unitPrice, lineTotal })
      }

      const oldRowsByOrderItemId = new Map<number, Record<string, unknown>>()
      for (const row of oldRows) {
        const orderItemId = toInt(row.order_item_id, 0)
        if (orderItemId) oldRowsByOrderItemId.set(orderItemId, row)
      }
      const oldTargets: Array<{ orderItemId: number; baselineQuantity: number; targetQuantity: number; originalUnitPrice: number; expectedCurrentUnitPrice: number; restoredUnitPrice: number }> = []
      let originalRemovedValue = 0
      let correctedRemovedValue = 0
      for (const [index, planItem] of plan.oldItems.entries()) {
        const row = oldRowsByOrderItemId.get(planItem.orderItemId)
        if (!row) throw new CriticalOperationConflictError(`Старая позиция обмена ${index + 1} больше не найдена.`)
        const currentUnitPrice = requiredSafeMoney(row.current_unit_price, `Цена старой позиции ${index + 1}`)
        const baselineQuantity = Math.max(0, toInt(row.current_quantity, 0))
        const targetQuantity = baselineQuantity + planItem.quantity
        const correction = await db.prepare(
          `SELECT new_unit_price FROM exchange_order_item_price_corrections
           WHERE exchange_id=? AND order_item_id=? AND role='old'
           ORDER BY id DESC LIMIT 1`
        ).bind(exchangeId,planItem.orderItemId).first<{new_unit_price:number}>()
        const restoredUnitPrice = correction
          ? requiredSafeMoney(correction.new_unit_price, `Исправленная цена старой позиции ${index + 1}`)
          : currentUnitPrice
        if (correction) {
          const valid=await isApprovedExchangePriceLineage(db,exchangeId,planItem.orderItemId,
              planItem.unitPrice,restoredUnitPrice,'old')
          const expectedPresentPrice = baselineQuantity > 0 ? restoredUnitPrice : planItem.unitPrice
          if (!valid || currentUnitPrice !== expectedPresentPrice) {
            throw new CriticalOperationConflictError('Цена оставшейся старой позиции расходится с подтверждённой историей. Отмена остановлена до движения товара.')
          }
        } else if(currentUnitPrice !== planItem.unitPrice) {
          throw new CriticalOperationConflictError('Цена старой позиции обмена изменилась без истории коррекции. Отмена остановлена.')
        }
        if (baselineQuantity > 0 && toInt(row.current_line_total,-1)!==baselineQuantity*currentUnitPrice) {
          throw new CriticalOperationConflictError('Сумма оставшегося товара обмена не совпадает с количеством и ценой.')
        }
        if (!Number.isSafeInteger(targetQuantity) || targetQuantity < 0) {
          throw new CriticalOperationConflictError('Не удалось безопасно рассчитать восстановление старой позиции.')
        }
        originalRemovedValue += planItem.quantity * planItem.unitPrice
        correctedRemovedValue += planItem.quantity * restoredUnitPrice
        if(!Number.isSafeInteger(originalRemovedValue) || !Number.isSafeInteger(correctedRemovedValue)) {
          throw new CriticalOperationConflictError('Итог восстановленных цен вышел за пределы безопасного целого числа.')
        }
        oldTargets.push({ orderItemId: planItem.orderItemId, baselineQuantity, targetQuantity,
          originalUnitPrice: planItem.unitPrice,expectedCurrentUnitPrice:currentUnitPrice,restoredUnitPrice })
      }
      if(originalRemovedValue !== plan.removedValue) {
        throw new CriticalOperationConflictError('Исходный денежный снимок обмена не совпадает с ценами его старых позиций.')
      }

      const projectedRestoredTotal = activeTotal - removedNewValue + correctedRemovedValue
      if (!Number.isSafeInteger(projectedRestoredTotal) || projectedRestoredTotal < 0) {
        throw new CriticalOperationConflictError('Итог заказа после отмены обмена получился некорректным.')
      }

      const financialAction = cleanText(exchange.financial_action)
      const financialAmount = Math.max(0, toInt(exchange.financial_amount, 0))
      const currentNetPaid = ledger.receivedAmount - ledger.returnAmount
      const projectedNetPaid = financialAction === 'extra_payment'
        ? currentNetPaid - financialAmount
        : financialAction === 'refund'
          ? currentNetPaid + financialAmount
          : currentNetPaid
      if (!Number.isSafeInteger(projectedNetPaid) || projectedNetPaid < 0) {
        throw new CriticalOperationConflictError(
          'После отмены обмена возвраты денег превысят оставшиеся оплаты. Сначала отмените или исправьте более позднюю денежную операцию.'
        )
      }
      if (projectedNetPaid > projectedRestoredTotal) {
        throw new CriticalOperationConflictError(
          `После отмены обмена останется переплата ${projectedNetPaid - projectedRestoredTotal}. Сначала исправьте или отмените более позднюю оплату/возврат, затем повторите отмену обмена.`
        )
      }

      cancelContext = {
        ...cancelContext,
        preflight: { projectedRestoredTotal, projectedNetPaid, oldTargets, newSnapshots },
      }
      await advanceCriticalOperation(db, criticalOperation, 'validated', {
        targetType:'exchange',targetId:exchangeId,context:cancelContext,
      })
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
      const target = cancelContext.preflight?.oldTargets.find((entry) => entry.orderItemId === planItem.orderItemId)
      if (!target) throw new CriticalOperationConflictError('Не найден снимок восстановления старой позиции. Отмена остановлена.')
      const currentQuantity = Math.max(0, toInt(current.quantity, 0))
      if (currentQuantity !== target.targetQuantity) {
        if (currentQuantity !== target.baselineQuantity
          || toInt(current.unit_price,-1) !== target.expectedCurrentUnitPrice) {
          throw new CriticalOperationConflictError(
            'Старая позиция или её цена изменились во время отмены обмена. Операция остановлена.'
          )
        }
        const restoredLineTotal=target.targetQuantity * target.restoredUnitPrice
        if(!Number.isSafeInteger(restoredLineTotal)) throw new CriticalOperationConflictError('Ошибка расчёта восстановленной позиции.')
        const result=await db.prepare(
          `UPDATE order_items
           SET quantity = ?,unit_price = ?,line_total = ?,stock_writeoff_status = ?
           WHERE id = ? AND order_id = ? AND quantity = ? AND unit_price = ?`
        ).bind(
          target.targetQuantity,target.restoredUnitPrice,restoredLineTotal,
          planItem.originalStockStatus || (planItem.isWorkshop ? 'workshop' : 'reserved'),
          planItem.orderItemId,orderId,target.baselineQuantity,target.expectedCurrentUnitPrice,
        ).run()
        if(!result.meta?.changes) throw new CriticalOperationConflictError('Старая позиция изменилась во время восстановления.')
      } else if(toInt(current.unit_price,-1)!==target.restoredUnitPrice) {
        throw new CriticalOperationConflictError('Повторное восстановление обнаружило несовпадение подтверждённой цены.')
      }
      if (planItem.physicalState === 'not_issued' && !planItem.isWorkshop) {
        await restoreNotIssuedReservation(db, planItem, timestamp, exchangeId)
      }
      await restoreWorkshopSnapshot(db, planItem.workshopSnapshot, timestamp)
    }

    const financialAction = cleanText(exchange.financial_action)
    const financialAmount = Math.max(0, toInt(exchange.financial_amount, 0))
    if (financialAction === 'extra_payment' && financialAmount > 0) {
      const mappedPaymentIds = await exchangeSetPaymentIds(db, exchangeId)
      const firstPaymentId = toInt(exchange.payment_id, 0)
      const paymentIds = mappedPaymentIds.length ? mappedPaymentIds : firstPaymentId ? [firstPaymentId] : []
      for (const paymentId of new Set(paymentIds)) {
        await removeSinglePaymentWithMoneyEvent(db, {
          paymentId,
          orderId,
          externalOrderId: cleanText(exchange.external_id),
          timestamp,
          relatedType: 'exchange_extra',
          reason: 'exchange_cancel',
          comment,
        })
      }
    } else if (financialAction === 'refund' && financialAmount > 0) {
      const refundReturnId = toInt(exchange.refund_return_id, 0)
      if (refundReturnId) {
        const splitReversals = await splitRefundReversalStatements(db, {
          orderId, externalOrderId: cleanText(exchange.external_id),
          amount: financialAmount, methodSummary: cleanText(exchange.payment_method),
          timestamp, comment, reason: 'exchange_cancel', exchangeId,
        })
        await db.batch([
          db.prepare(
            `UPDATE returns
             SET status = 'cancelled', cancelled_at = ?, cancellation_comment = ?
             WHERE id = ? AND order_id = ?`
          ).bind(timestamp, comment, refundReturnId, orderId),
          ...(splitReversals || [refundReversalMoneyEventStatement(db, {
            eventKey: `189c:exchange-set:${exchangeId}:refund-cancelled`,
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
          })]),
        ])
      }
    }

    const totalRow = await db.prepare(
      `SELECT COALESCE(SUM(line_total), 0) AS total_amount
       FROM order_items
       WHERE order_id = ? AND quantity > 0`
    ).bind(orderId).first<{ total_amount: number }>()
    const restoredTotal = Math.max(0, toInt(totalRow?.total_amount, 0))
    if (restoredTotal !== cancelContext.preflight?.projectedRestoredTotal) {
      throw new CriticalOperationConflictError('Итог заказа изменился во время отмены. Операция остановлена до финального статуса; обновите данные и повторите.')
    }
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
