import type { Dispatch, SetStateAction } from 'react'
import type { ActionTextPromptRequest } from '../../components/dialogs/ActionTextPromptModal'
import type { CashRegisterCycle, CashRegisterCyclesResponse, CashRegisterResponse } from '../../app/types'
import { formatDateShort, formatMoney, readJsonResponse } from '../../app/utils'

export type CashMovementDraft = { direction: 'in' | 'out'; amount: number; comment: string; businessDate: string }

type CashRegisterActionsArgs = {
  askActionConfirmation: (text: string) => Promise<boolean>
  askActionText: (request: ActionTextPromptRequest) => Promise<string | null>
  isAdmin: boolean
  cashRegister: CashRegisterResponse | null
  cashRegisterCycles: CashRegisterCycle[]
  cashRegisterCyclesOpen: boolean
  cashSetupAmount: number
  cashMovementDraft: CashMovementDraft
  cashReconcileAmount: number
  cashReconcileComment: string
  cashMutationLockRef: { current: boolean }
  setCashRegister: Dispatch<SetStateAction<CashRegisterResponse | null>>
  setCashRegisterBusy: Dispatch<SetStateAction<boolean>>
  setCashRegisterCycles: Dispatch<SetStateAction<CashRegisterCycle[]>>
  setCashRegisterCyclesBusy: Dispatch<SetStateAction<boolean>>
  setCashRegisterCyclesHasMore: Dispatch<SetStateAction<boolean>>
  setCashMovementDraft: Dispatch<SetStateAction<CashMovementDraft>>
  setCashReconcileAmount: Dispatch<SetStateAction<number>>
  setCashReconcileComment: Dispatch<SetStateAction<string>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  makeCashRequestId: (prefix: string) => string
}

// Keep existing cash ledger and reconciliation operator operations together.
// The Worker remains authoritative for operation history, cash balance and reversal.
export function createCashRegisterActions({
  askActionConfirmation,
  askActionText,
  isAdmin,
  cashRegister,
  cashRegisterCycles,
  cashRegisterCyclesOpen,
  cashSetupAmount,
  cashMovementDraft,
  cashReconcileAmount,
  cashReconcileComment,
  cashMutationLockRef,
  setCashRegister,
  setCashRegisterBusy,
  setCashRegisterCycles,
  setCashRegisterCyclesBusy,
  setCashRegisterCyclesHasMore,
  setCashMovementDraft,
  setCashReconcileAmount,
  setCashReconcileComment,
  setError,
  setMessage,
  apiFetch,
  makeCashRequestId,
}: CashRegisterActionsArgs) {
  async function runCashMutation<T>(action: () => Promise<T>) {
    if (cashMutationLockRef.current) return null
    cashMutationLockRef.current = true
    setCashRegisterBusy(true)
    setError(null)
    setMessage(null)
    try {
      return await action()
    } finally {
      cashMutationLockRef.current = false
      setCashRegisterBusy(false)
    }
  }

  async function loadCashRegister() {
    setCashRegisterBusy(true)
    try {
      const response = await apiFetch('/api/finance/cash-register')
      const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Инкассация')
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить кассу.')
      setCashRegister(data)
      if (data.initialized) setCashReconcileAmount(Number(data.currentBalance || 0))
      return data
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить инкассацию.')
      return null
    } finally {
      setCashRegisterBusy(false)
    }
  }

  async function loadCashRegisterCycles(append = false) {
    setCashRegisterCyclesBusy(true)
    try {
      const offset = append ? cashRegisterCycles.length : 0
      const response = await apiFetch(`/api/finance/cash-register/cycles?limit=12&offset=${offset}`)
      const data = await readJsonResponse<CashRegisterCyclesResponse & { message?: string }>(response, 'Прошлые циклы кассы')
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить прошлые циклы кассы.')
      const nextCycles = Array.isArray(data.cycles) ? data.cycles : []
      setCashRegisterCycles((current) => append ? [...current, ...nextCycles] : nextCycles)
      setCashRegisterCyclesHasMore(Boolean(data.hasMore))
      return nextCycles
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить прошлые циклы кассы.')
      return []
    } finally {
      setCashRegisterCyclesBusy(false)
    }
  }

  async function setupCashRegister() {
    const amount = Math.max(0, Math.trunc(Number(cashSetupAmount || 0)))
    if (!(await askActionConfirmation(`Зафиксировать начальный остаток наличных ${formatMoney(amount)}?`))) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/setup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Настройка инкассации')
        if (!response.ok) throw new Error(data.message || 'Не удалось установить начальный остаток.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setMessage('Начальный остаток сохранён. Автоучёт пока выключен.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось установить начальный остаток.')
      }
    })
  }

  async function setCashAutoTracking(enabled: boolean) {
    const prompt = enabled
      ? 'Включить автоучёт? Новые наличные оплаты будут увеличивать кассу, а возвраты наличными — уменьшать.'
      : 'Остановить автоучёт? Журнал, ручные операции и сверка остатка останутся доступны, но новые операции по заказам временно не будут менять кассу автоматически.'
    if (!(await askActionConfirmation(prompt))) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/auto-tracking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Автоучёт наличных')
        if (!response.ok) throw new Error(data.message || 'Не удалось изменить состояние автоучёта.')
        setCashRegister(data)
        setMessage(enabled ? 'Автоучёт наличных включён.' : 'Автоучёт остановлен. Ручной учёт и журнал продолжают работать.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось изменить состояние автоучёта.')
      }
    })
  }

  async function activateCashRegister() {
    return setCashAutoTracking(true)
  }

  async function saveCashRegisterMovement() {
    const amount = Math.max(0, Math.trunc(Number(cashMovementDraft.amount || 0)))
    const comment = cashMovementDraft.comment.trim()
    if (amount <= 0) {
      setError('Укажите сумму больше нуля.')
      return
    }
    if (!comment) {
      setError('Комментарий обязателен: укажите, куда ушли или откуда пришли наличные.')
      return
    }
    if (cashMovementDraft.direction === 'out' && cashRegister && amount > cashRegister.currentBalance) {
      setError(`По учёту в кассе только ${formatMoney(cashRegister.currentBalance)}.`)
      return
    }
    const historicalBusinessDate = isAdmin ? cashMovementDraft.businessDate.trim() : ''
    if (historicalBusinessDate && !/^\d{4}-\d{2}-\d{2}$/.test(historicalBusinessDate)) {
      setError('Укажите корректную дату пропущенной операции.')
      return
    }
    if (historicalBusinessDate) {
      const directionLabel = cashMovementDraft.direction === 'in' ? 'внесение' : 'выдачу'
      if (!(await askActionConfirmation(`Добавить пропущенное ${directionLabel} ${formatMoney(amount)} за ${formatDateShort(historicalBusinessDate)}?\n\nДата операции будет сохранена отдельно от сегодняшнего времени внесения.\n${comment}`))) return
    } else if (cashMovementDraft.direction === 'out' && !(await askActionConfirmation(`Выдать из кассы ${formatMoney(amount)}?\n\n${comment}`))) return
    const requestId = makeCashRequestId('manual')
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/movements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ direction: cashMovementDraft.direction, amount, comment, requestId, ...(historicalBusinessDate ? { businessDate: historicalBusinessDate } : {}) }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Ручное движение наличных')
        if (!response.ok) throw new Error(data.message || 'Не удалось сохранить движение наличных.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setCashMovementDraft((current) => ({ ...current, amount: 0, comment: '', businessDate: '' }))
        setMessage(historicalBusinessDate
          ? `Пропущенная операция добавлена за ${formatDateShort(historicalBusinessDate)}. Время внесения сохранено отдельно.`
          : cashMovementDraft.direction === 'in' ? 'Внесение наличных записано.' : 'Выдача наличных записана.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось сохранить движение наличных.')
      }
    })
  }

  async function reconcileCashRegister() {
    if (!cashRegister?.initialized) return
    const amount = Math.max(0, Math.trunc(Number(cashReconcileAmount || 0)))
    const comment = cashReconcileComment.trim()
    if (!comment) {
      setError('Для сверки укажите причину изменения остатка.')
      return
    }
    if (amount === cashRegister.currentBalance) {
      setMessage('Фактический остаток уже совпадает с учётом.')
      return
    }
    if (!(await askActionConfirmation(`Установить фактический остаток ${formatMoney(amount)}?\n\nСистема запишет только разницу отдельной строкой журнала.\nПричина: ${comment}`))) return
    const requestId = makeCashRequestId('reconcile')
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/reconcile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount, comment, requestId }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Сверка кассы')
        if (!response.ok) throw new Error(data.message || 'Не удалось скорректировать остаток.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setCashReconcileComment('')
        setMessage('Фактический остаток кассы обновлён. Разница сохранена в журнале.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось скорректировать остаток.')
      }
    })
  }

  async function reverseCashRegisterMovement(entryId: number) {
    if (!(await askActionConfirmation('Отменить эту ручную операцию? Исходная строка останется в истории, а система добавит обратную запись.'))) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch(`/api/finance/cash-register/movements/${entryId}/reverse`, { method: 'POST' })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Отмена ручной операции')
        if (!response.ok) throw new Error(data.message || 'Не удалось отменить ручную операцию.')
        setCashRegister(data)
        setCashReconcileAmount(data.currentBalance)
        setMessage('Ручная операция отменена обратной записью.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось отменить ручную операцию.')
      }
    })
  }

  async function resetCashRegisterCycle() {
    if (!isAdmin) {
      setError('Начать новый цикл учёта может только администратор.')
      return
    }
    const comment = (await askActionText({
      title: 'Новый цикл кассы',
      description: 'Укажите причину начала нового цикла учёта. Она сохранится в истории кассы.',
      label: 'Причина сброса текущего журнала',
      initialValue: 'Перезапуск учёта наличных после сверки',
      minLength: 1,
      confirmLabel: 'Продолжить',
    }))?.trim() || ''
    if (!comment) return
    if (!(await askActionConfirmation('Обнулить текущую кассу и начать новый чистый цикл?\n\nСтарые записи НЕ удалятся из базы, но будут отделены от нового журнала. Автоучёт будет остановлен.'))) return
    await runCashMutation(async () => {
      try {
        const response = await apiFetch('/api/finance/cash-register/reset-cycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment }),
        })
        const data = await readJsonResponse<CashRegisterResponse & { message?: string }>(response, 'Сброс кассы')
        if (!response.ok) throw new Error(data.message || 'Не удалось начать новый цикл кассы.')
        setCashRegister(data)
        setCashReconcileAmount(0)
        setCashReconcileComment('')
        setCashMovementDraft((current) => ({ ...current, amount: 0, comment: '' }))
        setMessage('Начат новый цикл кассы с 0 ₸. Старый журнал сохранён в базе. Автоучёт выключен.')
        if (cashRegisterCyclesOpen) void loadCashRegisterCycles()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Не удалось начать новый цикл кассы.')
      }
    })
  }

  return {
    loadCashRegister,
    loadCashRegisterCycles,
    setupCashRegister,
    setCashAutoTracking,
    activateCashRegister,
    saveCashRegisterMovement,
    reconcileCashRegister,
    reverseCashRegisterMovement,
    resetCashRegisterCycle,
  }
}
