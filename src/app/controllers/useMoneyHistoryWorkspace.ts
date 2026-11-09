import { useState, useRef } from 'react'
import type { FinancialHistoryEntry, FinancialHistoryResponse } from '../types'
import { formatLocalDateInput, readJsonResponse } from '../utils'

type MoneyHistoryWorkspaceArgs = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  financeReportFilters: { dateFrom: string; dateTo: string }
}

// Read-only money journal pagination and request sequence protection.
// Payment mutations, cash ledger and report reconciliation remain in App.
export function useMoneyHistoryWorkspace({ apiFetch, financeReportFilters }: MoneyHistoryWorkspaceArgs) {
  const [moneyHistory, setMoneyHistory] = useState<FinancialHistoryEntry[]>([])
  const [moneyHistoryBusy, setMoneyHistoryBusy] = useState(false)
  const [moneyHistoryError, setMoneyHistoryError] = useState('')
  const [moneyHistoryQuery, setMoneyHistoryQuery] = useState('')
  const [moneyHistoryType, setMoneyHistoryType] = useState({ flow: 'all' as 'all' | 'in' | 'out', operation: 'all' as 'all' | 'order_payment' | 'debt_close' | 'order_extra' | 'exchange_extra' | 'refund' | 'correction', trace: 'all' as 'all' | 'normal' | 'info' | 'review' | 'legacy' })
  const [moneyHistoryHasMore, setMoneyHistoryHasMore] = useState(false)
  const [moneyHistorySummary, setMoneyHistorySummary] = useState({ count: 0, totalIn: 0, totalOut: 0, net: 0 })
  const moneyHistoryRequestIdRef = useRef(0)

  async function loadMoneyHistory(options: { append?: boolean } = {}) {
    const append = Boolean(options.append)
    if (!financeReportFilters.dateFrom || !financeReportFilters.dateTo) return null
    const requestId = ++moneyHistoryRequestIdRef.current
    const offset = append ? moneyHistory.length : 0
    const currentMonthStart = `${formatLocalDateInput().slice(0, 7)}-01`
    const includeLegacy = financeReportFilters.dateFrom < currentMonthStart
    const effectiveTrace = !includeLegacy && moneyHistoryType.trace === 'legacy' ? 'all' : moneyHistoryType.trace
    setMoneyHistoryBusy(true)
    setMoneyHistoryError('')
    try {
      const params = new URLSearchParams({
        dateFrom: financeReportFilters.dateFrom,
        dateTo: financeReportFilters.dateTo,
        q: moneyHistoryQuery.trim(),
        flow: moneyHistoryType.flow,
        operation: moneyHistoryType.operation,
        trace: effectiveTrace,
        includeLegacy: includeLegacy ? '1' : '0',
        limit: '50',
        offset: String(offset),
      })
      const response = await apiFetch(`/api/finance/money-history?${params.toString()}`)
      const data = await readJsonResponse<FinancialHistoryResponse & { message?: string }>(response, 'История денег')
      if (!response.ok) throw new Error(data.message || 'Не удалось загрузить историю денег.')
      if (requestId !== moneyHistoryRequestIdRef.current) return data
      setMoneyHistory((current) => append ? [...current, ...(data.events || [])] : (data.events || []))
      setMoneyHistoryHasMore(Boolean(data.hasMore))
      setMoneyHistorySummary({
        count: Number(data.count || 0),
        totalIn: Number(data.summary?.totalIn || 0),
        totalOut: Number(data.summary?.totalOut || 0),
        net: Number(data.summary?.net || 0),
      })
      return data
    } catch (err) {
      if (requestId === moneyHistoryRequestIdRef.current) {
        setMoneyHistoryError(err instanceof Error ? err.message : 'Не удалось загрузить историю денег.')
        if (!append) setMoneyHistory([])
      }
      return null
    } finally {
      if (requestId === moneyHistoryRequestIdRef.current) setMoneyHistoryBusy(false)
    }
  }

  return {
    moneyHistory,
    setMoneyHistory,
    moneyHistoryBusy,
    setMoneyHistoryBusy,
    moneyHistoryError,
    setMoneyHistoryError,
    moneyHistoryQuery,
    setMoneyHistoryQuery,
    moneyHistoryType,
    setMoneyHistoryType,
    moneyHistoryHasMore,
    setMoneyHistoryHasMore,
    moneyHistorySummary,
    setMoneyHistorySummary,
    moneyHistoryRequestIdRef,
    loadMoneyHistory,
  }
}
