// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { FinanceDashboardRenderer } from '../renderers/FinanceDashboardRenderer'
import { FinanceDayPanel } from '../finance/FinanceDayPanel'
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
    apiFetch,
    active,
    accessRole,
  } = ctx
  const singleDay = Boolean(financeReportFilters.dateFrom && financeReportFilters.dateFrom === financeReportFilters.dateTo)
  const dayView = active && singleDay && ['summary', 'payments', 'cash'].includes(financeMode) ? <FinanceDayPanel
    key={`${financeReportFilters.dateFrom}:${financeMode}:${accessRole}`}
    date={financeReportFilters.dateFrom} initialLedger={financeMode === 'cash' ? 'cash' : 'money'} apiFetch={apiFetch}
    cashVersion={financeDashboardCtx.cashRegister} financeVersion={financeDashboardCtx.financeReport}
    onOrder={(event) => void financeDashboardCtx.openOrderFromFinance({ orderId: event.orderId, externalId: event.externalOrderId })}
  /> : null

  return (
    <article className="card wide sector-finance" id="finance" style={sectorStyle('finance')}>
              <div className="card-label">Финансы</div>
              <div className="card-meta">Продажи, реальные поступления и текущий долг показаны отдельно — без смешивания разных смыслов.</div>
    
              <div className="orders-filter-panel finance-workspace-panel">
                <div className="reports-filter-header">
                  <div>
                    <h3>День или период</h3>
                    <div className="muted-note">Для разбора одного дня нажмите «Один день» и выберите дату.</div>
                  </div>
                  <div className="reports-period-buttons" role="tablist" aria-label="Период финансов">
                    <button className="secondary compact" type="button" aria-pressed={singleDay} onClick={() => setFinanceReportFilters(getPeriodRange('today'))}>Один день</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('today'))}>Сегодня</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('yesterday'))}>Вчера</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('month'))}>Месяц</button>
                    <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('year'))}>Год</button>
                  </div>
                </div>
                <div className="orders-filter-grid reports-main-filter-grid">
                  {singleDay ? <label>Дата дня<input type="date" value={financeReportFilters.dateFrom} onChange={(event) => setFinanceReportFilters({ dateFrom: event.target.value, dateTo: event.target.value })} /></label> : <>
                  <label>
                    Начало периода
                    <input type="date" value={financeReportFilters.dateFrom} onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
                  </label>
                  <label>
                    Конец периода
                    <input type="date" value={financeReportFilters.dateTo} onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateTo: event.target.value }))} />
                  </label>
                  </>}
                  <div className="finance-auto-refresh" aria-live="polite">
                    <span className={`status-pill ${financeReportBusy ? 'status-warning' : 'status-online'}`}>
                      {financeReportBusy ? 'Обновляю автоматически...' : 'Обновляется автоматически'}
                    </span>
                  </div>
                </div>
              </div>
              {financeMode === 'cash' && !singleDay ? <p className="muted-note">Ниже — текущая касса. Для разбора прошлой даты выберите «Один день».</p> : null}
    
              {FinanceDashboardRenderer({ ...financeDashboardCtx, financeDay: dayView })}
            </article>
  )
}
