// Read-only Warehouse history state: exact SKU/source filters, pagination, physical
// checks, transfer grouping and stale-request rejection. No inventory mutations.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { InventoryStocktakeSession } from '../../../shared/api-contracts.ts'
import type { InventoryCheckHistoryResponse, InventoryCheckHistoryRow, InventoryHistoryResponse, InventorySourceKey } from '../../app/types'

export type InventoryHistoryFilter = {
  source: InventorySourceKey
  variantId: number
  productId?: number
  productName?: string
  color?: string
  size?: string
}

type InventoryHistoryWorkspaceOptions = {
  inventoryPanel: string
  loadInventoryHistory: (query: {
    source: InventorySourceKey | ''
    variantId: number
    q: string
    beforeId: number
    limit: number
  }) => Promise<InventoryHistoryResponse | null | undefined>
  loadInventoryCheckHistory: (query: {
    source: InventorySourceKey | ''
    variantId: number
    limit: number
  }) => Promise<InventoryCheckHistoryResponse | null | undefined>
  loadInventoryStocktakeSession: (id: string) => Promise<{
    session?: InventoryStocktakeSession | null
  } | null | undefined>
  openInventoryPanel: (panel: 'history') => void
  clearStockDetail: () => void
}

export function useInventoryHistoryWorkspace({
  inventoryPanel,
  loadInventoryHistory,
  loadInventoryCheckHistory,
  loadInventoryStocktakeSession,
  openInventoryPanel,
  clearStockDetail,
}: InventoryHistoryWorkspaceOptions) {
  const [historyVariantFilter, setHistoryVariantFilter] = useState<InventoryHistoryFilter | null>(null)
  const [historyMode, setHistoryMode] = useState<'movements' | 'checks'>('movements')
  const [historyRows, setHistoryRows] = useState<InventoryHistoryResponse['movements']>([])
  const [historyCheckRows, setHistoryCheckRows] = useState<InventoryCheckHistoryRow[]>([])
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [historyNextBeforeId, setHistoryNextBeforeId] = useState<number | null>(null)
  const [historyQuery, setHistoryQuery] = useState('')
  const [historyStocktakeDetail, setHistoryStocktakeDetail] = useState<InventoryStocktakeSession | null>(null)
  const [historyStocktakeDetailBusy, setHistoryStocktakeDetailBusy] = useState(false)
  const historyRequestRef = useRef(0)

  const formatHistoryMoment = (value: unknown) => {
    const text = String(value || '').trim()
    if (!text) return '—'
    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return text
    return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
  }

  const historyCheckLabel = (row: any) => {
    if (row.checkType === 'full_stocktake') return 'Полная ревизия'
    if (row.checkType === 'selective_stocktake') return 'Выборочная ревизия'
    if (row.checkType === 'cycle_count') return 'Плановая сверка'
    if (row.checkType === 'order_observation') return 'Сверка при заказе'
    if (row.checkType === 'exchange_observation') return 'Сверка при обмене'
    if (row.checkType === 'transfer_observation') return 'Сверка при перемещении'
    return 'Короткая сверка'
  }

  async function loadHistoryMovements(reset = true) {
    const requestId = ++historyRequestRef.current
    setHistoryBusy(true)
    setHistoryError('')
    try {
      const data = await loadInventoryHistory({
        source: historyVariantFilter?.source || '',
        variantId: Number(historyVariantFilter?.variantId || 0),
        q: historyQuery,
        beforeId: reset ? 0 : Number(historyNextBeforeId || 0),
        limit: 50,
      })
      if (requestId !== historyRequestRef.current) return
      const rows = Array.isArray(data?.movements) ? data.movements : []
      setHistoryRows((current) => reset ? rows : [...current, ...rows])
      setHistoryHasMore(Boolean(data?.hasMore))
      setHistoryNextBeforeId(Number(data?.nextBeforeId || 0) || null)
    } catch (err) {
      if (requestId !== historyRequestRef.current) return
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить историю склада.')
    } finally {
      if (requestId === historyRequestRef.current) setHistoryBusy(false)
    }
  }

  async function loadHistoryChecks() {
    const requestId = ++historyRequestRef.current
    setHistoryBusy(true)
    setHistoryError('')
    setHistoryStocktakeDetail(null)
    try {
      const data = await loadInventoryCheckHistory({ source: historyVariantFilter?.source || '', variantId: Number(historyVariantFilter?.variantId || 0), limit: 40 })
      if (requestId !== historyRequestRef.current) return
      setHistoryCheckRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (err) {
      if (requestId !== historyRequestRef.current) return
      setHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить ревизии и сверки.')
    } finally {
      if (requestId === historyRequestRef.current) setHistoryBusy(false)
    }
  }

  async function openHistoryStocktake(sessionId: string) {
    if (!sessionId || historyStocktakeDetailBusy) return
    if (historyStocktakeDetail?.id === sessionId) { setHistoryStocktakeDetail(null); return }
    setHistoryStocktakeDetailBusy(true)
    setHistoryError('')
    try {
      const data = await loadInventoryStocktakeSession(sessionId)
      setHistoryStocktakeDetail(data?.session || null)
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Не удалось открыть детали ревизии.')
    } finally {
      setHistoryStocktakeDetailBusy(false)
    }
  }

  const historyDisplayRows = useMemo(() => {
    const result: any[] = []
    const seenTransfers = new Set<string>()
    for (const row of historyRows) {
      const transfer = ['transfer_in', 'transfer_out'].includes(String(row.referenceType || '')) && row.referenceId
      if (!transfer) { result.push({ kind: 'movement', row }); continue }
      const key = String(row.referenceId)
      if (seenTransfers.has(key)) continue
      seenTransfers.add(key)
      const rows = historyRows.filter((candidate: any) => String(candidate.referenceId || '') === key && ['transfer_in', 'transfer_out'].includes(String(candidate.referenceType || '')))
      const outgoing = rows.filter((candidate: any) => candidate.referenceType === 'transfer_out')
      result.push({ kind: 'transfer', row, rows, variantCount: new Set(outgoing.map((candidate: any) => candidate.variantId)).size, totalQuantity: outgoing.reduce((sum: number, candidate: any) => sum + Math.abs(Number(candidate.quantityDelta || 0)), 0) })
    }
    return result
  }, [historyRows])

  useEffect(() => {
    if (inventoryPanel !== 'history') return
    if (historyMode === 'movements') void loadHistoryMovements(true)
    else void loadHistoryChecks()
  }, [inventoryPanel, historyMode, historyVariantFilter?.variantId, historyVariantFilter?.source])

  function openSimpleStockHistory(detail: InventoryHistoryFilter) {
    setHistoryVariantFilter(detail)
    setHistoryMode('movements')
    setHistoryQuery('')
    clearStockDetail()
    openInventoryPanel('history')
  }

  return {
    formatHistoryMoment,
    historyBusy,
    historyCheckLabel,
    historyCheckRows,
    historyDisplayRows,
    historyError,
    historyHasMore,
    historyMode,
    historyQuery,
    historyRows,
    historyStocktakeDetail,
    historyStocktakeDetailBusy,
    historyVariantFilter,
    loadHistoryChecks,
    loadHistoryMovements,
    openHistoryStocktake,
    openSimpleStockHistory,
    setHistoryMode,
    setHistoryQuery,
    setHistoryVariantFilter,
  }
}
