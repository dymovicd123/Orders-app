// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useState } from 'react'
import '../../styles/dashboard-workshop-attention-r1.css'

type SectionContext = Record<string, any>

function dashboardDayDistance(from: string, to: string) {
  if (!from || !to) return null
  const left = Date.parse(`${from}T00:00:00.000Z`)
  const right = Date.parse(`${to}T00:00:00.000Z`)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  return Math.floor((right - left) / 86400000)
}

function dashboardShortDate(value: string) {
  if (!value) return '—'
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('ru-RU')
}

function workshopWarningTone(item: any, ageLimit: number) {
  if (Number(item.overdueDays || 0) > 0 || Number(item.waitingDays || 0) >= ageLimit) return 'is-danger'
  const today = new Date().toISOString().slice(0, 10)
  const dueInDays = item.dueDate ? dashboardDayDistance(today, item.dueDate) : null
  if (dueInDays !== null && dueInDays >= 0 && dueInDays <= 2) return 'is-deadline'
  if (item.urgent) return 'is-urgent'
  if (item.dueDate) return 'is-planned'
  return 'is-workshop'
}

export function DashboardSection({ ctx }: { ctx: SectionContext }) {
  const {
    busy,
    dashboardInsights,
    dashboardSummary,
    dashboardWorkshopWarnings,
    formatMoney,
    formatPercent,
    isAdmin,
    loadOverviewDashboard,
    openDashboardWorkshopItem,
    openInventoryPanel,
    sectorStyle,
    setInventoryDraft,
    setOrderPanel,
    summary,
    workshopData,
  } = ctx
  const [selectedWorkshopWarning, setSelectedWorkshopWarning] = useState<any | null>(null)
  const workshopAgeLimit = Number(dashboardInsights?.thresholds.workshopAgeLimit ?? 7)

  return (
    <section className="card wide sector-overview dashboard-home" id="dashboard" style={sectorStyle('overview')}>
      <div className="dashboard-hero">
        <div>
          <div className="card-label">Инфопанель</div>
          <h2>Дэшборд месяца</h2>
          <p>Главные цифры месяца и незавершённый цех. Просроченные и срочные заказы выносятся вперёд.</p>
        </div>
        <div className="dashboard-hero-actions">
          <span className="soft-badge">Этот месяц</span>
          <button className="secondary compact" type="button" onClick={() => void loadOverviewDashboard()} disabled={busy}>
            {busy ? 'Обновляю...' : 'Обновить'}
          </button>
        </div>
      </div>

      <div className="summary-grid dashboard-summary-grid">
        <div className="summary-card"><span>План месяца</span><strong>{formatMoney(dashboardSummary.monthPlan || 0)}</strong></div>
        <div className="summary-card"><span>Выполнение</span><strong>{formatPercent(dashboardSummary.monthPlanCompletion || 0)}</strong><div className="mini-progress"><i style={{ width: `${Math.min(100, Math.round((dashboardSummary.monthPlanCompletion || 0) * 100))}%` }} /></div></div>
        <div className="summary-card"><span>Кол-во продаж</span><strong>{dashboardSummary.monthOrderCount || 0}</strong></div>
        <div className="summary-card"><span>Общая сумма продаж</span><strong>{formatMoney(dashboardSummary.monthTotalSales || 0)}</strong></div>
        <div className="summary-card"><span>Поступило</span><strong>{formatMoney(dashboardSummary.monthTotalReceived || 0)}</strong></div>
        <div className="summary-card danger-card"><span>Актуальные долги</span><strong>{formatMoney(dashboardSummary.monthCurrentDebt || 0)}</strong></div>
        <div className="summary-card danger-card"><span>Сумма возврата</span><strong>{formatMoney(dashboardSummary.monthTotalReturns || 0)}</strong></div>
        <div className="summary-card"><span>Средний чек</span><strong>{formatMoney(dashboardSummary.monthAvgCheck || 0)}</strong></div>
        <div className="summary-card"><span>Новые клиенты</span><strong>{dashboardSummary.monthNewClients || 0}</strong></div>
        <div className="summary-card"><span>Повторные клиенты</span><strong>{dashboardSummary.monthRepeatClients || 0}</strong></div>
        <div className="summary-card warning-card"><span>Цех активные</span><strong>{dashboardSummary.workshopActiveTotal || workshopData?.activeCount || summary.workshop}</strong></div>
      </div>

      <div className="dashboard-workspace">
        <section className="mini-panel dashboard-actions-panel">
          <div className="mini-panel-head">
            <div>
              <h3>Быстрые действия</h3>
              <p className="mini-panel-note">Самые частые переходы без поиска по меню.</p>
            </div>
          </div>
          <div className="dashboard-action-grid">
            <button type="button" onClick={() => { setOrderPanel('create'); window.location.hash = '#orders' }}>Создать заказ</button>
            <button type="button" onClick={() => { setOrderPanel('list'); window.location.hash = '#orders' }}>Список заказов</button>
            <button type="button" onClick={() => window.location.hash = '#workshop'}>Цех</button>
            {isAdmin ? (<>
              <button type="button" onClick={() => { openInventoryPanel('movement'); window.location.hash = '#inventory' }}>Приход</button>
              <button type="button" onClick={() => { setInventoryDraft((current) => ({ ...current, movementType: 'writeoff' })); openInventoryPanel('movement'); window.location.hash = '#inventory' }}>Списание</button>
              <button type="button" onClick={() => { setInventoryDraft((current) => ({ ...current, movementType: 'transfer' })); openInventoryPanel('movement'); window.location.hash = '#inventory' }}>Перемещение</button>
              <button type="button" onClick={() => { openInventoryPanel('catalog'); window.location.hash = '#inventory' }}>Товары</button>
            </>) : null}
            <button type="button" onClick={() => window.location.hash = '#reports'}>Отчёты</button>
          </div>
        </section>

        <section className="mini-panel dashboard-attention-panel dashboard-workshop-attention-panel">
          <div className="mini-panel-head">
            <div>
              <h3>Что требует внимания</h3>
              <p className="mini-panel-note">Цех: сначала просроченные дедлайны, затем ближайшие сроки, срочные и долго ожидающие позиции.</p>
            </div>
            <span className="soft-badge">{dashboardWorkshopWarnings.length}</span>
          </div>

          <div className="dashboard-attention-grid">
            <div className="dashboard-attention-column">
              <div className="dashboard-list-head">
                <strong>Очередь контроля цеха</strong>
                <span>Долгое ожидание от {workshopAgeLimit} дн. · активных всего {dashboardSummary.workshopActiveTotal}</span>
              </div>
              <div className="dashboard-scroll-list dashboard-workshop-list">
                {dashboardWorkshopWarnings.length ? dashboardWorkshopWarnings.map((item) => {
                  const tone = workshopWarningTone(item, workshopAgeLimit)
                  const characteristics = [item.gender, item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'Характеристики не указаны'
                  const customer = item.customerName || item.customerPhone || 'Клиент не указан'
                  return (
                    <button
                      key={`dash-workshop-${item.id}`}
                      type="button"
                      className={`dashboard-workshop-warning-card ${tone}`}
                      onClick={() => setSelectedWorkshopWarning(item)}
                      title="Показать детали заказа"
                    >
                      <span className="dashboard-workshop-card-head">
                        <span className="dashboard-workshop-order-ref">{item.externalOrderId || 'Без ORD'}</span>
                        <span className="dashboard-workshop-card-badges">
                          {item.overdueDays > 0 ? <b className="dashboard-attention-badge is-overdue">Просрочено {item.overdueDays} дн.</b> : null}
                          {!item.overdueDays && item.dueDate ? <b className="dashboard-attention-badge is-deadline">До {dashboardShortDate(item.dueDate)}</b> : null}
                          {item.urgent ? <b className="dashboard-attention-badge is-urgent">Срочно</b> : null}
                          <b className={`dashboard-attention-badge ${item.waitingDays >= workshopAgeLimit ? 'is-waiting-long' : 'is-waiting'}`}>Ждёт {item.waitingDays} дн.</b>
                        </span>
                      </span>
                      <span className="dashboard-workshop-card-main">
                        <strong>{item.productName}</strong>
                        <span className="dashboard-workshop-customer">{customer}</span>
                      </span>
                      <span className="dashboard-workshop-characteristics">{characteristics}</span>
                      <span className="dashboard-workshop-meta">
                        <span>{item.managerName || 'Менеджер не указан'}</span>
                        {item.city ? <span>{item.city}</span> : null}
                        <span>{item.quantity || 1} шт.</span>
                      </span>
                      {item.comment ? <span className="dashboard-workshop-comment">{item.comment}</span> : null}
                    </button>
                  )
                }) : (
                  <div className="empty-state">Просроченных, срочных или долго ожидающих позиций нет.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>

      {selectedWorkshopWarning ? (
        <div
          className="dashboard-workshop-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedWorkshopWarning(null)
          }}
        >
          <section className="dashboard-workshop-detail" role="dialog" aria-modal="true" aria-label="Детали позиции цеха">
            <div className="dashboard-workshop-detail-head">
              <div>
                <span className="dashboard-workshop-order-ref">{selectedWorkshopWarning.externalOrderId || 'Без ORD'}</span>
                <h3>{selectedWorkshopWarning.productName}</h3>
                <p>{selectedWorkshopWarning.reason}</p>
              </div>
              <button className="secondary compact" type="button" onClick={() => setSelectedWorkshopWarning(null)}>Закрыть</button>
            </div>

            <div className="dashboard-workshop-detail-grid">
              <div><span>Клиент</span><strong>{selectedWorkshopWarning.customerName || 'Не указан'}</strong></div>
              <div><span>Телефон</span><strong>{selectedWorkshopWarning.customerPhone || 'Не указан'}</strong></div>
              <div><span>Менеджер</span><strong>{selectedWorkshopWarning.managerName || 'Не указан'}</strong></div>
              <div><span>Город</span><strong>{selectedWorkshopWarning.city || 'Не указан'}</strong></div>
              <div><span>Дата заказа</span><strong>{dashboardShortDate(selectedWorkshopWarning.orderDate)}</strong></div>
              <div><span>Дедлайн</span><strong>{selectedWorkshopWarning.dueDate ? dashboardShortDate(selectedWorkshopWarning.dueDate) : 'Не задан'}</strong></div>
              <div><span>В ожидании</span><strong>{selectedWorkshopWarning.waitingDays} дн.</strong></div>
              <div><span>Количество</span><strong>{selectedWorkshopWarning.quantity || 1} шт.</strong></div>
              <div><span>Доставка</span><strong>{selectedWorkshopWarning.deliveryType || 'Не указана'}</strong></div>
              <div><span>Статус</span><strong>{selectedWorkshopWarning.urgent ? 'Срочно' : 'Обычно'}</strong></div>
            </div>

            <div className="dashboard-workshop-detail-block">
              <span>Характеристики</span>
              <strong>{[selectedWorkshopWarning.gender, selectedWorkshopWarning.color, selectedWorkshopWarning.material, selectedWorkshopWarning.length, selectedWorkshopWarning.size].filter(Boolean).join(' · ') || 'Не указаны'}</strong>
            </div>
            <div className="dashboard-workshop-detail-block">
              <span>Комментарий цеху</span>
              <strong>{selectedWorkshopWarning.comment || 'Нет комментария'}</strong>
            </div>

            <div className="dashboard-workshop-detail-actions">
              <button
                className="primary"
                type="button"
                onClick={() => {
                  const item = selectedWorkshopWarning
                  setSelectedWorkshopWarning(null)
                  openDashboardWorkshopItem(item)
                }}
              >
                Открыть в цехе
              </button>
              <button className="secondary" type="button" onClick={() => setSelectedWorkshopWarning(null)}>Остаться на инфопанели</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
