import type { ExchangeDraft, OrderRecord } from './types'
import type { prepareLegacyExchangePairs } from './legacyExchangePreparation'
import type { useApiClient } from './controllers/useApiClient'
import { readJsonResponse } from './utils'

type ValidatedPairs = Extract<ReturnType<typeof prepareLegacyExchangePairs>, { ok: true }>
type PreparedPair = ValidatedPairs['unsavedPairs'][number]
type CriticalClient = Pick<ReturnType<typeof useApiClient>,
  'apiFetch' | 'prepareCriticalRequest' | 'completeCriticalRequest'>

// Keep batch and per-pair POST contracts distinct. Financial adjustment is
// still attached only to the final child; network-ambiguous requests retain
// the original requestId until a durably successful response is observed.
export async function submitLegacyExchangeBatch(
  client: CriticalClient,
  exchangeSelectedOrder: OrderRecord,
  exchangeDraft: ExchangeDraft,
  unsavedPairs: PreparedPair[],
) {
  const batchPayload = {
    orderId: exchangeSelectedOrder.id,
    exchangeDate: exchangeDraft.exchangeDate,
    expectedOrderTotal: Number(exchangeSelectedOrder.total_amount),
    pairs: unsavedPairs.map((pair) => ({
      oldItemId: Number(pair.selectedOldItem.id || 0),
      oldQuantity: pair.oldQuantity,
      oldReturnSource: pair.oldReturnSource,
      oldPhysicalState: pair.oldPhysicalState,
      newItem: {
        ...pair.effectiveNewItem,
        issuePossessionConfirmed: pair.effectiveNewItem.stockObservationEnabled === true,
        unitPrice: Number(pair.effectiveNewItem.unitPrice),
        catalogPriceSnapshot: pair.effectiveNewItem.catalogPriceSnapshot == null ? null : Number(pair.effectiveNewItem.catalogPriceSnapshot),
      },
      newSourceWasManuallyChanged: pair.newSourceWasManuallyChanged,
      expectedOldActiveQuantity: Number(pair.selectedOldItem.quantity),
      expectedOldUnitPrice: Number(pair.selectedOldItem.unitPrice),
      expectedOldLineTotal: Number(pair.selectedOldItem.lineTotal),
      expectedOldCatalogPriceSnapshot: pair.selectedOldItem.catalogPriceSnapshot == null ? null : Number(pair.selectedOldItem.catalogPriceSnapshot),
    })),
    financialAction: exchangeDraft.financialAction,
    financialAmount: exchangeDraft.financialAmount,
    paymentMethod: exchangeDraft.paymentMethod,
    comment: exchangeDraft.comment,
  }
  const batchKey = `exchange-batch-create:${exchangeSelectedOrder.id}:${unsavedPairs.map((pair) => pair.draftKey).join('.')}`
  const critical = client.prepareCriticalRequest(batchKey, batchPayload)
  const response = await client.apiFetch('/api/exchanges/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
    body: JSON.stringify(critical.payload),
  })
  const result = await readJsonResponse<{
    ok?: boolean
    message?: string
    order?: OrderRecord
    exchangeIds?: number[]
    exchangeCount?: number
    pendingInventoryCount?: number
    workshopCount?: number
    finalTotalAmount?: number
  }>(response, 'Обмен · несколько позиций')
  if (!response.ok) throw new Error(result.message || `Exchange batch failed: ${response.status}`)
  client.completeCriticalRequest(batchKey, critical.requestId)
  return result
}

export async function submitLegacyExchangePair(
  client: CriticalClient,
  exchangeSelectedOrder: OrderRecord,
  exchangeDraft: ExchangeDraft,
  pair: PreparedPair,
  pairDraftCount: number,
  itemizedExchange: boolean,
) {
  const isFinalPair = pair.index === pairDraftCount - 1
  const payload = {
    orderId: exchangeSelectedOrder.id,
    exchangeDate: exchangeDraft.exchangeDate,
    oldItemId: Number(pair.selectedOldItem.id || 0),
    oldQuantity: pair.oldQuantity,
    oldReturnSource: pair.oldReturnSource,
    oldPhysicalState: pair.oldPhysicalState,
    newItem: itemizedExchange ? {
      ...pair.effectiveNewItem,
      issuePossessionConfirmed: pair.effectiveNewItem.stockObservationEnabled === true,
      unitPrice: Number(pair.effectiveNewItem.unitPrice),
      catalogPriceSnapshot: pair.effectiveNewItem.catalogPriceSnapshot == null ? null : Number(pair.effectiveNewItem.catalogPriceSnapshot),
    } : { ...pair.effectiveNewItem, issuePossessionConfirmed: pair.effectiveNewItem.stockObservationEnabled === true },
    newSourceWasManuallyChanged: pair.newSourceWasManuallyChanged,
    ...(itemizedExchange ? {
      expectedOrderTotal: Number(exchangeSelectedOrder.total_amount),
      expectedOldActiveQuantity: Number(pair.selectedOldItem.quantity),
      expectedOldUnitPrice: Number(pair.selectedOldItem.unitPrice),
      expectedOldLineTotal: Number(pair.selectedOldItem.lineTotal),
      expectedOldCatalogPriceSnapshot: pair.selectedOldItem.catalogPriceSnapshot == null ? null : Number(pair.selectedOldItem.catalogPriceSnapshot),
    } : {}),
    // One visit has one money difference. Put it only on the final child exchange,
    // so debt/top-up/refund can never be counted once per selected product.
    financialAction: isFinalPair ? exchangeDraft.financialAction : 'none',
    financialAmount: isFinalPair ? exchangeDraft.financialAmount : 0,
    paymentMethod: isFinalPair ? exchangeDraft.paymentMethod : '',
    comment: exchangeDraft.comment,
  }
  const criticalKey = `exchange-create:${exchangeSelectedOrder.id}:${pair.draftKey}`
  const critical = client.prepareCriticalRequest(criticalKey, payload)
  const response = await client.apiFetch('/api/exchanges', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
    body: JSON.stringify(critical.payload),
  })
  const result = await readJsonResponse<{ ok?: boolean; message?: string; order?: OrderRecord; exchangeId?: number; pendingInventoryCount?: number }>(response, `Обмен · позиция ${pair.index + 1}`)
  if (!response.ok) throw new Error(result.message || `Exchange failed: ${response.status}`)
  client.completeCriticalRequest(criticalKey, critical.requestId)
  return result
}
