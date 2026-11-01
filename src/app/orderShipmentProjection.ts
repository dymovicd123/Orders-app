import type { OrderRecord } from './types'

type OrderLine = OrderRecord['items'][number]
export type LineShipmentState = 'sent' | 'partial' | 'not_sent' | 'unknown'
export type OrderShipmentDisplay = {
  state: LineShipmentState
  label: string
  lines: Array<{
    state: LineShipmentState
    label: string
    sentQuantity: number | null
    quantity: number
  }>
}

const confirmedStockIssue = new Set([
  'fulfilled', 'written_off', 'negative', 'retired_physically_issued',
])
const knownNotIssued = new Set([
  'reserved', 'active', 'pending_reservation', 'unresolved', 'pending',
  // 'reservation_released' alone is ambiguous: a prior handover may have
  // been followed by a Return. Do not call that historic item "not sent".
])

/**
 * A read-only compatibility projection. It does not issue/undo inventory.
 * New item-scoped dispatch quantities take priority; older orders have only
 * fulfillment and whole-order facts. Unknown historical events stay unknown.
 */
export function projectOrderShipmentDisplay(
  order: Pick<OrderRecord, 'shipping_status' | 'items'>,
): OrderShipmentDisplay {
  const orderSent = order.shipping_status === 'sent'
  const lines = (order.items || []).filter(item => Number(item.quantity || 0) > 0).map((item: OrderLine) => {
    const quantity = Math.max(1, Math.trunc(Number(item.quantity || 1)))
    // Stage 5's future canonical shipment ledger will populate this number.
    // Do not infer an arbitrary split quantity from a whole-line reservation.
    const recordedQuantity = (item as OrderLine & { shipmentSentQuantity?: number | null }).shipmentSentQuantity
    let sentQuantity: number | null = null
    let state: LineShipmentState = 'unknown'
    if (typeof recordedQuantity === 'number' && Number.isSafeInteger(recordedQuantity)
      && recordedQuantity >= 0 && recordedQuantity <= quantity) {
      sentQuantity = recordedQuantity
      state = recordedQuantity === quantity ? 'sent' : recordedQuantity === 0 ? 'not_sent' : 'partial'
    } else if (Number(item.pendingExchangeDispatchId || 0) > 0) {
      // Replacement saved as "send later" is not part of a previous order dispatch.
      state = 'not_sent'
      sentQuantity = 0
    } else if (orderSent) {
      // Preserve old whole-order shipping fact, except for new pending replacements.
      state = 'sent'
      sentQuantity = quantity
    } else if (item.isWorkshop || item.sourceType === 'workshop') {
      // Workshop "done" is readiness, NOT evidence the customer received it.
      state = 'not_sent'
      sentQuantity = 0
    } else {
      const stockState = String(item.stockWriteoffStatus || '').trim().toLowerCase()
      if (confirmedStockIssue.has(stockState)) {
        state = 'sent'
        sentQuantity = quantity
      } else if (knownNotIssued.has(stockState)) {
        state = 'not_sent'
        sentQuantity = 0
      }
    }
    const label = state === 'sent' ? 'Отправлен'
      : state === 'not_sent' ? 'Не отправлен'
        : state === 'partial' ? `Отправлено ${sentQuantity} из ${quantity}`
          : 'Отправка не уточнена'
    return { state, label, sentQuantity, quantity }
  })

  // Retained-only historical summaries have no line-level facts.
  if (!lines.length) {
    return {
      state: orderSent ? 'sent' : 'not_sent',
      label: orderSent ? 'Отправлен' : 'Не отправлен',
      lines,
    }
  }
  const anySent = lines.some(line => line.state === 'sent' || line.state === 'partial')
  const allSent = lines.every(line => line.state === 'sent')
  const anyPending = lines.some(line => line.state === 'not_sent' || line.state === 'partial')
  const anyUnknown = lines.some(line => line.state === 'unknown')
  const state: LineShipmentState = allSent ? 'sent'
    : anySent && anyPending ? 'partial'
      : anyUnknown ? 'unknown'
        : anySent ? 'partial'
          : 'not_sent'
  return {
    state,
    label: state === 'sent' ? 'Отправлен'
      : state === 'partial' ? 'Частично отправлено'
        : state === 'not_sent' ? 'Не отправлен'
          : 'Отправка не уточнена',
    lines,
  }
}
