import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { formatMoney, readJsonResponse } from '../../app/utils'

export type DatabaseStorageMonth = {
  month: string
  label: string
  orderCount: number
  totalAmount: number
  receivedAmount: number
  returnAmount: number
  debtOrderCount: number
  unsentOrderCount: number
  liveWorkshopTaskCount: number
  recentLinkedOperationCount: number
  activeReservationCount: number
  pendingLifecycleCount: number
  canDelete: boolean
  blockedReasons: string[]
}

export type DatabaseStorageStatus = {
  ok: boolean
  currentSizeBytes: number
  limitBytes: number
  usagePercent: number
  warningLevel: 'normal' | 'warning' | 'critical'
  cleanupThresholdPercent: number
  cleanupAllowed: boolean
  cleanupThresholdReached?: boolean
  activeStocktakeCount?: number
  cleanupBlockedReason?: string
  capacityLabel: string
  retentionMonths: number
  maxSelectedMonths: number
  months: DatabaseStorageMonth[]
  activeCleanup?: {
    months: string[]
    currentMonth: string
    initialOrders: number
    remainingOrders: number
    startedAt: string
  } | null
  lastCleanup?: {
    months: string[]
    deletedOrders: number
    completedAt: string
    sizeBeforeBytes: number
    sizeAfterBytes: number
  } | null
}

type CleanupStartResponse = {
  ok: boolean
  operationToken: string
  months: string[]
  initialOrders: number
  remainingOrders: number
  message?: string
}

type CleanupContinueResponse = {
  ok: boolean
  done: boolean
  months: string[]
  currentMonth: string
  completedMonths: string[]
  initialOrders: number
  deletedOrders: number
  deletedThisBatch: number
  remainingOrders: number
  sizeAfterBytes?: number
  message?: string
}

type CapacityResponse = {
  ok: boolean
  limitBytes: number
  capacityLabel: string
  message?: string
}

type StorageMaintenanceArgs = {
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  isAdmin: boolean
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
}

export type DatabaseStorageMaintenanceController = ReturnType<typeof useDatabaseStorageMaintenance>

function formatBytes(value: number) {
  const bytes = Math.max(0, Number(value || 0))
  if (bytes < 1000) return `${Math.round(bytes)} Б`
  if (bytes < 1000 ** 2) return `${(bytes / 1000).toFixed(1)} КБ`
  if (bytes < 1000 ** 3) return `${(bytes / 1000 ** 2).toFixed(1)} МБ`
  return `${(bytes / 1000 ** 3).toFixed(2)} ГБ`
}

function cleanupConfirmText(months: string[]) {
  return `УДАЛИТЬ ${[...months].sort().join(' ')}`
}

export function useDatabaseStorageMaintenance({ apiFetch, isAdmin, setError, setMessage }: StorageMaintenanceArgs) {
  const [status, setStatus] = useState<DatabaseStorageStatus | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [capacityBusy, setCapacityBusy] = useState(false)
  const [selectedMonths, setSelectedMonths] = useState<string[]>([])
  const [confirmation, setConfirmation] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [reportsConfirmed, setReportsConfirmed] = useState(false)
  const [progress, setProgress] = useState<CleanupContinueResponse | null>(null)
  const [capacityDraft, setCapacityDraft] = useState(500_000_000)
  const [capacityPassword, setCapacityPassword] = useState('')

  const loadStatus = useCallback(async (includeMonths = false) => {
    if (!isAdmin) return null
    setBusy(true)
    try {
      const response = await apiFetch(`/api/admin/storage${includeMonths ? '?months=1' : ''}`)
      const data = await readJsonResponse<DatabaseStorageStatus>(response, 'Хранилище базы')
      setStatus(data)
      setCapacityDraft(data.limitBytes)
      if (includeMonths) {
        setSelectedMonths((current) => {
          if (data.activeCleanup?.months?.length) return [...data.activeCleanup.months]
          const available = new Set(data.months.map((entry) => entry.month))
          return current.filter((month) => available.has(month))
        })
      }
      return data
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось проверить размер базы.')
      return null
    } finally {
      setBusy(false)
    }
  }, [apiFetch, isAdmin, setError])

  useEffect(() => {
    if (!isAdmin) {
      setStatus(null)
      setOpen(false)
      return
    }
    void loadStatus(false)
    const timer = window.setInterval(() => { void loadStatus(false) }, 30 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [isAdmin, loadStatus])

  const openPanel = useCallback(() => {
    if (!isAdmin) return
    setOpen(true)
    void loadStatus(true)
  }, [isAdmin, loadStatus])

  const hidePanelForReports = useCallback(() => {
    if (deleting || capacityBusy) return
    setOpen(false)
  }, [capacityBusy, deleting])

  const closePanel = useCallback(() => {
    if (deleting || capacityBusy) return
    setOpen(false)
    setSelectedMonths([])
    setConfirmation('')
    setCurrentPassword('')
    setCapacityPassword('')
    setReportsConfirmed(false)
    setProgress(null)
  }, [capacityBusy, deleting])

  const toggleMonth = useCallback((month: string) => {
    setSelectedMonths((current) => {
      const next = current.includes(month) ? current.filter((value) => value !== month) : [...current, month]
      return next.sort()
    })
    setConfirmation('')
    setCurrentPassword('')
    setReportsConfirmed(false)
    setProgress(null)
  }, [])

  const selectAllEligible = useCallback(() => {
    const eligible = (status?.months || []).filter((entry) => entry.canDelete).slice(0, status?.maxSelectedMonths || 24).map((entry) => entry.month)
    setSelectedMonths(eligible)
    setConfirmation('')
    setCurrentPassword('')
    setReportsConfirmed(false)
    setProgress(null)
  }, [status?.maxSelectedMonths, status?.months])

  const clearSelection = useCallback(() => {
    setSelectedMonths([])
    setConfirmation('')
    setCurrentPassword('')
    setReportsConfirmed(false)
    setProgress(null)
  }, [])

  const selectedMonthInfos = useMemo(() => {
    const selected = new Set(selectedMonths)
    return (status?.months || []).filter((entry) => selected.has(entry.month)).sort((a, b) => a.month.localeCompare(b.month))
  }, [selectedMonths, status?.months])

  const selectedOrdersCount = selectedMonthInfos.reduce((sum, entry) => sum + entry.orderCount, 0)
  const expectedConfirmation = cleanupConfirmText(selectedMonths)
  const canSubmit = Boolean(
    status?.cleanupAllowed
    && selectedMonthInfos.length > 0
    && selectedMonthInfos.length === selectedMonths.length
    && selectedMonthInfos.every((entry) => entry.canDelete)
    && selectedMonths.length <= (status?.maxSelectedMonths || 24)
    && confirmation.trim().toUpperCase() === expectedConfirmation
    && currentPassword
    && reportsConfirmed
    && !deleting,
  )

  const updateCapacity = useCallback(async () => {
    if (!capacityPassword || capacityBusy) return
    setCapacityBusy(true)
    setError(null)
    setMessage(null)
    try {
      const response = await apiFetch('/api/admin/storage/capacity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limitBytes: capacityDraft, currentPassword: capacityPassword }),
      })
      const data = await readJsonResponse<CapacityResponse>(response, 'Доступный объём базы')
      setCapacityPassword('')
      setMessage(data.message || `Доступный объём базы обновлён: ${data.capacityLabel}.`)
      await loadStatus(true)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось обновить доступный объём базы.')
    } finally {
      setCapacityBusy(false)
    }
  }, [apiFetch, capacityBusy, capacityDraft, capacityPassword, loadStatus, setError, setMessage])

  const deleteSelectedMonths = useCallback(async () => {
    if (!selectedMonths.length || !canSubmit) return
    setDeleting(true)
    setError(null)
    setMessage(null)
    setProgress(null)
    try {
      const startResponse = await apiFetch('/api/admin/storage/cleanup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ months: selectedMonths, confirmation, currentPassword, reportsConfirmed }),
      })
      const started = await readJsonResponse<CleanupStartResponse>(startResponse, 'Подготовка удаления старых месяцев')
      const token = started.operationToken
      let lastResult: CleanupContinueResponse | null = null
      while (true) {
        const continueResponse = await apiFetch('/api/admin/storage/cleanup/continue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationToken: token }),
        })
        lastResult = await readJsonResponse<CleanupContinueResponse>(continueResponse, 'Удаление старых месяцев')
        setProgress(lastResult)
        if (lastResult.done) break
        await new Promise((resolve) => window.setTimeout(resolve, 100))
      }
      setCurrentPassword('')
      setConfirmation('')
      setReportsConfirmed(false)
      setSelectedMonths([])
      await loadStatus(true)
      setMessage(lastResult?.message || `Очистка завершена. Удалено заказов: ${lastResult?.deletedOrders || 0}.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось удалить старые данные.')
      await loadStatus(true)
    } finally {
      setDeleting(false)
    }
  }, [apiFetch, canSubmit, confirmation, currentPassword, loadStatus, reportsConfirmed, selectedMonths, setError, setMessage])

  return {
    status,
    open,
    busy,
    deleting,
    capacityBusy,
    selectedMonths,
    selectedMonthInfos,
    selectedOrdersCount,
    confirmation,
    currentPassword,
    reportsConfirmed,
    progress,
    capacityDraft,
    capacityPassword,
    expectedConfirmation,
    canSubmit,
    openPanel,
    closePanel,
    hidePanelForReports,
    loadStatus,
    toggleMonth,
    selectAllEligible,
    clearSelection,
    setConfirmation,
    setCurrentPassword,
    setReportsConfirmed,
    setCapacityDraft,
    setCapacityPassword,
    updateCapacity,
    deleteSelectedMonths,
  }
}

export function DatabaseStorageWarning({ maintenance }: { maintenance: DatabaseStorageMaintenanceController }) {
  const status = maintenance.status
  if (!status || status.warningLevel === 'normal') return null
  const critical = status.warningLevel === 'critical'
  return (
    <div className={`storage-warning-banner ${critical ? 'is-critical' : ''}`} role="alert">
      <div>
        <strong>{critical ? 'В базе почти не осталось места' : 'Хранилище базы заполняется'}</strong>
        <span>Использовано {status.usagePercent.toFixed(1)}%: {formatBytes(status.currentSizeBytes)} из {formatBytes(status.limitBytes)}.</span>
      </div>
      <button className={critical ? 'danger compact' : 'secondary compact'} type="button" onClick={maintenance.openPanel}>Открыть очистку</button>
    </div>
  )
}

export function DatabaseStorageModal({
  maintenance,
  onOpenReports,
}: {
  maintenance: DatabaseStorageMaintenanceController
  onOpenReports: (months: string[]) => void
}) {
  if (!maintenance.open) return null
  const status = maintenance.status
  const progressPercent = maintenance.progress?.initialOrders
    ? Math.min(100, Math.max(0, (maintenance.progress.deletedOrders / maintenance.progress.initialOrders) * 100))
    : 0
  const selectedLabels = maintenance.selectedMonthInfos.map((entry) => entry.label).join(', ')

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card storage-maintenance-modal" role="dialog" aria-modal="true" aria-label="Хранилище этой системы">
        <div className="modal-head">
          <div>
            <div className="card-label">Только для администратора</div>
            <h3>Хранилище этой системы</h3>
            <p>Здесь показаны данные только этой системы. Вторая система хранит данные отдельно и очищается независимо.</p>
          </div>
          <button className="secondary compact" type="button" onClick={maintenance.closePanel} disabled={maintenance.deleting || maintenance.capacityBusy}>Закрыть</button>
        </div>

        {status ? (
          <>
            <div className={`storage-usage-card is-${status.warningLevel}`}>
              <div className="storage-usage-head">
                <div><span>Использовано</span><strong>{status.usagePercent.toFixed(2)}%</strong></div>
                <div><span>Размер базы</span><strong>{formatBytes(status.currentSizeBytes)} / {formatBytes(status.limitBytes)}</strong></div>
              </div>
              <div className="storage-meter" aria-label={`База заполнена на ${status.usagePercent.toFixed(2)} процента`}><i style={{ width: `${Math.min(100, status.usagePercent)}%` }} /></div>
              <small>Очистка открывается после {status.cleanupThresholdPercent}%.</small>
            </div>

            <div className="storage-capacity-card">
              <div>
                <strong>Настроенный лимит этой базы</strong>
                <span>Сейчас: {status.capacityLabel}. Эта настройка нужна только для предупреждений и очистки — она не меняет тариф или лимиты Cloudflare.</span>
              </div>
              <select value={maintenance.capacityDraft} onChange={(event) => maintenance.setCapacityDraft(Number(event.target.value))} disabled={maintenance.capacityBusy || maintenance.deleting}>
                <option value={500_000_000}>500 МБ</option>
                <option value={10_000_000_000}>10 ГБ</option>
              </select>
              <input type="password" value={maintenance.capacityPassword} onChange={(event) => maintenance.setCapacityPassword(event.target.value)} placeholder="Текущий пароль" autoComplete="current-password" disabled={maintenance.capacityBusy || maintenance.deleting} />
              <button className="secondary compact" type="button" onClick={() => void maintenance.updateCapacity()} disabled={!maintenance.capacityPassword || maintenance.capacityBusy || maintenance.deleting}>
                {maintenance.capacityBusy ? 'Сохраняю...' : 'Обновить объём'}
              </button>
            </div>

            {status.cleanupBlockedReason ? (
              <div className="storage-resume-note"><strong>Очистка временно недоступна</strong><span>{status.cleanupBlockedReason}</span></div>
            ) : !status.cleanupAllowed ? (
              <div className="storage-safe-note"><strong>Сейчас удаление не требуется</strong><span>До порога очистки достаточно места. Предупреждение для администратора появится только после реального достижения порога.</span></div>
            ) : (
              <div className="storage-danger-note"><strong>Перед удалением сохраните важные отчёты</strong><span>Удаляются детали только выбранных старых заказов. Перед удалением система сохраняет краткую историю заказа: номер, дату, клиента, суммы и список товаров. Она продолжит учитываться в истории клиента и будет находиться по точному номеру заказа. Текущий каталог, физические остатки, активные резервы и ревизии не очищаются.</span></div>
            )}

            {status.activeCleanup ? (
              <div className="storage-resume-note">
                <strong>Есть незавершённая очистка</strong>
                <span>Месяцы: {status.activeCleanup.months.join(', ')}. Сейчас обрабатывается {status.activeCleanup.currentMonth}; осталось заказов: {status.activeCleanup.remainingOrders}. Выберите те же месяцы и повторите подтверждение.</span>
              </div>
            ) : null}

            <div className="storage-month-list">
              <div className="storage-month-list-head">
                <div><h4>Старые месяцы</h4><p>Можно выбрать несколько месяцев. Текущий год, последние {status.retentionMonths} месяцев, активные резервы, незавершённые возвраты/обмены и месяцы с недавними операциями защищены.</p></div>
                <div className="storage-month-actions">
                  <button className="secondary compact" type="button" onClick={maintenance.selectAllEligible} disabled={maintenance.deleting}>Выбрать доступные</button>
                  <button className="secondary compact" type="button" onClick={maintenance.clearSelection} disabled={maintenance.deleting || !maintenance.selectedMonths.length}>Снять выбор</button>
                  <button className="secondary compact" type="button" onClick={() => void maintenance.loadStatus(true)} disabled={maintenance.busy || maintenance.deleting}>{maintenance.busy ? 'Проверяю...' : 'Обновить'}</button>
                </div>
              </div>

              {status.months.length ? status.months.map((entry) => {
                const selected = maintenance.selectedMonths.includes(entry.month)
                return (
                  <label className={`storage-month-card ${selected ? 'is-selected' : ''} ${!entry.canDelete ? 'is-disabled' : ''}`} key={entry.month}>
                    <input type="checkbox" checked={selected} disabled={!entry.canDelete || maintenance.deleting || (!selected && maintenance.selectedMonths.length >= status.maxSelectedMonths)} onChange={() => maintenance.toggleMonth(entry.month)} />
                    <span className="storage-month-main">
                      <strong>{entry.label}</strong>
                      <span>Заказов: {entry.orderCount} · Продажи: {formatMoney(entry.totalAmount)} · Возвраты: {formatMoney(entry.returnAmount)}</span>
                      {entry.canDelete ? <em>Все операции месяца завершены</em> : <em className="is-blocked">Нельзя удалить: {entry.blockedReasons.join(', ')}</em>}
                    </span>
                  </label>
                )
              }) : <div className="empty-state">Нет старых месяцев, которые подходят по сроку хранения.</div>}
            </div>

            {maintenance.selectedMonthInfos.length ? (
              <div className="storage-delete-confirmation">
                <div>
                  <div className="card-label">Необратимое удаление</div>
                  <h4>Выбрано месяцев: {maintenance.selectedMonthInfos.length} · заказов: {maintenance.selectedOrdersCount}</h4>
                  <p>{selectedLabels}</p>
                </div>
                <button className="secondary" type="button" onClick={() => onOpenReports(maintenance.selectedMonths)} disabled={maintenance.deleting}>Открыть отчёты от первого до последнего выбранного месяца</button>
                <label className="storage-confirm-check"><input type="checkbox" checked={maintenance.reportsConfirmed} onChange={(event) => maintenance.setReportsConfirmed(event.target.checked)} disabled={maintenance.deleting} /><span>Нужные отчёты сохранены</span></label>
                <label><span>Текущий пароль администратора</span><input type="password" value={maintenance.currentPassword} onChange={(event) => maintenance.setCurrentPassword(event.target.value)} disabled={maintenance.deleting} autoComplete="current-password" /></label>
                <label><span>Введите подтверждение</span><input value={maintenance.confirmation} onChange={(event) => maintenance.setConfirmation(event.target.value.toUpperCase())} disabled={maintenance.deleting} placeholder={maintenance.expectedConfirmation} /></label>
                <code>{maintenance.expectedConfirmation}</code>
                {maintenance.progress ? (
                  <div className="storage-cleanup-progress">
                    <div><span>Удалено заказов: {maintenance.progress.deletedOrders} из {maintenance.progress.initialOrders} · текущий месяц: {maintenance.progress.currentMonth}</span><strong>{progressPercent.toFixed(0)}%</strong></div>
                    <div className="storage-meter"><i style={{ width: `${progressPercent}%` }} /></div>
                  </div>
                ) : null}
                <button className="danger" type="button" disabled={!maintenance.canSubmit} onClick={() => void maintenance.deleteSelectedMonths()}>
                  {maintenance.deleting ? 'Удаляю безопасными частями...' : `Удалить выбранные месяцы (${maintenance.selectedMonthInfos.length})`}
                </button>
              </div>
            ) : null}
          </>
        ) : <div className="empty-state">{maintenance.busy ? 'Проверяю хранилище...' : 'Не удалось получить данные хранилища.'}</div>}
      </section>
    </div>
  )
}
