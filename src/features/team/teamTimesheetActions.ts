import type { Dispatch, SetStateAction } from 'react'
import type { TeamTimesheetResponse } from '../../app/types'
import { formatLocalDateInput, readJsonResponse } from '../../app/utils'

type TeamTimesheetActionsArgs = {
  isAdmin: boolean
  timesheetMonth: string
  timesheetData: TeamTimesheetResponse | null
  timesheetSelectedDays: string[]
  timesheetSelectedManagers: number[]
  timesheetWorkUntil: string
  timesheetComment: string
  setTimesheetMonth: Dispatch<SetStateAction<string>>
  setTimesheetSelectedDays: Dispatch<SetStateAction<string[]>>
  setTimesheetSelectedManagers: Dispatch<SetStateAction<number[]>>
  setTimesheetData: Dispatch<SetStateAction<TeamTimesheetResponse | null>>
  setTimesheetBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  reportReadFailure: (errorValue: unknown, label: string, hasPreviousData: boolean) => void
  loadTeamSalaryReport: () => Promise<unknown>
  refreshActivityLogIfVisible: () => Promise<unknown>
}

// Calendar selection and persisted timesheet writes belong to one typed owner.
// Preserve the original calendar formatting, permissions and dependent refresh.
export function createTeamTimesheetActions({
  isAdmin,
  timesheetMonth,
  timesheetData,
  timesheetSelectedDays,
  timesheetSelectedManagers,
  timesheetWorkUntil,
  timesheetComment,
  setTimesheetMonth,
  setTimesheetSelectedDays,
  setTimesheetSelectedManagers,
  setTimesheetData,
  setTimesheetBusy,
  setError,
  setMessage,
  apiFetch,
  reportReadFailure,
  loadTeamSalaryReport,
  refreshActivityLogIfVisible,
}: TeamTimesheetActionsArgs) {
  function getTimesheetMonthDays(monthValue = timesheetMonth) {
    const [yearText, monthText] = monthValue.split('-')
    const year = Number(yearText)
    const month = Number(monthText)
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return Array.from({ length: lastDay }, (_, index) => `${yearText}-${monthText}-${String(index + 1).padStart(2, '0')}`)
  }


  function shiftTimesheetMonth(offset: number) {
    const [yearText, monthText] = timesheetMonth.split('-')
    const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + offset, 1))
    setTimesheetMonth(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`)
    setTimesheetSelectedDays([])
  }

  function setTimesheetCurrentMonth() {
    setTimesheetMonth(formatLocalDateInput().slice(0, 7))
    setTimesheetSelectedDays([])
  }

  function getTimesheetCalendarSlots() {
    const days = getTimesheetMonthDays()
    const first = days[0]
    const firstOffset = first ? ((new Date(`${first}T00:00:00`).getDay() + 6) % 7) : 0
    return [...Array.from({ length: firstOffset }, () => ''), ...days]
  }

  function getTimesheetWeekdayLabel(date: string) {
    const labels = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']
    return labels[new Date(`${date}T00:00:00`).getDay()] || ''
  }

  function getTimesheetEntriesForDate(date: string) {
    return (timesheetData?.entries || []).filter((entry) => entry.date === date)
  }

  async function loadTeamTimesheet(monthValue = timesheetMonth) {
    setTimesheetBusy(true)
    try {
      const response = await apiFetch(`/api/team/timesheet?month=${encodeURIComponent(monthValue)}`)
      const data = await readJsonResponse<TeamTimesheetResponse>(response, 'Табель')
      if (!response.ok) throw new Error('Не удалось загрузить табель.')
      setTimesheetData(data)
      return data
    } catch (err) {
      reportReadFailure(err, 'Табель', Boolean(timesheetData))
      return null
    } finally {
      setTimesheetBusy(false)
    }
  }

  async function saveTeamTimesheet(clear = false) {
    if (!isAdmin) {
      setError('Изменение табеля доступно только администратору.')
      return
    }

    setTimesheetBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/team/timesheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dates: timesheetSelectedDays,
          managerIds: timesheetSelectedManagers,
          workUntil: timesheetWorkUntil,
          comment: timesheetComment,
          clear,
        }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Табель')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить табель.')
      await Promise.all([loadTeamTimesheet(), loadTeamSalaryReport(), refreshActivityLogIfVisible()])
      setMessage(clear ? 'Выбранные назначения табеля очищены.' : 'Табель сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения табеля')
    } finally {
      setTimesheetBusy(false)
    }
  }

  function setTimesheetDaysPreset(kind: 'all' | 'weekdays' | 'weekends' | 'odd' | 'even' | 'clear') {
    const days = getTimesheetMonthDays()
    if (kind === 'clear') {
      setTimesheetSelectedDays([])
      return
    }
    const filtered = days.filter((date) => {
      const dayNumber = Number(date.slice(-2))
      const dayOfWeek = new Date(`${date}T00:00:00`).getDay()
      if (kind === 'weekdays') return dayOfWeek >= 1 && dayOfWeek <= 5
      if (kind === 'weekends') return dayOfWeek === 0 || dayOfWeek === 6
      if (kind === 'odd') return dayNumber % 2 === 1
      if (kind === 'even') return dayNumber % 2 === 0
      return true
    })
    setTimesheetSelectedDays(filtered)
  }

  function toggleTimesheetDay(date: string) {
    setTimesheetSelectedDays((current) => current.includes(date) ? current.filter((entry) => entry !== date) : [...current, date])
  }

  function toggleTimesheetManager(id: number) {
    setTimesheetSelectedManagers((current) => current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id])
  }

  return {
    getTimesheetMonthDays,
    shiftTimesheetMonth,
    setTimesheetCurrentMonth,
    getTimesheetCalendarSlots,
    getTimesheetWeekdayLabel,
    getTimesheetEntriesForDate,
    loadTeamTimesheet,
    saveTeamTimesheet,
    setTimesheetDaysPreset,
    toggleTimesheetDay,
    toggleTimesheetManager,
  }
}
