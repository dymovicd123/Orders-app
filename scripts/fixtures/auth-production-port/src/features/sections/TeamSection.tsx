// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
type SectionContext = Record<string, any>

export function TeamSection({ ctx }: { ctx: SectionContext }) {
  const {
    exportTeamPlanReportWord,
    formatDateShort,
    formatLocalDateInput,
    formatMoney,
    formatPercent,
    getTimesheetCalendarSlots,
    getTimesheetEntriesForDate,
    getTimesheetWeekdayLabel,
    isAdmin,
    loadPlans,
    loadTeamActivityReport,
    loadTeamSalaryReport,
    loadTeamTimesheet,
    MANAGER_COLOR_OPTIONS,
    ManagerBadge,
    planBusy,
    planFilters,
    planReport,
    printTeamPlanReportPdf,
    removeTeamEmployee,
    resolveManagerDisplayColor,
    saveTeamEmployee,
    saveTeamEmployeeColor,
    saveTeamTimesheet,
    sectorStyle,
    setPlanFilters,
    setTeamActivityFilters,
    setTeamColorEditorId,
    setTeamDraft,
    setTeamEmployeeEmploymentStatus,
    setTeamFormOpen,
    setTeamMode,
    setTeamRosterView,
    setTeamSalaryFilters,
    setTimesheetComment,
    setTimesheetCurrentMonth,
    setTimesheetDaysPreset,
    setTimesheetMonth,
    setTimesheetSelectedDays,
    setTimesheetSelectedManagers,
    setTimesheetWorkUntil,
    shiftTimesheetMonth,
    teamActivityBusy,
    teamActivityFilters,
    teamActivityLoadFailed,
    teamActivityReport,
    teamBusy,
    teamColorEditorId,
    teamDraft,
    teamEmployees,
    teamFormOpen,
    teamMode,
    teamRosterView,
    teamSalaryFilters,
    teamSalaryReport,
    timesheetBusy,
    timesheetComment,
    timesheetData,
    timesheetMonth,
    timesheetSelectedDays,
    timesheetSelectedManagers,
    timesheetWorkUntil,
    toggleTimesheetDay,
    toggleTimesheetManager,
  } = ctx

  return (
    <article className="card wide sector-team" id="team" style={sectorStyle('team')}>
              <div className="card-label">Команда</div>
              <div className="card-meta">Активные сотрудники отделены от бывших. Цвет помогает различать людей с одинаковыми именами.</div>
              <div className="summary-grid compact-summary team-summary-clean">
                <div className="summary-card"><span>Активных</span><strong>{teamEmployees.filter((employee) => employee.isActive).length}</strong></div>
                <div className="summary-card"><span>Бывших</span><strong>{teamEmployees.filter((employee) => !employee.isActive).length}</strong></div>
              </div>
    
              <div className="order-panel-tabs team-mode-tabs" role="tablist" aria-label="Раздел команды">
                <button className={`secondary compact ${teamMode === 'employees' ? 'is-active' : ''}`} type="button" onClick={() => setTeamMode('employees')}>Сотрудники</button>
                <button className={`secondary compact ${teamMode === 'timesheet' ? 'is-active' : ''}`} type="button" onClick={() => setTeamMode('timesheet')}>Табель</button>
                <button className={`secondary compact ${teamMode === 'plan' ? 'is-active' : ''}`} type="button" onClick={() => setTeamMode('plan')}>Выполнение плана</button>
                <button className={`secondary compact ${teamMode === 'salary' ? 'is-active' : ''}`} type="button" onClick={() => setTeamMode('salary')}>Зарплата</button>
                <button className={`secondary compact ${teamMode === 'activity' ? 'is-active' : ''}`} type="button" onClick={() => setTeamMode('activity')}>Работа с заказами</button>
              </div>
    
              {teamMode === 'employees' ? (
                <>
                  <div className="team-roster-toolbar">
                    <div className="team-roster-tabs" role="tablist" aria-label="Состав команды">
                      <button className={`secondary compact ${teamRosterView === 'active' ? 'is-active' : ''}`} type="button" onClick={() => setTeamRosterView('active')}>Активные ({teamEmployees.filter((employee) => employee.isActive).length})</button>
                      <button className={`secondary compact ${teamRosterView === 'former' ? 'is-active' : ''}`} type="button" onClick={() => setTeamRosterView('former')}>Бывшие ({teamEmployees.filter((employee) => !employee.isActive).length})</button>
                    </div>
                    {isAdmin ? (
                      <button className="primary compact" type="button" onClick={() => {
                        setTeamDraft({ id: 0, name: '', role: 'Менеджер', phone: '', colorKey: MANAGER_COLOR_OPTIONS[teamEmployees.length % MANAGER_COLOR_OPTIONS.length], hiredAt: formatLocalDateInput(), comment: '', isActive: true })
                        setTeamFormOpen(true)
                      }}>+ Добавить сотрудника</button>
                    ) : null}
                  </div>
    
                  {teamFormOpen ? (
                    <section className="mini-panel team-editor-panel">
                      <div className="mini-panel-head">
                        <div>
                          <h3>{teamDraft.id ? 'Редактирование сотрудника' : 'Новый сотрудник'}</h3>
                          <p className="mini-panel-note">Одинаковые имена разрешены. Цвет помогает быстро различать сотрудников, а дата ниже используется только как дополнительная информация.</p>
                        </div>
                        <button className="ghost compact" type="button" onClick={() => setTeamFormOpen(false)}>Закрыть</button>
                      </div>
                      <div className="form-grid compact-form team-editor-grid">
                        <label>Имя сотрудника
                          <input disabled={!isAdmin} value={teamDraft.name} onChange={(event) => setTeamDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="Например: АСЕЛЬ" />
                        </label>
                        <label>Роль
                          <select disabled={!isAdmin} value={teamDraft.role} onChange={(event) => setTeamDraft((draft) => ({ ...draft, role: event.target.value }))}>
                            <option value="Менеджер">Менеджер</option>
                            <option value="Админ">Админ</option>
                          </select>
                        </label>
                        <label>Дата начала (если ещё нет заказов)
                          <input disabled={!isAdmin} type="date" value={teamDraft.hiredAt} onChange={(event) => setTeamDraft((draft) => ({ ...draft, hiredAt: event.target.value }))} />
                        </label>
                        <label>Контакт необязательно
                          <input disabled={!isAdmin} value={teamDraft.phone} onChange={(event) => setTeamDraft((draft) => ({ ...draft, phone: event.target.value }))} placeholder="Телефон или рабочая почта" />
                        </label>
                        <label className="span-2">Цвет сотрудника
                          <span className="manager-color-picker" role="radiogroup" aria-label="Цвет сотрудника">
                            {MANAGER_COLOR_OPTIONS.map((color) => (
                              <button
                                key={`manager-color-${color}`}
                                type="button"
                                className={`manager-color-choice ${teamDraft.colorKey.toUpperCase() === color ? 'is-selected' : ''}`}
                                style={{ backgroundColor: color }}
                                onClick={() => setTeamDraft((draft) => ({ ...draft, colorKey: color }))}
                                aria-label={`Выбрать цвет ${color}`}
                              />
                            ))}
                            <span className="manager-custom-color">
                              <input
                                type="color"
                                value={resolveManagerDisplayColor(teamDraft.colorKey, teamDraft.id || teamDraft.name)}
                                onChange={(event) => setTeamDraft((draft) => ({ ...draft, colorKey: event.target.value.toUpperCase() }))}
                                aria-label="Выбрать собственный цвет"
                              />
                              <span>Свой цвет</span>
                            </span>
                          </span>
                        </label>
                        <label className="span-2">Комментарий
                          <input disabled={!isAdmin} value={teamDraft.comment} onChange={(event) => setTeamDraft((draft) => ({ ...draft, comment: event.target.value }))} placeholder="Внутреннее примечание, если нужно" />
                        </label>
                      </div>
                      <div className="button-row">
                        <button className="primary" type="button" disabled={teamBusy || !isAdmin} onClick={() => void saveTeamEmployee()}>{teamBusy ? 'Сохраняю...' : teamDraft.id ? 'Сохранить изменения' : 'Создать сотрудника'}</button>
                        <button className="secondary" type="button" onClick={() => setTeamFormOpen(false)}>Отмена</button>
                      </div>
                    </section>
                  ) : null}
    
                  <div className="team-roster-note">
                    {teamRosterView === 'active'
                      ? 'Здесь только действующие сотрудники. Увольнение переносит человека в отдельный список и не меняет старые заказы.'
                      : 'Бывшие сотрудники не появляются в новых заказах. Их история, планы и отчёты остаются доступными.'}
                  </div>
    
                  <div className="table-shell">
                    <table className="data-table team-roster-table">
                      <thead>
                        {teamRosterView === 'active' ? (
                          <tr><th>Сотрудник</th><th>Роль</th><th>Первый заказ</th><th>Цвет</th><th>Действия</th></tr>
                        ) : (
                          <tr><th>Сотрудник</th><th>Роль</th><th>Первый заказ</th><th>Уволен</th><th>Действия</th></tr>
                        )}
                      </thead>
                      <tbody>
                        {teamEmployees.filter((employee) => teamRosterView === 'active' ? employee.isActive : !employee.isActive).map((employee) => (
                          <tr key={`employee-${employee.id}`}>
                            <td>
                              <div className="team-person-cell">
                                <ManagerBadge name={employee.name} colorKey={employee.colorKey} seed={employee.id} />
                                {employee.phone ? <small>{employee.phone}</small> : null}
                              </div>
                            </td>
                            <td>{employee.role || 'Менеджер'}</td>
                            <td>{formatDateShort(employee.hiredAt || employee.createdAt || '')}</td>
                            <td>{teamRosterView === 'active' ? (
                              <div className="team-inline-color-editor">
                                <button
                                  className="team-color-trigger"
                                  type="button"
                                  disabled={!isAdmin || teamBusy}
                                  onClick={() => setTeamColorEditorId((current) => current === employee.id ? null : employee.id)}
                                >
                                  <span className="manager-color-dot" style={{ backgroundColor: resolveManagerDisplayColor(employee.colorKey, employee.id) }} />
                                  <span>Изменить</span>
                                </button>
                                {teamColorEditorId === employee.id ? (
                                  <div className="team-inline-color-palette">
                                    {MANAGER_COLOR_OPTIONS.map((color) => (
                                      <button
                                        key={`quick-color-${employee.id}-${color}`}
                                        type="button"
                                        className={`manager-color-choice is-small ${resolveManagerDisplayColor(employee.colorKey, employee.id) === color ? 'is-selected' : ''}`}
                                        style={{ backgroundColor: color }}
                                        disabled={teamBusy}
                                        onClick={() => void saveTeamEmployeeColor(employee, color)}
                                        aria-label={`Назначить цвет ${color}`}
                                      />
                                    ))}
                                    <label className="team-custom-color-inline">
                                      <input
                                        type="color"
                                        value={resolveManagerDisplayColor(employee.colorKey, employee.id)}
                                        disabled={teamBusy}
                                        onChange={(event) => void saveTeamEmployeeColor(employee, event.target.value)}
                                      />
                                      <span>Свой</span>
                                    </label>
                                  </div>
                                ) : null}
                              </div>
                            ) : formatDateShort(employee.dismissedAt || employee.updatedAt || '')}</td>
                            <td>{isAdmin ? (
                              <div className="table-action-row">
                                <button className="secondary compact" type="button" onClick={() => {
                                  setTeamDraft({ id: employee.id, name: employee.name, role: employee.role || 'Менеджер', phone: employee.phone || '', colorKey: employee.colorKey || '#2563EB', hiredAt: employee.hiredAt || formatLocalDateInput(), comment: employee.comment || '', isActive: employee.isActive })
                                  setTeamFormOpen(true)
                                }}>Редактировать</button>
                                {employee.isActive ? (
                                  <button className="ghost danger compact" type="button" disabled={teamBusy} onClick={() => void setTeamEmployeeEmploymentStatus(employee, false)}>Уволить</button>
                                ) : (
                                  <button className="secondary compact" type="button" disabled={teamBusy} onClick={() => void setTeamEmployeeEmploymentStatus(employee, true)}>Восстановить</button>
                                )}
                                {employee.canDelete ? (
                                  <button className="ghost danger compact" type="button" disabled={teamBusy} onClick={() => void removeTeamEmployee(employee)}>Удалить ошибочную запись</button>
                                ) : null}
                              </div>
                            ) : <span className="muted">Просмотр</span>}</td>
                          </tr>
                        ))}
                        {!teamEmployees.some((employee) => teamRosterView === 'active' ? employee.isActive : !employee.isActive) ? (
                          <tr><td colSpan={5} className="empty-state">{teamRosterView === 'active' ? 'Активных сотрудников нет.' : 'Бывших сотрудников нет.'}</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
    
              {teamMode === 'timesheet' ? (
                <>
                  <div className="orders-filter-panel reports-workspace-panel timesheet-control-panel-v2">
                    <div className="reports-filter-header">
                      <div>
                        <h3>Табель</h3>
                        <div className="muted-note">Сымбат и администраторы не назначаются в табель. Выбери дни в календаре, сотрудников и время работы.</div>
                      </div>
                      <div className="reports-period-buttons timesheet-month-switcher">
                        <button className="secondary compact" type="button" onClick={() => shiftTimesheetMonth(-1)}>←</button>
                        <input type="month" value={timesheetMonth} onChange={(event) => { setTimesheetMonth(event.target.value); setTimesheetSelectedDays([]) }} />
                        <button className="secondary compact" type="button" onClick={() => shiftTimesheetMonth(1)}>→</button>
                        <button className="secondary compact" type="button" onClick={setTimesheetCurrentMonth}>Этот месяц</button>
                        <button className="secondary compact" type="button" disabled={timesheetBusy} onClick={() => void loadTeamTimesheet()}>Обновить</button>
                      </div>
                    </div>
    
                    <div className="timesheet-selection-summary-v2">
                      <strong>Выбрано:</strong> {timesheetSelectedDays.length} дн. · {timesheetSelectedManagers.length ? `${timesheetSelectedManagers.length} сотрудн.` : 'без выбора сотрудников'} · до {timesheetWorkUntil || 'без времени'}
                    </div>
    
                    <div className="timesheet-action-grid-v2">
                      <section className="timesheet-panel-v2">
                        <div className="timesheet-section-label">Быстрый выбор дней</div>
                        <div className="button-row compact-wrap">
                          <button className="secondary compact" type="button" onClick={() => setTimesheetDaysPreset('all')}>Все дни</button>
                          <button className="secondary compact" type="button" onClick={() => setTimesheetDaysPreset('weekdays')}>Будни</button>
                          <button className="secondary compact" type="button" onClick={() => setTimesheetDaysPreset('weekends')}>Выходные</button>
                          <button className="secondary compact" type="button" onClick={() => setTimesheetDaysPreset('even')}>Чётные</button>
                          <button className="secondary compact" type="button" onClick={() => setTimesheetDaysPreset('odd')}>Нечётные</button>
                          <button className="ghost compact" type="button" onClick={() => setTimesheetDaysPreset('clear')}>Снять выбор</button>
                        </div>
                      </section>
    
                      <section className="timesheet-panel-v2">
                        <div className="timesheet-section-label">Кого назначить</div>
                        <div className="button-row compact-wrap">
                          <button className="secondary compact" type="button" onClick={() => setTimesheetSelectedManagers(timesheetData?.employees.map((employee) => employee.id) || [])}>Выбрать всех</button>
                          <button className="ghost compact" type="button" onClick={() => setTimesheetSelectedManagers([])}>Снять всех</button>
                        </div>
                        <div className="reference-chips timesheet-employee-chips-v2">
                          {(timesheetData?.employees || []).map((employee) => (
                            <button key={`timesheet-employee-${employee.id}`} className={`chip-button timesheet-manager-chip ${timesheetSelectedManagers.includes(employee.id) ? 'is-active' : ''}`} type="button" onClick={() => toggleTimesheetManager(employee.id)}>
                              <span className="manager-color-dot" style={{ backgroundColor: resolveManagerDisplayColor(employee.colorKey, employee.id) }} />
                              <span>{employee.name} · {employee.role || 'Менеджер'}</span>
                            </button>
                          ))}
                          {!(timesheetData?.employees || []).length ? <span className="empty-state">Обычных активных сотрудников нет. Администраторы скрыты из табеля.</span> : null}
                        </div>
                      </section>
    
                      <section className="timesheet-panel-v2 timesheet-time-panel-v2">
                        <div className="timesheet-section-label">Назначение</div>
                        <label>Работают до<input type="time" value={timesheetWorkUntil} onChange={(event) => setTimesheetWorkUntil(event.target.value)} /></label>
                        <label>Комментарий<input value={timesheetComment} onChange={(event) => setTimesheetComment(event.target.value)} placeholder="Например: усиленная смена" /></label>
                        <div className="button-row compact-wrap">
                          <button className="primary compact" type="button" disabled={timesheetBusy || !isAdmin} onClick={() => void saveTeamTimesheet(false)}>Назначить выбранное</button>
                          <button className="ghost danger compact" type="button" disabled={timesheetBusy || !isAdmin || !timesheetSelectedDays.length} onClick={() => void saveTeamTimesheet(true)}>Очистить выбранные дни</button>
                        </div>
                      </section>
                    </div>
                  </div>
    
                  <div className="timesheet-calendar-v2">
                    {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((label) => <div key={`weekday-${label}`} className="timesheet-weekday-v2">{label}</div>)}
                    {getTimesheetCalendarSlots().map((date, index) => {
                      if (!date) return <div key={`timesheet-empty-${index}`} className="timesheet-day-v2 is-empty" />
                      const entries = getTimesheetEntriesForDate(date)
                      const selected = timesheetSelectedDays.includes(date)
                      const weekend = ['Сб', 'Вс'].includes(getTimesheetWeekdayLabel(date))
                      return (
                        <button key={`timesheet-day-${date}`} className={`timesheet-day-v2 ${selected ? 'selected' : ''} ${weekend ? 'weekend' : ''} ${entries.length ? 'has-work' : ''}`} type="button" onClick={() => toggleTimesheetDay(date)}>
                          <span className="timesheet-day-head-v2"><strong>{Number(date.slice(-2))}</strong><em>{getTimesheetWeekdayLabel(date)}</em></span>
                          {entries.length ? (
                            <span className="timesheet-day-assignments-v2">
                              {entries.map((entry) => <span key={`assignment-${entry.id}`} className="timesheet-assignment-pill-v2"><span className="manager-color-dot" style={{ backgroundColor: resolveManagerDisplayColor(entry.managerColor, entry.managerId) }} />{entry.manager}{entry.workUntil ? ` до ${entry.workUntil}` : ''}</span>)}
                            </span>
                          ) : <span className="timesheet-empty-note-v2">Свободно</span>}
                        </button>
                      )
                    })}
                  </div>
                </>
              ) : null}
    
              {teamMode === 'plan' ? (
                <>
                  <div className="report-filter-row">
                    <label>Начало<input type="date" value={planFilters.dateFrom} onChange={(event) => setPlanFilters((filters) => ({ ...filters, dateFrom: event.target.value }))} /></label>
                    <label>Конец<input type="date" value={planFilters.dateTo} onChange={(event) => setPlanFilters((filters) => ({ ...filters, dateTo: event.target.value }))} /></label>
                    <button className="primary compact" type="button" disabled={planBusy} onClick={() => void loadPlans()}>{planBusy ? 'Считаю...' : 'Показать выполнение'}</button>
                    <button className="secondary compact" type="button" onClick={exportTeamPlanReportWord}>Скачать Word</button>
                    <button className="secondary compact" type="button" onClick={printTeamPlanReportPdf}>PDF / печать</button>
                  </div>
                  <div id="teamPlanReportExport" className="team-plan-dashboard">
                    <div className="summary-grid compact-summary">
                      <div className="summary-card"><span>Менеджеров с планом</span><strong>{planReport?.managerPlans.length || 0}</strong></div>
                      <div className="summary-card"><span>План</span><strong>{formatMoney((planReport?.managerPlans || []).reduce((sum, row) => sum + Number(row.plannedAmount || 0), 0))}</strong></div>
                      <div className="summary-card"><span>Факт</span><strong>{formatMoney((planReport?.managerPlans || []).reduce((sum, row) => sum + Number(row.factAmount || 0), 0))}</strong></div>
                      <div className="summary-card danger-card"><span>Возвраты</span><strong>{formatMoney((planReport?.managerPlans || []).reduce((sum, row) => sum + Number(row.returnAmount || 0), 0))}</strong></div>
                    </div>
                    <div className="team-plan-card-list">
                      {(planReport?.managerPlans || []).map((row, index) => {
                        const completion = Math.max(0, Math.min(1.2, Number(row.completionRate || 0)))
                        const remaining = Math.max(0, Number(row.plannedAmount || 0) - Number(row.factAmount || 0))
                        return (
                          <article className="team-plan-card" key={`team-plan-card-${row.id}`}>
                            <div className="team-plan-card-name"><strong><span className="team-plan-index">{index + 1}.</span> <ManagerBadge name={row.manager} colorKey={row.managerColor} compact /></strong><span>{formatPercent(row.completionRate)} · {Number(row.completionRate || 0) >= 1 ? 'план выполнен' : 'в процессе'}</span></div>
                            <div className="team-plan-progress"><i style={{ width: `${Math.min(100, Math.round(completion * 100))}%` }} /></div>
                            <div className="team-plan-metrics">
                              <span>Факт: <b>{formatMoney(row.factAmount)}</b></span>
                              <span>План: <b>{formatMoney(row.plannedAmount)}</b></span>
                              <span>Возвраты: <b>{formatMoney(row.returnAmount)}</b></span>
                              <span>Осталось: <b>{formatMoney(remaining)}</b></span>
                              <span>Бонус: <b>{formatMoney(row.bonusAmount || 0)}</b></span>
                            </div>
                          </article>
                        )
                      })}
                      {!(planReport?.managerPlans || []).length ? <div className="empty-state">Показателей выполнения пока нет.</div> : null}
                    </div>
                  </div>
                </>
              ) : null}
    
              {teamMode === 'salary' ? (
                <>
                  <div className="report-filter-row">
                    <label>Начало<input type="date" value={teamSalaryFilters.dateFrom} onChange={(event) => setTeamSalaryFilters((filters) => ({ ...filters, dateFrom: event.target.value }))} /></label>
                    <label>Конец<input type="date" value={teamSalaryFilters.dateTo} onChange={(event) => setTeamSalaryFilters((filters) => ({ ...filters, dateTo: event.target.value }))} /></label>
                    <button className="primary compact" type="button" disabled={teamBusy} onClick={() => void loadTeamSalaryReport()}>Показать зарплату</button>
                  </div>
                  <div className="summary-grid compact-summary">
                    <div className="summary-card"><span>Сотрудников</span><strong>{teamSalaryReport?.totals.employees || 0}</strong></div>
                    <div className="summary-card"><span>Рабочих дней</span><strong>{teamSalaryReport?.totals.workDays || 0}</strong></div>
                    <div className="summary-card"><span>Оклад</span><strong>{formatMoney(teamSalaryReport?.totals.salaryBase || 0)}</strong></div>
                    <div className="summary-card"><span>Бонус</span><strong>{formatMoney(teamSalaryReport?.totals.bonusAmount || 0)}</strong></div>
                    <div className="summary-card"><span>Итого</span><strong>{formatMoney(teamSalaryReport?.totals.totalSalary || 0)}</strong></div>
                  </div>
                  <div className="table-shell"><table className="data-table"><thead><tr><th>Сотрудник</th><th>Роль</th><th>Дней</th><th>План</th><th>Факт</th><th>%</th><th>Оклад</th><th>Бонус</th><th>Итого</th></tr></thead><tbody>
                    {(teamSalaryReport?.rows || []).map((row) => <tr key={`salary-${row.managerId || row.manager}`}><td><ManagerBadge name={row.manager} colorKey={row.managerColor} compact /></td><td>{row.role}</td><td>{row.workDays}</td><td>{formatMoney(row.plannedAmount)}</td><td>{formatMoney(row.factAmount)}</td><td>{formatPercent(row.completionRate)}</td><td>{formatMoney(row.salaryBase)}</td><td>{formatMoney(row.bonusAmount)}</td><td>{formatMoney(row.totalSalary)}</td></tr>)}
                    {!(teamSalaryReport?.rows || []).length ? <tr><td colSpan={9} className="empty-state">Зарплата пока не рассчитана.</td></tr> : null}
                  </tbody></table></div>
                </>
              ) : null}
    
              {teamMode === 'activity' ? (
                <>
                  <div className="report-filter-row">
                    <label>Начало<input type="date" value={teamActivityFilters.dateFrom} onChange={(event) => setTeamActivityFilters((filters) => ({ ...filters, dateFrom: event.target.value }))} /></label>
                    <label>Конец<input type="date" value={teamActivityFilters.dateTo} onChange={(event) => setTeamActivityFilters((filters) => ({ ...filters, dateTo: event.target.value }))} /></label>
                    <label>Поиск<input value={teamActivityFilters.q} onChange={(event) => setTeamActivityFilters((filters) => ({ ...filters, q: event.target.value }))} placeholder="Менеджер, заказ, комментарий" /></label>
                    <label>Тип<select value={teamActivityFilters.actionType} onChange={(event) => setTeamActivityFilters((filters) => ({ ...filters, actionType: event.target.value as TeamActivityType }))}>
                      <option value="all">Все события</option>
                      <option value="orders">Заказы</option>
                      <option value="debt">Закрытия долга</option>
                      <option value="payments">Оплаты</option>
                      <option value="returns">Возвраты</option>
                      <option value="exchanges">Обмены</option>
                    </select></label>
                    <button className="primary compact" type="button" disabled={teamActivityBusy} onClick={() => void loadTeamActivityReport()}>{teamActivityBusy ? 'Загружаю...' : 'Показать'}</button>
                  </div>
                  {teamActivityLoadFailed ? <div className="inline-note danger-note team-activity-inline-error">{teamActivityReport ? 'Не удалось обновить данные. Ниже оставлена предыдущая успешная загрузка — она может не соответствовать выбранным сейчас фильтрам.' : 'Не удалось загрузить работу с заказами. Нажмите «Показать» ещё раз. Если ошибка повторится, система покажет её точную причину.'}</div> : null}
                  <div className="summary-grid compact-summary">
                    <div className="summary-card"><span>Заказы</span><strong>{teamActivityReport ? teamActivityReport.totals.orders : '—'}</strong></div>
                    <div className="summary-card"><span>Оплаты</span><strong>{teamActivityReport ? teamActivityReport.totals.payments : '—'}</strong></div>
                    <div className="summary-card"><span>Закрытые долги</span><strong>{teamActivityReport ? teamActivityReport.totals.debtClosed : '—'}</strong></div>
                    <div className="summary-card"><span>Возвраты</span><strong>{teamActivityReport ? teamActivityReport.totals.returns : '—'}</strong></div>
                    <div className="summary-card"><span>Обмены</span><strong>{teamActivityReport ? teamActivityReport.totals.exchanges : '—'}</strong></div>
                  </div>
                  <div className="report-grid two-columns">
                    <section className="report-block">
                      <h3>Итого по менеджерам заказов</h3>
                      <div className="table-shell"><table className="data-table"><thead><tr><th>Менеджер заказа</th><th>Заказы</th><th>Закрытые долги</th><th>Оплаты</th><th>Возвраты</th><th>Обмены</th></tr></thead><tbody>
                        {(teamActivityReport?.summary || []).map((row) => <tr key={`activity-summary-${row.managerId || row.manager}`}><td><ManagerBadge name={row.manager} colorKey={row.managerColor} compact /></td><td>{row.orders}</td><td>{row.debtClosed}</td><td>{row.payments}</td><td>{row.returns}</td><td>{row.exchanges}</td></tr>)}
                        {teamActivityReport && !(teamActivityReport.summary || []).length ? <tr><td colSpan={6} className="empty-state">Рабочей активности за период нет.</td></tr> : null}
                      </tbody></table></div>
                    </section>
                    <section className="report-block">
                      <h3>История работы с заказами</h3>
                      <div className="table-shell"><table className="data-table"><thead><tr><th>Дата</th><th>Менеджер заказа</th><th>Заказ</th><th>Действие</th><th>Сумма</th></tr></thead><tbody>
                        {(teamActivityReport?.rows || []).map((entry) => <tr key={`team-activity-${entry.id}`}><td>{formatDateShort(entry.actionDate || entry.actionAt)}</td><td><ManagerBadge name={entry.manager} colorKey={entry.managerColor} compact /></td><td>{entry.externalOrderId || '—'}</td><td><strong>{entry.title}</strong><br /><span className="muted-note">{entry.details || '—'}</span></td><td>{entry.amount ? formatMoney(entry.amount) : '—'}</td></tr>)}
                        {teamActivityReport && !(teamActivityReport.rows || []).length ? <tr><td colSpan={5} className="empty-state">За выбранный период событий по заказам нет.</td></tr> : null}
                      </tbody></table></div>
                      {teamActivityReport?.hasMore ? <button className="secondary compact team-activity-load-more" type="button" disabled={teamActivityBusy} onClick={() => void loadTeamActivityReport(teamActivityFilters, { append: true })}>{teamActivityBusy ? 'Загружаю…' : 'Показать ещё'}</button> : null}
                    </section>
                  </div>
                </>
              ) : null}
            </article>
  )
}
