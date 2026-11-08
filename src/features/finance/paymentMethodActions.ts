import type { Dispatch, SetStateAction } from 'react'
import type { ReferenceListItem } from '../../app/types'
import { normalizeSuggestion, readJsonResponse } from '../../app/utils'

export type FinanceMethodDraft = { id: number; value: string; sortOrder: string; isActive: boolean }

type FinancePaymentMethodActionsArgs = {
  isAdmin: boolean
  financePaymentMethods: ReferenceListItem[]
  financeMethodDraft: FinanceMethodDraft
  setFinancePaymentMethods: Dispatch<SetStateAction<ReferenceListItem[]>>
  setFinanceMethodsBusy: Dispatch<SetStateAction<boolean>>
  setFinanceMethodDraft: Dispatch<SetStateAction<FinanceMethodDraft>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  reportReadFailure: (errorValue: unknown, label: string, hasPreviousData: boolean) => void
  loadReferencesData: (force?: boolean) => Promise<unknown>
}

// Maintain reference-owned payment-method semantics; money facts remain independent.
export function createFinancePaymentMethodActions({
  isAdmin,
  financePaymentMethods,
  financeMethodDraft,
  setFinancePaymentMethods,
  setFinanceMethodsBusy,
  setFinanceMethodDraft,
  setError,
  setMessage,
  apiFetch,
  reportReadFailure,
  loadReferencesData,
}: FinancePaymentMethodActionsArgs) {
  async function loadFinancePaymentMethods(force = false) {
    if (financePaymentMethods.length && !force) return financePaymentMethods
    setFinanceMethodsBusy(true)
    try {
      const response = await apiFetch('/api/reference-values?kind=paymentMethods')
      const data = await readJsonResponse<{ ok?: boolean; items?: ReferenceListItem[] }>(response, 'Способы оплаты')
      if (!response.ok) throw new Error('Не удалось загрузить способы оплаты.')
      const rows = Array.isArray(data.items) ? data.items : []
      setFinancePaymentMethods(rows)
      return rows
    } catch (err) {
      reportReadFailure(err, 'Способы оплаты', financePaymentMethods.length > 0)
      return []
    } finally {
      setFinanceMethodsBusy(false)
    }
  }

  async function saveFinancePaymentMethod() {
    if (!isAdmin) {
      setError('Изменение способов оплаты доступно только администратору.')
      return null
    }
    const value = normalizeSuggestion(financeMethodDraft.value)
    if (!value) {
      setError('Введите способ оплаты.')
      return null
    }

    const isEdit = financeMethodDraft.id > 0
    const response = await apiFetch(isEdit ? `/api/reference-values/${financeMethodDraft.id}` : '/api/reference-values', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'paymentMethods',
        value,
        sortOrder: Number(financeMethodDraft.sortOrder || 0),
        isActive: true,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || 'Не удалось сохранить способ оплаты.')
    }

    setFinanceMethodDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    await Promise.all([loadFinancePaymentMethods(true), loadReferencesData(true)])
    setMessage('Способ оплаты обновлён. Формы заказов, долгов и обменов будут брать список отсюда.')
    return readJsonResponse(response, 'Способ оплаты')
  }

  async function removeFinancePaymentMethod(id: number) {
    if (!isAdmin) {
      setError('Удаление способа оплаты доступно только администратору.')
      return
    }
    if (!id) return
    const response = await apiFetch(`/api/reference-values/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'paymentMethods' }),
    })
    if (!response.ok) throw new Error('Не удалось отключить способ оплаты.')
    if (financeMethodDraft.id === id) {
      setFinanceMethodDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    }
    await Promise.all([loadFinancePaymentMethods(true), loadReferencesData(true)])
    setMessage('Способ оплаты отключён.')
  }

  return { loadFinancePaymentMethods, saveFinancePaymentMethod, removeFinancePaymentMethod }
}
