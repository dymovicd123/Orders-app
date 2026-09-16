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
  const singleDay = Boolean(financeReportFilters.dateFrom && financeReportFilters.dateFrom === financeReportFilters.dateTo)
  const periodApplies = !['cash', 'methods'].includes(financeMode)

  return (
    <article className="card wide sector-finance" id="finance" style={sectorStyle('finance')}>
      <div className="card-label">Финансы</div>
      <div className="card-meta">Деньги показаны по дате операции. Время внесения хранится для аудита и не меняет день, к которому относится операция.</div>

      {periodApplies ? (
        <div className="orders-filter-panel finance-workspace-panel">
          <div className="reports-filter-header">
            <div>
              <h3>{singleDay ? 'День' : 'Период'}</h3>
              <div className="muted-note">Все операции ниже относятся именно к выбранным датам. Поздний ввод помечается отдельно.</div>
            </div>
            <div className="reports-period-buttons" role="group" aria-label="Период финансов">
              <button className="secondary compact" type="button" aria-pressed={singleDay} onClick={() => setFinanceReportFilters(getPeriodRange('today'))}>Выбрать день</button>
              <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('yesterday'))}>Вчера</button>
              <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('month'))}>Месяц</button>
              <button className="secondary compact" type="button" onClick={() => setFinanceReportFilters(getPeriodRange('year'))}>Год</button>
            </div>
          </div>
          <div className="orders-filter-grid reports-main-filter-grid">
            {singleDay ? (
              <label>Дата<input type="date" value={financeReportFilters.dateFrom} onChange={(event) => setFinanceReportFilters({ dateFrom: event.target.value, dateTo: event.target.value })} /></label>
            ) : <>
              <label>
                С
                <input type="date" value={financeReportFilters.dateFrom} onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateFrom: event.target.value }))} />
              </label>
              <label>
                По
                <input type="date" value={financeReportFilters.dateTo} onChange={(event) => setFinanceReportFilters((current) => ({ ...current, dateTo: event.target.value }))} />
              </label>
            </>}
            <div className="finance-auto-refresh" aria-live="polite">
              <span className={`status-pill ${financeReportBusy ? 'status-warning' : 'status-online'}`}>
                {financeReportBusy ? 'Обновляю...' : 'Данные актуальны'}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="muted-note finance-current-scope-note">
          {financeMode === 'cash'
            ? 'Касса показывает текущее состояние наличных. Выбранный на других вкладках период здесь не применяется.'
            : 'Справочник способов оплаты не зависит от выбранного периода.'}
        </div>
      )}

      {FinanceDashboardRenderer(financeDashboardCtx)}
    </article>
  )
}
