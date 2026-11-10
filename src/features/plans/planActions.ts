import type { Dispatch, SetStateAction } from 'react'
import type { ManagerPlanRecord, DepartmentPlanRecord } from '../../app/types'
import { readJsonResponse } from '../../app/utils'

export type ManagerPlanDraft = {
  id: number
  periodStart: string
  periodEnd: string
  managerId: number
  managerName: string
  plannedAmount: number
  salaryBase: number
  comment: string
}

export type DepartmentPlanDraft = {
  id: number
  periodStart: string
  periodEnd: string
  plannedAmount: number
  comment: string
}

export type PlanFilters = { dateFrom: string; dateTo: string }
export type PlanReport = { managerPlans: ManagerPlanRecord[]; departmentPlans: DepartmentPlanRecord[] }

type PlanActionsArgs = {
  askActionConfirmation: (text: string) => Promise<boolean>
  isAdmin: boolean
  planFilters: PlanFilters
  planReport: PlanReport | null
  managerPlanDraft: ManagerPlanDraft
  departmentPlanDraft: DepartmentPlanDraft
  setManagerPlanDraft: Dispatch<SetStateAction<ManagerPlanDraft>>
  setDepartmentPlanDraft: Dispatch<SetStateAction<DepartmentPlanDraft>>
  setPlanBusy: Dispatch<SetStateAction<boolean>>
  setPlanReport: Dispatch<SetStateAction<PlanReport | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  reportReadFailure: (errorValue: unknown, label: string, hasPreviousData: boolean) => void
  refreshFinanceReportsIfVisible: () => Promise<unknown>
}

// Plans retain their original admin-only write boundary; financial reports
// are refreshed after a successful plan mutation, not before.
export function createPlanActions({
  askActionConfirmation,
  isAdmin,
  planFilters,
  planReport,
  managerPlanDraft,
  departmentPlanDraft,
  setManagerPlanDraft,
  setDepartmentPlanDraft,
  setPlanBusy,
  setPlanReport,
  setError,
  setMessage,
  apiFetch,
  reportReadFailure,
  refreshFinanceReportsIfVisible,
}: PlanActionsArgs) {
  function editManagerPlan(row: ManagerPlanRecord) {
    setManagerPlanDraft({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      managerId: Number(row.managerId || 0),
      managerName: row.manager,
      plannedAmount: row.plannedAmount,
      salaryBase: row.salaryBase || 100000,
      comment: row.comment || '',
    })
  }

  function editDepartmentPlan(row: DepartmentPlanRecord) {
    setDepartmentPlanDraft({
      id: row.id,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      plannedAmount: row.plannedAmount,
      comment: row.comment || '',
    })
  }

  async function deleteManagerPlan(id: number) {
    if (!isAdmin || !id || !await askActionConfirmation('Удалить план менеджера?')) return
    setPlanBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/plans/${id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План менеджера')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить план менеджера.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setMessage('План менеджера удалён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления плана')
    } finally {
      setPlanBusy(false)
    }
  }

  async function deleteDepartmentPlan(id: number) {
    if (!isAdmin || !id || !await askActionConfirmation('Удалить план отдела?')) return
    setPlanBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/department-plans/${id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План отдела')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить план отдела.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setMessage('План отдела удалён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления плана отдела')
    } finally {
      setPlanBusy(false)
    }
  }

  async function loadPlans(nextFilters = planFilters) {
    setPlanBusy(true)
    try {
      const params = new URLSearchParams({ startDate: nextFilters.dateFrom, endDate: nextFilters.dateTo })
      const response = await apiFetch(`/api/plans?${params.toString()}`)
      const data = await readJsonResponse<{ ok?: boolean; managerPlans?: ManagerPlanRecord[]; departmentPlans?: DepartmentPlanRecord[] }>(response, 'План')
      if (!response.ok) throw new Error('Не удалось загрузить планы.')
      setPlanReport({ managerPlans: data.managerPlans || [], departmentPlans: data.departmentPlans || [] })
      return data
    } catch (err) {
      reportReadFailure(err, 'Планы', Boolean(planReport))
      return null
    } finally {
      setPlanBusy(false)
    }
  }

  async function saveManagerPlan() {
    if (!isAdmin) {
      setError('Изменение плана доступно только администратору.')
      return
    }

    setPlanBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...managerPlanDraft, salaryBase: managerPlanDraft.salaryBase || 100000, bonusHitPercent: 5, bonusMissPercent: 3 }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План менеджера')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить план менеджера.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setManagerPlanDraft({ id: 0, periodStart: managerPlanDraft.periodStart, periodEnd: managerPlanDraft.periodEnd, managerId: 0, managerName: '', plannedAmount: 0, salaryBase: 100000, comment: '' })
      setMessage(managerPlanDraft.id ? 'План менеджера обновлён.' : 'План менеджера сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения плана')
    } finally {
      setPlanBusy(false)
    }
  }

  async function saveDepartmentPlan() {
    if (!isAdmin) {
      setError('Изменение плана отдела доступно только администратору.')
      return
    }

    setPlanBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/department-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(departmentPlanDraft),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'План отдела')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить план отдела.')
      await Promise.all([loadPlans(), refreshFinanceReportsIfVisible()])
      setDepartmentPlanDraft({ id: 0, periodStart: departmentPlanDraft.periodStart, periodEnd: departmentPlanDraft.periodEnd, plannedAmount: 0, comment: '' })
      setMessage(departmentPlanDraft.id ? 'План отдела обновлён.' : 'План отдела сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения плана отдела')
    } finally {
      setPlanBusy(false)
    }
  }

  return {
    editManagerPlan,
    editDepartmentPlan,
    deleteManagerPlan,
    deleteDepartmentPlan,
    loadPlans,
    saveManagerPlan,
    saveDepartmentPlan,
  }
}
