import { useState } from 'react'

type RetirementHistoryRow = {
  id: number
  historySource: 'operation' | 'granular'
  entityType: 'execution' | 'product' | 'group' | 'variant'
  entityId: number
  productId: number
  productName: string
  material: string | null
  length: string | null
  category: string | null
  gender: string | null
  color: string | null
  sizeLabel: string | null
  variantCount: number
  physicalQuantity: number
  reservedQuantity: number
  createdAt: string
  completedAt: string | null
  restoredAt: string | null
  restorePending: boolean
  workingAgain: boolean
  restorable: boolean
}

type Props = {
  onCatalogChanged?: () => void | boolean | Promise<void | boolean>
}

const executionLabelFor = (row: RetirementHistoryRow) => {
  const material = String(row.material || 'СТАНДАРТ')
  const length = String(row.length || 'СТАНДАРТ')
  return material === 'СТАНДАРТ' && length === 'СТАНДАРТ'
    ? 'Основное исполнение'
    : material === 'СТАНДАРТ'
      ? `Длина: ${length}`
      : length === 'СТАНДАРТ'
        ? material
        : `${material} · ${length}`
}

const labelFor = (row: RetirementHistoryRow) => {
  if (row.entityType === 'product') return row.productName
  const execution = executionLabelFor(row)
  if (row.entityType === 'execution') return `${row.productName} — ${execution}`
  const category = row.category === 'child' ? 'Детский' : 'Взрослый'
  const identity = [row.color || 'Цвет не указан', row.gender || 'Пол не указан', category]
  if (row.entityType === 'variant') {
    identity.push(`${row.category === 'child' ? 'возраст' : 'размер'} ${row.sizeLabel || '—'}`)
  }
  return `${row.productName} — ${execution} · ${identity.join(' · ')}`
}

const typeLabelFor = (row: RetirementHistoryRow) => {
  if (row.entityType === 'product') return 'Товар'
  if (row.entityType === 'execution') return 'Исполнение'
  if (row.entityType === 'group') return 'Группа'
  return 'Точная позиция'
}

const formatMoment = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

async function readJson(response: Response) {
  const text = await response.text()
  if (!text) return { ok: response.ok }
  try {
    return JSON.parse(text)
  } catch {
    return { ok: response.ok, message: response.ok ? '' : 'Не удалось получить ответ сервера.' }
  }
}

export function CatalogRetirementHistory({ onCatalogChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<RetirementHistoryRow[]>([])
  const [busy, setBusy] = useState(false)
  const [restoringId, setRestoringId] = useState(0)
  const [confirmRow, setConfirmRow] = useState<RetirementHistoryRow | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/catalog/retirements?limit=40', {
        credentials: 'include',
        cache: 'no-store',
      })
      const result = await readJson(response)
      if (!response.ok || result?.ok === false) {
        setError(result?.message || 'Не удалось загрузить историю удалений.')
        return false
      }
      setRows(Array.isArray(result?.rows) ? result.rows : [])
      return true
    } catch {
      setError('Не удалось загрузить историю удалений. Проверьте соединение и попробуйте снова.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const openHistory = async () => {
    setOpen(true)
    setNotice('')
    setConfirmRow(null)
    await load()
  }

  const restore = async () => {
    if (!confirmRow?.restorable || restoringId) return
    setRestoringId(confirmRow.id)
    setError('')
    setNotice('')
    try {
      const requestId = `catalog-retirement-restore-${confirmRow.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`
      const response = await fetch(`/api/catalog/retirements/${encodeURIComponent(String(confirmRow.id))}/restore`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      const result = await readJson(response)
      if (!response.ok || result?.ok === false) {
        setError(result?.message || 'Не удалось восстановить позицию.')
        return
      }
      setConfirmRow(null)
      setNotice('Восстановлено в рабочий каталог. Старые остатки и резервы не возвращались.')
      await onCatalogChanged?.()
      await load()
    } catch {
      setError('Не удалось подтвердить восстановление. Обновите страницу перед повторной попыткой.')
    } finally {
      setRestoringId(0)
    }
  }

  return (
    <>
      <button className="secondary compact" type="button" onClick={() => void openHistory()}>
        Удалённые
      </button>

      {open ? (
        <div className="modal-backdrop catalog-retirement-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !restoringId) setOpen(false)
        }}>
          <section className="modal-card catalog-retirement-history-modal" role="dialog" aria-modal="true" aria-labelledby="catalog-retirement-history-title">
            <div className="catalog-retirement-history-head">
              <div>
                <span className="card-label">История каталога</span>
                <h3 id="catalog-retirement-history-title">Удалённые товары и позиции</h3>
                <p>Здесь собраны удаления товара, исполнения, группы и точной SKU. Товар/исполнение можно безопасно восстановить; локальные удаления остаются историей и не оживляют старый остаток.</p>
              </div>
              <button className="secondary compact" type="button" disabled={Boolean(restoringId)} onClick={() => setOpen(false)}>Закрыть</button>
            </div>

            {notice ? <div className="catalog-retirement-history-notice" role="status">{notice}</div> : null}
            {error ? <div className="catalog-retirement-modal-error" role="alert">{error}</div> : null}

            <div className="catalog-retirement-history-list">
              {busy ? <div className="empty-state compact-empty">Загружаю историю…</div> : null}
              {!busy && !rows.length ? <div className="empty-state compact-empty">Удалённых товаров и позиций пока нет.</div> : null}
              {!busy ? rows.map((row) => {
                const working = Boolean(row.workingAgain)
                const restorePending = Boolean(row.restorePending)
                return (
                  <article className="catalog-retirement-history-row" key={`${row.historySource}-${row.id}`}>
                    <div className="catalog-retirement-history-copy">
                      <strong>{labelFor(row)}</strong>
                      <span>{typeLabelFor(row)} · удалено {formatMoment(row.completedAt || row.createdAt)}</span>
                      <small>
                        {row.restorable
                          ? `${row.variantCount} поз. · было физически ${row.physicalQuantity} · в резерве ${row.reservedQuantity}`
                          : `${row.variantCount} поз. · история заказов и движений сохранена`}
                      </small>
                    </div>
                    <div className="catalog-retirement-history-actions">
                      {!row.restorable ? (
                        <span className="soft-badge">{working ? 'Есть новая рабочая версия' : 'Локальное удаление'}</span>
                      ) : working ? (
                        <span className="soft-badge">{row.restoredAt ? 'Восстановлено' : 'Снова в каталоге'}</span>
                      ) : (
                        <>
                          {restorePending ? <span className="soft-badge">Восстановление не завершено</span> : null}
                          <button className="secondary compact" type="button" disabled={Boolean(restoringId)} onClick={() => { setConfirmRow(row); setError(''); setNotice('') }}>
                            {restorePending ? 'Продолжить' : 'Восстановить'}
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                )
              }) : null}
            </div>

            {confirmRow ? (
              <div className="catalog-retirement-restore-confirm">
                <strong>{confirmRow.restorePending ? 'Продолжить восстановление?' : 'Вернуть в рабочий каталог?'}</strong>
                <p><b>{labelFor(confirmRow)}</b> {confirmRow.restorePending ? 'будет безопасно довосстановлен' : 'будет создан заново'} как рабочая версия.</p>
                <p>Старые заказы и история останутся привязаны к удалённой версии. Физический остаток и резерв начнутся с нуля.</p>
                <div className="modal-actions">
                  <button className="primary" type="button" disabled={Boolean(restoringId)} onClick={() => void restore()}>
                    {restoringId ? 'Восстанавливаю…' : confirmRow.restorePending ? 'Продолжить' : 'Восстановить'}
                  </button>
                  <button className="secondary" type="button" disabled={Boolean(restoringId)} onClick={() => setConfirmRow(null)}>Отмена</button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}
    </>
  )
}
