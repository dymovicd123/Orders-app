import type { InventorySourceKey, InventoryHistoryResponse, InventoryCheckHistoryResponse } from '../../app/types'
import type {
  InventoryReservationsResponse,
  InventoryStocktakeSessionsResponse,
  InventoryStocktakeMutationResponse,
  InventoryCycleCountSuggestionsResponse,
  InventoryCycleCountApplyResponse,
} from '../../../shared/api-contracts.ts'
import { readJsonResponse } from '../../app/utils'

// Preserve the existing HTTP routes, validation, and managed-write behavior supplied by apiFetch.
// This boundary deliberately has no knowledge of inventory UI state or mutation side effects.
export function createInventoryStocktakeClient(apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  async function loadInventoryReservations(source: InventorySourceKey, variantId = 0, productId = 0): Promise<InventoryReservationsResponse> {
    if (!variantId && !productId) return { ok: true, source, variantId: 0, productId: 0, totalQuantity: 0, reservations: [] }
    const params = new URLSearchParams({ source })
    if (variantId) params.set('variantId', String(variantId))
    if (productId) params.set('productId', String(productId))
    const response = await apiFetch(`/api/inventory/reservations?${params.toString()}`)
    const data = await readJsonResponse<InventoryReservationsResponse>(response, 'Заказы по резерву')
    if (!response.ok) throw new Error(data?.message || 'Не удалось загрузить заказы, которые держат товар.')
    return data
  }

  async function loadInventoryStocktakeSessions(source: InventorySourceKey | '' = '') {
    const params = new URLSearchParams()
    if (source) params.set('source', source)
    const response = await apiFetch(`/api/inventory/stocktakes${params.toString() ? `?${params.toString()}` : ''}`)
    const data = await readJsonResponse<InventoryStocktakeSessionsResponse>(response, 'Активные ревизии')
    if (!response.ok) throw new Error(data?.message || 'Не удалось загрузить активные ревизии.')
    return data
  }

  async function loadInventoryStocktakeSession(sessionId: string) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}`)
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Ревизия')
    if (!response.ok) throw new Error(data?.message || 'Не удалось загрузить ревизию.')
    return data
  }

  async function createInventoryStocktakeSession(source: InventorySourceKey, productIds: number[] = []) {
    const response = await apiFetch('/api/inventory/stocktakes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, productIds }),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Начало ревизии')
    if (!response.ok) throw new Error(data?.message || 'Не удалось начать ревизию.')
    return data
  }

  async function saveInventoryStocktakeCount(sessionId: string, itemId: number, countedQuantity: number | null) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/items/${itemId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ countedQuantity }),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Сохранение пересчёта')
    if (!response.ok) throw new Error(data?.message || 'Не удалось сохранить количество.')
    return data
  }

  async function addInventoryStocktakeVariant(sessionId: string, variantId: number) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/items`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variantId }),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Добавление товара в ревизию')
    if (!response.ok) throw new Error(data?.message || 'Не удалось добавить товар в ревизию.')
    return data
  }


  async function addInventoryStocktakeCombination(sessionId: string, input: {
    productId: number
    material: string
    length: string
    category: 'adult' | 'child'
    gender: string
    color: string
    size?: string
    sizes?: string[]
    createReferenceFields?: string[]
    deferUnknown?: boolean
  }) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/items/combination`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Добавление комбинации в ревизию')
    if (!response.ok) throw new Error(data?.message || 'Не удалось добавить комбинацию товара в ревизию.')
    return data
  }

  async function reconcileFoundInventoryStock(stockId: number) {
    if (!stockId) return null
    const response = await apiFetch(`/api/inventory/found-stock/${stockId}/reconcile`, { method: 'POST' })
    const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Уточнение найденной позиции')
    if (!response.ok || data?.ok === false) throw new Error(data?.message || 'Не удалось определить найденную позицию.')
    return data
  }

  async function loadInventoryCycleCounts(source: InventorySourceKey, limit = 12) {
    const params = new URLSearchParams({ source, limit: String(limit) })
    const response = await apiFetch(`/api/inventory/cycle-counts?${params.toString()}`)
    const data = await readJsonResponse<InventoryCycleCountSuggestionsResponse>(response, 'Короткие сверки')
    if (!response.ok) throw new Error(data?.message || 'Не удалось подобрать позиции для короткой сверки.')
    return data
  }

  async function applyInventoryCycleCounts(input: { source: InventorySourceKey; items: Array<{ variantId: number; expectedQuantity: number; countedQuantity: number }> }) {
    const response = await apiFetch('/api/inventory/cycle-counts/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryCycleCountApplyResponse>(response, 'Короткая сверка')
    if (!response.ok && data?.code !== 'changed' && data?.code !== 'stocktake_active') throw new Error(data?.message || 'Не удалось сохранить короткую сверку.')
    return data
  }

  async function quickInventoryStocktakeBatch(input: { source: InventorySourceKey; items: Array<{ variantId: number; expectedQuantity: number; countedQuantity: number }> }) {
    const response = await apiFetch('/api/inventory/stocktakes/quick-batch', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryCycleCountApplyResponse>(response, 'Быстрая сверка')
    if (!response.ok && data?.code !== 'changed' && data?.code !== 'stocktake_active') throw new Error(data?.message || 'Не удалось сверить выбранные позиции.')
    return data
  }

  async function quickInventoryStocktake(input: { source: InventorySourceKey; variantId: number; expectedQuantity: number; countedQuantity: number }) {
    const response = await apiFetch('/api/inventory/stocktakes/quick', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    })
    const data = await readJsonResponse<InventoryCycleCountApplyResponse>(response, 'Точечная сверка')
    if (!response.ok && data?.code !== 'changed') throw new Error(data?.message || 'Не удалось сверить количество.')
    return data
  }

  async function completeInventoryStocktakeSession(sessionId: string) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Завершение ревизии')
    if (!response.ok && data?.code !== 'recount_required' && data?.code !== 'unfilled') {
      throw new Error(data?.message || 'Не удалось завершить ревизию.')
    }
    return data
  }

  async function cancelInventoryStocktakeSession(sessionId: string) {
    const response = await apiFetch(`/api/inventory/stocktakes/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' })
    const data = await readJsonResponse<InventoryStocktakeMutationResponse>(response, 'Отмена ревизии')
    if (!response.ok) throw new Error(data?.message || 'Не удалось отменить ревизию.')
    return data
  }


  async function loadInventoryHistory(input: { source?: string; variantId?: number; q?: string; beforeId?: number; limit?: number } = {}) {
    const params = new URLSearchParams({ limit: String(input.limit || 50) })
    if (input.source) params.set('source', input.source)
    if (input.variantId) params.set('variantId', String(input.variantId))
    if (input.q?.trim()) params.set('q', input.q.trim())
    if (input.beforeId) params.set('beforeId', String(input.beforeId))
    const response = await apiFetch(`/api/inventory/history?${params.toString()}`)
    const data = await readJsonResponse<InventoryHistoryResponse>(response, 'История склада')
    if (!response.ok) throw new Error('Не удалось загрузить историю склада.')
    return data
  }

  async function loadInventoryCheckHistory(input: { source?: string; variantId?: number; limit?: number } = {}) {
    const params = new URLSearchParams({ limit: String(input.limit || 30) })
    if (input.source) params.set('source', input.source)
    if (input.variantId) params.set('variantId', String(input.variantId))
    const response = await apiFetch(`/api/inventory/check-history?${params.toString()}`)
    const data = await readJsonResponse<InventoryCheckHistoryResponse>(response, 'Ревизии и сверки')
    if (!response.ok) throw new Error('Не удалось загрузить ревизии и сверки.')
    return data
  }


  return {
    loadInventoryReservations,
    loadInventoryStocktakeSessions,
    loadInventoryStocktakeSession,
    createInventoryStocktakeSession,
    saveInventoryStocktakeCount,
    addInventoryStocktakeVariant,
    addInventoryStocktakeCombination,
    reconcileFoundInventoryStock,
    loadInventoryCycleCounts,
    applyInventoryCycleCounts,
    quickInventoryStocktakeBatch,
    quickInventoryStocktake,
    completeInventoryStocktakeSession,
    cancelInventoryStocktakeSession,
    loadInventoryHistory,
    loadInventoryCheckHistory,
  }
}
