import { useCallback, useRef, useState } from 'react'
import type { FinanceReportResponse, FinanceReportType, OrdersFinanceSummaryResponse } from '../../app/types'
import { isTransientApiError, readJsonResponse } from '../../app/utils'

type DateRange = { dateFrom: string; dateTo: string }
type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ReportReadFailure = (errorValue: unknown, label: string, hasPreviousData: boolean) => void

type Options = {
  apiFetch: ApiFetch
  reportReadFailure: ReportReadFailure
}

const ORDERS_SUMMARY_TTL_MS = 2 * 60 * 1000
const FULL_REPORT_TTL_MS = 60 * 1000
const FINANCE_WORKSPACE_TTL_MS = 3 * 60 * 1000

function ordersSummaryFromFinanceReport(data: FinanceReportResponse): OrdersFinanceSummaryResponse {
  return {
    ok: data.ok,
    startDate: data.startDate,
    endDate: data.endDate,
    generatedAt: data.generatedAt,
    overview: {
      orderCount: Number(data.overview.orderCount || 0),
      totalSales: Number(data.overview.totalSales || 0),
      avgCheck: Number(data.overview.avgCheck || 0),
      grossReceived: Number(data.overview.grossReceived || 0),
      totalReturned: Number(data.overview.totalReturned || 0),
      currentDebt: Number(data.overview.currentDebt || 0),
      currentDebtOrders: Number(data.overview.currentDebtOrders || 0),
    },
  }
}

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
    financeInFlight.current.clear()
    summaryInFlight.current.clear()
    financeRequestId.current++
    summaryRequestId.current++
  }, [])

  const loadOrdersFinanceSummary = useCallback(async (range: DateRange, force = false) => {
    if (!range.dateFrom || !range.dateTo) return null
    const key = `${range.dateFrom}::${range.dateTo}`
    const requestId = ++summaryRequestId.current
    const cached = summaryCache.current.get(key)
    if (force) summaryCache.current.delete(key)
    if (!force && cached && Date.now() - cached.savedAt <= ORDERS_SUMMARY_TTL_MS) {
      setOrdersFinanceReport(cached.data)
      setOrdersFinanceBusy(false)
      return cached.data
    }

    setOrdersFinanceBusy(true)
    let request = force ? undefined : summaryInFlight.current.get(key)
    if (!request) {
      request = (async () => {
        const params = new URLSearchParams({ startDate: range.dateFrom, endDate: range.dateTo })
        const response = await apiFetch(`/api/reports/orders-summary?${params.toString()}`)
        const data = await readJsonResponse<OrdersFinanceSummaryResponse>(response, 'Сводка таблицы заказов')
        if (!response.ok) throw new Error('Не удалось загрузить сводку таблицы заказов.')
        if (summaryInFlight.current.get(key) === request) summaryCache.current.set(key, { data, savedAt: Date.now() })
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

  const loadFinanceReports = useCallback(async (range: DateRange, options: { force?: boolean; scope?: 'full' | 'finance'; reportType?: FinanceReportType } = {}) => {
    if (!range.dateFrom || !range.dateTo) return null
    const scope = options.scope || 'full'
    const reportType = scope === 'full' ? options.reportType : undefined
    const key = `${scope}::${reportType || 'all'}::${range.dateFrom}::${range.dateTo}`
    const requestId = ++financeRequestId.current
    const cached = financeCache.current.get(key)
    const cacheTtlMs = scope === 'finance' ? FINANCE_WORKSPACE_TTL_MS : FULL_REPORT_TTL_MS
    if (options.force) financeCache.current.delete(key)
    if (!options.force && cached && Date.now() - cached.savedAt <= cacheTtlMs) {
      setFinanceReport(cached.data)
      setFinanceReportBusy(false)
      return cached.data
    }

    setFinanceReportBusy(true)
    if (financeReport?.reportType !== reportType) setFinanceReport(null)
    let request = options.force ? undefined : financeInFlight.current.get(key)
    if (!request) {
      request = (async () => {
        const params = new URLSearchParams({ startDate: range.dateFrom, endDate: range.dateTo })
        if (scope !== 'full') params.set('scope', scope)
        if (reportType) params.set('reportType', reportType)
        const response = await apiFetch(`/api/reports/finance?${params.toString()}`)
        const data = await readJsonResponse<FinanceReportResponse>(response, 'Финансовые отчёты')
        if (!response.ok) throw new Error('Не удалось загрузить финансовые отчёты.')
        if (financeInFlight.current.get(key) === request) {
          const savedAt = Date.now()
          financeCache.current.set(key, { data, savedAt })
          // R7.6: the full/Finance workspace response already computed the exact Orders summary
          // with order_date for sales, payment_date for receipts, return_date for returns, and
          // current debt independently of the period. Reuse that exact result across navigation
          // instead of issuing a second /orders-summary aggregate for the same date range.
          if (!reportType) {
            const summaryKey = `${range.dateFrom}::${range.dateTo}`
            summaryCache.current.set(summaryKey, { data: ordersSummaryFromFinanceReport(data), savedAt })
          }
        }
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
