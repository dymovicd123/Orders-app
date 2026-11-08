import type { Dispatch, SetStateAction } from 'react'
import type { OrderRecord, WorkshopPeriodPreset, WorkshopTaskRecord, WorkshopView } from '../../app/types'
import { getPeriodRange, readJsonResponse } from '../../app/utils'

export type WorkshopActionFilters = {
  view: WorkshopView
  period: WorkshopPeriodPreset
  dateFrom: string
  dateTo: string
  urgentOnly: boolean
  q: string
}

type WorkshopTaskActionsArgs = {
  workshopFilters: WorkshopActionFilters
  setWorkshopFilters: Dispatch<SetStateAction<WorkshopActionFilters>>
  setWorkshopBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  loadWorkshopData: (filters: WorkshopActionFilters, options: { force?: boolean; refreshCounts?: boolean }) => Promise<unknown>
  applyWorkshopTaskStatusChange: (task: WorkshopTaskRecord, status: 'active' | 'done', previousStatus: string) => void
  upsertOrderInState: (order: OrderRecord) => void
  loadDashboard: (force?: boolean) => Promise<unknown>
}

// Keep the Workshop task PATCH and its readback/refresh fallback together.
// Task completion is not shipment; Workshop settlement remains Worker-owned.
export function createWorkshopTaskActions({
  workshopFilters,
  setWorkshopFilters,
  setWorkshopBusy,
  setError,
  setMessage,
  apiFetch,
  loadWorkshopData,
  applyWorkshopTaskStatusChange,
  upsertOrderInState,
  loadDashboard,
}: WorkshopTaskActionsArgs) {
  function applyWorkshopPeriodPreset(preset: WorkshopPeriodPreset) {
    const range = preset === 'all' ? { dateFrom: '', dateTo: '' } : getPeriodRange(preset)
    setWorkshopFilters((current) => ({
      ...current, period: preset,
      dateFrom: preset === 'custom' ? current.dateFrom : range.dateFrom,
      dateTo: preset === 'custom' ? current.dateTo : range.dateTo,
    }))
  }



  async function markWorkshopTaskDone(task: WorkshopTaskRecord) {
    setWorkshopBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/workshop/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'done', orderItemId: task.orderItemId || null }),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; changed?: boolean; previousStatus?: string; order?: OrderRecord; refreshRequired?: boolean }>(response, 'Цех')
      if (!response.ok) {
        throw new Error(result.message || 'Не удалось отметить позицию готовой.')
      }
      if (result.changed === false) await loadWorkshopData(workshopFilters, { force: true, refreshCounts: true })
      else applyWorkshopTaskStatusChange(task, 'done', result.previousStatus || task.status)
      if (result.order) upsertOrderInState(result.order)
      else if (result.refreshRequired) void loadDashboard(false)
      const orderAlreadySent = String(result.order?.shipping_status || task.shippingStatus || '').trim().toLowerCase() === 'sent'
      setMessage(orderAlreadySent
        ? `Позиция цеха по заказу ${task.externalOrderId} готова. Сам заказ уже был отмечен отправленным ранее.`
        : `Позиция цеха по заказу ${task.externalOrderId} готова. Это не отправка клиенту: заказ остаётся «Не отправлен».`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления цеха')
    } finally {
      setWorkshopBusy(false)
    }
  }

  async function restoreWorkshopTaskActive(task: WorkshopTaskRecord) {
    setWorkshopBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/workshop/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active', orderItemId: task.orderItemId || null }),
      })
      const result = await readJsonResponse<{ ok?: boolean; message?: string; changed?: boolean; previousStatus?: string; order?: OrderRecord; refreshRequired?: boolean }>(response, 'Цех')
      if (!response.ok) {
        throw new Error(result.message || 'Не удалось вернуть позицию в актуальные.')
      }
      if (result.changed === false) await loadWorkshopData(workshopFilters, { force: true, refreshCounts: true })
      else applyWorkshopTaskStatusChange(task, 'active', result.previousStatus || task.status)
      if (result.order) upsertOrderInState(result.order)
      else if (result.refreshRequired) void loadDashboard(false)
      setMessage(`Позиция цеха по заказу ${task.externalOrderId} возвращена в актуальные.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка обновления цеха')
    } finally {
      setWorkshopBusy(false)
    }
  }

  return { applyWorkshopPeriodPreset, markWorkshopTaskDone, restoreWorkshopTaskActive }
}
