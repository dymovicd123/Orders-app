import type { OrderRecord } from './types'

export type OrderOperationalProjection = {
  archived: boolean
  deleted: boolean
  retainedOnly: boolean
  hasActiveReturnOperation: boolean
  activeReturnCount: number
  refundAmount: number
  receivedAmount: number
  debtAmount: number
  netRetainedAmount: number
  hasWorkshopItems: boolean
  hasStockItems: boolean
  mixedOrder: boolean
  workshopPending: boolean
  workshopSummary: 'not_applicable' | 'in_workshop' | 'ready' | 'cancelled' | 'mixed'
  workshopLabel: string
  lifecycleLabel: string
  paymentLabel: string
  paymentClass: 'status-online' | 'status-warning' | 'status-offline'
  canOpenDebt: boolean
  canOpenReturn: boolean
  canOpenExchange: boolean
  canEdit: boolean
  canShip: boolean
  canCorrectShipping: boolean
  canOpenStockHandover: boolean
}

/**
 * One operational projection for ordinary order surfaces.
 *
 * Important truth contracts:
 * - return_amount is a financial aggregate, not a whole-order lifecycle state.
 * - workshop task state is stronger than the coarse orders.workshop_status cache.
 * - received / refund / debt are separate money dimensions.
 *
 * This function deliberately does not invent one "god status". It composes the
 * independent facts needed by the UI so every screen does not reinterpret raw
 * database fields on its own.
 */
export function projectOrderOperationalState(
  order: OrderRecord,
  options: { isAdmin?: boolean } = {},
): OrderOperationalProjection {
  const retainedOnly = Boolean(order.retained_only)
  const normalizedOrderStatus = String(order.order_status || '').trim().toLowerCase()
  const archived = retainedOnly || normalizedOrderStatus === 'archived'
  const deleted = normalizedOrderStatus === 'deleted'

  const activeReturns = Array.isArray(order.returns)
    ? order.returns.filter((entry) => String(entry?.status || 'completed').trim().toLowerCase() !== 'cancelled')
    : []
  const activeReturnCount = activeReturns.length
  const hasActiveReturnOperation = activeReturnCount > 0

  const refundAmount = Math.max(0, Number(order.return_amount || 0))
  const receivedAmount = Math.max(0, Number(order.received_amount || 0))
  const debtAmount = Math.max(0, Number(order.debt_amount || 0))
  const netRetainedAmount = Math.max(0, receivedAmount - refundAmount)

  const items = Array.isArray(order.items) ? order.items : []
  const workshopItems = items.filter((item) => Boolean(item?.isWorkshop) || String(item?.sourceType || '').toLowerCase() === 'workshop')
  const hasWorkshopItems = workshopItems.length > 0
  const hasStockItems = items.some((item) => !Boolean(item?.isWorkshop) && String(item?.sourceType || '').toLowerCase() !== 'workshop')
  const mixedOrder = hasWorkshopItems && hasStockItems

  const knownWorkshopStatuses = workshopItems
    .map((item) => String(item?.workshopTaskStatus || '').trim().toLowerCase())
    .filter(Boolean)
  const hasActiveWorkshopTask = knownWorkshopStatuses.includes('active')
  const coarseWorkshopStatus = String(order.workshop_status || '').trim().toLowerCase()

  // Use the coarse order field only as a compatibility fallback when no linked
  // per-item task status is available.
  const workshopPending = hasWorkshopItems && (
    hasActiveWorkshopTask
    || (knownWorkshopStatuses.length === 0 && coarseWorkshopStatus === 'in_workshop')
  )

  let workshopSummary: OrderOperationalProjection['workshopSummary'] = 'not_applicable'
  if (hasWorkshopItems) {
    if (workshopPending) {
      workshopSummary = 'in_workshop'
    } else if (knownWorkshopStatuses.length > 0 && knownWorkshopStatuses.every((status) => status === 'cancelled')) {
      workshopSummary = 'cancelled'
    } else if (knownWorkshopStatuses.length > 0 && knownWorkshopStatuses.some((status) => status === 'cancelled')) {
      workshopSummary = 'mixed'
    } else {
      workshopSummary = 'ready'
    }
  }

  const workshopLabel = workshopSummary === 'not_applicable'
    ? ''
    : workshopSummary === 'in_workshop'
      ? 'Цех: в работе'
      : workshopSummary === 'cancelled'
        ? 'Цех: отменено'
        : workshopSummary === 'mixed'
          ? 'Цех: частично отменено'
          : 'Цех: готово'

  const lifecycleLabel = archived
    ? 'Архив'
    : deleted
      ? 'Удалён'
      : normalizedOrderStatus === 'closed'
        ? 'Закрыт'
        : 'Активен'

  let paymentLabel = 'Не оплачено'
  let paymentClass: OrderOperationalProjection['paymentClass'] = 'status-offline'
  if (receivedAmount > 0 && debtAmount > 0) {
    paymentLabel = refundAmount > 0 ? 'Частично оплачено · был возврат' : 'Частично оплачено'
    paymentClass = 'status-warning'
  } else if (receivedAmount > 0) {
    paymentLabel = refundAmount >= receivedAmount && refundAmount > 0
      ? 'Оплачено · деньги возвращены'
      : refundAmount > 0
        ? 'Оплачено · был возврат'
        : 'Оплачено'
    paymentClass = 'status-online'
  }

  const simpleAdmin = Boolean(options.isAdmin)
  const mutableWorkingOrder = !retainedOnly && !archived && !deleted
  const sent = String(order.shipping_status || '').trim().toLowerCase() === 'sent'

  return {
    archived,
    deleted,
    retainedOnly,
    hasActiveReturnOperation,
    activeReturnCount,
    refundAmount,
    receivedAmount,
    debtAmount,
    netRetainedAmount,
    hasWorkshopItems,
    hasStockItems,
    mixedOrder,
    workshopPending,
    workshopSummary,
    workshopLabel,
    lifecycleLabel,
    paymentLabel,
    paymentClass,
    canOpenDebt: mutableWorkingOrder && debtAmount > 0,
    // Existing completed returns must not turn the whole order into a terminal
    // "returned" state. The Return/Exchange domains validate remaining quantity.
    canOpenReturn: mutableWorkingOrder,
    canOpenExchange: mutableWorkingOrder,
    // Current backend intentionally blocks rewriting an order while a completed
    // Return is active. Keep that safety without using return_amount as lifecycle.
    canEdit: mutableWorkingOrder && !hasActiveReturnOperation && (simpleAdmin || !sent),
    // Preserve current conservative shipping/correction behavior while an active
    // Return exists; this is an action guard, not a lifecycle label.
    canShip: mutableWorkingOrder && !hasActiveReturnOperation && !sent && !workshopPending,
    canCorrectShipping: mutableWorkingOrder && !hasActiveReturnOperation && sent,
    canOpenStockHandover: mutableWorkingOrder
      && !hasActiveReturnOperation
      && !sent
      && Boolean(order.stock_handover_review_needed || (mixedOrder && workshopPending && order.stock_handover_has_active_items)),
  }
}
