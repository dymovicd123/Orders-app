// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { FinanceDashboardRenderer } from '../renderers/FinanceDashboardRenderer'
type SectionContext = Record<string, any>

export function FinanceSection({ ctx }: { ctx: SectionContext }) {
  const {
    financeMode,
    financeReportBusy,
    financeReportFilters,
    getPeriodRange,
    financeDashboardCtx,
    sectorStyle,
    setFinanceReportFilters,
  } = ctx

  return (
    <article className="card wide sector-finance" id="finance" style={sectorStyle('finance')}>
              <div className="card-label">Финансы</div>
              <div className="card-meta">Продажи, реальные поступления и текущий долг показаны отдельно — без смешивания разных смыслов.</div>
    
              {financeMode !== 'cash' ? <div className="orders-filter-panel finance-workspace-panel">
                <div className="reports-filter-header">
                  <div>
                    <h3>Период сводки</h3>
                    <div className="muted-note">Выберите даты или один из быстрых периодов.</div>
                  </div>
                  <div className="reports-period-buttons" role="tablist" aria-label="Период финансов">
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('today'))}>Сегодня</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('yesterday'))}>Вчера</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('month'))}>Месяц</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('year'))}>Год</button>
                  </div>
                </div>
                <div className="orders-filter-grid reports-main-filter-grid">
                  <label>
                    Начало периода
                    <input type="date" value={financeReportFilters.dateFrom} onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
                  </label>
                  <label>
                    Конец периода
                    <input type="date" value={financeReportFilters.dateTo} onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateTo: event.target.value }))} />
                  </label>
                  <div className="finance-auto-refresh" aria-live="polite">
                    <span className={`status-pill ${financeReportBusy ? 'status-warning' : 'status-online'}`}>
                      {financeReportBusy ? 'Обновляю автоматически...' : 'Обновляется автоматически'}
                    </span>
                  </div>
                </div>
              </div> : null}
    
              {FinanceDashboardRenderer(financeDashboardCtx)}
            </article>
  )
}
