// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useMemo, useState } from 'react'
import { LinkedTableScroll } from '../../components/tables/LinkedTableScroll'

type SectionContext = Record<string, any>
type WorkshopChannel = 'regular' | 'kaspi'
type WorkshopPanel = 'orders' | 'invoice'

export function WorkshopSection({ ctx }: { ctx: SectionContext }) {
  const {
    activeWorkshopTasks,
    applyWorkshopPeriodPreset,
    copyWorkshopInvoiceText,
    downloadWorkshopInvoicePdf,
    exportWorkshopInvoiceWord,
    formatDateShort,
    getPeriodRange,
    getWorkshopInvoiceDeadlineLabel,
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
    workshopDetailRows,
    workshopFilters,
    workshopInvoiceIsKaspi,
    workshopInvoiceMode,
    workshopInvoiceRows,
    workshopScopeTasks,
    workshopSortDirection,
  } = ctx

  const [workshopChannel, setWorkshopChannel] = useState<WorkshopChannel>(workshopInvoiceIsKaspi ? 'kaspi' : 'regular')
  const [workshopPanel, setWorkshopPanel] = useState<WorkshopPanel>(workshopFilters.view === 'invoice' ? 'invoice' : 'orders')

  const isKaspiTask = (task: any) => String(task.orderPaymentMethod || '').trim().toUpperCase() === 'КАСПИ МАГАЗИН'
  const visibleWorkshopTasks = useMemo(
    () => activeWorkshopTasks.filter((task: any) => workshopChannel === 'kaspi' ? isKaspiTask(task) : !isKaspiTask(task)),
    [activeWorkshopTasks, workshopChannel],
  )
  const visibleWorkshopUnits = visibleWorkshopTasks.reduce((sum: number, task: any) => sum + Number(task.quantity || 0), 0)
  const isDoneView = workshopFilters.view === 'done'
  const isUrgentOrdersView = workshopPanel === 'orders' && workshopChannel === 'regular' && workshopFilters.view === 'urgent'
  const customPeriod = workshopFilters.period === 'custom'

  const ensureInvoiceRange = (current: any) => {
    const fallback = getPeriodRange('month')
    const missingRange = current.period === 'all' || !current.dateFrom || !current.dateTo
    return {
      period: missingRange ? 'month' as WorkshopPeriodPreset : current.period,
      dateFrom: missingRange ? fallback.dateFrom : current.dateFrom,
      dateTo: missingRange ? fallback.dateTo : current.dateTo,
    }
  }

  const openOrders = () => {
    setWorkshopPanel('orders')
    setWorkshopFilters((current: any) => ({
      ...current,
      view: 'active' as WorkshopView,
      urgentOnly: false,
    }))
    setWorkshopSortDirection('oldest')
  }

  const openInvoice = () => {
    setWorkshopPanel('invoice')
    setWorkshopInvoiceMode(workshopChannel === 'kaspi' ? 'kaspi' : 'period')
    setWorkshopFilters((current: any) => {
      const range = ensureInvoiceRange(current)
      return {
        ...current,
        ...range,
        view: 'invoice' as WorkshopView,
        urgentOnly: false,
      }
    })
    setWorkshopSortDirection('oldest')
  }

  const changeChannel = (channel: WorkshopChannel) => {
    setWorkshopChannel(channel)
    if (workshopPanel === 'invoice') {
      setWorkshopInvoiceMode(channel === 'kaspi' ? 'kaspi' : 'period')
      setWorkshopFilters((current: any) => {
        const range = ensureInvoiceRange(current)
        return {
          ...current,
          ...range,
          view: 'invoice' as WorkshopView,
          urgentOnly: false,
        }
      })
      return
    }

    setWorkshopFilters((current: any) => ({
      ...current,
      view: current.view === 'done' ? 'done' as WorkshopView : 'active' as WorkshopView,
      urgentOnly: false,
    }))
    setWorkshopSortDirection(workshopFilters.view === 'done' ? 'newest' : 'oldest')
  }

  const setOrderStatus = (status: 'active' | 'done') => {
    setWorkshopFilters((current: any) => ({
      ...current,
      view: status as WorkshopView,
      urgentOnly: false,
    }))
    setWorkshopSortDirection(status === 'done' ? 'newest' : 'oldest')
  }

  const toggleUrgentOrders = () => {
    const nextUrgent = !isUrgentOrdersView
    setWorkshopFilters((current: any) => ({
      ...current,
      view: nextUrgent ? 'urgent' as WorkshopView : 'active' as WorkshopView,
      urgentOnly: nextUrgent,
    }))
    setWorkshopSortDirection('oldest')
  }

  const setRegularInvoiceMode = (mode: 'period' | 'urgent') => {
    setWorkshopInvoiceMode(mode)
    setWorkshopFilters((current: any) => {
      const range = ensureInvoiceRange(current)
      return {
        ...current,
        ...range,
        view: mode === 'urgent' ? 'urgent' as WorkshopView : 'invoice' as WorkshopView,
        urgentOnly: mode === 'urgent',
      }
    })
  }

  const invoiceTitle = workshopChannel === 'kaspi'
    ? 'Накладная Kaspi магазина'
    : workshopInvoiceMode === 'urgent'
      ? 'Срочная накладная'
      : 'Обычная накладная'

  return (
    <article className={`card wide sector-workshop workshop-workspace workshop-channel-${workshopChannel}`} id="workshop" style={sectorStyle('workshop')}>
      <div className="workshop-page-head">
        <div>
          <div className="card-label">Цех</div>
          <div className="card-meta">Рабочая очередь производства и накладные — отдельно для обычных заказов и Kaspi магазина.</div>
        </div>
        <span className={`workshop-load-state ${workshopBusy ? 'is-busy' : ''}`}>{workshopBusy ? 'Обновление…' : 'Данные актуальны'}</span>
      </div>

      <div className="workshop-channel-tabs" role="tablist" aria-label="Тип заказов цеха">
        <button
          type="button"
          className={`workshop-channel-tab ${workshopChannel === 'regular' ? 'is-active' : ''}`}
          onClick={() => changeChannel('regular')}
        >
          <span>Обычные заказы</span>
          <small>Основная очередь цеха</small>
        </button>
        <button
          type="button"
          className={`workshop-channel-tab is-kaspi ${workshopChannel === 'kaspi' ? 'is-active' : ''}`}
          onClick={() => changeChannel('kaspi')}
        >
          <span>Kaspi магазин</span>
          <small>Приоритетная очередь · срок до 20:00</small>
        </button>
      </div>

      <div className="workshop-section-tabs" role="tablist" aria-label="Раздел цеха">
        <button type="button" className={workshopPanel === 'orders' ? 'is-active' : ''} onClick={openOrders}>Заказы</button>
        <button type="button" className={workshopPanel === 'invoice' ? 'is-active' : ''} onClick={openInvoice}>Накладная</button>
      </div>

      {workshopPanel === 'orders' ? (
        <>
          <section className="workshop-control-panel" aria-label="Фильтры заказов цеха">
            <div className="workshop-control-row workshop-status-row">
              <div className="workshop-control-group">
                <span className="workshop-control-label">Статус</span>
                <div className="workshop-choice-row">
                  <button type="button" className={`secondary compact ${!isDoneView ? 'is-active' : ''}`} onClick={() => setOrderStatus('active')}>Активные</button>
                  <button type="button" className={`secondary compact ${isDoneView ? 'is-active' : ''}`} onClick={() => setOrderStatus('done')}>Готовые</button>
                  {workshopChannel === 'regular' && !isDoneView ? (
                    <button type="button" className={`secondary compact workshop-urgent-filter ${isUrgentOrdersView ? 'is-active' : ''}`} onClick={toggleUrgentOrders}>
                      Только срочные
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="workshop-queue-summary">
                <strong>{visibleWorkshopTasks.length}</strong>
                <span>позиций · {visibleWorkshopUnits} шт.</span>
              </div>
            </div>

            <div className="workshop-control-row">
              <label className="workshop-search-field">
                <span>Поиск</span>
                <input
                  value={workshopFilters.q}
                  onChange={(event) => setWorkshopFilters((current: any) => ({ ...current, q: event.target.value }))}
                  placeholder="Заказ, товар, клиент или комментарий"
                />
              </label>

              <div className="workshop-control-group workshop-period-group">
                <span className="workshop-control-label">Период</span>
                <div className="workshop-choice-row">
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
              </div>

              <label className="workshop-sort-field">
                <span>Сортировка</span>
                <select value={workshopSortDirection} onChange={(event) => setWorkshopSortDirection(event.target.value as 'oldest' | 'newest')}>
                  <option value="oldest">Сначала старые</option>
                  <option value="newest">Сначала новые</option>
                </select>
              </label>
            </div>

            {customPeriod ? (
              <div className="workshop-custom-dates">
                <label>
                  <span>С даты</span>
                  <input
                    type="date"
                    value={workshopFilters.dateFrom}
                    onChange={(event) => setWorkshopFilters((current: any) => ({ ...current, period: 'custom', dateFrom: event.target.value }))}
                  />
                </label>
                <label>
                  <span>По дату</span>
                  <input
                    type="date"
                    value={workshopFilters.dateTo}
                    onChange={(event) => setWorkshopFilters((current: any) => ({ ...current, period: 'custom', dateTo: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}
          </section>

          <div className="workshop-list-head">
            <div>
              <strong>{isDoneView ? 'Готовые заказы' : isUrgentOrdersView ? 'Срочные заказы' : 'Заказы в работе'}</strong>
              <span>{workshopChannel === 'kaspi' ? 'Kaspi магазин — отдельная приоритетная очередь.' : isDoneView ? 'Готовые позиции можно вернуть обратно в работу.' : 'Срочные позиции отмечены прямо в списке.'}</span>
            </div>
          </div>

          <LinkedTableScroll className="workshop-table-shell workshop-orders-shell" ariaLabel="Горизонтальная прокрутка таблицы цеха">
            <table className="data-table workshop-grid-table workshop-order-like-table">
              <thead>
                <tr>
                  <th>Заказ</th>
                  <th>Изделие</th>
                  <th>Клиент</th>
                  <th>Приоритет</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {visibleWorkshopTasks.length ? visibleWorkshopTasks.map((task: any) => (
                  <tr className={`${task.urgent ? 'is-urgent' : ''} ${task.comment ? 'has-comment' : ''}`.trim()} key={`workshop-task-${task.id}`}>
                    <td>
                      <div className="order-cell-stack workshop-order-ref">
                        <strong>{task.externalOrderId}</strong>
                        <span>{formatDateShort(task.orderDate)}</span>
                        <span>{task.managerName || '—'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="workshop-product-card">
                        <div className="workshop-product-title-row">
                          <strong>{task.productName}</strong>
                          <span className="workshop-qty-pill">{task.quantity} шт.</span>
                        </div>
                        <div className="workshop-detail-grid" aria-label="Характеристики товара">
                          {workshopDetailRows(task).map((detail: any) => (
                            <span className="workshop-detail-chip" key={`${task.id}-${detail.label}-${detail.value}`}>
                              <small>{detail.label}</small>
                              <b>{detail.value}</b>
                            </span>
                          ))}
                          {!workshopDetailRows(task).length ? <span className="muted-small">характеристики не указаны</span> : null}
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="order-cell-stack">
                        <strong>{workshopCustomerIdentity(task).primary}</strong>
                        {workshopCustomerIdentity(task).secondary ? <span>{workshopCustomerIdentity(task).secondary}</span> : null}
                        <span>{task.city || '—'}</span>
                        <span>{task.deliveryType || '—'}</span>
                      </div>
                    </td>
                    <td>
                      <div className="workshop-special-stack">
                        {workshopChannel === 'kaspi' ? <span className="status-pill status-info">КАСПИ МАГАЗИН</span> : null}
                        <span className={task.urgent ? 'urgent-pill' : 'normal-pill'}>{task.urgent ? 'Срочно' : 'Обычно'}</span>
                        {task.exchangeId ? <span className="status-pill status-info">Обмен #{task.exchangeId}</span> : null}
                        {task.dueDate || task.dueTime ? (
                          <span className="workshop-deadline">
                            до {[task.dueDate ? formatDateShort(task.dueDate) : '', task.dueTime || ''].filter(Boolean).join(' · ')}
                          </span>
                        ) : null}
                        {task.comment ? <span className="workshop-comment">{task.comment}</span> : null}
                      </div>
                    </td>
                    <td>
                      <div className="workshop-actions table-actions-vertical">
                        {task.shippingStatus !== 'sent' ? (
                          <button className="secondary compact" type="button" onClick={() => void openWorkshopOrderEditor(task)}>
                            Открыть заказ
                          </button>
                        ) : null}
                        <button className="secondary compact" type="button" onClick={() => void openWorkshopExchange(task)}>Обмен</button>
                        <span className={`status-pill ${task.shippingStatus === 'sent' ? 'status-online' : 'status-warning'}`}>
                          Заказ: {task.shippingStatus === 'sent' ? 'отправлен' : 'не отправлен'}
                        </span>
                        {task.status === 'active' ? (
                          <button className="primary compact" type="button" onClick={() => void markWorkshopTaskDone(task)} disabled={workshopBusy}>
                            Готово в цехе
                          </button>
                        ) : (
                          <>
                            <span className="status-pill status-online">Цех: готово</span>
                            <button className="primary compact" type="button" onClick={() => void restoreWorkshopTaskActive(task)} disabled={workshopBusy}>
                              Вернуть в работу
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr><td colSpan={5} className="empty-state">{workshopChannel === 'kaspi' ? 'Заказы Kaspi магазина по текущему фильтру не найдены.' : 'Обычные заказы по текущему фильтру не найдены.'}</td></tr>
                )}
              </tbody>
            </table>
          </LinkedTableScroll>
        </>
      ) : (
        <>
          <section className="workshop-control-panel workshop-invoice-controls" aria-label="Настройки накладной">
            <div className="workshop-control-row workshop-invoice-topline">
              <div className="workshop-control-group">
                <span className="workshop-control-label">Накладная</span>
                {workshopChannel === 'regular' ? (
                  <div className="workshop-choice-row">
                    <button
                      type="button"
                      className={`secondary compact ${workshopInvoiceMode !== 'urgent' ? 'is-active' : ''}`}
                      onClick={() => setRegularInvoiceMode('period')}
                    >
                      Все за период
                    </button>
                    <button
                      type="button"
                      className={`secondary compact ${workshopInvoiceMode === 'urgent' ? 'is-active' : ''}`}
                      onClick={() => setRegularInvoiceMode('urgent')}
                    >
                      Только срочные
                    </button>
                  </div>
                ) : (
                  <span className="workshop-kaspi-invoice-note">Отдельная накладная Kaspi магазина · заказы идут по сроку.</span>
                )}
              </div>

              <div className="workshop-invoice-count">
                <strong>{workshopInvoiceRows.length}</strong>
                <span>строк · {workshopScopeTasks.reduce((sum: number, task: any) => sum + Number(task.quantity || 0), 0)} шт.</span>
              </div>
            </div>

            <div className="workshop-control-row">
              <div className="workshop-control-group workshop-period-group">
                <span className="workshop-control-label">Период</span>
                <div className="workshop-choice-row">
                  {[
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
              </div>

              <div className="workshop-bulk-actions workshop-export-actions">
                <button className="secondary compact" type="button" onClick={() => void exportWorkshopInvoiceWord()} disabled={!workshopScopeTasks.length}>Word</button>
                <button className="secondary compact" type="button" onClick={() => void downloadWorkshopInvoicePdf()} disabled={!workshopScopeTasks.length}>PDF</button>
                <button className="secondary compact" type="button" onClick={printWorkshopInvoice} disabled={!workshopScopeTasks.length}>Печать</button>
                <button className="secondary compact" type="button" onClick={() => void copyWorkshopInvoiceText()} disabled={!workshopScopeTasks.length}>Копировать</button>
              </div>
            </div>

            {customPeriod ? (
              <div className="workshop-custom-dates">
                <label>
                  <span>С даты</span>
                  <input
                    type="date"
                    value={workshopFilters.dateFrom}
                    onChange={(event) => setWorkshopFilters((current: any) => ({ ...current, period: 'custom', dateFrom: event.target.value }))}
                  />
                </label>
                <label>
                  <span>По дату</span>
                  <input
                    type="date"
                    value={workshopFilters.dateTo}
                    onChange={(event) => setWorkshopFilters((current: any) => ({ ...current, period: 'custom', dateTo: event.target.value }))}
                  />
                </label>
              </div>
            ) : null}
          </section>

          <div className="workshop-list-head workshop-invoice-head">
            <div>
              <strong>{invoiceTitle}</strong>
              <span>
                {workshopChannel === 'kaspi'
                  ? 'Каждая позиция остаётся привязана к своему заказу и сроку.'
                  : workshopInvoiceMode === 'urgent'
                    ? 'Только срочные активные позиции обычных заказов.'
                    : 'Срочные заказы идут первыми, обычные одинаковые позиции могут объединяться.'}
              </span>
            </div>
          </div>

          <div className="table-shell workshop-invoice-table-shell">
            <table className="data-table workshop-simple-invoice-table">
              <thead>
                <tr>
                  <th>Изделие</th>
                  <th>Характеристики</th>
                  <th>Кол-во</th>
                  <th>{workshopInvoiceIsKaspi ? 'Срок' : 'Срочность'}</th>
                  <th>Комментарий</th>
                  <th>Заказ</th>
                </tr>
              </thead>
              <tbody>
                {workshopInvoiceRows.length ? workshopInvoiceRows.map((row: any) => (
                  <tr className={`${row.isSpecialOrder ? 'is-special-order' : ''} ${row.priority === 0 ? 'is-urgent' : row.priority === 1 ? 'has-comment' : ''}`.trim()} key={row.key}>
                    <td><strong>{row.productName}</strong></td>
                    <td>{row.characteristics || '—'}</td>
                    <td>{row.quantity} шт.</td>
                    <td>{workshopInvoiceIsKaspi ? getWorkshopInvoiceDeadlineLabel(row) : getWorkshopInvoiceImportanceLabel(row)}</td>
                    <td>{row.comment || '—'}</td>
                    <td>{row.orderRef || '—'}</td>
                  </tr>
                )) : (
                  <tr><td colSpan={6} className="empty-state">{workshopChannel === 'kaspi' ? 'Нет активных позиций Kaspi магазина за выбранный период.' : 'Нет позиций для накладной.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </article>
  )
}
