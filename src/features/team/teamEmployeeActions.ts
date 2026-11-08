import type { Dispatch, SetStateAction } from 'react'
import type { ManagedAuthUser, TeamEmployee } from '../../app/types'
import { formatLocalDateInput, readJsonResponse } from '../../app/utils'
import { resolveManagerDisplayColor } from '../../components'

export type TeamEmployeeDraft = {
  id: number
  name: string
  role: string
  phone: string
  birthDate: string
  colorKey: string
  hiredAt: string
  comment: string
  isActive: boolean
  createAccount: boolean
  login: string
  password: string
  mustChangePassword: boolean
}

type TeamEmployeeActionsArgs = {
  isAdmin: boolean
  teamDraft: TeamEmployeeDraft
  teamEmployees: TeamEmployee[]
  authUsers: ManagedAuthUser[]
  setTeamBusy: Dispatch<SetStateAction<boolean>>
  setTeamEmployees: Dispatch<SetStateAction<TeamEmployee[]>>
  setTeamDraft: Dispatch<SetStateAction<TeamEmployeeDraft>>
  setTeamFormOpen: Dispatch<SetStateAction<boolean>>
  setTeamColorEditorId: Dispatch<SetStateAction<number | null>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  reportReadFailure: (errorValue: unknown, label: string, hasPreviousData: boolean) => void
  loadAuthUsers: () => Promise<unknown>
  loadReferencesData: (force?: boolean) => Promise<unknown>
}

// The employee and login are distinct saved records; retain original partial
// account-creation recovery and preserve historical employee references.
export function createTeamEmployeeActions({
  isAdmin,
  teamDraft,
  teamEmployees,
  authUsers,
  setTeamBusy,
  setTeamEmployees,
  setTeamDraft,
  setTeamFormOpen,
  setTeamColorEditorId,
  setError,
  setMessage,
  apiFetch,
  reportReadFailure,
  loadAuthUsers,
  loadReferencesData,
}: TeamEmployeeActionsArgs) {
  async function loadTeamEmployees() {
    setTeamBusy(true)
    try {
      const response = await apiFetch('/api/team')
      const data = await readJsonResponse<{ ok?: boolean; employees?: TeamEmployee[] }>(response, 'Команда')
      if (!response.ok) throw new Error('Не удалось загрузить команду.')
      setTeamEmployees(Array.isArray(data.employees) ? data.employees : [])
      return data
    } catch (err) {
      reportReadFailure(err, 'Команда', teamEmployees.length > 0)
      return null
    } finally {
      setTeamBusy(false)
    }
  }

  async function saveTeamEmployee() {
    if (!isAdmin) {
      setError('Изменение команды доступно только администратору.')
      return
    }

    const hasLinkedAccount = Boolean(teamDraft.id && authUsers.some((user) => user.managerId === teamDraft.id))
    const shouldCreateAccount = teamDraft.createAccount !== false && !hasLinkedAccount
    const requestedLogin = (teamDraft.login || '').trim().toLowerCase()
    if (shouldCreateAccount) {
      if (requestedLogin.length < 3) {
        setError('Для входа укажите логин минимум из 3 символов.')
        return
      }
      if ((teamDraft.password || '').length < 8) {
        setError('Для нового сотрудника задайте временный пароль минимум из 8 символов.')
        return
      }
    }

    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/team/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(teamDraft),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string; employeeId?: number }>(response, 'Сотрудник')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить сотрудника.')
      const employeeId = Number(data.employeeId || teamDraft.id || 0)

      if (shouldCreateAccount && employeeId) {
        const accountResponse = await apiFetch('/api/auth/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            login: requestedLogin,
            password: teamDraft.password,
            role: String(teamDraft.role || '').toLowerCase().includes('админ') ? 'admin' : 'manager',
            managerId: employeeId,
            displayName: teamDraft.name,
            isActive: true,
            mustChangePassword: teamDraft.mustChangePassword !== false,
          }),
        })
        const accountData = await readJsonResponse<{ ok?: boolean; message?: string }>(accountResponse, 'Доступ сотрудника')
        if (!accountResponse.ok) {
          await Promise.all([loadTeamEmployees(), loadAuthUsers(), loadReferencesData(true)])
          setTeamDraft((draft) => ({ ...draft, id: employeeId, login: requestedLogin, createAccount: true }))
          setError(`Сотрудник создан, но вход не настроен: ${accountData.message || 'не удалось создать аккаунт'}. Исправьте логин или пароль здесь и сохраните ещё раз.`)
          return
        }
      }

      setTeamDraft({ id: 0, name: '', role: 'Менеджер', phone: '', birthDate: '', colorKey: '#2563EB', hiredAt: formatLocalDateInput(), comment: '', isActive: true, createAccount: true, login: '', password: '', mustChangePassword: true })
      await Promise.all([loadTeamEmployees(), isAdmin ? loadAuthUsers() : Promise.resolve(), loadReferencesData(true)])
      setTeamFormOpen(false)
      setMessage(shouldCreateAccount ? `Сотрудник сохранён. Вход @${requestedLogin} создан.` : 'Сотрудник сохранён.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения сотрудника')
    } finally {
      setTeamBusy(false)
    }
  }

  async function saveTeamEmployeeColor(employee: TeamEmployee, colorKey: string) {
    if (!isAdmin || !employee?.id) return
    const normalizedColor = resolveManagerDisplayColor(colorKey, employee.id)
    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/team/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: employee.id,
          name: employee.name,
          role: employee.role || 'Менеджер',
          phone: employee.phone || '',
          colorKey: normalizedColor,
          hiredAt: employee.hiredAt || formatLocalDateInput(),
          comment: employee.comment || '',
          isActive: employee.isActive,
        }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Цвет сотрудника')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить цвет сотрудника.')
      setTeamEmployees((current) => current.map((item) => item.id === employee.id ? { ...item, colorKey: normalizedColor } : item))
      if (teamDraft.id === employee.id) setTeamDraft((draft) => ({ ...draft, colorKey: normalizedColor }))
      setTeamColorEditorId(null)
      void loadReferencesData(true)
      setMessage(`Цвет сотрудника ${employee.name} обновлён.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения цвета сотрудника')
    } finally {
      setTeamBusy(false)
    }
  }

  async function setTeamEmployeeEmploymentStatus(employee: TeamEmployee, isActive: boolean) {
    if (!isAdmin) {
      setError('Изменение статуса сотрудника доступно только администратору.')
      return
    }
    if (!employee?.id) return
    const confirmation = isActive
      ? `Вернуть сотрудника ${employee.name} в активную команду? Он снова появится в новых заказах и назначениях.`
      : `Отметить сотрудника ${employee.name} как уволенного? Старые заказы, планы, выплаты и отчёты сохранятся.`
    if (!window.confirm(confirmation)) return

    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/team/employees/${employee.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Статус сотрудника')
      if (teamDraft.id === employee.id) {
        setTeamDraft((draft) => ({ ...draft, isActive }))
      }
      await Promise.all([loadTeamEmployees(), isAdmin ? loadAuthUsers() : Promise.resolve(), loadReferencesData(true)])
      setMessage(data.message || (isActive ? 'Сотрудник возвращён в команду. Доступ в систему включите отдельно, если он нужен.' : 'Сотрудник отмечен как уволенный. Его вход в систему отключён.'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить статус сотрудника.')
    } finally {
      setTeamBusy(false)
    }
  }

  async function removeTeamEmployee(employee: TeamEmployee) {
    if (!isAdmin) {
      setError('Удаление сотрудников доступно только администратору.')
      return
    }
    if (!employee?.id) return
    if (!window.confirm(`Удалить сотрудника ${employee.name}? Если по нему есть заказы, планы или отчёты, система не даст удалить и предложит отметить его как уволенного.`)) return
    setTeamBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch(`/api/team/employees/${employee.id}`, { method: 'DELETE' })
      const data = await readJsonResponse<{ ok?: boolean; message?: string }>(response, 'Удаление сотрудника')
      if (!response.ok) throw new Error(data.message || 'Не удалось удалить сотрудника.')
      if (teamDraft.id === employee.id) setTeamDraft({ id: 0, name: '', role: 'Менеджер', phone: '', birthDate: '', colorKey: '#2563EB', hiredAt: formatLocalDateInput(), comment: '', isActive: true, createAccount: true, login: '', password: '', mustChangePassword: true })
      await Promise.all([loadTeamEmployees(), isAdmin ? loadAuthUsers() : Promise.resolve(), loadReferencesData(true)])
      setMessage(data.message || 'Сотрудник удалён из команды.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления сотрудника')
    } finally {
      setTeamBusy(false)
    }
  }

  return {
    loadTeamEmployees,
    saveTeamEmployee,
    saveTeamEmployeeColor,
    setTeamEmployeeEmploymentStatus,
    removeTeamEmployee,
  }
}
