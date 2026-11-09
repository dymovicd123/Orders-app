import type { Dispatch, SetStateAction } from 'react'
import type { TeamActivityResponse, TeamActivityType, TeamSalaryResponse } from '../../app/types'
import { readJsonResponse } from '../../app/utils'

export type TeamReportFilters = { dateFrom: string; dateTo: string }
export type TeamActivityFilters = TeamReportFilters & { q: string; actionType: TeamActivityType }

type TeamReportActionsArgs = {
  teamSalaryFilters: TeamReportFilters
  teamSalaryReport: TeamSalaryResponse | null
  teamActivityFilters: TeamActivityFilters
  teamActivityReport: TeamActivityResponse | null
  setTeamBusy: Dispatch<SetStateAction<boolean>>
  setTeamSalaryReport: Dispatch<SetStateAction<TeamSalaryResponse | null>>
  setTeamActivityBusy: Dispatch<SetStateAction<boolean>>
  setTeamActivityLoadFailed: Dispatch<SetStateAction<boolean>>
  setTeamActivityReport: Dispatch<SetStateAction<TeamActivityResponse | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  reportReadFailure: (errorValue: unknown, label: string, hasPreviousData: boolean) => void
}

// Reads preserve period scope and the full summary while appending only the
// paginated activity rows; no salary, finance or inventory writes.
export function createTeamReportActions({
  teamSalaryFilters,
  teamSalaryReport,
  teamActivityFilters,
  teamActivityReport,
  setTeamBusy,
  setTeamSalaryReport,
  setTeamActivityBusy,
  setTeamActivityLoadFailed,
  setTeamActivityReport,
  apiFetch,
  reportReadFailure,
}: TeamReportActionsArgs) {
  async function loadTeamSalaryReport(nextFilters = teamSalaryFilters) {
    setTeamBusy(true)
    try {
      const params = new URLSearchParams({ startDate: nextFilters.dateFrom, endDate: nextFilters.dateTo })
      const response = await apiFetch(`/api/team/salary?${params.toString()}`)
      const data = await readJsonResponse<TeamSalaryResponse>(response, 'Зарплата команды')
      if (!response.ok) throw new Error('Не удалось загрузить зарплату команды.')
      setTeamSalaryReport(data)
      return data
    } catch (err) {
      reportReadFailure(err, 'Отчёт по зарплате', Boolean(teamSalaryReport))
      return null
    } finally {
      setTeamBusy(false)
    }
  }


  async function loadTeamActivityReport(nextFilters = teamActivityFilters, options: { append?: boolean } = {}) {
    const append = Boolean(options.append)
    setTeamActivityBusy(true)
    setTeamActivityLoadFailed(false)
    try {
      const offset = append ? Number(teamActivityReport?.rows?.length || 0) : 0
      const params = new URLSearchParams({
        startDate: nextFilters.dateFrom,
        endDate: nextFilters.dateTo,
        q: nextFilters.q.trim(),
        actionType: nextFilters.actionType,
        limit: '50',
        offset: String(offset),
      })
      const response = await apiFetch(`/api/team/activity?${params.toString()}`)
      const data = await readJsonResponse<TeamActivityResponse>(response, 'Работа с заказами')
      if (!response.ok) throw new Error('Не удалось загрузить работу с заказами.')
      setTeamActivityReport((current) => append && current
        ? { ...data, rows: [...(current.rows || []), ...(data.rows || [])] }
        : data)
      setTeamActivityLoadFailed(false)
      return data
    } catch (err) {
      setTeamActivityLoadFailed(true)
      reportReadFailure(err, 'Работа с заказами', Boolean(teamActivityReport))
      return null
    } finally {
      setTeamActivityBusy(false)
    }
  }

  return { loadTeamSalaryReport, loadTeamActivityReport }
}
