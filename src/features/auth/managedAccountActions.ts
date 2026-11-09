import type { Dispatch, SetStateAction } from 'react'
import type { AccessRole, ManagedAuthUser } from '../../app/types'
import { readJsonResponse } from '../../app/utils'

export type ManagedAuthUserDraft = {
  id: number; login: string; password: string; role: AccessRole; managerId: number;
  displayName: string; isActive: boolean; mustChangePassword: boolean
}

type Base = {
  isAdmin: boolean
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  setAuthUsersBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
}
type LoadArgs = Base & { setAuthUsers: Dispatch<SetStateAction<ManagedAuthUser[]>> }
type SaveArgs = Base & {
  authUserDraft: ManagedAuthUserDraft
  authUsers: ManagedAuthUser[]
  setAuthUserDraft: Dispatch<SetStateAction<ManagedAuthUserDraft>>
  loadAuthUsers: () => Promise<void>
}
type DisableArgs = Base & { loadAuthUsers: () => Promise<void> }

// Admin account controls are separate from login/session state and never
// bypass the existing Worker role checks or duplicate manager identity guard.
export async function loadManagedAuthUsers({
  isAdmin, apiFetch, setAuthUsersBusy, setAuthUsers, setError,
}: LoadArgs): Promise<void> {
    if (!isAdmin) return
    setAuthUsersBusy(true)
    try {
      const response = await apiFetch('/api/auth/users')
      const data = await readJsonResponse<{ ok: boolean; items?: ManagedAuthUser[] }>(response, 'Пользователи')
      setAuthUsers(data.items || [])
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось загрузить пользователей.')
    } finally {
      setAuthUsersBusy(false)
    }
}

export async function saveManagedAuthUser({
  isAdmin, apiFetch, authUserDraft, authUsers, setAuthUserDraft,
  setAuthUsersBusy, setError, setMessage, loadAuthUsers,
}: SaveArgs): Promise<void> {
    if (!isAdmin) return
    setAuthUsersBusy(true)
    setError(null)
    try {
      const isEdit = Boolean(authUserDraft.id)
      const duplicateManagerAccount = authUserDraft.managerId
        ? authUsers.find((user) => user.managerId === authUserDraft.managerId && user.id !== authUserDraft.id)
        : null
      if (duplicateManagerAccount) {
        throw new Error(`У этого сотрудника уже есть аккаунт @${duplicateManagerAccount.login}. Измените его в разделе «Команда».`)
      }
      const payload = {
        login: authUserDraft.login,
        password: authUserDraft.password || undefined,
        role: authUserDraft.role,
        managerId: authUserDraft.managerId || null,
        displayName: authUserDraft.displayName,
        isActive: authUserDraft.isActive,
        mustChangePassword: authUserDraft.mustChangePassword,
      }
      const response = await apiFetch(isEdit ? `/api/auth/users/${authUserDraft.id}` : '/api/auth/users', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      await readJsonResponse(response, 'Пользователь')
      setAuthUserDraft({ id: 0, login: '', password: '', role: 'manager', managerId: 0, displayName: '', isActive: true, mustChangePassword: true })
      setMessage(isEdit ? 'Аккаунт обновлён.' : 'Аккаунт создан.')
      await loadAuthUsers()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить аккаунт.')
    } finally {
      setAuthUsersBusy(false)
    }
}

export async function disableManagedAuthUser(id: number, {
  isAdmin, apiFetch, setAuthUsersBusy, setError, setMessage, loadAuthUsers,
}: DisableArgs): Promise<void> {
    if (!isAdmin || !window.confirm('Отключить этот аккаунт? Его активные сессии будут закрыты.')) return
    setAuthUsersBusy(true)
    try {
      const response = await apiFetch(`/api/auth/users/${id}`, { method: 'DELETE' })
      await readJsonResponse(response, 'Отключение аккаунта')
      setMessage('Аккаунт отключён.')
      await loadAuthUsers()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось отключить аккаунт.')
    } finally {
      setAuthUsersBusy(false)
    }
}
