import type { EditorItem, ExchangeDraft, OrderRecord } from './types'
import { formatMoney, readJsonResponse } from './utils'
import type { useApiClient } from './controllers/useApiClient'

type ExchangeCriticalClient = Pick<
  ReturnType<typeof useApiClient>,
  'apiFetch' | 'prepareCriticalRequest' | 'completeCriticalRequest'
>

// A Set V2 Exchange is two independent collections, not old-to-new pairs.
// Compute exact historic price snapshots and current settlement before any write.
export function prepareExchangeSetCreation(order: OrderRecord, draft: ExchangeDraft) {
  const selectedOld = (draft.oldSelections || []).filter((entry) => Number(entry.orderItemId || 0) > 0 && Number(entry.quantity || 0) > 0)
  const selectedNew = (draft.newItems || []).filter((entry) => String(entry.item?.productName || '').trim())

  if (!selectedOld.length) {
    return { ok: false as const, error: 'Выберите хотя бы один товар, который клиент меняет.' }
  }
  if (!selectedNew.length) {
    return { ok: false as const, error: 'Добавьте хотя бы один товар, который клиент получает.' }
  }

  const oldPayload: Array<{
    orderItemId: number
    quantity: number
    physicalState: 'not_issued' | 'pending' | 'warehouse' | 'boutique' | 'no_stock'
    expectedActiveQuantity: number
    expectedUnitPrice: number
    expectedLineTotal: number
    expectedCatalogPriceSnapshot: number | null
  }> = []
  let removedValue = 0
  for (const [index, selected] of selectedOld.entries()) {
    const item = order.items.find((candidate) => Number(candidate.id || 0) === Number(selected.orderItemId || 0))
    if (!item) {
      return { ok: false as const, error: `Возвращаемая позиция ${index + 1} больше не найдена в заказе. Обновите заказ.` }
    }
    const available = Math.max(0, Number(item.availableOperationQuantity ?? item.quantity ?? 0))
    const quantity = Math.max(1, Number(selected.quantity || 1))
    const unitPrice = Number(item.unitPrice)
    const lineTotal = Number(item.lineTotal)
    if (quantity > available) {
      return { ok: false as const, error: `Для «${item.productName}» доступно ${available} шт., выбрано ${quantity}.` }
    }
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0 || !Number.isSafeInteger(lineTotal) || lineTotal !== Number(item.quantity || 0) * unitPrice) {
      return { ok: false as const, error: `У «${item.productName}» устарели ценовые данные. Обновите заказ и откройте обмен заново.` }
    }
    removedValue += quantity * unitPrice
    oldPayload.push({
      orderItemId: Number(item.id || 0),
      quantity,
      physicalState: selected.physicalState,
      expectedActiveQuantity: Number(item.quantity || 0),
      expectedUnitPrice: unitPrice,
      expectedLineTotal: lineTotal,
      expectedCatalogPriceSnapshot: item.catalogPriceSnapshot == null ? null : Number(item.catalogPriceSnapshot),
    })
  }

  const newPayload: EditorItem[] = []
  let addedValue = 0
  for (const [index, entry] of selectedNew.entries()) {
    const item = entry.item
    const quantity = Math.max(1, Number(item.quantity || 1))
    const unitPrice = item.unitPrice == null ? Number.NaN : Number(item.unitPrice)
    const catalogSnapshot = item.catalogPriceSnapshot == null ? null : Number(item.catalogPriceSnapshot)
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      return { ok: false as const, error: `Новая позиция ${index + 1}: укажите цену продажи.` }
    }
    if (catalogSnapshot !== null && (!Number.isSafeInteger(catalogSnapshot) || catalogSnapshot < 0)) {
      return { ok: false as const, error: `Новая позиция ${index + 1}: цена Каталога изменилась. Выберите товар заново.` }
    }
    addedValue += quantity * unitPrice
    newPayload.push({
      ...item,
      observedPhysicalQuantity: null,
      quantity,
      unitPrice,
      catalogPriceSnapshot: catalogSnapshot,
    })
  }

  const currentNetPaid = Math.max(0, Number(order.received_amount || 0) - Number(order.return_amount || 0))
  const projectedTotal = Number(order.total_amount || 0) - removedValue + addedValue
  if (!Number.isSafeInteger(projectedTotal) || projectedTotal < 0) {
    return { ok: false as const, error: 'Не удалось безопасно рассчитать новый итог заказа.' }
  }
  const dueBeforeSettlement = Math.max(0, projectedTotal - currentNetPaid)
  const refundAmount = Math.max(0, currentNetPaid - projectedTotal)
  const paymentAmount = Math.max(0, Math.trunc(Number(draft.paymentAmount || 0)))
  if (refundAmount > 0 && paymentAmount > 0) {
    return { ok: false as const, error: 'После пересчёта клиенту нужно вернуть деньги. Уберите оплату сейчас.' }
  }
  if (paymentAmount > dueBeforeSettlement) {
    return { ok: false as const, error: `Оплата сейчас больше долга после обмена: ${formatMoney(dueBeforeSettlement)}.` }
  }
  if (paymentAmount > 0 && !draft.paymentMethod.trim()) {
    return { ok: false as const, error: 'Выберите способ оплаты денег, полученных сейчас.' }
  }
  if (refundAmount > 0 && !draft.refundMethod.trim()) {
    return { ok: false as const, error: `Нужно вернуть клиенту ${formatMoney(refundAmount)}. Выберите способ возврата денег.` }
  }

  const extraPaymentAmount = Number(draft.extraPaymentAmount || 0)
  const extraRefundAmount = Number(draft.extraRefundAmount || 0)
  if (paymentAmount > 0 && draft.extraPaymentEnabled && (
    !Number.isSafeInteger(extraPaymentAmount) || extraPaymentAmount <= 0 || extraPaymentAmount >= paymentAmount
    || !draft.extraPaymentMethod.trim()
    || draft.extraPaymentMethod.trim().toUpperCase() === draft.paymentMethod.trim().toUpperCase()
  )) {
    return { ok: false as const, error: 'Для второго способа доплаты укажите другой способ и сумму меньше получаемой доплаты.' }
  }
  if (refundAmount > 0 && draft.extraRefundEnabled && (
    !Number.isSafeInteger(extraRefundAmount) || extraRefundAmount <= 0 || extraRefundAmount >= refundAmount
    || !draft.extraRefundMethod.trim()
    || draft.extraRefundMethod.trim().toUpperCase() === draft.refundMethod.trim().toUpperCase()
  )) {
    return { ok: false as const, error: 'Для второго способа возврата укажите другой способ и сумму меньше возвращаемой.' }
  }
  const paymentParts = paymentAmount > 0
    ? draft.extraPaymentEnabled
      ? [
          { method: draft.paymentMethod, amount: paymentAmount - extraPaymentAmount },
          { method: draft.extraPaymentMethod, amount: extraPaymentAmount },
        ]
      : [{ method: draft.paymentMethod, amount: paymentAmount }]
    : []
  const refundParts = refundAmount > 0
    ? draft.extraRefundEnabled
      ? [
          { method: draft.refundMethod, amount: refundAmount - extraRefundAmount },
          { method: draft.extraRefundMethod, amount: extraRefundAmount },
        ]
      : [{ method: draft.refundMethod, amount: refundAmount }]
    : []

  return {
    ok: true as const,
    oldItemCount: oldPayload.length,
    newItemCount: newPayload.length,
    projectedTotal,
    payload: {
      orderId: order.id,
      exchangeDate: draft.exchangeDate,
      expectedOrderTotal: Number(order.total_amount || 0),
      oldItems: oldPayload,
      newItems: newPayload.map((item) => ({
        ...item, observedPhysicalQuantity: null, issuePossessionConfirmed: item.stockObservationEnabled === true,
      })),
      paymentAmount,
      paymentMethod: draft.paymentMethod,
      refundMethod: draft.refundMethod,
      paymentParts,
      refundParts,
      comment: draft.comment,
    },
  }
}

// Request ID must survive an unknown network result; on success complete the
// critical operation before any follow-up refresh can fail.
export async function submitExchangeSetCreation(
  client: ExchangeCriticalClient,
  payload: Extract<ReturnType<typeof prepareExchangeSetCreation>, { ok: true }>['payload'],
) {
  const criticalKey = `exchange-set-create:${payload.orderId}`
  const critical = client.prepareCriticalRequest(criticalKey, payload)
  const response = await client.apiFetch('/api/exchanges/set', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
    body: JSON.stringify(critical.payload),
  })
  const result = await readJsonResponse<{
    ok?: boolean
    message?: string
    order?: OrderRecord
    oldItemCount?: number
    newItemCount?: number
    finalTotalAmount?: number
    paymentAmount?: number
    refundAmount?: number
    remainingDebt?: number
    pendingInventoryCount?: number
    workshopCount?: number
  }>(response, 'Обмен')
  if (!response.ok) throw new Error(result.message || `Exchange failed: ${response.status}`)
  client.completeCriticalRequest(criticalKey, critical.requestId)
  return result
}
