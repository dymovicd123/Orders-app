import type { Dispatch, SetStateAction } from 'react'
import type { CashRegisterResponse, ExchangeHistoryEntry, InventorySourceKey, OrderRecord, ReturnDraft, ReturnHistoryEntry } from '../../app/types'
import type { useApiClient } from '../../app/controllers/useApiClient'
import type { StockResolutionPrompt } from './StockResolutionConfirmModal'
import { createReturnDraft, formatDateShort, formatMoney, readJsonResponse } from '../../app/utils'
import { cancelReturnCriticalRequest, cancelExchangeCriticalRequest, correctExchangeFinancialCriticalRequest } from '../../app/controllers/returnExchangeCriticalRequests'

type ReturnExchangeAftercareArgs = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  askStockResolution: (prompt: StockResolutionPrompt) => Promise<boolean>
  askActionConfirmation: (message: string) => Promise<boolean>
  criticalReturnExchangeClient: Pick<ReturnType<typeof useApiClient>, 'apiFetch' | 'prepareCriticalRequest' | 'completeCriticalRequest'>
  setReturnBusy: Dispatch<SetStateAction<boolean>>
  setExchangeBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  setReturnedItemResolutionEventId: Dispatch<SetStateAction<number | null>>
  isAdmin: boolean
  cashRegister: CashRegisterResponse | null
  setReturnSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setReturnDraft: Dispatch<SetStateAction<ReturnDraft>>
  setExchangeSelectedOrderId: Dispatch<SetStateAction<number | null>>
  setSelectedOrderId: Dispatch<SetStateAction<number | null>>
  upsertOrderInState: (order: OrderRecord) => void
  prepareCriticalRequest: <T extends Record<string, unknown>>(key: string, basePayload: T) => { requestId: string; payload: T & { requestId: string } }
  completeCriticalRequest: (key: string, requestId: string) => void
  invalidateInventoryStockCaches: (includeCatalogReview?: boolean) => void
  invalidateFinanceReadCaches: () => void
  loadReturnHistory: () => Promise<unknown>
  loadExchangeHistory: () => Promise<unknown>
  refreshActivityLogIfVisible: () => unknown
  refreshFinanceReportsIfVisible: () => unknown
  loadDashboard: (force?: boolean) => Promise<unknown>
  loadWorkshopData: () => Promise<unknown>
  loadInventoryData: (source: InventorySourceKey, force?: boolean, query?: string, includeMovements?: boolean) => Promise<unknown>
  loadInventoryLifecycle: (force?: boolean) => Promise<unknown>
  loadCashRegister: () => Promise<unknown>
}

// Post-commit actions keep money corrections separate from item-level physical
// receiving. A newer stocktake can protect physical truth from a double receipt.
export function createReturnExchangeAftercareActions({
  apiFetch,
  askStockResolution,
  askActionConfirmation,
  criticalReturnExchangeClient,
  setReturnBusy,
  setExchangeBusy,
  setError,
  setMessage,
  setReturnedItemResolutionEventId,
  isAdmin,
  cashRegister,
  setReturnSelectedOrderId,
  setReturnDraft,
  setExchangeSelectedOrderId,
  setSelectedOrderId,
  upsertOrderInState,
  prepareCriticalRequest,
  completeCriticalRequest,
  invalidateInventoryStockCaches,
  invalidateFinanceReadCaches,
  loadReturnHistory,
  loadExchangeHistory,
  refreshActivityLogIfVisible,
  refreshFinanceReportsIfVisible,
  loadDashboard,
  loadWorkshopData,
  loadInventoryData,
  loadInventoryLifecycle,
  loadCashRegister,
}: ReturnExchangeAftercareArgs) {
  async function receiveReturnedItemAction(input: {
    operationType: 'return' | 'exchange'
    operationId: number
    operationItemId: number
    destination: 'warehouse' | 'boutique' | 'no_stock'
    productName: string
    externalId: string
    freshnessDecision?: 'already_counted' | 'arrived_after_check'
    deferRefresh?: boolean
  }) {
    const destinationLabel = input.destination === 'warehouse' ? 'Склад' : input.destination === 'boutique' ? 'Бутик' : 'без добавления в остаток'
    const setBusy = input.operationType === 'return' ? setReturnBusy : setExchangeBusy
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      let freshnessDecision = input.freshnessDecision
      let result: {
        ok?: boolean
        code?: string
        message?: string
        productName?: string
        quantity?: number
        latestCheck?: { id?: number; checkedAt?: string; expectedQuantity?: number; countedQuantity?: number } | null
        pendingInventoryCount?: number
        pendingInventory?: { eventId?: number; reason?: string; productName?: string } | null
        stockApplied?: boolean
        stockAlreadyApplied?: boolean
        freshnessProtected?: boolean
      } = {}

      while (true) {
        const payload = {
          operationType: input.operationType,
          operationId: input.operationId,
          operationItemId: input.operationItemId,
          destination: input.destination,
          ...(freshnessDecision ? { freshnessDecision } : {}),
        }
        const criticalKey = `returned-item-receive:${input.operationType}:${input.operationId}:${input.operationItemId}:${input.destination}:${freshnessDecision || 'preflight'}`
        const critical = prepareCriticalRequest(criticalKey, payload)
        const response = await apiFetch('/api/returned-items/receive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': critical.requestId },
          body: JSON.stringify(critical.payload),
        })
        result = await readJsonResponse<typeof result>(response, 'Получение возвращённого товара')

        if (result.code === 'intake_freshness_confirmation_required' && !freshnessDecision) {
          completeCriticalRequest(criticalKey, critical.requestId)
          const check = result.latestCheck
          const alreadyCounted = await askStockResolution({
            title: 'После оформления возврата товар уже пересчитывали',
            intro: `Последняя физическая сверка этой позиции была ${check?.checkedAt ? formatDateShort(check.checkedAt) : 'после оформления возврата'}. Нужно понять, вошла ли возвращённая вещь в тот пересчёт.`,
            question: 'Эта возвращённая вещь уже была включена в последнюю сверку?',
            actionLabel: 'Да, уже учтена',
            cancelLabel: 'Нет, приехала позже',
            trackedLabel: 'В последней сверке',
            neededLabel: 'Сейчас принимаем',
            items: [{
              productName: result.productName || input.productName,
              tracked: Math.max(0, Number(check?.countedQuantity || 0)),
              needed: Math.max(1, Number(result.quantity || 1)),
            }],
            note: 'Если вещь уже была в пересчёте, система не прибавит её второй раз. Если она приехала позже — добавит как новое физическое поступление.',
          })
          freshnessDecision = alreadyCounted ? 'already_counted' : 'arrived_after_check'
          continue
        }

        if (!response.ok || result.ok === false) throw new Error(result.message || `Receive returned item failed: ${response.status}`)
        completeCriticalRequest(criticalKey, critical.requestId)
        break
      }

      invalidateInventoryStockCaches(true)
      if (!input.deferRefresh) {
        await Promise.allSettled([
          input.operationType === 'return' ? loadReturnHistory() : loadExchangeHistory(),
          refreshActivityLogIfVisible(),
          loadInventoryData('warehouse', true, '', false),
          loadInventoryData('boutique', true, '', false),
          isAdmin ? loadInventoryLifecycle(true) : Promise.resolve(null),
        ])
      }
      if (input.destination === 'no_stock') {
        setMessage(`«${input.productName}» отмечен как полученный. В остаток товар не добавлялся.`)
      } else if (result.freshnessProtected) {
        setMessage(`«${input.productName}» отмечен как полученный. Повторно в ${destinationLabel} не добавляли: вы подтвердили, что вещь уже была учтена в более свежей сверке.`)
      } else if (Number(result.pendingInventoryCount || 0) > 0) {
        const eventId = Number(result.pendingInventory?.eventId || 0)
        if (eventId) setReturnedItemResolutionEventId(eventId)
        setMessage(eventId
          ? `«${input.productName}» получен. Открылось уточнение товара — после подтверждения он сразу попадёт в выбранный остаток.`
          : `«${input.productName}» физически получен. Для остатка требуется уточнение товара — система ничего не прибавляла наугад.`)
      } else {
        setMessage(`«${input.productName}» получен и учтён: ${destinationLabel}.`)
      }
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отметить товар полученным.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function cancelReturnEntry(entry: ReturnHistoryEntry) {
    if (!(await askActionConfirmation(`Отменить возврат ${entry.externalId || ''} на ${formatMoney(entry.amount)}? Система отменит деньги и статус возврата. Более свежие фактические данные склада, если они уже появились, будут сохранены.`))) return
    setReturnBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await cancelReturnCriticalRequest(criticalReturnExchangeClient, entry.id)
      if (result.order) {
        upsertOrderInState(result.order)
        setReturnSelectedOrderId(result.order.id)
        setReturnDraft(createReturnDraft(result.order))
      }
      await Promise.allSettled([
        loadReturnHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        loadWorkshopData(),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadInventoryLifecycle(true),
      ])
      setMessage(`Возврат по заказу ${entry.externalId || ''} отменён. Финансы, остатки и цех обновлены.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отмены возврата')
    } finally {
      setReturnBusy(false)
    }
  }

  async function correctExchangeFinancialEntry(
    entry: ExchangeHistoryEntry,
    draft: { exchangeDate: string; financialAmount: number; paymentMethod: string; comment: string },
  ) {
    const amount = Math.trunc(Number(draft.financialAmount || 0))
    if (entry.status === 'cancelled' || (entry.financialAction !== 'extra_payment' && entry.financialAction !== 'refund')) return false
    if (!draft.exchangeDate) {
      setError('Укажите дату денежной операции обмена.')
      return false
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('Укажите целую сумму больше нуля.')
      return false
    }
    if (!draft.paymentMethod.trim()) {
      setError(entry.financialAction === 'refund' ? 'Выберите способ возврата денег.' : 'Выберите способ оплаты доплаты.')
      return false
    }

    setExchangeBusy(true)
    setError(null)
    setMessage(null)
    try {
      const payload = {
        exchangeDate: draft.exchangeDate,
        financialAmount: amount,
        paymentMethod: draft.paymentMethod,
        comment: draft.comment,
        expectedExchangeDate: entry.exchangeDate,
        expectedFinancialAmount: entry.financialAmount,
        expectedPaymentMethod: entry.paymentMethod || '',
        expectedComment: entry.comment || '',
      }
      const result = await correctExchangeFinancialCriticalRequest(criticalReturnExchangeClient, entry.id, payload)
      if (result.order) upsertOrderInState(result.order)
      invalidateFinanceReadCaches()
      await Promise.allSettled([
        loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        cashRegister?.initialized ? loadCashRegister() : Promise.resolve(null),
      ])
      setMessage(result.unchanged
        ? `Денежная часть обмена #${entry.id} уже соответствует этим данным.`
        : `Денежная часть обмена #${entry.id} исправлена. Товары, остатки и цех не менялись.`)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка исправления денег обмена')
      return false
    } finally {
      setExchangeBusy(false)
    }
  }

  async function cancelExchangeEntry(entry: ExchangeHistoryEntry) {

    if (!(await askActionConfirmation(`Отменить обмен по заказу ${entry.externalId}? Система отменит деньги, статус и новую позицию. Более свежие фактические данные склада, если они уже появились, будут сохранены.`))) return
    setExchangeBusy(true)
    setError(null)
    setMessage(null)
    try {
      const result = await cancelExchangeCriticalRequest(criticalReturnExchangeClient, entry.id)
      if (result.order) {
        upsertOrderInState(result.order)
        setSelectedOrderId(result.order.id)
        setExchangeSelectedOrderId(result.order.id)
      }
      await Promise.allSettled([
        loadExchangeHistory(),
        refreshActivityLogIfVisible(),
        refreshFinanceReportsIfVisible(),
        loadDashboard(false),
        loadWorkshopData(),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadInventoryLifecycle(true),
      ])
      setMessage(`Обмен по заказу ${entry.externalId} отменён. Финансы, позиции, остатки и цех обновлены.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка отмены обмена')
    } finally {
      setExchangeBusy(false)
    }
  }


  return {
    receiveReturnedItemAction,
    cancelReturnEntry,
    correctExchangeFinancialEntry,
    cancelExchangeEntry,
  }
}
