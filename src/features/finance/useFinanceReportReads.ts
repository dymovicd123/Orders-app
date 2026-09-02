import { useCallback, useRef, useState } from 'react'
import type { FinanceReportResponse, OrdersFinanceSummaryResponse } from '../../app/types'
import { isTransientApiError, readJsonResponse } from '../../app/utils'

type DateRange = { dateFrom: string; dateTo: string }
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ReportReadFailure = (errorValue: unknown, label: string, hasPreviousData: boolean) => void

type Options = {
  apiFetch: ApiFetch
  reportReadFailure: ReportReadFailure
}

const ORDERS_SUMMARY_TTL_MS = 60 * 1000
const FULL_REPORT_TTL_MS = 60 * 1000

export function useFinanceReportReads({ apiFetch, reportReadFailure }: Options) {
  const [financeReport, setFinanceReport] = useState<FinanceReportResponse | null>(null)
  const [financeReportBusy, setFinanceReportBusy] = useState(false)
  const [ordersFinanceReport, setOrdersFinanceReport] = useState<OrdersFinanceSummaryResponse | null>(null)
  const [ordersFinanceBusy, setOrdersFinanceBusy] = useState(false)

  const financeRequestId = useRef(0)
  const summaryRequestId = useRef(0)
  const financeCache = useRef(new Map<string, { data: FinanceReportResponse; savedAt: number }>())
  const summaryCache = useRef(new Map<string, { data: OrdersFinanceSummaryResponse; savedAt: number }>())
  const financeInFlight = useRef(new Map<string, Promise<FinanceReportResponse>>())
  const summaryInFlight = useRef(new Map<string, Promise<OrdersFinanceSummaryResponse>>())

  const invalidateFinanceReadCaches = useCallback(() => {
    financeCache.current.clear()
    summaryCache.current.clear()
  }, [])

  const loadOrdersFinanceSummary = useCallback(async (range: DateRange, force = false) => {
    if (!range.dateFrom || !range.dateTo) return null
    const key = `${range.dateFrom}::${range.dateTo}`
    const requestId = ++summaryRequestId.current
    const cached = summaryCache.current.get(key)
    if (!force && cached && Date.now() - cached.savedAt <= ORDERS_SUMMARY_TTL_MS) {
      setOrdersFinanceReport(cached.data)
      setOrdersFinanceBusy(false)
      return cached.data
    }

    setOrdersFinanceBusy(true)
    let request = summaryInFlight.current.get(key)
    if (!request) {
      request = (async () => {
        const params = new URLSearchParams({ startDate: range.dateFrom, endDate: range.dateTo })
        const response = await apiFetch(`/api/reports/orders-summary?${params.toString()}`)
        const data = await readJsonResponse<OrdersFinanceSummaryResponse>(response, 'Сводка таблицы заказов')
        if (!response.ok) throw new Error('Не удалось загрузить сводку таблицы заказов.')
        summaryCache.current.set(key, { data, savedAt: Date.now() })
        return data
      })()
      summaryInFlight.current.set(key, request)
    }

    try {
      const data = await request
      if (requestId === summaryRequestId.current) setOrdersFinanceReport(data)
      return data
    } catch (error) {
      if (requestId === summaryRequestId.current && !ordersFinanceReport) setOrdersFinanceReport(null)
      if (!isTransientApiError(error)) reportReadFailure(error, 'Сводка таблицы заказов', Boolean(ordersFinanceReport))
      return null
    } finally {
      if (summaryInFlight.current.get(key) === request) summaryInFlight.current.delete(key)
      if (requestId === summaryRequestId.current) setOrdersFinanceBusy(false)
    }
  }, [apiFetch, ordersFinanceReport, reportReadFailure])

  const loadFinanceReports = useCallback(async (range: DateRange, options: { force?: boolean; scope?: 'full' | 'finance' } = {}) => {
    if (!range.dateFrom || !range.dateTo) return null
    const scope = options.scope || 'full'
    const key = `${scope}::${range.dateFrom}::${range.dateTo}`
    const requestId = ++financeRequestId.current
    const cached = financeCache.current.get(key)
    if (!options.force && cached && Date.now() - cached.savedAt <= FULL_REPORT_TTL_MS) {
      setFinanceReport(cached.data)
      setFinanceReportBusy(false)
      return cached.data
    }

    setFinanceReportBusy(true)
    let request = financeInFlight.current.get(key)
    if (!request) {
      request = (async () => {
        const params = new URLSearchParams({ startDate: range.dateFrom, endDate: range.dateTo })
        if (scope !== 'full') params.set('scope', scope)
        const response = await apiFetch(`/api/reports/finance?${params.toString()}`)
        const data = await readJsonResponse<FinanceReportResponse>(response, 'Финансовые отчёты')
        if (!response.ok) throw new Error('Не удалось загрузить финансовые отчёты.')
        financeCache.current.set(key, { data, savedAt: Date.now() })
        return data
      })()
      financeInFlight.current.set(key, request)
    }

    try {
      const data = await request
      if (requestId === financeRequestId.current) setFinanceReport(data)
      return data
    } catch (error) {
      reportReadFailure(error, 'Финансовые отчёты', Boolean(financeReport))
      return null
    } finally {
      if (financeInFlight.current.get(key) === request) financeInFlight.current.delete(key)
      if (requestId === financeRequestId.current) setFinanceReportBusy(false)
    }
  }, [apiFetch, financeReport, reportReadFailure])

  return {
    financeReport,
    financeReportBusy,
    ordersFinanceReport,
    ordersFinanceBusy,
    invalidateFinanceReadCaches,
    loadFinanceReports,
    loadOrdersFinanceSummary,
  }
}
