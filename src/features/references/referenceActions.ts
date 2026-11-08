import type { Dispatch, SetStateAction } from 'react'
import type { ReferenceData, ReferenceKind, ReferenceListItem } from '../../app/types'
import { normalizeSuggestion, readJsonResponse } from '../../app/utils'

export type ReferenceDraft = { id: number; value: string; sortOrder: string; isActive: boolean }
export type ReferenceCount = { total: number; active: number; inactive: number }
export type ReferenceCounts = Partial<Record<ReferenceKind, ReferenceCount>>
export type ReferenceCache = Partial<Record<ReferenceKind, ReferenceListItem[]>>
export type ReferenceStatusFilter = 'all' | 'active' | 'inactive'

type ReferenceActionsArgs = {
  isAdmin: boolean
  canManageWarehouse: boolean
  references: ReferenceData | null
  referenceKind: ReferenceKind
  referenceDraft: ReferenceDraft
  referenceItems: ReferenceListItem[]
  referenceItemsCache: ReferenceCache
  referenceKindCounts: ReferenceCounts
  referenceBusy: boolean
  referenceRequestIdRef: { current: number }
  setReferences: Dispatch<SetStateAction<ReferenceData | null>>
  setReferenceItems: Dispatch<SetStateAction<ReferenceListItem[]>>
  setReferenceItemsCache: Dispatch<SetStateAction<ReferenceCache>>
  setReferenceKindCounts: Dispatch<SetStateAction<ReferenceCounts>>
  setReferenceBusy: Dispatch<SetStateAction<boolean>>
  setReferenceDraft: Dispatch<SetStateAction<ReferenceDraft>>
  setReferenceKind: Dispatch<SetStateAction<ReferenceKind>>
  setReferenceSearch: Dispatch<SetStateAction<string>>
  setReferenceStatusFilter: Dispatch<SetStateAction<ReferenceStatusFilter>>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}

// Reference controls keep request-id stale-read suppression and the original
// warehouse-only material/color/size edit permissions.
export function createReferenceActions({
  isAdmin,
  canManageWarehouse,
  references,
  referenceKind,
  referenceDraft,
  referenceItems,
  referenceItemsCache,
  referenceKindCounts,
  referenceBusy,
  referenceRequestIdRef,
  setReferences,
  setReferenceItems,
  setReferenceItemsCache,
  setReferenceKindCounts,
  setReferenceBusy,
  setReferenceDraft,
  setReferenceKind,
  setReferenceSearch,
  setReferenceStatusFilter,
  setError,
  setMessage,
  apiFetch,
}: ReferenceActionsArgs) {
  async function loadReferencesData(force = false) {
    if (references && !force) return references
    const response = await apiFetch('/api/reference-data')
    if (!response.ok) return null
    const referenceData = await readJsonResponse<ReferenceData>(response, 'Справочники')
    setReferences(referenceData)
    return referenceData
  }

  async function loadReferenceKindCounts(kinds: ReferenceKind[], force = false) {
    const requested = Array.from(new Set(kinds)).filter(Boolean)
    if (!requested.length) return {}
    if (!force && requested.every((kind) => referenceKindCounts[kind])) {
      return referenceKindCounts
    }
    const response = await apiFetch(`/api/reference-values/counts?kinds=${encodeURIComponent(requested.join(','))}`)
    if (!response.ok) return null
    const data = await readJsonResponse<{ ok: boolean; counts?: Partial<Record<ReferenceKind, { total: number; active: number; inactive: number }>> }>(response, 'Счётчики справочников')
    const counts = data.counts || {}
    setReferenceKindCounts((current) => ({ ...current, ...counts }))
    return counts
  }

  async function loadReferenceItems(kind = referenceKind, force = false) {
    const cached = referenceItemsCache[kind]
    if (cached && !force) {
      setReferenceItems(cached)
      return cached
    }
    if (referenceBusy && !force) return referenceItems
    const requestId = ++referenceRequestIdRef.current
    setReferenceBusy(true)
    try {
      const response = await apiFetch(`/api/reference-values?kind=${encodeURIComponent(kind)}`)
      if (!response.ok) return null
      const data = await readJsonResponse<{ ok: boolean; items?: ReferenceListItem[] }>(response, 'Справочник')
      const items = Array.isArray(data.items) ? data.items : []
      if (requestId !== referenceRequestIdRef.current) {
        return items
      }
      setReferenceItems(items)
      setReferenceItemsCache((current) => ({ ...current, [kind]: items }))
      const activeCount = items.filter((item) => item.isActive).length
      setReferenceKindCounts((current) => ({
        ...current,
        [kind]: { total: items.length, active: activeCount, inactive: Math.max(0, items.length - activeCount) },
      }))
      return items
    } finally {
      if (requestId === referenceRequestIdRef.current) {
        setReferenceBusy(false)
      }
    }
  }

  async function saveReferenceEntry() {
    if (!(isAdmin || (canManageWarehouse && ['colors', 'materials', 'lengths', 'sizes', 'childAges'].includes(referenceKind)))) {
      setError('Изменение этого справочника доступно только администратору.')
      return
    }

    const value = normalizeSuggestion(referenceDraft.value)
    if (!value) {
      setError('Введите значение для справочника.')
      return null
    }

    setError(null)
    const payload = {
      kind: referenceKind,
      value,
      sortOrder: Number(referenceDraft.sortOrder || 0),
      isActive: Boolean(referenceDraft.isActive),
    }

    const isEdit = referenceDraft.id > 0
    const response = await apiFetch(
      isEdit ? `/api/reference-values/${referenceDraft.id}` : '/api/reference-values',
      {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    if (!response.ok) {
      const result = await readJsonResponse<{ message?: string }>(response, 'Справочник')
      throw new Error(result.message || 'Не удалось сохранить справочник.')
    }

    const outcome = await readJsonResponse<{ ok?: boolean; value?: string; reused?: boolean; restored?: boolean }>(response, 'Справочник')
    setReferenceDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    await Promise.all([
      loadReferencesData(true),
      loadReferenceItems(referenceKind, true),
      loadReferenceKindCounts([referenceKind], true),
    ])
    setMessage(outcome.reused
      ? `Значение «${outcome.value || value}» уже существует — используем его, дубль не создавали.`
      : outcome.restored
        ? `Значение «${outcome.value || value}» восстановлено в справочнике.`
        : 'Справочник обновлён.')
    return outcome
  }

  async function removeReferenceEntry(id: number) {
    if (!(isAdmin || (canManageWarehouse && ['colors', 'materials', 'lengths', 'sizes', 'childAges'].includes(referenceKind)))) {
      setError('Удаление значений этого справочника доступно только администратору.')
      return
    }

    if (!id) return
    const response = await apiFetch(`/api/reference-values/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: referenceKind }),
    })
    if (!response.ok) {
      const problem = await readJsonResponse<{ message?: string }>(response, 'Справочник')
      throw new Error(problem.message || 'Не удалось отключить значение.')
    }
    if (referenceDraft.id === id) {
      setReferenceDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
    }
    await Promise.all([
      loadReferencesData(true),
      loadReferenceItems(referenceKind, true),
      loadReferenceKindCounts([referenceKind], true),
    ])
    setMessage('Значение отключено.')
  }

  function resetReferenceDraft() {
    setReferenceDraft({ id: 0, value: '', sortOrder: '0', isActive: true })
  }

  function selectReferenceKind(kind: ReferenceKind) {
    setReferenceKind(kind)
    setReferenceItems(referenceItemsCache[kind] || [])
    setReferenceSearch('')
    setReferenceStatusFilter('all')
    resetReferenceDraft()
    void loadReferenceItems(kind, !referenceItemsCache[kind])
  }

  return {
    loadReferencesData,
    loadReferenceKindCounts,
    loadReferenceItems,
    saveReferenceEntry,
    removeReferenceEntry,
    resetReferenceDraft,
    selectReferenceKind,
  }
}
