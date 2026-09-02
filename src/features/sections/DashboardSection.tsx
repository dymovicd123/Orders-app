// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function DashboardSection({ ctx }: { ctx: SectionContext }) {
  const {
    busy,
    dashboardInsights,
    dashboardLowStock,
    dashboardSummary,
    dashboardWorkshopWarnings,
    formatMoney,
    formatPercent,
    isAdmin,
    loadOverviewDashboard,
    openDashboardStockItem,
    openDashboardWorkshopItem,
    openInventoryPanel,
    sectorStyle,
    setInventoryDraft,
    setOrderPanel,
    summary,
    workshopData,
  } = ctx

  return (
    <section className="card wide sector-overview dashboard-home" id="dashboard" style={sectorStyle('overview')}>
              <div className="dashboard-hero">
                <div>
                  <div className="card-label">Инфопанель</div>
                  <h2>Дэшборд месяца</h2>
                  <p>Главные цифры месяца по дате заказа, горячие остатки и незавершённый цех.</p>
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
                <div className="summary-card"><span>Получено</span><strong>{formatMoney(dashboardSummary.monthTotalReceived || 0)}</strong></div>
                <div className="summary-card danger-card"><span>Актуальные долги</span><strong>{formatMoney(dashboardSummary.monthCurrentDebt || 0)}</strong></div>
                <div className="summary-card danger-card"><span>Сумма возврата</span><strong>{formatMoney(dashboardSummary.monthTotalReturns || 0)}</strong></div>
                <div className="summary-card"><span>Средний чек</span><strong>{formatMoney(dashboardSummary.monthAvgCheck || 0)}</strong></div>
                <div className="summary-card"><span>Новые клиенты</span><strong>{dashboardSummary.monthNewClients || 0}</strong></div>
                <div className="summary-card"><span>Повторные клиенты</span><strong>{dashboardSummary.monthRepeatClients || 0}</strong></div>
                <div className="summary-card warning-card"><span>Критичные остатки</span><strong>{dashboardSummary.criticalStockCount}</strong></div>
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
    
                <section className="mini-panel dashboard-attention-panel">
                  <div className="mini-panel-head">
                    <div>
                      <h3>Что требует внимания</h3>
                      <p className="mini-panel-note">Склад сортируется по спросу из заказов, цех — по сроку ожидания.</p>
                    </div>
                    <span className="soft-badge">{dashboardLowStock.length + dashboardWorkshopWarnings.length}</span>
                  </div>
    
                  <div className="dashboard-attention-grid">
                    <div className="dashboard-attention-column">
                      <div className="dashboard-list-head">
                        <strong>Критические остатки склада</strong>
                        <span>{dashboardSummary.negativeStockCount} минус · {dashboardSummary.zeroStockCount} ноль · порог {dashboardInsights?.thresholds.lowStockLimit ?? 5}</span>
                      </div>
                      <div className="dashboard-scroll-list">
                        {dashboardLowStock.length ? dashboardLowStock.map((item) => (
                          <button
                            key={`dash-stock-${item.source}-${item.id}`}
                            type="button"
                            className={`dashboard-warning-row ${item.quantity < 0 ? 'is-danger' : item.quantity === 0 ? 'is-zero' : 'is-low'}`}
                            onClick={() => openDashboardStockItem(item)}
                            title="Открыть товар в складе"
                          >
                            <span className="dashboard-warning-main">
                              <strong>{item.productName}</strong>
                              <em>{[item.sourceLabel, item.gender, item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'Без характеристик'}</em>
                              <small>{item.reason}{item.latestOrderId ? ` · последний заказ: ${item.latestOrderId}` : ''}</small>
                            </span>
                            <span className="dashboard-warning-side">
                              <b>{item.quantity}</b>
                              <small>{item.demandQuantity} шт. спрос</small>
                            </span>
                          </button>
                        )) : (
                          <div className="empty-state">Критичных остатков пока нет.</div>
                        )}
                      </div>
                    </div>
    
                    <div className="dashboard-attention-column">
                      <div className="dashboard-list-head">
                        <strong>Цех долго в ожидании</strong>
                        <span>Порог {dashboardInsights?.thresholds.workshopAgeLimit ?? 7} дн. · активных всего {dashboardSummary.workshopActiveTotal}</span>
                      </div>
                      <div className="dashboard-scroll-list">
                        {dashboardWorkshopWarnings.length ? dashboardWorkshopWarnings.map((item) => (
                          <button
                            key={`dash-workshop-${item.id}`}
                            type="button"
                            className={`dashboard-warning-row ${item.overdueDays > 0 ? 'is-danger' : item.urgent ? 'is-urgent' : 'is-workshop'}`}
                            onClick={() => openDashboardWorkshopItem(item)}
                            title="Открыть позицию в цехе"
                          >
                            <span className="dashboard-warning-main">
                              <strong>{item.productName}</strong>
                              <em>{[item.gender, item.color, item.material, item.length, item.size].filter(Boolean).join(' · ') || 'Без характеристик'}</em>
                              <small>{item.reason} · {item.externalOrderId || 'без номера заказа'} · {item.managerName || 'без менеджера'}{item.city ? ` · ${item.city}` : ''}</small>
                            </span>
                            <span className="dashboard-warning-side">
                              <b>{item.waitingDays}</b>
                              <small>дн.</small>
                            </span>
                          </button>
                        )) : (
                          <div className="empty-state">Долгих незавершённых позиций нет.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </section>
  )
}
