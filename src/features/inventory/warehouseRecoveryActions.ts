import type { Dispatch, SetStateAction } from 'react'
import type { CatalogResponse, CatalogReviewResponse, InventoryLifecyclePendingResponse, InventoryResponse, InventorySourceKey, ReferenceData } from '../../app/types'
import type { CatalogResolutionContext, CatalogResolutionInput, CatalogResolutionResponse, WarehouseAttentionSummaryResponse } from '../../../shared/api-contracts.ts'
import { readJsonResponse } from '../../app/utils'

type WarehouseRecoveryActionsArgs = {
  canManageWarehouse: boolean
  catalogReview: CatalogReviewResponse | null
  catalogReviewBusy: boolean
  setCatalogReview: Dispatch<SetStateAction<CatalogReviewResponse | null>>
  setCatalogReviewBusy: Dispatch<SetStateAction<boolean>>
  inventoryLifecycle: InventoryLifecyclePendingResponse | null
  inventoryLifecycleBusy: boolean
  setInventoryLifecycle: Dispatch<SetStateAction<InventoryLifecyclePendingResponse | null>>
  setInventoryLifecycleBusy: Dispatch<SetStateAction<boolean>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  loadInventoryData: (source: InventorySourceKey, force?: boolean, query?: string, includeMovements?: boolean) => Promise<InventoryResponse | null>
  loadCatalogData: (force?: boolean) => Promise<CatalogResponse | null>
  loadReferencesData: (force?: boolean) => Promise<ReferenceData | null>
  loadWarehouseAttention: (details?: boolean, force?: boolean) => Promise<WarehouseAttentionSummaryResponse | null>
}

async function settleCatalogReviewRefreshes(tasks: Promise<unknown>[]) { return (await Promise.allSettled(tasks)).some((entry) => entry.status === 'rejected') }

// Domain operations retain the original server authority and refresh/error behavior.
export function createWarehouseRecoveryActions({
  canManageWarehouse,
  catalogReview,
  catalogReviewBusy,
  setCatalogReview,
  setCatalogReviewBusy,
  inventoryLifecycle,
  inventoryLifecycleBusy,
  setInventoryLifecycle,
  setInventoryLifecycleBusy,
  apiFetch,
  setError,
  setMessage,
  loadInventoryData,
  loadCatalogData,
  loadReferencesData,
  loadWarehouseAttention,
}: WarehouseRecoveryActionsArgs) {
  async function loadCatalogReview(force = false, orderId = 0) {
    if (!canManageWarehouse) return null
    if (!orderId && catalogReview?.mode !== 'order' && catalogReview && !force) return catalogReview
    setCatalogReviewBusy(true)
    try {
      // Opening the review page is read-only. An orderId is used only when an old hidden
      // exception becomes operational because the user is trying to finish that exact order.
      const params = new URLSearchParams({ limit: '24' })
      if (orderId > 0) params.set('orderId', String(orderId))
      const response = await apiFetch(`/api/catalog/review?${params.toString()}`)
      if (!response.ok) return null
      const data = await readJsonResponse<CatalogReviewResponse>(response, 'Неразобранные товары')
      setCatalogReview(data)
      return data
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function reconcileCatalogReview(limit = 20) {
    if (!canManageWarehouse || catalogReviewBusy) return null
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/reconcile?limit=${Math.max(1, Math.min(20, limit))}`, { method: 'POST' })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Безопасное распознавание каталога')
      if (!response.ok) throw new Error(result?.message || 'Не удалось разобрать очевидные позиции.')
      const nextRefresh = loadCatalogReview(true)
      const refreshIncomplete = await settleCatalogReviewRefreshes([nextRefresh, ...(Number(result?.resolvedGroups || 0) > 0 ? [loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false), loadCatalogData(true)] : [])])
      const next = await nextRefresh.catch(() => catalogReview)
      const successMessage = Number(result?.resolvedGroups || 0) > 0 ? `Автоматически разобрано: ${result.resolvedGroups}.` : 'Очевидных безопасных совпадений больше нет.'
      setMessage(refreshIncomplete ? `${successMessage} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : successMessage)
      return { ...result, review: next }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось разобрать очевидные позиции.')
      return null
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function loadCatalogReviewContext(orderItemId: number) {
    const response = await apiFetch(`/api/catalog/review/${orderItemId}/context`)
    const data = await readJsonResponse<CatalogResolutionContext>(response, 'Разбор позиции')
    if (!response.ok) throw new Error(data?.message || 'Не удалось определить, что именно требует уточнения.')
    return data
  }

  async function resolveCatalogReviewFacts(orderItemId: number, input: CatalogResolutionInput) {
    if (!canManageWarehouse || !orderItemId || catalogReviewBusy) return null
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/${orderItemId}/resolve-facts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Разбор позиции')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось разобрать позицию.')
      const createdReference = Array.isArray(input.createFields) && input.createFields.length > 0
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
        createdReference ? loadReferencesData(true) : Promise.resolve(null), loadWarehouseAttention(false, true),
      ])
      setMessage(refreshIncomplete ? `${result?.message || 'Позиция разобрана.'} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : (result?.message || 'Позиция разобрана.'))
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось разобрать позицию.')
      return null
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function excludeCatalogReviewItem(orderItemId: number) {
    if (!canManageWarehouse || !orderItemId || catalogReviewBusy) return null
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/${orderItemId}/exclude`, { method: 'POST' })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Разбор позиции')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось оставить позицию вне каталога.')
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true, catalogReview?.mode === 'order' ? Number(catalogReview.orderId || 0) : 0),
        loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
      ])
      setMessage(refreshIncomplete ? `${result?.message || 'Позиция оставлена только в заказе.'} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : (result?.message || 'Позиция оставлена только в заказе.'))
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось оставить позицию вне каталога.')
      return null
    } finally {
      setCatalogReviewBusy(false)
    }
  }

  async function loadInventoryLifecycle(force = false) {
    if (!canManageWarehouse) {
      setInventoryLifecycle(null)
      return null
    }
    if (inventoryLifecycle && !force) return inventoryLifecycle
    setInventoryLifecycleBusy(true)
    try {
      const response = await apiFetch('/api/inventory/lifecycle/pending?limit=60')
      if (!response.ok) return null
      const data = await readJsonResponse<InventoryLifecyclePendingResponse>(response, 'Ожидающие складские движения')
      setInventoryLifecycle(data)
      return data
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  async function loadInventoryLifecycleContext(eventId: number) {
    const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/context`)
    const data = await readJsonResponse<CatalogResolutionContext>(response, 'Физическая позиция')
    if (!response.ok) throw new Error(data?.message || 'Не удалось определить, что именно нужно уточнить.')
    return data
  }

  async function resolveInventoryLifecycleFacts(eventId: number, input: CatalogResolutionInput) {
    if (!canManageWarehouse || !eventId || inventoryLifecycleBusy) return null
    setInventoryLifecycleBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/resolve-facts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Физическая позиция')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось применить складское движение.')
      const createdReference = Array.isArray(input.createFields) && input.createFields.length > 0
      await Promise.all([
        loadInventoryLifecycle(true),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadCatalogData(true),
        createdReference ? loadReferencesData(true) : Promise.resolve(null),
      ])
      setMessage(result?.message || 'Физическая позиция подтверждена и склад обновлён.')
      return result
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось применить складское движение.')
      return null
    } finally {
      setInventoryLifecycleBusy(false)
    }
  }

  async function reconcileKnownInventoryLifecycle(eventId: number) {
    if (!eventId) return null
    setError(null)
    try {
      const response = await apiFetch(`/api/inventory/lifecycle/${eventId}/reconcile-known`, { method: 'POST' })
      const result = await readJsonResponse<CatalogResolutionResponse>(response, 'Приёмка известной позиции')
      if (!response.ok || result?.ok === false) throw new Error(result?.message || 'Не удалось завершить приёмку.')
      const [attentionData] = await Promise.all([
        loadWarehouseAttention(true),
        canManageWarehouse ? loadInventoryLifecycle(true) : Promise.resolve(null),
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
      ])
      setMessage(result?.message || 'Приёмка завершена.')
      return { ...result, warehouseAttention: attentionData }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось завершить приёмку.')
      return null
    }
  }

  async function resolveCatalogReviewItem(orderItemId: number, variantId: number) {
    if (!canManageWarehouse || !orderItemId || !variantId || catalogReviewBusy) return false
    setCatalogReviewBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/catalog/review/${orderItemId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId }),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; linked?: number; reserved?: number; fulfilled?: number }>(response, 'Привязка товара')
      if (!response.ok || result.ok === false) throw new Error(result.message || 'Не удалось связать позицию с каталогом.')
      const refreshIncomplete = await settleCatalogReviewRefreshes([
        loadCatalogReview(true), loadInventoryData('warehouse', true, '', false), loadInventoryData('boutique', true, '', false),
      ])
      const successMessage = result.message || `Позиция связана с каталогом${Number(result.linked || 0) > 1 ? `; одинаковых записей обработано: ${result.linked}` : ''}.`
      setMessage(refreshIncomplete ? `${successMessage} Изменение сохранено, но часть экрана не обновилась. Нажмите «Обновить».` : successMessage)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось связать позицию с каталогом.')
      return false
    } finally {
      setCatalogReviewBusy(false)
    }
  }


  return {
    loadCatalogReview,
    reconcileCatalogReview,
    loadCatalogReviewContext,
    resolveCatalogReviewFacts,
    excludeCatalogReviewItem,
    loadInventoryLifecycle,
    loadInventoryLifecycleContext,
    resolveInventoryLifecycleFacts,
    reconcileKnownInventoryLifecycle,
    resolveCatalogReviewItem,
  }
}
