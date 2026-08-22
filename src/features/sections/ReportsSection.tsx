// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { FinanceReportContentRenderer } from '../renderers/FinanceReportContentRenderer'
type SectionContext = Record<string, any>

export function ReportsSection({ ctx }: { ctx: SectionContext }) {
  const {
    financeReportBusy,
    financeReportFilters,
    financeReportOptions,
    financeReportType,
    getPeriodRange,
    reloadFinanceReports,
    financeReportContentCtx,
    sectorStyle,
    setFinanceReportFilters,
    setFinanceReportType,
  } = ctx

  return (
    <article className="card wide sector-reports" id="reports" style={sectorStyle('reports')}>
              <div className="card-label">Отчёты</div>
              <div className="card-meta">
                Отчёты вынесены в отдельный раздел: показываются только нужные отчёты из старой системы, без лишних таблиц.
              </div>
    
              <div className="orders-filter-panel reports-workspace-panel">
                <div className="reports-filter-header">
                  <div>
                    <h3>Сводные отчёты</h3>
                    <div className="muted-note">Период в финансовых отчётах всегда определяется по дате заказа.</div>
                  </div>
                  <div className="reports-period-buttons" role="tablist" aria-label="Период отчёта">
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('today'))}>Сегодня</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('yesterday'))}>Вчера</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('month'))}>Месяц</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('year'))}>Год</button>
                  </div>
                </div>
    
                <div className="orders-filter-grid reports-main-filter-grid">
                  <label>
                    Тип отчёта
                    <select value={financeReportType} onChange={(event) => setFinanceReportType(event.target.value as FinanceReportType)}>
                      {financeReportOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <label>
                    Начало периода
                    <input
                      type="date"
                      value={financeReportFilters.dateFrom}
                      onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateFrom: event.target.value }))}
                    />
                  </label>
                  <label>
                    Конец периода
                    <input
                      type="date"
                      value={financeReportFilters.dateTo}
                      onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateTo: event.target.value }))}
                    />
                  </label>
                  <div className="actions orders-filter-actions">
                    <button className="primary" type="button" disabled={financeReportBusy} onClick={() => void reloadFinanceReports()}>
                      {financeReportBusy ? 'Считаю...' : 'Показать отчёт'}
                    </button>
                  </div>
                </div>
              </div>
    
              {FinanceReportContentRenderer(financeReportContentCtx)}
            </article>
  )
}
