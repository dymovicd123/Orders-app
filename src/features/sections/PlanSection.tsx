// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function PlanSection({ ctx }: { ctx: SectionContext }) {
  const {
    deleteDepartmentPlan,
    deleteManagerPlan,
    departmentPlanDraft,
    editDepartmentPlan,
    editManagerPlan,
    exportPlanReportWord,
    formatDateShort,
    formatMoney,
    formatPercent,
    FriendlyNumberInput,
    isAdmin,
    loadPlans,
    ManagerBadge,
    ManagerPicker,
    managerPlanDraft,
    planBusy,
    planFilters,
    planReport,
    printPlanReportPdf,
    references,
    saveDepartmentPlan,
    saveManagerPlan,
    sectorStyle,
    setDepartmentPlanDraft,
    setManagerPlanDraft,
    setPlanFilters,
  } = ctx

  return (
    <article className="card wide sector-plan" id="plan" style={sectorStyle('plan')}>
              <div className="card-label">План</div>
              <div className="card-meta">План менеджера, план отдела и выполнение собраны в одном модуле.</div>
              <div className="form-grid compact-form">
                <label>Начало<input type="date" value={managerPlanDraft.periodStart} onChange={(event) => setManagerPlanDraft((draft) => ({ ...draft, periodStart: event.target.value }))} /></label>
                <label>Конец<input type="date" value={managerPlanDraft.periodEnd} onChange={(event) => setManagerPlanDraft((draft) => ({ ...draft, periodEnd: event.target.value }))} /></label>
                <label>Менеджер<ManagerPicker valueId={managerPlanDraft.managerId} valueName={managerPlanDraft.managerName} options={references?.managerOptions || []} onChange={(manager) => setManagerPlanDraft((draft) => ({ ...draft, managerId: manager?.id || 0, managerName: manager?.name || '' }))} /></label>
                <label>План<FriendlyNumberInput type="number" min={0} value={managerPlanDraft.plannedAmount} onChange={(event) => setManagerPlanDraft((draft) => ({ ...draft, plannedAmount: Number(event.target.value || 0) }))} /></label>
                <label>Оклад<FriendlyNumberInput type="number" min={0} value={managerPlanDraft.salaryBase} onChange={(event) => setManagerPlanDraft((draft) => ({ ...draft, salaryBase: Number(event.target.value || 100000) }))} /></label>
                <div className="wide-field fixed-bonus-note"><strong>Бонус фиксированный:</strong> план выполнен — 5% от факта, не выполнен — 3%. Факт считается по реальным движениям денег: оплаты по дате оплаты минус возвраты по дате возврата.</div>
    
                <label>Комментарий<input value={managerPlanDraft.comment} onChange={(event) => setManagerPlanDraft((draft) => ({ ...draft, comment: event.target.value }))} /></label>
              </div>
              <div className="button-row"><button className="primary" type="button" disabled={planBusy || !isAdmin} onClick={() => void saveManagerPlan()}>Сохранить план менеджера</button></div>
    
              <div className="form-grid compact-form department-plan-box">
                <label>Начало отдела<input type="date" value={departmentPlanDraft.periodStart} onChange={(event) => setDepartmentPlanDraft((draft) => ({ ...draft, periodStart: event.target.value }))} /></label>
                <label>Конец отдела<input type="date" value={departmentPlanDraft.periodEnd} onChange={(event) => setDepartmentPlanDraft((draft) => ({ ...draft, periodEnd: event.target.value }))} /></label>
                <label>План отдела<FriendlyNumberInput type="number" min={0} value={departmentPlanDraft.plannedAmount} onChange={(event) => setDepartmentPlanDraft((draft) => ({ ...draft, plannedAmount: Number(event.target.value || 0) }))} /></label>
                <label>Комментарий<input value={departmentPlanDraft.comment} onChange={(event) => setDepartmentPlanDraft((draft) => ({ ...draft, comment: event.target.value }))} /></label>
              </div>
              <div className="button-row"><button className="secondary" type="button" disabled={planBusy || !isAdmin} onClick={() => void saveDepartmentPlan()}>Сохранить план отдела</button></div>
    
              <div className="report-filter-row">
                <label>Начало отчёта<input type="date" value={planFilters.dateFrom} onChange={(event) => setPlanFilters((filters) => ({ ...filters, dateFrom: event.target.value }))} /></label>
                <label>Конец отчёта<input type="date" value={planFilters.dateTo} onChange={(event) => setPlanFilters((filters) => ({ ...filters, dateTo: event.target.value }))} /></label>
                <button className="primary compact" type="button" disabled={planBusy} onClick={() => void loadPlans()}>{planBusy ? 'Загружаю...' : 'Показать выполнение'}</button>
                <button className="secondary compact" type="button" onClick={exportPlanReportWord}>Скачать Word</button>
                    <button className="secondary compact" type="button" onClick={printPlanReportPdf}>PDF / печать</button>
              </div>
              <div className="fixed-bonus-note plan-calculation-note">
                <strong>Единое правило:</strong> деньги входят в период по фактической дате операции. Факт = оплаты, поступившие в период, минус возвраты, оформленные в период.
              </div>
              <div id="planReportExport"><div className="report-grid two-columns">
                <section className="report-block"><h3>План менеджеров</h3><div className="table-shell"><table className="data-table"><thead><tr><th>Период</th><th>Менеджер</th><th>План</th><th>Получено</th><th>Возвраты</th><th>Факт</th><th>%</th><th>Оклад</th><th>Бонус</th><th>Итого</th><th className="export-hide">Действия</th></tr></thead><tbody>
                  {(planReport?.managerPlans || []).map((row) => <tr key={`mp-${row.id}`}><td>{formatDateShort(row.periodStart)} — {formatDateShort(row.periodEnd)}</td><td><ManagerBadge name={row.manager} colorKey={row.managerColor} compact /></td><td>{formatMoney(row.plannedAmount)}</td><td>{formatMoney(Number(row.factAmount || 0) + Number(row.returnAmount || 0))}</td><td>{formatMoney(row.returnAmount)}</td><td>{formatMoney(row.factAmount)}</td><td>{formatPercent(row.completionRate)}</td><td>{formatMoney(row.salaryBase)}</td><td>{formatMoney(row.bonusAmount || 0)}</td><td>{formatMoney(row.totalSalary || row.salaryBase || 0)}</td><td className="export-hide">{isAdmin ? <div className="row-actions compact-actions"><button className="secondary compact" type="button" onClick={() => editManagerPlan(row)}>Редактировать</button><button className="ghost danger compact" type="button" onClick={() => void deleteManagerPlan(row.id)}>Удалить</button></div> : '—'}</td></tr>)}
                  {!(planReport?.managerPlans || []).length ? <tr><td colSpan={11} className="empty-state">Планов менеджеров пока нет.</td></tr> : null}
    
                </tbody></table></div></section>
                <section className="report-block"><h3>План отдела</h3><div className="table-shell"><table className="data-table"><thead><tr><th>Период</th><th>План</th><th>Получено</th><th>Возвраты</th><th>Факт</th><th>%</th><th className="export-hide">Действия</th></tr></thead><tbody>
                  {(planReport?.departmentPlans || []).map((row) => <tr key={`dp-${row.id}`}><td>{formatDateShort(row.periodStart)} — {formatDateShort(row.periodEnd)}</td><td>{formatMoney(row.plannedAmount)}</td><td>{formatMoney(Number(row.factAmount || 0) + Number(row.returnAmount || 0))}</td><td>{formatMoney(row.returnAmount)}</td><td>{formatMoney(row.factAmount)}</td><td>{formatPercent(row.completionRate)}</td><td className="export-hide">{isAdmin ? <div className="row-actions compact-actions"><button className="secondary compact" type="button" onClick={() => editDepartmentPlan(row)}>Редактировать</button><button className="ghost danger compact" type="button" onClick={() => void deleteDepartmentPlan(row.id)}>Удалить</button></div> : '—'}</td></tr>)}
                  {!(planReport?.departmentPlans || []).length ? <tr><td colSpan={7} className="empty-state">Плана отдела пока нет.</td></tr> : null}
                </tbody></table></div></section>
              </div></div>
            </article>
  )
}
