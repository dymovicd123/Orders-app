import { useRef, useState } from 'react'
import type { AppSector, InventoryPanel, InventoryResponse, InventorySourceKey } from '../../app/types'
import type { WarehouseAttentionSummaryResponse } from '../../../shared/api-contracts.ts'
import { readJsonResponse } from '../../app/utils'
import { loadCompleteInventorySnapshot } from './loadCompleteInventorySnapshot'

const WAREHOUSE_ATTENTION_SUMMARY_TTL_MS = 60_000
const INVENTORY_FORM_SNAPSHOT_TTL_MS = 30_000
let warehouseAttentionSummaryCache: { data: WarehouseAttentionSummaryResponse; loadedAt: number } | null = null
let warehouseAttentionSummaryInFlight: Promise<WarehouseAttentionSummaryResponse | null> | null = null
let warehouseAttentionRequestToken = 0


type WarehouseSnapshotsArgs = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  activeSector: AppSector
  inventoryPanel: InventoryPanel
  inventorySource: 'warehouse' | 'boutique'
  clearCatalogReview: () => void
}

export function useWarehouseSnapshots({
  apiFetch, activeSector, inventoryPanel, inventorySource, clearCatalogReview,
}: WarehouseSnapshotsArgs) {
  const [inventoryData, setInventoryData] = useState<{
    warehouse: InventoryResponse | null
    boutique: InventoryResponse | null
  }>({
    warehouse: null,
    boutique: null,
  })
  const inventorySnapshotLoadedAt = useRef<Record<InventorySourceKey, number>>({ warehouse: 0, boutique: 0 })
  const inventorySnapshotRequestSeq = useRef<Record<InventorySourceKey, number>>({ warehouse: 0, boutique: 0 })
  const [inventorySnapshotLoadErrors, setInventorySnapshotLoadErrors] = useState<Record<InventorySourceKey, string>>({ warehouse: '', boutique: '' })
  const [warehouseAttention, setWarehouseAttention] = useState<WarehouseAttentionSummaryResponse | null>(null)

  async function loadWarehouseAttention(details = false, force = false) {
    const shouldLoadDetails = details || (activeSector === 'inventory' && inventoryPanel === 'attention')
    if (!shouldLoadDetails && !force) {
      const cached = warehouseAttentionSummaryCache
      if (cached && Date.now() - cached.loadedAt < WAREHOUSE_ATTENTION_SUMMARY_TTL_MS) {
        setWarehouseAttention((current) => current?.items ? current : cached.data)
        return cached.data
      }
      if (warehouseAttentionSummaryInFlight) {
        return await warehouseAttentionSummaryInFlight
      }
    }
    const requestToken = ++warehouseAttentionRequestToken
    const request = (async () => {
      const response = await apiFetch(`/api/inventory/attention${shouldLoadDetails ? '?details=1&limit=30' : ''}`)
      if (!response.ok) return null
      return await readJsonResponse<WarehouseAttentionSummaryResponse>(response, 'Склад')
    })()
    if (!shouldLoadDetails) warehouseAttentionSummaryInFlight = request
    try {
      const data = await request
      if (!data || requestToken !== warehouseAttentionRequestToken) return data
      setWarehouseAttention(data)
      if (shouldLoadDetails) {
        // R7.7: a detailed Attention response already carries the exact summary counters.
        // Reuse those counters for the next passive badge/overview read instead of immediately
        // rebuilding the same live Warehouse truth graph.
        warehouseAttentionSummaryCache = {
          data: { ok: data.ok, total: data.total, counts: data.counts },
          loadedAt: Date.now(),
        }
      } else {
        warehouseAttentionSummaryCache = { data, loadedAt: Date.now() }
      }
      return data
    } finally {
      if (!shouldLoadDetails && warehouseAttentionSummaryInFlight === request) warehouseAttentionSummaryInFlight = null
    }
  }

  async function loadInventoryData(
    source: 'warehouse' | 'boutique' = inventorySource,
    force = false,
    query = '',
    includeMovements = false,
  ) {
    const cached = inventoryData[source]
    const cachedHasMovements = cached?.movementsIncluded !== false
    const snapshotAgeMs = Date.now() - inventorySnapshotLoadedAt.current[source]
    if (
      cached
      && !force
      && !query.trim()
      && snapshotAgeMs >= 0
      && snapshotAgeMs <= INVENTORY_FORM_SNAPSHOT_TTL_MS
      && (!includeMovements || cachedHasMovements)
    ) {
      return cached
    }

    const fullSnapshot = !query.trim()
    const requestSeq = fullSnapshot
      ? ++inventorySnapshotRequestSeq.current[source]
      : inventorySnapshotRequestSeq.current[source]
    const rejectSnapshot = (message: string) => {
      // Never present a previously loaded count as though a newer full
      // refresh succeeded. Earlier failed requests must not erase a later
      // successful one.
      if (fullSnapshot && inventorySnapshotRequestSeq.current[source] === requestSeq) {
        inventorySnapshotLoadedAt.current[source] = 0
        setInventoryData((current) => ({ ...current, [source]: null }))
        setInventorySnapshotLoadErrors((current) => ({ ...current, [source]: message }))
      }
      return null
    }

    let data: InventoryResponse | null = null
    try {
      data = await loadCompleteInventorySnapshot(async (cursor, firstPageWithMovements) => {
        const params = new URLSearchParams({
          source,
          limit: '1000',
          cursor: String(cursor),
          q: query.trim(),
          includeMovements: firstPageWithMovements ? '1' : '0',
        })
        const response = await apiFetch(`/api/inventory?${params.toString()}`)
        if (response.headers.get('X-Orders-App-Stale') === '1') {
          throw new Error('Свежие остатки недоступны. Получен старый кеш — он не принят за актуальный склад.')
        }
        if (!response.ok) return null
        return readJsonResponse<InventoryResponse>(response, 'Склад')
      }, includeMovements)
    } catch (error) {
      console.error('Полные остатки не загружены:', error)
      return rejectSnapshot(error instanceof Error ? error.message : 'Не удалось получить достоверные остатки.')
    }
    if (!data) return rejectSnapshot('Сервер не отдал полный список остатков. Данные не обновлены.')
    // A filtered query is only a search result. It must never replace the
    // authoritative all-items snapshot used by the entire Warehouse screen.
    if (!fullSnapshot) return data
    if (inventorySnapshotRequestSeq.current[source] !== requestSeq) return null
    // No interim state update: all downstream stocktake/arrival/catalog editors
    // must see one complete, LIVE source snapshot, never partial/stale pages.
    if (fullSnapshot) {
      inventorySnapshotLoadedAt.current[source] = Date.now()
      setInventorySnapshotLoadErrors((current) => ({ ...current, [source]: '' }))
    }
    setInventoryData((current) => {
      const previous = current[source]
      if (!includeMovements && previous && previous.movementsIncluded !== false) {
        return {
          ...current,
          [source]: {
            ...data,
            movements: previous.movements,
            movementsIncluded: false,
          },
        }
      }
      return { ...current, [source]: data }
    })
    return data
  }

  function invalidateInventoryStockCaches(includeCatalogReview = false) {
    setInventoryData({ warehouse: null, boutique: null })
    inventorySnapshotLoadedAt.current = { warehouse: 0, boutique: 0 }
    inventorySnapshotRequestSeq.current = { warehouse: inventorySnapshotRequestSeq.current.warehouse + 1, boutique: inventorySnapshotRequestSeq.current.boutique + 1 }
    setInventorySnapshotLoadErrors({ warehouse: '', boutique: '' })
    if (includeCatalogReview) clearCatalogReview()
    // W3.1A: mutations invalidate Warehouse Attention truth, but do not spend a D1 read
    // unless the user actually opens/refreshes the recovery surface. Its own effect/action
    // remains the single owner of detailed refreshes (W2.1 race invariant).
    warehouseAttentionSummaryCache = null
  }


  return {
    inventoryData,
    inventorySnapshotLoadErrors,
    warehouseAttention,
    loadWarehouseAttention,
    loadInventoryData,
    invalidateInventoryStockCaches,
  }
}
