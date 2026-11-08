import type { Dispatch, SetStateAction } from 'react'
import type { InventoryAuditResponse, InventoryControlSettings, InventoryMovementRecord, InventoryResponse, InventorySourceKey } from '../../app/types'
import { readJsonResponse } from '../../app/utils'

type WarehouseGovernanceArgs = {
  canManageWarehouse: boolean
  inventoryAuditBusy: boolean
  setInventoryAuditBusy: Dispatch<SetStateAction<boolean>>
  setInventoryAudit: Dispatch<SetStateAction<InventoryAuditResponse | null>>
  inventoryControlBusy: boolean
  setInventoryControlBusy: Dispatch<SetStateAction<boolean>>
  inventoryControlSettings: InventoryControlSettings | null
  setInventoryControlSettings: Dispatch<SetStateAction<InventoryControlSettings | null>>
  reversingInventoryMovementId: number | null
  setReversingInventoryMovementId: Dispatch<SetStateAction<number | null>>
  apiFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string | null>>
  loadInventoryData: (source: InventorySourceKey, force?: boolean, query?: string, includeMovements?: boolean) => Promise<InventoryResponse | null>
}

// Preserve exact permission gates, confirmation text and post-write refresh semantics.
export function createWarehouseGovernanceActions({
  canManageWarehouse,
  inventoryAuditBusy,
  setInventoryAuditBusy,
  setInventoryAudit,
  inventoryControlBusy,
  setInventoryControlBusy,
  inventoryControlSettings,
  setInventoryControlSettings,
  reversingInventoryMovementId,
  setReversingInventoryMovementId,
  apiFetch,
  setError,
  setMessage,
  loadInventoryData,
}: WarehouseGovernanceArgs) {
  async function loadInventoryAudit() {
    setInventoryAuditBusy(true)
    try {
      const response = await apiFetch('/api/inventory/audit')
      if (!response.ok) return null
      const data = await readJsonResponse<InventoryAuditResponse>(response, 'Проверка автосписания')
      setInventoryAudit(data)
      return data
    } finally {
      setInventoryAuditBusy(false)
    }
  }

  async function resolveInventoryAuditIssue(row: InventoryAuditResponse['missing'][number] | InventoryAuditResponse['resolved'][number], resolved = true) {
    if (!canManageWarehouse || inventoryAuditBusy || !row?.issueKey) return
    if (resolved) {
      const question = 'Подтверждайте расхождение только после фактической сверки этой позиции. Система НЕ изменит остаток автоматически — она запомнит, что исторический разрыв проверен сотрудником. Продолжить?'
      if (!window.confirm(question)) return
    }
    setInventoryAuditBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/inventory/audit/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueKey: row.issueKey,
          resolved,
          comment: resolved ? 'Фактический остаток проверен сотрудником после сверки.' : 'Проблема возвращена в активную проверку.',
        }),
      })
      if (!response.ok) throw new Error('Не удалось сохранить результат сверки.')
      const data = await readJsonResponse<InventoryAuditResponse>(response, 'Результат сверки склада')
      setInventoryAudit(data)
      setMessage(resolved ? 'Расхождение отмечено как проверенное. Остаток автоматически не изменялся.' : 'Расхождение снова требует проверки.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось сохранить результат сверки.')
    } finally {
      setInventoryAuditBusy(false)
    }
  }

  async function loadInventoryControlSettings() {
    const response = await apiFetch('/api/inventory/settings')
    if (!response.ok) return null
    const data = await readJsonResponse<InventoryControlSettings>(response, 'Настройки склада')
    setInventoryControlSettings(data)
    return data
  }

  async function toggleInventoryAutoWriteoff() {
    if (!canManageWarehouse || inventoryControlBusy) return
    const nextEnabled = !(inventoryControlSettings?.autoWriteoffEnabled ?? true)
    const question = nextEnabled
      ? 'Включить автосписание? Новые заказы со склада и бутика снова будут сразу менять остатки.'
      : 'Выключить автосписание? Новые заказы сохранятся, но остатки не изменятся, пока администратор не запустит отложенное списание.'
    if (!window.confirm(question)) return
    setInventoryControlBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/inventory/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoWriteoffEnabled: nextEnabled }),
      })
      const data = await readJsonResponse<InventoryControlSettings>(response, 'Настройки склада')
      setInventoryControlSettings(data)
      setMessage(nextEnabled ? 'Автосписание включено.' : 'Автосписание выключено. Новые заказы не меняют остатки.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось изменить автосписание.')
    } finally {
      setInventoryControlBusy(false)
    }
  }

  async function applyPendingInventoryWriteoffs() {
    if (!canManageWarehouse || inventoryControlBusy) return
    const pending = inventoryControlSettings?.pendingWriteoffCount || 0
    if (!pending) {
      setMessage('Отложенных списаний нет.')
      return
    }
    if (!window.confirm(`Списать остатки по ${pending} отложенным позициям заказов? Заказы не удаляются и не меняются.`)) return
    setInventoryControlBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/api/inventory/pending-writeoffs/apply', { method: 'POST' })
      const data = await readJsonResponse<{ ok: boolean; applied: number; reconciled?: number; pendingWriteoffCount: number }>(response, 'Отложенное списание')
      setInventoryControlSettings((current) => current ? { ...current, pendingWriteoffCount: data.pendingWriteoffCount } : current)
      await Promise.all([
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
      ])
      const reconciled = Number(data.reconciled || 0)
      setMessage(`Списано позиций: ${data.applied}.${reconciled ? ` Уже учтено ранее и безопасно синхронизировано: ${reconciled}.` : ''} Осталось: ${data.pendingWriteoffCount}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось выполнить отложенное списание.')
    } finally {
      setInventoryControlBusy(false)
    }
  }

  async function reverseInventoryMovement(movement: InventoryMovementRecord) {
    if (!canManageWarehouse || !movement.canReverse || reversingInventoryMovementId) return
    const label = `${movement.productName} · ${movement.quantityDelta >= 0 ? '+' : ''}${movement.quantityDelta}`
    if (!window.confirm(`Отменить складскую операцию «${label}»? Остаток будет восстановлен обратным движением. Заказ, возврат или обмен останется в системе.`)) return
    setReversingInventoryMovementId(movement.id)
    setError(null)
    try {
      const response = await apiFetch(`/api/inventory/movements/${movement.id}/reverse?returnInventory=0`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: 'Отменено из журнала склада' }),
      })
      const data = await readJsonResponse<{ ok: boolean; reversedRows: number }>(response, 'Отмена складской операции')
      await Promise.all([
        loadInventoryData('warehouse', true, '', false),
        loadInventoryData('boutique', true, '', false),
        loadInventoryControlSettings(),
      ])
      setMessage(`Операция отменена. Восстановлено движений: ${data.reversedRows}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отменить складскую операцию.')
    } finally {
      setReversingInventoryMovementId(null)
    }
  }


  return {
    loadInventoryAudit,
    resolveInventoryAuditIssue,
    loadInventoryControlSettings,
    toggleInventoryAutoWriteoff,
    applyPendingInventoryWriteoffs,
    reverseInventoryMovement,
  }
}
