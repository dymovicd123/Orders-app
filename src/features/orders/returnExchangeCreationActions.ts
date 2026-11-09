import type { Dispatch, SetStateAction } from 'react'
import type { ExchangeDraft, InventorySourceKey, OrderPanel, OrderRecord, ReturnDraft } from '../../app/types'
import { createExchangeDraft, createReturnDraft, formatMoney } from '../../app/utils'
import { prepareReturnCreation, submitReturnCreation } from '../../app/returnCreationOperation'
import { prepareExchangeSetCreation, submitExchangeSetCreation } from '../../app/exchangeSetCreationOperation'
import { prepareLegacyExchangePairs } from '../../app/legacyExchangePreparation'
import { submitLegacyExchangeBatch, submitLegacyExchangePair } from '../../app/legacyExchangeCriticalRequests'

type ReturnExchangeCreationArgs = {
  returnSelectedOrder: OrderRecord | null
  returnDraft: ReturnDraft
  exchangeSelectedOrder: OrderRecord | null
  exchangeDraft: ExchangeDraft
  getOrderSourceAvailability: Parameters<typeof prepareLegacyExchangePairs>[2]
  isAdmin: boolean
  setReturnBusy: Dispatch<SetStateAction<boolean>>
  setExchangeBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setReturnSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setReturnDraft: Dispatch<SetStateAction<ReturnDraft>>
  setExchangeSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setExchangeDraft: Dispatch<SetStateAction<ExchangeDraft>>
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setOrderPanel: Dispatch<SetStateAction<OrderPanel>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  upsertOrderInState: (order: OrderRecord) => void
  loadReturnHistory: () => Promise<unknown>
  loadExchangeHistory: () => Promise<unknown>
  refreshActivityLogIfVisible: () => unknown
  refreshFinanceReportsIfVisible: () => unknown
  loadDashboard: (force?: boolean) => Promise<unknown>
  loadInventoryData: (source: InventorySourceKey, force?: boolean, query?: string, includeMovements?: boolean) => Promise<unknown>
  loadInventoryLifecycle: (force?: boolean) => Promise<unknown>
  loadWorkshopData: () => Promise<unknown>
}

// Creation owns both forms and post-commit refresh; server handles money, reservations
// and stock. Legacy pair completion flags survive partial successes, so retries
// cannot recreate already-committed exchange positions.
export function createReturnExchangeCreationActions({
  returnSelectedOrder,
  returnDraft,
  exchangeSelectedOrder,
  exchangeDraft,
  getOrderSourceAvailability,
  isAdmin,
  setReturnBusy,
  setExchangeBusy,
  setError,
  setMessage,
  setReturnSelectedOrderId,
  setReturnDraft,
  setExchangeSelectedOrderId,
  setExchangeDraft,
  setSelectedOrderId,
  setOrderPanel,
  apiFetch,
  prepareCriticalRequest,
  completeCriticalRequest,
  upsertOrderInState,
  loadReturnHistory,
  loadExchangeHistory,
  refreshActivityLogIfVisible,
  refreshFinanceReportsIfVisible,
  loadDashboard,
  loadInventoryData,
  loadInventoryLifecycle,
  loadWorkshopData,
}: ReturnExchangeCreationArgs) {
  async function saveReturn() {
    if (!returnSelectedOrder) {
      setError('Сначала выберите заказ для возврата.')
      return
    }

    const prepared = prepareReturnCreation(returnSelectedOrder, returnDraft)
    if (!prepared.ok) {
      setError(prepared.error)
      return
    }

    setReturnBusy(true)
    setError(null)
    setMessage(null)

    try {
      const result = await submitReturnCreation(
        { apiFetch, prepareCriticalRequest, completeCriticalRequest },
        prepared.payload,
      )

      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
      }
      setReturnSelectedOrderId(null)
      setReturnDraft(createReturnDraft())
      setOrderPanel('list')

      await Promise.allSettled([
        loadReturnHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
      ])
      const pendingInventoryCount = Math.max(0, Number(result.pendingInventoryCount || 0))
      setMessage(pendingInventoryCount > 0
        ? `Возврат по заказу ${returnSelectedOrder.external_id} сохранён. ${pendingInventoryCount} физ. позици${pendingInventoryCount === 1 ? 'я ожидает' : 'и ожидают'} подтверждения администратора; остаток по ним пока не изменён.`
        : `Возврат по заказу ${returnSelectedOrder.external_id} сохранён.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setReturnBusy(false)
    }
  }

  async function saveExchange() {
    if (!exchangeSelectedOrder) {
      setError('Сначала выберите заказ для обмена.')
      return
    }

    const itemizedExchange = exchangeSelectedOrder.pricing_mode === 'itemized_v1'

    if (itemizedExchange && exchangeDraft.workflowMode === 'set_v2') {
      const prepared = prepareExchangeSetCreation(exchangeSelectedOrder, exchangeDraft)
      if (!prepared.ok) {
        setError(prepared.error)
        return
      }

      setExchangeBusy(true)
      setError(null)
      setMessage(null)
      try {
        const result = await submitExchangeSetCreation(
          { apiFetch, prepareCriticalRequest, completeCriticalRequest },
          prepared.payload,
        )

        if (result.order) upsertOrderInState(result.order)
        setExchangeSelectedOrderId(null)
        setExchangeDraft(createExchangeDraft())
        setOrderPanel('list')
        await Promise.allSettled([
          loadExchangeHistory(),
          refreshActivityLogIfVisible(),
          refreshFinanceReportsIfVisible(),
          loadDashboard(false),
          Number(result.workshopCount || 0) > 0 ? loadWorkshopData() : Promise.resolve(null),
          loadInventoryData('warehouse', true, '', false),
          loadInventoryData('boutique', true, '', false),
          isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
        ])

        const moneyText = Number(result.refundAmount || 0) > 0
          ? ` Возвращено клиенту: ${formatMoney(Number(result.refundAmount || 0))}.`
          : Number(result.paymentAmount || 0) > 0
            ? ` Получено сейчас: ${formatMoney(Number(result.paymentAmount || 0))}.`
            : ''
        const debtText = Number(result.remainingDebt || 0) > 0
          ? ` Остаток долга: ${formatMoney(Number(result.remainingDebt || 0))}.`
          : ' Долга после обмена нет.'
        setMessage(`Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён: убрано ${result.oldItemCount || prepared.oldItemCount} поз., добавлено ${result.newItemCount || prepared.newItemCount} поз. Новый итог: ${formatMoney(Number(result.finalTotalAmount ?? prepared.projectedTotal))}.${moneyText}${debtText}`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить обмен.')
      } finally {
        setExchangeBusy(false)
      }
      return
    }

    const preparedLegacy = prepareLegacyExchangePairs(exchangeSelectedOrder, exchangeDraft, getOrderSourceAvailability)
    if (!preparedLegacy.ok) {
      setError(preparedLegacy.error)
      return
    }
    const { pairDrafts, unsavedPairs } = preparedLegacy

    setExchangeBusy(true)
    setError(null)
    setMessage(null)
    let savedThisAttempt = 0
    const savedBefore = pairDrafts.filter((pair) => pair.saved).length
    let lastOrder: OrderRecord | null = null
    let pendingInventoryCount = 0
    let exchangeTouchesWorkshop = false

    try {
      if (itemizedExchange && unsavedPairs.length > 1) {
        const result = await submitLegacyExchangeBatch(
          { apiFetch, prepareCriticalRequest, completeCriticalRequest },
          exchangeSelectedOrder, exchangeDraft, unsavedPairs,
        )

        if (result.order) {
          upsertOrderInState(result.order)
          setSelectedOrderId(result.order.id)
        }
        const totalPairCount = Math.max(unsavedPairs.length, Number(result.exchangeCount || 0))
        pendingInventoryCount = Math.max(0, Number(result.pendingInventoryCount || 0))
        exchangeTouchesWorkshop = unsavedPairs.some((pair) => pair.selectedOldItem.sourceType === 'workshop' || pair.effectiveNewItem.sourceType === 'workshop')
        setExchangeSelectedOrderId(null)
        setExchangeDraft(createExchangeDraft())
        await Promise.allSettled([
          loadExchangeHistory(),
          refreshActivityLogIfVisible(),
          refreshFinanceReportsIfVisible(),
          loadDashboard(false),
          exchangeTouchesWorkshop ? loadWorkshopData() : Promise.resolve(null),
          loadInventoryData('warehouse', true, '', false),
          loadInventoryData('boutique', true, '', false),
          isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
        ])
        setMessage(pendingInventoryCount > 0
          ? `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён: ${totalPairCount} поз. ${pendingInventoryCount} складск${pendingInventoryCount === 1 ? 'ое движение ожидает' : 'их движения ожидают'} подтверждения администратора.`
          : `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён: ${totalPairCount} поз.`)
        return
      }

      for (const pair of unsavedPairs) {
        const result = await submitLegacyExchangePair(
          { apiFetch, prepareCriticalRequest, completeCriticalRequest },
          exchangeSelectedOrder, exchangeDraft, pair, pairDrafts.length, itemizedExchange,
        )
        savedThisAttempt += 1
        pendingInventoryCount += Math.max(0, Number(result.pendingInventoryCount || 0))
        exchangeTouchesWorkshop = exchangeTouchesWorkshop || pair.selectedOldItem.sourceType === 'workshop' || pair.effectiveNewItem.sourceType === 'workshop'
        if (result.order) {
          lastOrder = result.order
          upsertOrderInState(result.order)
          setSelectedOrderId(result.order.id)
        }
        if (pair.isQueued) {
          setExchangeDraft((current) => ({
            ...current,
            queuedPairs: (current.queuedPairs || []).map((queued) => queued.draftKey === pair.draftKey ? { ...queued, saved: true } : queued),
          }))
        }
      }

      if (lastOrder) upsertOrderInState(lastOrder)
      const totalPairCount = pairDrafts.length
      setExchangeSelectedOrderId(null)
      setExchangeDraft(createExchangeDraft())
      await Promise.allSettled([
        loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        exchangeTouchesWorkshop ? loadWorkshopData() : Promise.resolve(null),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
      ])
      setMessage(pendingInventoryCount > 0
        ? `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён: ${totalPairCount} поз. ${pendingInventoryCount} складск${pendingInventoryCount === 1 ? 'ое движение ожидает' : 'их движения ожидают'} подтверждения администратора.`
        : `Обмен по заказу ${exchangeSelectedOrder.external_id} сохранён: ${totalPairCount} поз.`)
    } catch (err) {
      const savedCount = savedBefore + savedThisAttempt
      const details = err instanceof Error ? err.message : 'Неизвестная ошибка'
      setError(savedCount > 0
        ? `Сохранено ${savedCount} из ${pairDrafts.length} позиций обмена. Уже сохранённые строки отмечены и повторно не создадутся. Остальные не завершены: ${details}`
        : details)
    } finally {
      setExchangeBusy(false)
    }
  }



  return { saveReturn, saveExchange }
}
