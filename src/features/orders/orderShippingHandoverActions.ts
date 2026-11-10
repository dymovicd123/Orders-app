import type { Dispatch, SetStateAction } from 'react'
import type { InventorySourceKey, OrderRecord } from '../../app/types'
import type { OrderOperationalProjection } from '../../app/orderOperationalProjection'
import type { StockResolutionPrompt } from './StockResolutionConfirmModal'
import type { StockResolutionRequiredItemView } from '../inventory/inventoryMovementActions'
import { formatLocalDateInput, isArchivedOrderRecord, readJsonResponse } from '../../app/utils'

export type OrderStockHandoverItemView = {
  orderItemId: number
  productName: string
  itemDetails: string
  source: InventorySourceKey
  variantId: number
  quantity: number
  reservationId: number | null
  reservationStatus: string
  physicalQuantity: number
  totalReservedQuantity: number
  checkpointId: number | null
  checkpointAt: string | null
  checkpointType: string | null
  checkpointKind: 'revision' | 'check' | null
  reviewNeeded: boolean
  reviewReason: 'late_entry' | 'mixed_order_after_check' | null
  reviewDecision: string | null
  reviewedCheckpointId: number | null
  reviewedCheckpointAt: string | null
  itemCreatedAt: string | null
  state: 'already_issued' | 'handover_review' | 'ready_to_issue' | 'needs_attention'
}

export type OrderStockHandoverResponse = {
  ok: boolean
  message?: string
  orderId?: number
  externalId?: string
  orderDate?: string
  orderCreatedAt?: string
  customerName?: string
  shippingStatus?: string
  workshopPending?: boolean
  workshopItemCount?: number
  activeWorkshopTaskCount?: number
  items?: OrderStockHandoverItemView[]
  state?: OrderStockHandoverResponse
  order?: OrderRecord
  refreshRequired?: boolean
}

export type OrderStockHandoverActionResponse = Omit<OrderStockHandoverResponse, 'items'> & {
  code?: string
  operationType?: string
  items?: Array<OrderStockHandoverItemView | StockResolutionRequiredItemView>
}

export function handoverCheckpointDateLabel(value: string | null | undefined) {
  const raw = String(value || '').trim()
  if (!raw) return 'последней сверки'
  const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) return raw.slice(0, 10)
  return date.toLocaleDateString('ru-RU')
}

export function handoverSourceLabel(source: InventorySourceKey | string) {
  return source === 'boutique' ? 'Бутик' : 'Склад'
}

type ShippingHandoverActionsArgs = {
  askActionConfirmation: (text: string) => Promise<boolean>
  orders: OrderRecord[]
  stockHandoverOrder: OrderRecord | null
  stockHandoverActionItemId: number | null
  savingOrder: boolean
  setStockHandoverOrder: Dispatch<SetStateAction<OrderRecord | null>>
  setStockHandoverData: Dispatch<SetStateAction<OrderStockHandoverResponse | null>>
  setStockHandoverBusy: Dispatch<SetStateAction<boolean>>
  setStockHandoverActionItemId: Dispatch<SetStateAction<number | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setSavingOrder: Dispatch<SetStateAction<boolean>>
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setOrderCatalogResolutionOrder: Dispatch<SetStateAction<OrderRecord | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  askStockResolution: (prompt: StockResolutionPrompt) => Promise<boolean>
  getOrderOperationalProjection: (order: OrderRecord) => Promise<OrderOperationalProjection>
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  upsertOrderInState: (order: OrderRecord) => void
  invalidateInventoryStockCaches: (includeCatalogReview?: boolean) => void
  invalidateFinanceReadCaches: () => void
  refreshDashboard: (force?: boolean) => void
  refreshWorkshop: () => void
}

// One operator boundary owns physical handover, final shipment and correction.
// Original Worker remains the authority for physical stock and reservations.
// Possession confirmation never fabricates an absolute stock count.
export function createOrderShippingHandoverActions({
  askActionConfirmation,
  orders,
  stockHandoverOrder,
  stockHandoverActionItemId,
  savingOrder,
  setStockHandoverOrder,
  setStockHandoverData,
  setStockHandoverBusy,
  setStockHandoverActionItemId,
  setError,
  setMessage,
  setSavingOrder,
  setSelectedOrderId,
  setOrderCatalogResolutionOrder,
  apiFetch,
  askStockResolution,
  getOrderOperationalProjection,
  prepareCriticalRequest,
  completeCriticalRequest,
  upsertOrderInState,
  invalidateInventoryStockCaches,
  invalidateFinanceReadCaches,
  refreshDashboard,
  refreshWorkshop,
}: ShippingHandoverActionsArgs) {
  async function openOrderStockHandover(order: OrderRecord) {
    if (isArchivedOrderRecord(order)) {
      setMessage('Архивный заказ доступен только для просмотра.')
      return
    }
    setStockHandoverOrder(order)
    setStockHandoverData(null)
    setStockHandoverBusy(true)
    setStockHandoverActionItemId(null)
    setError(null)
    try {
      const response = await apiFetch(`/api/orders/${order.id}/stock-handover`)
      const result = await readJsonResponse<OrderStockHandoverResponse>(response, 'Товары со склада')
      if (!response.ok || !result.ok) throw new Error(result.message || `Stock handover failed: ${response.status}`)
      setStockHandoverData(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось открыть товары со склада.')
      setStockHandoverOrder(null)
      setStockHandoverData(null)
    } finally {
      setStockHandoverBusy(false)
    }
  }

  async function openOrderStockHandoverById(orderId: number, externalId = '') {
    const id = Number(orderId || 0)
    if (!id) return
    const known = orders.find((order) => Number(order.id) === id)
    if (known) {
      await openOrderStockHandover(known)
      return
    }
    const placeholder = {
      id,
      external_id: externalId || `#${id}`,
      order_status: 'active',
      shipping_status: 'not_sent',
    } as OrderRecord
    await openOrderStockHandover(placeholder)
  }

  function closeOrderStockHandover() {
    if (stockHandoverActionItemId !== null) return
    setStockHandoverOrder(null)
    setStockHandoverData(null)
    setStockHandoverBusy(false)
    setStockHandoverActionItemId(null)
  }

  async function runOrderStockHandoverAction(item: OrderStockHandoverItemView, action: 'issue_now' | 'issued_before_checkpoint' | 'still_here') {
    if (!stockHandoverOrder) return
    const checkpointDate = handoverCheckpointDateLabel(item.checkpointAt)
    const sourceName = handoverSourceLabel(item.source)
    let confirmText = ''
    if (action === 'issue_now') {
      confirmText = `Выдать клиенту сейчас: «${item.productName}» × ${item.quantity} (${sourceName})?\n\nСистема зафиксирует выдачу ${item.quantity} шт. и обновит остаток. Если по учёту товара окажется меньше, система отдельно попросит подтвердить только выдаваемые вещи. Сам заказ останется «Не отправлен», пока остальные товары не готовы.`
    } else if (action === 'issued_before_checkpoint') {
      confirmText = `На момент ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${checkpointDate} клиент уже получил «${item.productName}»?\n\nЭто уточнение факта по словам сотрудника для складского учёта, а не подтверждение отправки всего заказа. Резерв закроется, но физический остаток повторно не уменьшится. Отправку клиенту отмечают отдельно.`
    } else {
      confirmText = `На момент ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${checkpointDate} «${item.productName}» ещё находился в точке?\n\nЕсли да, резерв останется и товар спишется только при фактической выдаче.`
    }
    if (!await askActionConfirmation(confirmText)) return

    setStockHandoverActionItemId(item.orderItemId)
    setError(null)
    setMessage(null)
    try {
      const submitHandoverAction = async (stockConfirmations?: Array<{ source: InventorySourceKey; variantId: number; expectedQuantity: number; operationQuantity: number }>) => {
        const response = await apiFetch(`/api/orders/${stockHandoverOrder.id}/stock-handover`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action,
            orderItemId: item.orderItemId,
            checkpointId: item.checkpointId || undefined,
            checkpointAt: item.checkpointAt || undefined,
            stockConfirmations,
          }),
        })
        const result = await readJsonResponse<OrderStockHandoverActionResponse>(response, 'Товары со склада', { allowHttpError: true })
        return { response, result }
      }

      let { response, result } = await submitHandoverAction()
      if (!response.ok && action === 'issue_now' && result.code === 'stock_resolution_required' && result.operationType === 'handover' && Array.isArray(result.items) && result.items.length) {
        const resolutionItems = result.items as StockResolutionRequiredItemView[]
        const confirmed = await askStockResolution({
          title: 'Товара по учёту меньше, чем нужно для выдачи',
          intro: 'Перед продолжением подтвердите фактическую ситуацию с этими вещами.',
          actionLabel: 'Да, выдаю клиенту',
          items: resolutionItems.map((resolutionItem) => ({
            productName: resolutionItem.productName || item.productName,
            tracked: Math.max(0, Number(resolutionItem.trackedPhysicalQuantity || 0)),
            needed: Math.max(1, Number(resolutionItem.operationQuantity || item.quantity || 1)),
          })),
          note: 'Подтверждение относится только к этой выдаче. Общий остаток товара этим не пересчитывается.',
        })
        if (!confirmed) {
          setMessage('Выдача остановлена. Остатки не изменялись.')
          return
        }
        const stockConfirmations = resolutionItems.map((resolutionItem) => ({
          source: resolutionItem.source === 'boutique' ? 'boutique' as const : 'warehouse' as const,
          variantId: Number(resolutionItem.variantId || 0),
          expectedQuantity: Math.max(0, Number(resolutionItem.trackedPhysicalQuantity || 0)),
          operationQuantity: Math.max(1, Number(resolutionItem.operationQuantity || 1)),
        }))
        ;({ response, result } = await submitHandoverAction(stockConfirmations))
      }

      if (!response.ok || !result.ok) throw new Error(result.message || `Stock handover failed: ${response.status}`)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setStockHandoverOrder(result.order)
      }
      if (result.state) setStockHandoverData(result.state)
      if (result.refreshRequired) {
        if (!result.state) {
          try {
            const refresh = await apiFetch(`/api/orders/${stockHandoverOrder.id}/stock-handover`)
            const refreshed = await readJsonResponse<OrderStockHandoverResponse>(refresh, 'Обновление товаров со склада')
            if (refresh.ok && refreshed.ok) setStockHandoverData(refreshed)
          } catch {
            // The committed action remains successful; the modal can be reopened to refresh later.
          }
        }
        if (!result.order) refreshDashboard(false)
      }
      invalidateInventoryStockCaches(true)
      if (action === 'issue_now') {
        setMessage(`«${item.productName}» выдан клиенту. При окончательной отправке заказа этот товар второй раз не спишется.`)
      } else if (action === 'issued_before_checkpoint') {
        setMessage(`«${item.productName}»: сохранён ответ о выдаче до проверки. Резерв закрыт, физический остаток повторно не изменён. Отправка заказа отдельно не подтверждена.`)
      } else {
        setMessage(`«${item.productName}»: подтверждено, что во время ${item.checkpointKind === 'revision' ? 'ревизии' : 'сверки'} ${checkpointDate} товар ещё находился у вас.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить действие с товаром.')
      try {
        const refresh = await apiFetch(`/api/orders/${stockHandoverOrder.id}/stock-handover`)
        const refreshed = await readJsonResponse<OrderStockHandoverResponse>(refresh, 'Обновление товаров со склада')
        if (refresh.ok && refreshed.ok) setStockHandoverData(refreshed)
      } catch {
        // Keep the current modal open; the user can close and reopen it safely.
      }
    } finally {
      setStockHandoverActionItemId(null)
    }
  }

  async function markOrderSentToClient(order: OrderRecord): Promise<boolean> {
    const projection = await getOrderOperationalProjection(order)
    if (!projection.canShip) {
      setMessage(projection.workshopPending
        ? 'Отправить весь заказ можно после готовности позиций Цеха.'
        : projection.hasCommittedItemReturn
          ? 'Отправка недоступна: по текущему товару уже проведён возврат. Сначала исправьте сам возврат.'
          : 'Этот заказ сейчас нельзя отметить как отправленный.')
      return false
    }
    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const today = formatLocalDateInput()
      const submitShipping = async (stockConfirmations?: Array<{ source: InventorySourceKey; variantId: number; expectedQuantity: number; operationQuantity: number }>) => {
        const shippingPayload = { shippingStatus: 'sent', shippingDate: today, stockConfirmations }
        const criticalKey = `order-shipping:${order.id}`
        const critical = prepareCriticalRequest(criticalKey, shippingPayload)
        const response = await apiFetch(`/api/orders/${order.id}/shipping`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        const result = await readJsonResponse<{ message?: string; order?: OrderRecord; refreshRequired?: boolean; code?: string; reviewOrderId?: number; operationType?: string; items?: Array<{ source?: InventorySourceKey; variantId?: number; productName?: string; trackedPhysicalQuantity?: number; operationQuantity?: number; unexplainedQuantity?: number }> }>(response, 'Отправка клиенту', { allowHttpError: true })
        if (response.ok) completeCriticalRequest(criticalKey, critical.requestId)
        return { response, result }
      }
      let { response, result } = await submitShipping()
      if (!response.ok && (result.code === 'workshop_not_ready' || result.code === 'stock_handover_review_required')) {
        setMessage(result.message || 'Перед отправкой проверьте товары со склада.')
        await openOrderStockHandover(order)
        return false
      }
      if (!response.ok && result.code === 'catalog_review_required') {
        setOrderCatalogResolutionOrder(order)
        setMessage(result.message || 'Перед отправкой нужно уточнить складской товар. Окно уточнения открыто прямо в заказах.')
        return false
      }
      if (!response.ok && result.code === 'stock_resolution_required' && result.operationType === 'shipping' && Array.isArray(result.items) && result.items.length) {
        const confirmed = await askStockResolution({
          title: 'Товара по учёту меньше, чем нужно для отправки',
          intro: 'Система не меняет общий остаток наугад. Подтвердите только фактическую передачу этих вещей.',
          actionLabel: 'Да, отправляю клиенту',
          items: result.items.map((resolutionItem) => ({
            productName: resolutionItem.productName || `variant #${resolutionItem.variantId || ''}`,
            tracked: Math.max(0, Number(resolutionItem.trackedPhysicalQuantity || 0)),
            needed: Math.max(1, Number(resolutionItem.operationQuantity || 1)),
          })),
          note: 'Это подтверждение одной отправки, а не пересчёт всего склада или бутика.',
        })
        if (!confirmed) {
          setMessage('Отправка остановлена. Остатки не изменялись.')
          return false
        }
        const stockConfirmations = result.items.map((item) => ({
          source: item.source === 'boutique' ? 'boutique' as const : 'warehouse' as const,
          variantId: Number(item.variantId || 0),
          expectedQuantity: Math.max(0, Number(item.trackedPhysicalQuantity || 0)),
          operationQuantity: Math.max(1, Number(item.operationQuantity || 1)),
        }))
        ;({ response, result } = await submitShipping(stockConfirmations))
      }
      if (!response.ok) {
        throw new Error(result.message || `Shipping failed: ${response.status}`)
      }
      if (result?.order) {
        upsertOrderInState(result.order as OrderRecord)
        refreshWorkshop()
        setSelectedOrderId(result.order.id)
      }
      if (result.refreshRequired || !result.order) {
        refreshDashboard(false)
        refreshWorkshop()
      }
      // Shipping is now the physical stock event. Invalidate cached physical/reserved/available values.
      invalidateInventoryStockCaches(true)
      invalidateFinanceReadCaches()
      setMessage(`Заказ ${order.external_id} отмечен как отправленный клиенту.`)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      return false
    } finally {
      setSavingOrder(false)
    }
  }


  async function correctMistakenOrderShipping(order: OrderRecord) {
    const projection = await getOrderOperationalProjection(order)
    if (savingOrder || !projection.canCorrectShipping) return
    const confirmed = await askActionConfirmation(
      `Снять отметку «Отправлен» у заказа ${order.external_id}?\n\nПодтвердите только если текущий товар клиенту не передавался. Заказ вернётся в состояние «Не отправлен». Если был обмен, он сохранится.`
    )
    if (!confirmed) return

    setSavingOrder(true)
    setError(null)
    setMessage(null)
    try {
      const payload = { physicalOutcome: 'not_issued' as const }
      const criticalKey = `order-handover-correction:${order.id}`
      const critical = prepareCriticalRequest(criticalKey, payload)
      const response = await apiFetch(`/api/orders/${order.id}/shipping/correct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
        body: JSON.stringify(critical.payload),
      })
      const result = await readJsonResponse<{
        ok?: boolean
        message?: string
        order?: OrderRecord
        refreshRequired?: boolean
        alreadyCorrected?: boolean
        restoredPhysicalQuantity?: number
        freshnessProtectedQuantity?: number
        reactivatedReservations?: number
        exchangeCurrentTruth?: boolean
        reopenedExchangeItems?: number
        protectedExchangePhysicalTruth?: number
      }>(response, 'Снятие ошибочной отметки отправки')
      if (!response.ok) throw new Error(result.message || 'Не удалось снять ошибочную отметку «Отправлен».')
      completeCriticalRequest(criticalKey, critical.requestId)
      if (result.order) upsertOrderInState(result.order)
      invalidateInventoryStockCaches(true)
      setMessage(result.alreadyCorrected
        ? `Заказ ${order.external_id} уже отмечен как «Не отправлен».`
        : result.exchangeCurrentTruth
          ? `Заказ ${order.external_id} снова «Не отправлен». Обмен сохранён.`
          : `Заказ ${order.external_id} снова «Не отправлен».`)
      refreshDashboard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось снять ошибочную отметку «Отправлен».')
    } finally {
      setSavingOrder(false)
    }
  }



  return {
    openOrderStockHandover,
    openOrderStockHandoverById,
    closeOrderStockHandover,
    runOrderStockHandoverAction,
    markOrderSentToClient,
    correctMistakenOrderShipping,
  }
}
