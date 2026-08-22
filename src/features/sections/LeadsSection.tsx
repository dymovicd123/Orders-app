// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function LeadsSection({ ctx }: { ctx: SectionContext }) {
  const {
    callCentreDraft,
    callCentreRecords,
    deleteCallCentreRecord,
    deleteLeadRecord,
    editCallCentreRecord,
    editLeadRecord,
    formatDateShort,
    formatLocalDateInput,
    formatPercent,
    FriendlyNumberInput,
    getPeriodRange,
    leadBusy,
    leadDraft,
    leadFilters,
    leadMode,
    leadRecords,
    loadCallCentreRecords,
    loadLeadRecords,
    ManagerBadge,
    ManagerPicker,
    references,
    saveCallCentreRecord,
    saveLeadRecord,
    sectorStyle,
    setCallCentreDraft,
    setLeadDraft,
    setLeadFilters,
    setLeadMode,
  } = ctx

  return (
    <article className="card wide sector-leads" id="leads" style={sectorStyle('leads')}>
              <div className="card-label">Лиды</div>
              <div className="card-meta">Обычные лиды и Call Centre переключаются режимом, как в старой системе.</div>
              <div className="order-panel-tabs" role="tablist" aria-label="Режим лидов">
                <button className={`secondary compact ${leadMode === 'leads' ? 'is-active' : ''}`} type="button" onClick={() => setLeadMode('leads')}>Лиды</button>
                <button className={`secondary compact ${leadMode === 'callCentre' ? 'is-active' : ''}`} type="button" onClick={() => setLeadMode('callCentre')}>Call Centre</button>
              </div>
    
              <div className="report-filter-row">
                <label>Начало периода<input type="date" value={leadFilters.dateFrom} onChange={(event) => setLeadFilters((filters) => ({ ...filters, dateFrom: event.target.value }))} /></label>
                <label>Конец периода<input type="date" value={leadFilters.dateTo} onChange={(event) => setLeadFilters((filters) => ({ ...filters, dateTo: event.target.value }))} /></label>
                <button className="secondary compact" type="button" onClick={() => setLeadFilters(getPeriodRange('month'))}>Месяц</button>
                <button className="secondary compact" type="button" onClick={() => setLeadFilters(getPeriodRange('year'))}>Год</button>
                <button className="primary compact" type="button" disabled={leadBusy} onClick={() => leadMode === 'leads' ? void loadLeadRecords() : void loadCallCentreRecords()}>{leadBusy ? 'Загружаю...' : 'Показать журнал'}</button>
              </div>
    
              {leadMode === 'leads' ? (
                <>
                  <div className="form-grid compact-form">
                    <label>Дата<input type="date" value={leadDraft.date} onChange={(event) => setLeadDraft((draft) => ({ ...draft, date: event.target.value }))} /></label>
                    <label>Менеджер<ManagerPicker valueId={leadDraft.managerId} valueName={leadDraft.managerName} options={references?.managerOptions || []} onChange={(manager) => setLeadDraft((draft) => ({ ...draft, managerId: manager?.id || 0, managerName: manager?.name || '' }))} /></label>
                    <label>Принято лидов<FriendlyNumberInput type="number" min={0} value={leadDraft.acceptedCount} onChange={(event) => setLeadDraft((draft) => ({ ...draft, acceptedCount: Number(event.target.value || 0) }))} /></label>
                    <label>Неквал лиды<FriendlyNumberInput type="number" min={0} value={leadDraft.badCount} onChange={(event) => setLeadDraft((draft) => ({ ...draft, badCount: Number(event.target.value || 0) }))} /></label>
    
                    <label className="span-2">Комментарий<input value={leadDraft.comment} onChange={(event) => setLeadDraft((draft) => ({ ...draft, comment: event.target.value }))} /></label>
                  </div>
                  <div className="button-row">
                    <button className="primary" type="button" disabled={leadBusy} onClick={() => void saveLeadRecord()}>{leadDraft.id ? 'Обновить запись' : 'Сохранить лиды'}</button>
                    {leadDraft.id ? <button className="secondary" type="button" onClick={() => setLeadDraft({ id: 0, date: formatLocalDateInput(), managerId: 0, managerName: '', acceptedCount: 0, badCount: 0, comment: '' })}>Новая запись</button> : null}
                  </div>
                  <div className="table-shell"><table className="data-table"><thead><tr><th>Дата</th><th>Менеджер</th><th>Принято</th><th>Неквал</th><th>Квал</th><th>Продажи</th><th>Конверсия</th><th>Комментарий</th><th className="export-hide">Действия</th></tr></thead><tbody>
                    {leadRecords.map((row) => <tr key={`lead-${row.id}`}><td>{formatDateShort(row.date)}</td><td><ManagerBadge name={row.manager} colorKey={row.managerColor} compact /></td><td>{row.acceptedCount}</td><td>{row.badCount}</td><td>{row.qualifiedCount}</td><td>{row.salesCount}</td><td>{formatPercent(row.conversionRate)}</td><td>{row.comment || '—'}</td><td className="export-hide"><div className="row-actions compact-actions"><button className="secondary compact" type="button" onClick={() => editLeadRecord(row)}>Редактировать</button><button className="ghost danger compact" type="button" onClick={() => void deleteLeadRecord(row.id)}>Удалить</button></div></td></tr>)}
                    {!leadRecords.length ? <tr><td colSpan={9} className="empty-state">Лидов за период пока нет.</td></tr> : null}
                  </tbody></table></div>
                </>
              ) : (
                <>
                  <div className="form-grid compact-form">
                    <label>Дата<input type="date" value={callCentreDraft.date} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, date: event.target.value }))} /></label>
                    <label>Менеджер<ManagerPicker valueId={callCentreDraft.managerId} valueName={callCentreDraft.managerName} options={references?.managerOptions || []} onChange={(manager) => setCallCentreDraft((draft) => ({ ...draft, managerId: manager?.id || 0, managerName: manager?.name || '' }))} /></label>
                    <label>Принято лидов<FriendlyNumberInput type="number" min={0} value={callCentreDraft.acceptedLeads} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, acceptedLeads: Number(event.target.value || 0) }))} /></label>
                    <label>Совершено звонков<FriendlyNumberInput type="number" min={0} value={callCentreDraft.callsMade} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, callsMade: Number(event.target.value || 0) }))} /></label>
                    <label>Принято звонков<FriendlyNumberInput type="number" min={0} value={callCentreDraft.callsAccepted} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, callsAccepted: Number(event.target.value || 0) }))} /></label>
                    <label>Фейки<FriendlyNumberInput type="number" min={0} value={callCentreDraft.fakeCount} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, fakeCount: Number(event.target.value || 0) }))} /></label>
                    <label>Отказники<FriendlyNumberInput type="number" min={0} value={callCentreDraft.refusalCount} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, refusalCount: Number(event.target.value || 0) }))} /></label>
                    <label>Потенциалы<FriendlyNumberInput type="number" min={0} value={callCentreDraft.potentialCount} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, potentialCount: Number(event.target.value || 0) }))} /></label>
    
                    <label className="span-2">Комментарий<input value={callCentreDraft.comment} onChange={(event) => setCallCentreDraft((draft) => ({ ...draft, comment: event.target.value }))} /></label>
                  </div>
                  <div className="button-row">
                    <button className="primary" type="button" disabled={leadBusy} onClick={() => void saveCallCentreRecord()}>{callCentreDraft.id ? 'Обновить запись' : 'Сохранить Call Centre'}</button>
                    {callCentreDraft.id ? <button className="secondary" type="button" onClick={() => setCallCentreDraft({ id: 0, date: formatLocalDateInput(), managerId: 0, managerName: '', acceptedLeads: 0, callsMade: 0, callsAccepted: 0, fakeCount: 0, refusalCount: 0, potentialCount: 0, comment: '' })}>Новая запись</button> : null}
                  </div>
                  <div className="table-shell"><table className="data-table"><thead><tr><th>Дата</th><th>Менеджер</th><th>Лиды</th><th>Звонки</th><th>Принято</th><th>Фейки</th><th>Отказники</th><th>Потенциалы</th><th>% дозвона</th><th className="export-hide">Действия</th></tr></thead><tbody>
                    {callCentreRecords.map((row) => <tr key={`cc-${row.id}`}><td>{formatDateShort(row.date)}</td><td><ManagerBadge name={row.manager} colorKey={row.managerColor} compact /></td><td>{row.acceptedLeads}</td><td>{row.callsMade}</td><td>{row.callsAccepted}</td><td>{row.fakeCount}</td><td>{row.refusalCount}</td><td>{row.potentialCount}</td><td>{formatPercent(row.callAcceptanceRate)}</td><td className="export-hide"><div className="row-actions compact-actions"><button className="secondary compact" type="button" onClick={() => editCallCentreRecord(row)}>Редактировать</button><button className="ghost danger compact" type="button" onClick={() => void deleteCallCentreRecord(row.id)}>Удалить</button></div></td></tr>)}
                    {!callCentreRecords.length ? <tr><td colSpan={10} className="empty-state">Call Centre за период пока пуст.</td></tr> : null}
                  </tbody></table></div>
                </>
              )}
            </article>
  )
}
