import { useCallback, useRef, useState } from 'react'
import type { WorkshopResponse, WorkshopTaskRecord, WorkshopView, WorkshopPeriodPreset } from '../../app/types'
import { readJsonResponse } from '../../app/utils'

type ApiFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ReportReadFailure = (errorValue: unknown, label: string, hasPreviousData: boolean) => void

type WorkshopReadFilters = {
  view: WorkshopView
  period: WorkshopPeriodPreset
  dateFrom: string
  dateTo: string
  urgentOnly: boolean
  q: string
}

type WorkshopSortDirection = 'oldest' | 'newest'
type WorkshopLoadOptions = { force?: boolean; refreshCounts?: boolean }
type WorkshopCounts = Pick<WorkshopResponse, 'activeCount' | 'urgentCount' | 'doneCount'>
type WorkshopCountsResponse = { ok: boolean } & WorkshopCounts

type Options = {
  apiFetch: ApiFetch
  reportReadFailure: ReportReadFailure
}

const WORKSHOP_LIST_TTL_MS = 20 * 1000
const WORKSHOP_COUNTS_TTL_MS = 60 * 1000

function statusBucket(status: string) {
  if (status === 'active') return 'active'
  if (status === 'done' || status === 'ready') return 'done'
  return 'other'
}

export function useWorkshopReads({ apiFetch, reportReadFailure }: Options) {
  const [workshopData, setWorkshopDataState] = useState<WorkshopResponse | null>(null)
  const [workshopBusy, setWorkshopBusy] = useState(false)
  const currentData = useRef<WorkshopResponse | null>(null)
  const requestId = useRef(0)
  const listCache = useRef(new Map<string, { data: WorkshopResponse; savedAt: number }>())
  const listInFlight = useRef(new Map<string, Promise<WorkshopResponse>>())
  const countsCache = useRef<({ savedAt: number } & WorkshopCounts) | null>(null)
  const countsInFlight = useRef<Promise<WorkshopCounts> | null>(null)

  const commit = useCallback((data: WorkshopResponse) => {
    currentData.current = data
    setWorkshopDataState(data)
  }, [])

  const invalidateWorkshopReadCache = useCallback(() => {
    listCache.current.clear()
    countsCache.current = null
  }, [])

  const loadWorkshopCounts = useCallback(async (force = false) => {
    const cached = countsCache.current
    if (!force && cached && Date.now() - cached.savedAt <= WORKSHOP_COUNTS_TTL_MS) return cached
    if (!countsInFlight.current) {
      countsInFlight.current = (async () => {
        const response = await apiFetch('/api/workshop/counts')
        const data = await readJsonResponse<WorkshopCountsResponse>(response, 'Счётчики цеха')
        if (!response.ok) throw new Error('Не удалось загрузить счётчики цеха.')
        const counts = {
          activeCount: Number(data.activeCount || 0),
          urgentCount: Number(data.urgentCount || 0),
          doneCount: Number(data.doneCount || 0),
        }
        countsCache.current = { ...counts, savedAt: Date.now() }
        return counts
      })().finally(() => { countsInFlight.current = null })
    }
    return countsInFlight.current
  }, [apiFetch])

  const loadWorkshopData = useCallback(async (
    filters: WorkshopReadFilters,
    sortDirection: WorkshopSortDirection,
    options: WorkshopLoadOptions = {},
  ) => {
    const key = [filters.view, filters.period, filters.dateFrom, filters.dateTo, filters.urgentOnly ? '1' : '0', sortDirection].join('::')
    const currentRequestId = ++requestId.current
    const force = options.force ?? true
    const cached = listCache.current.get(key)
    const needCounts = options.refreshCounts ?? !countsCache.current

    if (!force && cached && Date.now() - cached.savedAt <= WORKSHOP_LIST_TTL_MS) {
      let counts = countsCache.current
      if (needCounts || !counts || Date.now() - counts.savedAt > WORKSHOP_COUNTS_TTL_MS) {
        try { await loadWorkshopCounts(false) } catch (error) { reportReadFailure(error, 'Счётчики цеха', Boolean(counts)) }
        counts = countsCache.current
      }
      const data = {
        ...cached.data,
        activeCount: counts?.activeCount ?? currentData.current?.activeCount ?? 0,
        urgentCount: counts?.urgentCount ?? currentData.current?.urgentCount ?? 0,
        doneCount: counts?.doneCount ?? currentData.current?.doneCount ?? 0,
        countsIncluded: Boolean(counts),
      }
      if (currentRequestId === requestId.current) commit(data)
      return data
    }

    setWorkshopBusy(true)
    let request = listInFlight.current.get(key)
    if (!request) {
      request = (async () => {
        const params = new URLSearchParams({
          view: filters.view,
          period: filters.period,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          urgentOnly: filters.urgentOnly ? '1' : '0',
          sort: sortDirection,
          limit: '300',
          includeCounts: '0',
        })
        const response = await apiFetch(`/api/workshop?${params.toString()}`)
        const data = await readJsonResponse<WorkshopResponse>(response, 'Цех')
        if (!response.ok) throw new Error('Не удалось загрузить цех.')
        listCache.current.set(key, { data, savedAt: Date.now() })
        return data
      })()
      listInFlight.current.set(key, request)
    }

    try {
      const countsRequest = (needCounts || !countsCache.current || Date.now() - countsCache.current.savedAt > WORKSHOP_COUNTS_TTL_MS)
        ? loadWorkshopCounts(Boolean(options.refreshCounts && force)).catch((error) => {
            reportReadFailure(error, 'Счётчики цеха', Boolean(countsCache.current))
            return countsCache.current
          })
        : Promise.resolve(countsCache.current)
      const [listData] = await Promise.all([request, countsRequest])
      const counts = countsCache.current
      const data = {
        ...listData,
        activeCount: counts?.activeCount ?? currentData.current?.activeCount ?? 0,
        urgentCount: counts?.urgentCount ?? currentData.current?.urgentCount ?? 0,
        doneCount: counts?.doneCount ?? currentData.current?.doneCount ?? 0,
        countsIncluded: Boolean(counts),
      }
      if (currentRequestId === requestId.current) commit(data)
      return data
    } catch (error) {
      reportReadFailure(error, 'Данные цеха', Boolean(currentData.current))
      return null
    } finally {
      if (listInFlight.current.get(key) === request) listInFlight.current.delete(key)
      if (currentRequestId === requestId.current) setWorkshopBusy(false)
    }
  }, [apiFetch, commit, loadWorkshopCounts, reportReadFailure])

  const applyWorkshopTaskStatusChange = useCallback((task: WorkshopTaskRecord, nextStatus: 'active' | 'done', previousStatus = task.status) => {
    listCache.current.clear()
    const current = currentData.current
    if (!current) return
    const previousBucket = statusBucket(previousStatus)
    const nextBucket = statusBucket(nextStatus)
    const activeDelta = (nextBucket === 'active' ? 1 : 0) - (previousBucket === 'active' ? 1 : 0)
    const doneDelta = (nextBucket === 'done' ? 1 : 0) - (previousBucket === 'done' ? 1 : 0)
    const urgentDelta = task.urgent ? activeDelta : 0
    const counts = {
      activeCount: Math.max(0, current.activeCount + activeDelta),
      urgentCount: Math.max(0, current.urgentCount + urgentDelta),
      doneCount: Math.max(0, current.doneCount + doneDelta),
    }
    countsCache.current = { ...counts, savedAt: Date.now() }
    const updatedTask = { ...task, status: nextStatus }
    const tasks = current.tasks
      .map((row) => row.id === task.id ? updatedTask : row)
      .filter((row) => current.view === 'done'
        ? statusBucket(row.status) === 'done'
        : statusBucket(row.status) === 'active' && (current.view !== 'urgent' || row.urgent))
    commit({ ...current, ...counts, count: tasks.length, countsIncluded: true, tasks })
  }, [commit])

  return {
    workshopData,
    workshopBusy,
    setWorkshopBusy,
    loadWorkshopData,
    invalidateWorkshopReadCache,
    applyWorkshopTaskStatusChange,
  }
}
