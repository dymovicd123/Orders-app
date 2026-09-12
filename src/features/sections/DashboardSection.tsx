// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useMemo, useState } from 'react'
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

function earliestDate(left: string, right: string) {
  if (!left) return right || ''
  if (!right) return left
  return left <= right ? left : right
}

function buildWorkshopOrderCards(rows: any[]) {
  const grouped = new Map<string, any>()

  for (const item of rows || []) {
    const key = item.externalOrderId || `order-${item.orderId}`
    const current = grouped.get(key)
    const quantity = Math.max(1, Number(item.quantity || 1))

    if (!current) {
      grouped.set(key, {
        key,
        orderId: item.orderId,
        externalOrderId: item.externalOrderId,
        customerName: item.customerName || '',
        customerPhone: item.customerPhone || '',
        managerName: item.managerName || '',
        city: item.city || '',
        deliveryType: item.deliveryType || '',
        orderDate: item.orderDate || '',
        dueDate: item.dueDate || '',
        waitingDays: Number(item.waitingDays || 0),
        overdueDays: Number(item.overdueDays || 0),
        urgent: Boolean(item.urgent),
        hasComment: Boolean(String(item.comment || '').trim()),
        priorityScore: Number(item.priorityScore || 0),
        totalQuantity: quantity,
        items: [item],
      })
      continue
    }

    current.items.push(item)
    current.totalQuantity += quantity
    current.waitingDays = Math.max(current.waitingDays, Number(item.waitingDays || 0))
    current.overdueDays = Math.max(current.overdueDays, Number(item.overdueDays || 0))
    current.urgent = current.urgent || Boolean(item.urgent)
    current.hasComment = current.hasComment || Boolean(String(item.comment || '').trim())
    current.priorityScore = Math.max(current.priorityScore, Number(item.priorityScore || 0))
    current.dueDate = earliestDate(current.dueDate, item.dueDate || '')
    current.orderDate = earliestDate(current.orderDate, item.orderDate || '')
    if (!current.customerName && item.customerName) current.customerName = item.customerName
    if (!current.customerPhone && item.customerPhone) current.customerPhone = item.customerPhone
    if (!current.managerName && item.managerName) current.managerName = item.managerName
    if (!current.city && item.city) current.city = item.city
  }

  const result = Array.from(grouped.values())
  for (const order of result) {
    order.items.sort((a: any, b: any) => {
      const urgentDiff = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent))
      if (urgentDiff) return urgentDiff
      return String(a.productName || '').localeCompare(String(b.productName || ''), 'ru')
    })
  }

  result.sort((a, b) => {
    if (b.overdueDays !== a.overdueDays) return b.overdueDays - a.overdueDays

    const today = new Date().toISOString().slice(0, 10)
    const aDue = a.dueDate ? dashboardDayDistance(today, a.dueDate) : null
    const bDue = b.dueDate ? dashboardDayDistance(today, b.dueDate) : null
    const aBucket = aDue !== null && aDue <= 2 ? 0 : a.urgent ? 1 : a.dueDate ? 2 : 3
    const bBucket = bDue !== null && bDue <= 2 ? 0 : b.urgent ? 1 : b.dueDate ? 2 : 3
    if (aBucket !== bBucket) return aBucket - bBucket
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate)
    if (b.waitingDays !== a.waitingDays) return b.waitingDays - a.waitingDays
    return String(a.externalOrderId || '').localeCompare(String(b.externalOrderId || ''), 'ru')
  })

  return result
}

function workshopOrderTone(order: any, ageLimit: number) {
  if (Number(order.overdueDays || 0) > 0) return 'is-danger'
  const today = new Date().toISOString().slice(0, 10)
  const dueInDays = order.dueDate ? dashboardDayDistance(today, order.dueDate) : null
  if (dueInDays !== null && dueInDays >= 0 && dueInDays <= 2) return 'is-deadline'
  if (order.urgent) return 'is-urgent'
  if (Number(order.waitingDays || 0) >= ageLimit) return 'is-waiting-long'
  if (order.dueDate) return 'is-planned'
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

  const [selectedWorkshopOrder, setSelectedWorkshopOrder] = useState<any | null>(null)
  const workshopAgeLimit = Number(dashboardInsights?.thresholds.workshopAgeLimit ?? 7)
  const workshopOrders = useMemo(() => buildWorkshopOrderCards(dashboardWorkshopWarnings), [dashboardWorkshopWarnings])

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
              <p className="mini-panel-note">Один блок = один заказ. Сначала просрочка и ближайшие дедлайны, затем срочные и долго ожидающие.</p>
            </div>
            <span className="soft-badge">{workshopOrders.length}</span>
          </div>

          <div className="dashboard-workshop-focus">
            <div className="dashboard-list-head">
              <strong>Очередь контроля цеха</strong>
              <span>Долгое ожидание от {workshopAgeLimit} дн. · активных всего {dashboardSummary.workshopActiveTotal}</span>
            </div>

            <div className="dashboard-scroll-list dashboard-workshop-order-list">
              {workshopOrders.length ? workshopOrders.map((order) => {
                const tone = workshopOrderTone(order, workshopAgeLimit)
                const previewItems = order.items.slice(0, 3)
                const hiddenItems = Math.max(0, order.items.length - previewItems.length)
                return (
                  <button
                    key={`dash-workshop-order-${order.key}`}
                    type="button"
                    className={`dashboard-workshop-order-card ${tone}`}
                    onClick={() => setSelectedWorkshopOrder(order)}
                    title="Показать заказ и позиции"
                  >
                    <span className="dashboard-workshop-order-top">
                      <span className="dashboard-workshop-order-ref">{order.externalOrderId || `Заказ #${order.orderId}`}</span>
                      <span className="dashboard-workshop-card-badges">
                        {order.overdueDays > 0 ? <b className="dashboard-attention-badge is-overdue">Просрочено {order.overdueDays} дн.</b> : null}
                        {!order.overdueDays && order.dueDate ? <b className="dashboard-attention-badge is-deadline">До {dashboardShortDate(order.dueDate)}</b> : null}
                        {order.urgent ? <b className="dashboard-attention-badge is-urgent">Срочно</b> : null}
                        {order.hasComment ? <b className="dashboard-attention-badge is-comment">Есть комментарий</b> : null}
                        <b className={`dashboard-attention-badge ${order.waitingDays >= workshopAgeLimit ? 'is-waiting-long' : 'is-waiting'}`}>Ждёт {order.waitingDays} дн.</b>
                      </span>
                    </span>

                    <span className="dashboard-workshop-order-main">
                      <span className="dashboard-workshop-order-client">
                        <strong>{order.customerName || 'Клиент не указан'}</strong>
                        <small>{order.managerName || 'Менеджер не указан'}{order.city ? ` · ${order.city}` : ''}{order.customerPhone ? ` · ${order.customerPhone}` : ''}</small>
                        <small>{order.dueDate ? `Дедлайн ${dashboardShortDate(order.dueDate)}` : 'Дедлайн не указан'}{order.orderDate ? ` · заказ от ${dashboardShortDate(order.orderDate)}` : ''}</small>
                      </span>
                      <span className="dashboard-workshop-order-count">
                        <strong>{order.totalQuantity} шт.</strong>
                        <small>{order.items.length} поз. в контроле</small>
                      </span>
                    </span>

                    <span className="dashboard-workshop-order-items">
                      {previewItems.map((item: any) => (
                        <span className="dashboard-workshop-order-item" key={`dash-order-${order.key}-${item.id}`}>
                          <span>
                            <strong>{item.productName}</strong>
                            <small>{[item.gender, item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'Характеристики не указаны'}</small>
                          </span>
                          <b>{Math.max(1, Number(item.quantity || 1))} шт.</b>
                        </span>
                      ))}
                      {hiddenItems > 0 ? <span className="dashboard-workshop-order-more">+ ещё {hiddenItems} поз.</span> : null}
                    </span>
                  </button>
                )
              }) : (
                <div className="empty-state">Просроченных, срочных или долго ожидающих заказов нет.</div>
              )}
            </div>
          </div>
        </section>
      </div>

      {selectedWorkshopOrder ? (
        <div
          className="dashboard-workshop-detail-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setSelectedWorkshopOrder(null)
          }}
        >
          <section className="dashboard-workshop-detail dashboard-workshop-order-detail" role="dialog" aria-modal="true" aria-label="Детали заказа цеха">
            <div className="dashboard-workshop-detail-head">
              <div>
                <span className="dashboard-workshop-order-ref">{selectedWorkshopOrder.externalOrderId || `Заказ #${selectedWorkshopOrder.orderId}`}</span>
                <h3>{selectedWorkshopOrder.customerName || 'Клиент не указан'}</h3>
                <p>{selectedWorkshopOrder.overdueDays > 0 ? `Дедлайн просрочен на ${selectedWorkshopOrder.overdueDays} дн.` : selectedWorkshopOrder.dueDate ? `Дедлайн ${dashboardShortDate(selectedWorkshopOrder.dueDate)}` : `В ожидании ${selectedWorkshopOrder.waitingDays} дн.`}</p>
              </div>
              <button className="secondary compact" type="button" onClick={() => setSelectedWorkshopOrder(null)}>Закрыть</button>
            </div>

            <div className="dashboard-workshop-detail-grid">
              <div><span>Клиент</span><strong>{selectedWorkshopOrder.customerName || 'Не указан'}</strong></div>
              <div><span>Телефон</span><strong>{selectedWorkshopOrder.customerPhone || 'Не указан'}</strong></div>
              <div><span>Менеджер</span><strong>{selectedWorkshopOrder.managerName || 'Не указан'}</strong></div>
              <div><span>Город</span><strong>{selectedWorkshopOrder.city || 'Не указан'}</strong></div>
              <div><span>Дата заказа</span><strong>{dashboardShortDate(selectedWorkshopOrder.orderDate)}</strong></div>
              <div><span>Дедлайн</span><strong>{selectedWorkshopOrder.dueDate ? dashboardShortDate(selectedWorkshopOrder.dueDate) : 'Не задан'}</strong></div>
              <div><span>В ожидании</span><strong>{selectedWorkshopOrder.waitingDays} дн.</strong></div>
              <div><span>В контроле</span><strong>{selectedWorkshopOrder.totalQuantity} шт. · {selectedWorkshopOrder.items.length} поз.</strong></div>
            </div>

            <div className="dashboard-workshop-detail-items">
              <div className="dashboard-workshop-detail-items-head">
                <strong>Позиции заказа в очереди контроля</strong>
                <span>{selectedWorkshopOrder.items.length}</span>
              </div>
              {selectedWorkshopOrder.items.map((item: any) => (
                <article className="dashboard-workshop-detail-item" key={`dash-detail-${selectedWorkshopOrder.key}-${item.id}`}>
                  <div>
                    <strong>{item.productName}</strong>
                    <small>{[item.gender, item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'Характеристики не указаны'}</small>
                    {item.comment ? <p>{item.comment}</p> : null}
                  </div>
                  <div className="dashboard-workshop-detail-item-side">
                    <b>{Math.max(1, Number(item.quantity || 1))} шт.</b>
                    {item.urgent ? <span>Срочно</span> : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="dashboard-workshop-detail-actions">
              <button
                className="primary"
                type="button"
                onClick={() => {
                  const item = selectedWorkshopOrder.items[0]
                  setSelectedWorkshopOrder(null)
                  if (item) openDashboardWorkshopItem(item)
                }}
              >
                Открыть заказ в цехе
              </button>
              <button className="secondary" type="button" onClick={() => setSelectedWorkshopOrder(null)}>Остаться на инфопанели</button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  )
}
