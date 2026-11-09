import type { Dispatch, SetStateAction } from 'react'
import type { ArchivePreviewResponse } from '../../app/types'
import { formatDateShort, formatMoney, getClosedArchiveMonth, monthEndFromInput, monthLabelFromInput, monthStartFromInput } from '../../app/utils'

export type ArchiveMonthDraft = {
  month: string
  cutoffDate: string
  includeNotSent: boolean
  reason: string
}

type Props = {
  archiveDraft: ArchiveMonthDraft
  archivePreview: ArchivePreviewResponse | null
  archiveBusy: boolean
  setArchiveDraft: Dispatch<SetStateAction<ArchiveMonthDraft>>
  setArchivePreview: Dispatch<SetStateAction<ArchivePreviewResponse | null>>
  setArchiveModalOpen: Dispatch<SetStateAction<boolean>>
  loadArchivePreview: () => Promise<unknown>
  runArchiveOrders: () => Promise<unknown>
}

// Preserve the two-step preview/confirmation UI; the server owns deletion
// eligibility and the App still owns the actual archive mutation.
export function ArchiveMonthModal({
  archiveDraft,
  archivePreview,
  archiveBusy,
  setArchiveDraft,
  setArchivePreview,
  setArchiveModalOpen,
  loadArchivePreview,
  runArchiveOrders,
}: Props) {
  return (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setArchiveModalOpen(false) }}>
          <section className="modal-card archive-month-modal" role="dialog" aria-modal="true" aria-label="Архив месяца">
            <div className="modal-head">
              <div>
                <div className="card-label">Архив месяца</div>
                <h3>Убрать закрытый месяц из работы</h3>
                <p>Заказы не удаляются: они остаются в клиентах, отчётах и истории. Архив просто убирает закрытые записи из ежедневной таблицы.</p>
              </div>
              <button className="ghost compact" type="button" onClick={() => setArchiveModalOpen(false)}>Закрыть</button>
            </div>

            <div className="archive-month-controls">
              <label>
                <span>Месяц</span>
                <input
                  type="month"
                  max={getClosedArchiveMonth().value}
                  value={archiveDraft.month}
                  onChange={(event) => {
                    const month = event.target.value || getClosedArchiveMonth().value
                    setArchiveDraft((draft) => ({
                      ...draft,
                      month,
                      cutoffDate: monthEndFromInput(month),
                      reason: `Закрытие месяца: ${monthLabelFromInput(month)}`,
                    }))
                    setArchivePreview(null)
                  }}
                />
              </label>
              <div className="archive-month-range">
                <span>Период</span>
                <strong>{formatDateShort(monthStartFromInput(archiveDraft.month))} — {formatDateShort(monthEndFromInput(archiveDraft.month))}</strong>
              </div>
              <label className="checkbox-row archive-checkbox">
                <input
                  type="checkbox"
                  checked={archiveDraft.includeNotSent}
                  onChange={(event) => {
                    setArchiveDraft((draft) => ({ ...draft, includeNotSent: event.target.checked }))
                    setArchivePreview(null)
                  }}
                />
                <span>Разрешить закрытые, но не отправленные заказы</span>
              </label>
            </div>

            <div className="archive-month-message">
              {!archivePreview ? (
                <span>Сначала проверьте месяц. Система покажет, мешают ли долги, активный цех или неотправленные заказы.</span>
              ) : archivePreview.blocked.withDebt === 0 ? (
                <span className="is-good">Долги по выбранному месяцу закрыты. Можно архивировать подходящие заказы.</span>
              ) : (
                <span className="is-warning">Есть незакрытые долги: {archivePreview.blocked.withDebt}. Лучше закрыть их перед архивацией.</span>
              )}
            </div>

            {archivePreview ? (
              <div className="archive-preview-box">
                <div className="archive-preview-title">
                  <strong>Предпросмотр</strong>
                  <span>{archivePreview.eligibleCount ? `Можно архивировать: ${archivePreview.eligibleCount}` : 'Пока нечего архивировать'}</span>
                </div>
                <div className="archive-preview-stats">
                  <div className="is-good"><span>Готово</span><strong>{archivePreview.eligibleCount}</strong></div>
                  <div><span>Не закрыты</span><strong>{archivePreview.blocked.notClosed}</strong></div>
                  <div><span>С долгом</span><strong>{archivePreview.blocked.withDebt}</strong></div>
                  <div><span>Цех активен</span><strong>{archivePreview.blocked.activeWorkshop}</strong></div>
                  <div><span>Не отправлены</span><strong>{archivePreview.blocked.notSent}</strong></div>
                </div>
                <div className="archive-preview-list">
                  {(archivePreview.orders || []).slice(0, 10).map((order) => (
                    <div className="archive-preview-item" key={`archive-modal-${order.id}`}>
                      <strong>{order.externalId}</strong>
                      <span>{formatDateShort(order.orderDate)} · {order.manager || '—'} · {formatMoney(order.totalAmount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => void loadArchivePreview()} disabled={archiveBusy}>
                {archiveBusy ? 'Проверяю...' : 'Проверить месяц'}
              </button>
              <button className="primary" type="button" onClick={() => void runArchiveOrders()} disabled={archiveBusy || !archivePreview?.eligibleCount}>
                Архивировать месяц
              </button>
            </div>
          </section>
        </div>
  )
}
