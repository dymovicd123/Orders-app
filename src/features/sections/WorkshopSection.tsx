// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'
type SectionContext = Record<string, any>

export function WorkshopSection({ ctx }: { ctx: SectionContext }) {
  const {
    activeWorkshopTasks,
    applyWorkshopPeriodPreset,
    copyWorkshopInvoiceText,
    downloadWorkshopInvoicePdf,
    exportWorkshopInvoiceWord,
    formatDateShort,
    getPeriodRange,
    getWorkshopInvoiceImportanceLabel,
    markWorkshopTaskDone,
    openWorkshopExchange,
    openWorkshopOrderEditor,
    printWorkshopInvoice,
    restoreWorkshopTaskActive,
    sectorStyle,
    setWorkshopFilters,
    setWorkshopInvoiceMode,
    setWorkshopSortDirection,
    workshopBusy,
    workshopCustomerIdentity,
    workshopData,
    workshopDetailRows,
    workshopFilters,
    workshopInvoiceMode,
    workshopInvoiceRows,
    workshopScopeTasks,
    workshopSortDirection,
  } = ctx

  return (
    <article className="card wide sector-workshop" id="workshop" style={sectorStyle('workshop')}>
              <div className="card-label">Цех</div>
              <div className="card-meta">
                Активные и готовые позиции по умолчанию не ограничены текущим месяцем, поэтому старые незавершённые заказы не исчезают из очереди. Накладная по-прежнему открывается за выбранный период.
              </div>
    
              <div className="workshop-toolbar">
                <div className="order-panel-tabs compact-tabs">
                  {[
                    { value: 'active' as const, label: 'Активные' },
                    { value: 'urgent' as const, label: 'Срочные' },
                    { value: 'invoice' as const, label: 'Накладная' },
                    { value: 'done' as const, label: 'Готовые' },
                  ].map((entry) => (
                    <button
                      key={entry.value}
                      className={`workshop-view-tab ${workshopFilters.view === entry.value ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => {
                        const fallback = getPeriodRange('month')
                        const needsInvoiceRange = entry.value === 'invoice' && (workshopFilters.period === 'all' || !workshopFilters.dateFrom || !workshopFilters.dateTo)
                        const next = {
                          ...workshopFilters,
                          view: entry.value,
                          period: needsInvoiceRange ? 'month' as WorkshopPeriodPreset : workshopFilters.period,
                          dateFrom: needsInvoiceRange ? fallback.dateFrom : workshopFilters.dateFrom,
                          dateTo: needsInvoiceRange ? fallback.dateTo : workshopFilters.dateTo,
                          urgentOnly: entry.value === 'urgent',
                        }
                        if (entry.value === 'done') setWorkshopSortDirection('newest')
                        if (entry.value === 'active' || entry.value === 'urgent') setWorkshopSortDirection('oldest')
                        setWorkshopFilters(next)
                      }}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
    
                <div className="order-panel-tabs compact-tabs">
                  {[
                    { value: 'all' as const, label: 'Все' },
                    { value: 'today' as const, label: 'Сегодня' },
                    { value: 'yesterday' as const, label: 'Вчера' },
                    { value: 'month' as const, label: 'Месяц' },
                    { value: 'custom' as const, label: 'Период' },
                  ].map((entry) => (
                    <button
                      key={entry.value}
                      className={`secondary compact ${workshopFilters.period === entry.value ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => applyWorkshopPeriodPreset(entry.value)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
    
                <div className="order-panel-tabs compact-tabs workshop-sort-tabs">
                  <button type="button" className={`secondary compact ${workshopSortDirection === 'oldest' ? 'is-active' : ''}`} onClick={() => setWorkshopSortDirection('oldest')}>Сначала старые</button>
                  <button type="button" className={`secondary compact ${workshopSortDirection === 'newest' ? 'is-active' : ''}`} onClick={() => setWorkshopSortDirection('newest')}>Сначала новые</button>
                </div>
              </div>
    
              <div className="workshop-filters">
                <label>
                  <span>Поиск</span>
                  <input
                    value={workshopFilters.q}
                    onChange={(event) => setWorkshopFilters((current) => ({ ...current, q: event.target.value }))}
                    placeholder="Заказ, товар, клиент, комментарий"
                  />
                </label>
                <label>
                  <span>С даты</span>
                  <input
                    type="date"
                    value={workshopFilters.dateFrom}
                    onChange={(event) => setWorkshopFilters((current) => ({ ...current, period: 'custom', dateFrom: event.target.value }))}
                  />
                </label>
                <label>
                  <span>По дату</span>
                  <input
                    type="date"
                    value={workshopFilters.dateTo}
                    onChange={(event) => setWorkshopFilters((current) => ({ ...current, period: 'custom', dateTo: event.target.value }))}
                  />
                </label>
                <div className="workshop-auto-note">Фильтры применяются автоматически{workshopBusy ? ' · загрузка…' : ''}. Вкладка “Активные” сортируется только по дате.</div>
              </div>
    
              <div className={`workshop-mode-note workshop-mode-${workshopFilters.view}`}>
                <strong>{workshopFilters.view === 'active' ? 'Активные позиции' : workshopFilters.view === 'urgent' ? 'Срочные активные позиции' : workshopFilters.view === 'done' ? 'Готовые позиции' : 'Накладная цеха'}</strong>
                <span>{workshopFilters.view === 'active' ? 'Список отсортирован только по дате: сначала ранние или сначала поздние. Срочные вынесены в отдельную вкладку.' : workshopFilters.view === 'urgent' ? 'Показываются только срочные и ещё не готовые позиции. Накладную можно скачать сразу из этой вкладки.' : workshopFilters.view === 'done' ? 'Здесь позиции, которые уже отмечены готовыми. Их можно вернуть обратно в активные.' : 'Срочные заказы всегда сверху и целиком, затем заказы с комментариями, обычные одинаковые изделия объединяются.'}</span>
              </div>
    
              <div className="workshop-kpis">
                <div><strong>{workshopData?.activeCount ?? 0}</strong><span>активные</span></div>
                <div><strong>{workshopData?.urgentCount ?? 0}</strong><span>срочные активные</span></div>
                <div><strong>{workshopData?.doneCount ?? 0}</strong><span>готовые</span></div>
                <div><strong>{activeWorkshopTasks.length}</strong><span>в текущем фильтре</span></div>
              </div>
    
              <div className="workshop-bulk-panel workshop-workflow-note">
                <div className="workshop-bulk-main">
                  <strong>Цех редактируется через заказ</strong>
                  <span>Срочность, комментарий и состав позиции меняются в форме редактирования заказа. В таблице цеха оставлены только рабочие действия: открыть заказ и отметить готовность.</span>
                </div>
                {workshopFilters.view === 'invoice' || workshopFilters.view === 'urgent' ? (
                  <div className="workshop-bulk-actions">
                    <button className="secondary compact" type="button" onClick={() => void exportWorkshopInvoiceWord()} disabled={!workshopScopeTasks.length}>
                      Скачать Word
                    </button>
                    <button className="secondary compact" type="button" onClick={() => void downloadWorkshopInvoicePdf()} disabled={!workshopScopeTasks.length}>
                      Скачать PDF
                    </button>
                    <button className="secondary compact" type="button" onClick={printWorkshopInvoice} disabled={!workshopScopeTasks.length}>
                      Печать PDF
                    </button>
                    <button className="secondary compact" type="button" onClick={() => void copyWorkshopInvoiceText()} disabled={!workshopScopeTasks.length}>
                      Копировать накладную
                    </button>
                  </div>
                ) : null}
              </div>
    
              {workshopFilters.view === 'invoice' || workshopFilters.view === 'urgent' ? (
                <div className="workshop-invoice-summary">
                  <div className="workshop-invoice-summary-head">
                    <div>
                      <strong>{workshopFilters.view === 'urgent' ? 'Срочная накладная' : 'Накладная таблицей'}</strong>
                      <span>{workshopFilters.view === 'urgent' ? 'Только срочные активные позиции за выбранный период.' : 'Сначала срочные заказы целиком, затем заказы с комментариями, затем обычные суммированные позиции.'}</span>
                    </div>
                    <span>{workshopInvoiceRows.length} строк · {workshopScopeTasks.reduce((sum, task) => sum + Number(task.quantity || 0), 0)} шт.</span>
                  </div>
                  <div className="workshop-invoice-mode-row">
                    <button
                      className={`secondary compact ${workshopInvoiceMode === 'period' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => {
                        setWorkshopInvoiceMode('period')
                        const fallback = getPeriodRange('month')
                        const next = {
                          ...workshopFilters,
                          view: 'invoice' as WorkshopView,
                          urgentOnly: false,
                          period: (!workshopFilters.dateFrom || !workshopFilters.dateTo) ? 'month' as WorkshopPeriodPreset : workshopFilters.period,
                          dateFrom: workshopFilters.dateFrom || fallback.dateFrom,
                          dateTo: workshopFilters.dateTo || fallback.dateTo,
                        }
                        setWorkshopFilters(next)
                      }}
                    >Все за период</button>
                    <button
                      className={`secondary compact ${workshopInvoiceMode === 'urgent' || workshopFilters.view === 'urgent' ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => {
                        setWorkshopInvoiceMode('urgent')
                        const fallback = getPeriodRange('month')
                        const next = {
                          ...workshopFilters,
                          view: 'urgent' as WorkshopView,
                          period: (!workshopFilters.dateFrom || !workshopFilters.dateTo) ? 'month' as WorkshopPeriodPreset : workshopFilters.period,
                          dateFrom: workshopFilters.dateFrom || fallback.dateFrom,
                          dateTo: workshopFilters.dateTo || fallback.dateTo,
                          urgentOnly: true,
                        }
                        setWorkshopFilters(next)
                      }}
                    >Срочные за период</button>
                    <span>{workshopFilters.view === 'urgent' ? 'Берутся только срочные активные позиции. Период можно выбрать сверху.' : 'Дата управляется кнопками Сегодня / Вчера / Месяц / Период.'}</span>
                  </div>
                  <div className="table-shell">
                    <table className="data-table workshop-simple-invoice-table">
                      <thead>
                        <tr>
                          <th>Изделие</th>
                          <th>Характеристики</th>
                          <th>Кол-во</th>
                          <th>Срочность</th>
                          <th>Комментарий</th>
                          <th>Заказ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {workshopInvoiceRows.length ? workshopInvoiceRows.map((row) => (
                          <tr className={`${row.isSpecialOrder ? 'is-special-order' : ''} ${row.priority === 0 ? 'is-urgent' : row.priority === 1 ? 'has-comment' : ''}`.trim()} key={row.key}>
                            <td><strong>{row.productName}</strong></td>
                            <td>{row.characteristics || '—'}</td>
                            <td>{row.quantity} шт.</td>
                            <td>{getWorkshopInvoiceImportanceLabel(row)}</td>
                            <td>{row.comment || '—'}</td>
                            <td>{row.orderRef || '—'}</td>
                          </tr>
                        )) : (
                          <tr><td colSpan={6} className="empty-state">Нет позиций для накладной.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
    
              <LinkedTableScroll className="workshop-table-shell" ariaLabel="Горизонтальная прокрутка таблицы цеха">
                <table className="data-table workshop-grid-table workshop-order-like-table">
                  <thead>
                    <tr>
                      <th>Заказ / дата</th>
                      <th>Позиция</th>
                      <th>Кол-во</th>
                      <th>Клиент / город</th>
                      <th>Особое</th>
                      <th>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeWorkshopTasks.length ? activeWorkshopTasks.map((task) => (
                      <tr className={`${task.urgent ? 'is-urgent' : ''} ${task.comment ? 'has-comment' : ''}`.trim()} key={`workshop-task-${task.id}`}>
                        <td>
                          <div className="order-cell-stack workshop-order-ref">
                            <strong>{task.externalOrderId}</strong>
                            <span>{formatDateShort(task.orderDate)} · {task.managerName || '—'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="workshop-product-card">
                            <strong>{task.productName}</strong>
                            <div className="workshop-detail-grid" aria-label="Характеристики товара">
                              {workshopDetailRows(task).map((detail) => (
                                <span className="workshop-detail-chip" key={`${task.id}-${detail.label}-${detail.value}`}>
                                  <small>{detail.label}</small>
                                  <b>{detail.value}</b>
                                </span>
                              ))}
                              {!workshopDetailRows(task).length ? <span className="muted-small">характеристики не указаны</span> : null}
                            </div>
                          </div>
                        </td>
                        <td className="num"><strong>{task.quantity}</strong></td>
                        <td>
                          <div className="order-cell-stack">
                            <strong>{workshopCustomerIdentity(task).primary}</strong>
                            {workshopCustomerIdentity(task).secondary ? <span>{workshopCustomerIdentity(task).secondary}</span> : null}
                            <span>{task.city || '—'} · {task.deliveryType || '—'}</span>
                          </div>
                        </td>
                        <td>
                          <div className="workshop-special-stack">
                            <span className={task.urgent ? 'urgent-pill' : 'normal-pill'}>{task.urgent ? 'Срочно' : 'Обычно'}</span>
                            {task.exchangeId ? <span className="status-pill status-info">Обмен #{task.exchangeId}</span> : null}
                            {task.dueDate ? <span className="muted-small">до {formatDateShort(task.dueDate)}</span> : null}
                            {task.comment ? <span className="workshop-comment">{task.comment}</span> : null}
                          </div>
                        </td>
                        <td>
                          <div className="workshop-actions table-actions-vertical">
                            {task.shippingStatus !== 'sent' ? (
                              <button
                                className="secondary compact"
                                type="button"
                                onClick={() => void openWorkshopOrderEditor(task)}
                              >
                                Редактировать заказ
                              </button>
                            ) : null}
                            <button
                              className="secondary compact"
                              type="button"
                              onClick={() => void openWorkshopExchange(task)}
                            >
                              Обмен
                            </button>
                            {task.status === 'active' ? (
                              <button className="primary compact" type="button" onClick={() => void markWorkshopTaskDone(task)} disabled={workshopBusy}>
                                Готово
                              </button>
                            ) : (
                              <>
                                <span className="status-pill status-online">Готово</span>
                                <button className="primary compact" type="button" onClick={() => void restoreWorkshopTaskActive(task)} disabled={workshopBusy}>
                                  Вернуть
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )) : (
                      <tr><td colSpan={6} className="empty-state">Позиции цеха по текущему фильтру не найдены.</td></tr>
                    )}
                  </tbody>
                </table>
              </LinkedTableScroll>
            </article>
  )
}
