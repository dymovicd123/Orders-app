import { cleanText, toInt } from '../core/text.ts'
import { isPreSelectiveDispatchOrder } from './order-prior-issued-origin.ts'

type ReadOrder = {
  id: number
  external_id: string
  created_at?: string
  order_status?: string
  archived_at?: string | null
  shipping_status?: string
  committed_exchange_count?: number
  has_committed_item_return?: boolean
  updated_at?: string
  items: Array<Record<string, unknown>>
}
type ReservedLine = {order_item_id: unknown; quantity: unknown; status: unknown; variant_id: unknown}

export function buildOrderShipmentPlan(order: ReadOrder, reservations: ReservedLine[], priorIssuedItemIds: ReadonlySet<number> = new Set()) {
  const closed = ['archived', 'deleted'].includes(cleanText(order.order_status).toLowerCase())
    || Boolean(cleanText(order.archived_at))
  // The old order-wide sent marker records an earlier issue; a NEW replacement
  // may still need shipping. Never re-offer already sent ordinary lines.
  const historicallySent = cleanText(order.shipping_status) === 'sent'
  const legacyOrder = isPreSelectiveDispatchOrder(order.created_at)
  const hasCommittedPhysicalChange = toInt(order.committed_exchange_count, 0) > 0 || Boolean(order.has_committed_item_return)
  const activeById = new Map<number, {quantity: number; variantId: number; status: string}>()
  for (const reservation of reservations) {
    const reservationStatus=cleanText(reservation.status)
    if (reservationStatus !== 'active' && reservationStatus !== 'unresolved') continue
    const id = toInt(reservation.order_item_id, 0)
    if (id <= 0) continue
    const previous = activeById.get(id)
    const variantId = toInt(reservation.variant_id, 0)
    // A conflicting variant across reservations is unsafe: never infer one.
    activeById.set(id, {
      quantity: (previous?.quantity || 0) + Math.max(0, toInt(reservation.quantity, 0)),
      variantId: previous && previous.variantId !== variantId ? 0 : variantId,
      status: previous && previous.status !== reservationStatus ? 'conflict' : reservationStatus,
    })
  }
  // An earlier stock handover has already reduced physical stock. A full
  // issued-only order can be marked sent without performing another issue.
  const fulfilledById = new Map<number, { count: number; quantity: number; variantId: number; source: string }>()
  for (const reservation of reservations) {
    if (cleanText(reservation.status) !== 'fulfilled') continue
    const id = toInt(reservation.order_item_id, 0)
    if (id <= 0) continue
    const previous = fulfilledById.get(id)
    const variantId = toInt(reservation.variant_id, 0)
    const source = cleanText((reservation as ReservedLine & { inventory_source?: unknown }).inventory_source)
    fulfilledById.set(id, {
      count: (previous?.count || 0) + 1,
      quantity: (previous?.quantity || 0) + Math.max(0, toInt(reservation.quantity, 0)),
      variantId: previous && previous.variantId !== variantId ? 0 : variantId,
      source: previous && previous.source !== source ? '' : source,
    })
  }
  const lines = order.items.filter(i => toInt(i.quantity, 0) > 0).map(item => {
    const orderItemId = toInt(item.id, 0)
    const quantity = Math.max(1, toInt(item.quantity, 1))
    const isWorkshop = Boolean(item.isWorkshop) || cleanText(item.sourceType) === 'workshop'
    const pendingExchangeWorkshopId = toInt(item.pendingExchangeWorkshopId, 0)
    const pendingReplacement = toInt(item.pendingExchangeDispatchId, 0) > 0 || (isWorkshop && pendingExchangeWorkshopId > 0)
    const current = activeById.get(orderItemId)
    const stockState = cleanText(item.stockWriteoffStatus).toLowerCase()
    const workshopState = cleanText(item.workshopTaskStatus).toLowerCase()
    const recordedSent = item.shipmentSentQuantity == null ? null : Math.max(0,toInt(item.shipmentSentQuantity,0))
    const alreadyIssued = ['fulfilled','written_off','negative','retired_physically_issued'].includes(stockState)
      || (recordedSent !== null && recordedSent >= quantity)
    const fulfilled = fulfilledById.get(orderItemId)
    const canConfirmPriorIssue = !closed && !historicallySent && !isWorkshop && !pendingReplacement
      && stockState === 'fulfilled' && (recordedSent === null || recordedSent === 0)
      && fulfilled?.count === 1 && fulfilled.quantity === quantity && fulfilled.variantId > 0
      && fulfilled.source === cleanText(item.sourceType)
      && priorIssuedItemIds.has(orderItemId)
    // Post-Stage-5 orders use the normal per-item dispatch ledger even when an
    // earlier stocktake handover has already physically consumed this item.
    const dispatchPriorIssued = !legacyOrder && canConfirmPriorIssue
    const physicalReservationReady = stockState==='reserved' && current?.status==='active' && Boolean(current?.variantId)
    // A known SKU with a shortage-related unresolved reservation may be
    // dispatched after confirming that the specific pieces are physically present.
    const pendingStockResolution = stockState==='pending_reservation'
      && current?.status==='unresolved' && Boolean(current?.variantId)
    const physicallyReady = isWorkshop
      ? ['done', 'ready'].includes(workshopState)
      : physicalReservationReady || pendingStockResolution
    const alreadyClosed = closed || (historicallySent && !pendingReplacement)
    const readyQuantity = alreadyClosed || (alreadyIssued && !dispatchPriorIssued) || (!physicallyReady && !dispatchPriorIssued) ? 0
      : dispatchPriorIssued || isWorkshop || pendingStockResolution ? quantity
        : Math.min(quantity, current?.quantity || 0)
    const reason = readyQuantity ? ''
      : closed ? 'Заказ закрыт'
        : historicallySent && !pendingReplacement ? 'Уже отмечено как отправленное'
          : recordedSent !== null && recordedSent >= quantity ? 'Уже отправлен'
          : alreadyIssued ? 'Уже выдан'
          : isWorkshop ? 'Ещё не готов'
            : 'Проверьте наличие товара'
    return {
      orderItemId, productName: cleanText(item.productName) || 'Товар',
      color:cleanText(item.color),size:cleanText(item.size),
      material:cleanText(item.material),length:cleanText(item.length),
      quantity, sourceType: isWorkshop ? 'workshop' : cleanText(item.sourceType),
      exchangeEventId: pendingReplacement ? toInt(item.pendingExchangeDispatchId, 0) : null,
      exchangeWorkshopId: isWorkshop ? pendingExchangeWorkshopId : null,
      variantId: isWorkshop ? toInt(item.variantId, 0) : (dispatchPriorIssued ? fulfilled!.variantId : (current?.variantId || 0)),
      dispatchPriorIssued,
      reservationStatus: pendingStockResolution ? 'unresolved' : physicalReservationReady ? 'active' : null,
      needsStockConfirmation: Boolean(pendingStockResolution),
      readyQuantity, selectedQuantity: readyQuantity,
      selectable: readyQuantity > 0,
      canConfirmPriorIssue,
      reason,
    }
  })
  return {
    ok: true, orderId: order.id, externalId: order.external_id,
    // A snapshot for the future POST compare-and-swap, NOT authorization by itself.
    orderVersion: cleanText(order.updated_at),
    lines,
    selectedCount: lines.filter(line => line.selectedQuantity > 0).length,
    selectedQuantity: lines.reduce((n, line) => n + line.selectedQuantity, 0),
    // This is not a selective stock dispatch: every original line must have
    // proof of exactly one prior fulfilled reservation.
    canConfirmIssuedOnly: legacyOrder && !closed && !historicallySent && !hasCommittedPhysicalChange && lines.length > 0
      && lines.every(line => line.canConfirmPriorIssue),
    draftOnly: true,
  }
}
