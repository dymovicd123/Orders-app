import { useRef, useState } from 'react'
import type { ReturnDraft, ReturnHistoryEntry, ReturnHistoryResponse, ExchangeDraft, ExchangeHistoryEntry, ExchangeHistoryResponse } from '../types'
import { createReturnDraft, createExchangeDraft, readJsonResponse } from '../utils'

type ReturnExchangeWorkspaceArgs = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  reportReadFailure: (errorValue: unknown, label: string, hasPreviousData: boolean) => void
}

// Existing read semantics are preserved, including independent inbox tokens.
export function useReturnExchangeWorkspace({ apiFetch, reportReadFailure }: ReturnExchangeWorkspaceArgs) {
  const [returnSelectedOrderId, setReturnSelectedOrderId] = useState<number | null>(null)
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>(createReturnDraft())
  const [returnBusy, setReturnBusy] = useState(false)
  const [returnHistory, setReturnHistory] = useState<ReturnHistoryEntry[]>([])
  const [returnHistoryBusy, setReturnHistoryBusy] = useState(false)
  const [returnHistoryError, setReturnHistoryError] = useState('')
  const [returnHistoryFilters, setReturnHistoryFilters] = useState({ q: '', dateFrom: '', dateTo: '', status: 'all' })
  const [returnHistoryHasMore, setReturnHistoryHasMore] = useState(false)
  const [returnHistorySummary, setReturnHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, activeAmount: 0, pendingPhysicalQuantity: 0, count: 0 })
  const [returnPendingInbox, setReturnPendingInbox] = useState({
    rows: [] as ReturnHistoryEntry[], pendingQuantity: 0, hasMore: false, busy: false, error: '',
  })
  const returnPendingInboxToken = useRef(0)
  const [exchangeSelectedOrderId, setExchangeSelectedOrderId] = useState<number | null>(null)
  const [exchangeDraft, setExchangeDraft] = useState<ExchangeDraft>(createExchangeDraft())
  const [exchangeBusy, setExchangeBusy] = useState(false)
  const [exchangeHistory, setExchangeHistory] = useState<ExchangeHistoryEntry[]>([])
  const [exchangeHistoryBusy, setExchangeHistoryBusy] = useState(false)
  const [exchangeHistoryError, setExchangeHistoryError] = useState('')
  const [exchangeHistoryFilters, setExchangeHistoryFilters] = useState({ q: '', dateFrom: '', dateTo: '', status: 'all' })
  const [exchangeHistoryHasMore, setExchangeHistoryHasMore] = useState(false)
  const [exchangeHistorySummary, setExchangeHistorySummary] = useState({ activeCount: 0, cancelledCount: 0, pendingPhysicalQuantity: 0, count: 0 })
  const [exchangePendingInbox, setExchangePendingInbox] = useState({
    rows: [] as ExchangeHistoryEntry[], pendingQuantity: 0, hasMore: false, busy: false, error: '',
  })
  const exchangePendingInboxToken = useRef(0)

  // These independent oldest-first queues are NOT controlled by history q/date/status.
  // Staff must see pending physical items even after searching for an unrelated
  // order or when a September operation falls outside the newest 50 records.
  async function loadReturnPendingInbox(append = false) {
    const token = ++returnPendingInboxToken.current
    setReturnPendingInbox(current => ({ ...current, busy: true, error: '' }))
    try {
      const params = new URLSearchParams({ pendingOnly: '1', limit: '50',
        offset: String(append ? returnPendingInbox.rows.length : 0) })
      const response = await apiFetch(`/api/returns?${params.toString()}`)
      const data = await readJsonResponse<ReturnHistoryResponse>(response, 'Ожидающие возвраты')
      if (!response.ok) throw new Error('Не удалось обновить очередь приёмки возвратов.')
      if (token !== returnPendingInboxToken.current) return
      setReturnPendingInbox(current => ({
        rows: append ? [...current.rows, ...(data.returns || [])] : (data.returns || []),
        pendingQuantity: Number(data.summary?.pendingPhysicalQuantity || 0),
        hasMore: Boolean(data.hasMore), busy: false, error: '',
      }))
    } catch (err) {
      if (token !== returnPendingInboxToken.current) return
      setReturnPendingInbox(current => ({ ...current, busy: false,
        error: err instanceof Error ? err.message : 'Не удалось проверить ожидающие возвраты.' }))
    }
  }
  async function loadExchangePendingInbox(append = false) {
    const token = ++exchangePendingInboxToken.current
    setExchangePendingInbox(current => ({ ...current, busy: true, error: '' }))
    try {
      const params = new URLSearchParams({ pendingOnly: '1', limit: '50',
        offset: String(append ? exchangePendingInbox.rows.length : 0) })
      const response = await apiFetch(`/api/exchanges?${params.toString()}`)
      const data = await readJsonResponse<ExchangeHistoryResponse>(response, 'Ожидающие обмены')
      if (!response.ok) throw new Error('Не удалось обновить очередь приёмки обменов.')
      if (token !== exchangePendingInboxToken.current) return
      setExchangePendingInbox(current => ({
        rows: append ? [...current.rows, ...(data.exchanges || [])] : (data.exchanges || []),
        pendingQuantity: Number(data.summary?.pendingPhysicalQuantity || 0),
        hasMore: Boolean(data.hasMore), busy: false, error: '',
      }))
    } catch (err) {
      if (token !== exchangePendingInboxToken.current) return
      setExchangePendingInbox(current => ({ ...current, busy: false,
        error: err instanceof Error ? err.message : 'Не удалось проверить ожидающие обмены.' }))
    }
  }

  async function loadReturnHistory(options: { append?: boolean; filters?: typeof returnHistoryFilters } = {}) {
    const nextFilters = options.filters || returnHistoryFilters
    const append = Boolean(options.append)
    setReturnHistoryBusy(true)
    setReturnHistoryError('')
    try {
      const params = new URLSearchParams({ limit: '50', offset: append ? String(returnHistory.length) : '0' })
      if (nextFilters.q.trim()) params.set('q', nextFilters.q.trim())
      if (nextFilters.dateFrom) params.set('dateFrom', nextFilters.dateFrom)
      if (nextFilters.dateTo) params.set('dateTo', nextFilters.dateTo)
      if (nextFilters.status !== 'all') params.set('status', nextFilters.status)
      const response = await apiFetch(`/api/returns?${params.toString()}`)
      const data = await readJsonResponse<ReturnHistoryResponse>(response, 'История возвратов')
      if (!response.ok) throw new Error('Не удалось загрузить историю возвратов.')
      const rows = Array.isArray(data.returns) ? data.returns : []
      setReturnHistory((current) => append ? [...current, ...rows] : rows)
      setReturnHistoryHasMore(Boolean(data.hasMore))
      setReturnHistorySummary({
        activeCount: Number(data.summary?.activeCount || 0),
        cancelledCount: Number(data.summary?.cancelledCount || 0),
        activeAmount: Number(data.summary?.activeAmount || 0),
        pendingPhysicalQuantity: Number(data.summary?.pendingPhysicalQuantity || 0),
        count: Number(data.count || 0),
      })
      if (!append) void loadReturnPendingInbox()
      return rows
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить историю возвратов.'
      setReturnHistoryError(message)
      reportReadFailure(err, 'История возвратов', returnHistory.length > 0)
      return null
    } finally {
      setReturnHistoryBusy(false)
    }
  }

  async function loadExchangeHistory(options: { append?: boolean; filters?: typeof exchangeHistoryFilters } = {}) {
    const nextFilters = options.filters || exchangeHistoryFilters
    const append = Boolean(options.append)
    setExchangeHistoryBusy(true)
    setExchangeHistoryError('')
    try {
      const params = new URLSearchParams({ limit: '50', offset: append ? String(exchangeHistory.length) : '0' })
      if (nextFilters.q.trim()) params.set('q', nextFilters.q.trim())
      if (nextFilters.dateFrom) params.set('dateFrom', nextFilters.dateFrom)
      if (nextFilters.dateTo) params.set('dateTo', nextFilters.dateTo)
      if (nextFilters.status !== 'all') params.set('status', nextFilters.status)
      const response = await apiFetch(`/api/exchanges?${params.toString()}`)
      const data = await readJsonResponse<ExchangeHistoryResponse>(response, 'История обменов')
      if (!response.ok) throw new Error('Не удалось загрузить историю обменов.')
      const rows = Array.isArray(data.exchanges) ? data.exchanges : []
      setExchangeHistory((current) => append ? [...current, ...rows] : rows)
      setExchangeHistoryHasMore(Boolean(data.hasMore))
      setExchangeHistorySummary({ activeCount: Number(data.summary?.activeCount || 0), cancelledCount: Number(data.summary?.cancelledCount || 0), pendingPhysicalQuantity: Number(data.summary?.pendingPhysicalQuantity || 0), count: Number(data.count || 0) })
      if (!append) void loadExchangePendingInbox()
      return rows
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить историю обменов.'
      setExchangeHistoryError(message)
      return null
    } finally {
      setExchangeHistoryBusy(false)
    }
  }

  return {
    returnSelectedOrderId,
    setReturnSelectedOrderId,
    returnDraft,
    setReturnDraft,
    returnBusy,
    setReturnBusy,
    returnHistory,
    setReturnHistory,
    returnHistoryBusy,
    setReturnHistoryBusy,
    returnHistoryError,
    setReturnHistoryError,
    returnHistoryFilters,
    setReturnHistoryFilters,
    returnHistoryHasMore,
    setReturnHistoryHasMore,
    returnHistorySummary,
    setReturnHistorySummary,
    returnPendingInbox,
    setReturnPendingInbox,
    exchangeSelectedOrderId,
    setExchangeSelectedOrderId,
    exchangeDraft,
    setExchangeDraft,
    exchangeBusy,
    setExchangeBusy,
    exchangeHistory,
    setExchangeHistory,
    exchangeHistoryBusy,
    setExchangeHistoryBusy,
    exchangeHistoryError,
    setExchangeHistoryError,
    exchangeHistoryFilters,
    setExchangeHistoryFilters,
    exchangeHistoryHasMore,
    setExchangeHistoryHasMore,
    exchangeHistorySummary,
    setExchangeHistorySummary,
    exchangePendingInbox,
    setExchangePendingInbox,
    returnPendingInboxToken,
    exchangePendingInboxToken,
    loadReturnPendingInbox,
    loadExchangePendingInbox,
    loadReturnHistory,
    loadExchangeHistory,
  }
}
