// @ts-nocheck -- view extracted from the legacy monolith; typed view-models are the next refactor stage.
import { useEffect, useRef, useState } from 'react'
type SectionContext = Record<string, any>

export function TeamSection({ ctx }: { ctx: SectionContext }) {
  const {
    apiFetch,
    authUsers,
    authUsersBusy,
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
    loadAuthUsers,
    ManagerBadge,
    planBusy,
    planFilters,
    planReport,
    printTeamPlanReportPdf,
    removeTeamEmployee,
    resolveManagerDisplayColor,
    readJsonResponse,
    saveTeamEmployee,
    saveTeamEmployeeColor,
    saveTeamTimesheet,
    sectorStyle,
    setError,
    setMessage,
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

  const [teamAccessEditorId, setTeamAccessEditorId] = useState<number | null>(null)
  const [teamAccessDraft, setTeamAccessDraft] = useState({ id: 0, login: '', password: '', role: 'manager', isActive: true, mustChangePassword: true })
  const teamAccessLoginRef = useRef<HTMLInputElement | null>(null)
  const [systemAdminEditorOpen, setSystemAdminEditorOpen] = useState(false)
  const [systemAdminDraft, setSystemAdminDraft] = useState({ id: 0, login: '', password: '', isActive: true, mustChangePassword: true })
  const systemAdminLoginRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!teamAccessEditorId) return
    const focusFrame = window.requestAnimationFrame(() => teamAccessLoginRef.current?.focus())
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeTeamEmployeeAccess()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [teamAccessEditorId])

  function suggestTeamLogin(name: string, excludingAccountId = 0) {
    const transliteration: Record<string, string> = {
      А: 'a', Б: 'b', В: 'v', Г: 'g', Д: 'd', Е: 'e', Ё: 'e', Ж: 'zh', З: 'z', И: 'i', Й: 'i',
      К: 'k', Л: 'l', М: 'm', Н: 'n', О: 'o', П: 'p', Р: 'r', С: 's', Т: 't', У: 'u', Ф: 'f',
      Х: 'h', Ц: 'ts', Ч: 'ch', Ш: 'sh', Щ: 'sh', Ы: 'y', Э: 'e', Ю: 'yu', Я: 'ya',
      Ә: 'a', Ғ: 'g', Қ: 'q', Ң: 'n', Ө: 'o', Ұ: 'u', Ү: 'u', Һ: 'h', І: 'i',
    }
    const normalized = String(name || '').trim().toUpperCase()
    let base = ''
    for (const char of normalized) {
      if (/[A-Z0-9]/.test(char)) base += char.toLowerCase()
      else if (transliteration[char]) base += transliteration[char]
      else if (/\s|[-_.]/.test(char)) base += '.'
    }
    base = base.replace(/\.+/g, '.').replace(/^\.|\.$/g, '').slice(0, 24) || 'manager'
    const occupied = new Set(authUsers.filter((user) => user.id !== excludingAccountId).map((user) => user.login.toLowerCase()))
    if (!occupied.has(base)) return base
    let suffix = 2
    while (occupied.has(`${base}${suffix}`)) suffix += 1
    return `${base}${suffix}`.slice(0, 32)
  }

  function teamAuthUserFor(employeeId: number) {
    return authUsers.find((user) => user.managerId === employeeId) || null
  }

  function openSystemAdminAccess(account = null) {
    if (!isAdmin) return
    setSystemAdminDraft({
      id: account?.id || 0,
      login: account?.login || '',
      password: '',
      isActive: account?.isActive ?? true,
      mustChangePassword: account?.mustChangePassword ?? true,
    })
    setSystemAdminEditorOpen(true)
    window.requestAnimationFrame(() => systemAdminLoginRef.current?.focus())
  }

  function closeSystemAdminAccess() {
    setSystemAdminEditorOpen(false)
    setSystemAdminDraft({ id: 0, login: '', password: '', isActive: true, mustChangePassword: true })
  }

  async function saveSystemAdminAccess() {
    if (!isAdmin) return
    const login = String(systemAdminDraft.login || '').trim().toLowerCase()
    const existingAccount = systemAdminDraft.id ? authUsers.find((user) => user.id === systemAdminDraft.id) || null : null
    if (login.length < 3) {
      setError('Логин должен содержать минимум 3 символа.')
      return
    }
    if (!existingAccount && String(systemAdminDraft.password || '').length < 8) {
      setError('Для системного администратора задайте временный пароль минимум из 8 символов.')
      return
    }
    const duplicateLogin = authUsers.find((user) => user.id !== existingAccount?.id && user.login.toLowerCase() === login)
    if (duplicateLogin) {
      setError(`Логин @${login} уже используется.`)
      return
    }

    setError(null)
    setMessage(null)
    try {
      const isEdit = Boolean(existingAccount?.id)
      const password = systemAdminDraft.password || undefined
      const response = await apiFetch(isEdit ? `/api/auth/users/${existingAccount.id}` : '/api/auth/users', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password,
          role: 'admin',
          managerId: null,
          displayName: 'Системный администратор',
          isActive: systemAdminDraft.isActive,
          mustChangePassword: password ? true : systemAdminDraft.mustChangePassword,
        }),
      })
      const data = await readJsonResponse(response, 'Системный администратор')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить системного администратора.')
      await loadAuthUsers()
      closeSystemAdminAccess()
      setMessage(isEdit ? `Системный администратор @${login} обновлён.` : `Системный администратор @${login} создан.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить системного администратора.')
    }
  }

  async function disableSystemAdminAccess(account) {
    if (!isAdmin || !account?.id) return
    if (!window.confirm(`Отключить системного администратора @${account.login}? Активные сессии будут закрыты.`)) return
    setError(null)
    try {
      const response = await apiFetch(`/api/auth/users/${account.id}`, { method: 'DELETE' })
      const data = await readJsonResponse(response, 'Отключение системного администратора')
      if (!response.ok) throw new Error(data.message || 'Не удалось отключить системного администратора.')
      await loadAuthUsers()
      closeSystemAdminAccess()
      setMessage(`Системный администратор @${account.login} отключён.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось отключить системного администратора.')
    }
  }

  function openTeamEmployeeAccess(employee) {
    if (!isAdmin || !employee?.id) return
    const account = teamAuthUserFor(employee.id)
    setTeamAccessEditorId(employee.id)
    setTeamAccessDraft({
      id: account?.id || 0,
      login: account?.login || suggestTeamLogin(employee.name),
      password: '',
      role: account?.role || (String(employee.role || '').toLowerCase().includes('админ') ? 'admin' : 'manager'),
      isActive: account?.isActive ?? true,
      mustChangePassword: account?.mustChangePassword ?? true,
    })
  }

  function closeTeamEmployeeAccess() {
    setTeamAccessEditorId(null)
    setTeamAccessDraft({ id: 0, login: '', password: '', role: 'manager', isActive: true, mustChangePassword: true })
  }

  async function saveTeamEmployeeAccess(employee) {
    if (!isAdmin || !employee?.id) return
    const existingAccount = teamAuthUserFor(employee.id)
    const login = String(teamAccessDraft.login || '').trim().toLowerCase()
    if (login.length < 3) {
      setError('Логин должен содержать минимум 3 символа.')
      return
    }
    if (!existingAccount && String(teamAccessDraft.password || '').length < 8) {
      setError('Для нового входа задайте временный пароль минимум из 8 символов.')
      return
    }
    const duplicateLogin = authUsers.find((user) => user.id !== existingAccount?.id && user.login.toLowerCase() === login)
    if (duplicateLogin) {
      setError(`Логин @${login} уже используется.`)
      return
    }

    setError(null)
    setMessage(null)
    try {
      const isEdit = Boolean(existingAccount?.id)
      const password = teamAccessDraft.password || undefined
      const response = await apiFetch(isEdit ? `/api/auth/users/${existingAccount.id}` : '/api/auth/users', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          login,
          password,
          role: teamAccessDraft.role,
          managerId: employee.id,
          displayName: employee.name,
          isActive: teamAccessDraft.isActive,
          mustChangePassword: password ? true : teamAccessDraft.mustChangePassword,
        }),
      })
      const data = await readJsonResponse(response, 'Доступ сотрудника')
      if (!response.ok) throw new Error(data.message || 'Не удалось сохранить доступ сотрудника.')
      await loadAuthUsers()
      closeTeamEmployeeAccess()
      setMessage(isEdit ? `Доступ @${login} обновлён.` : `Для ${employee.name} создан вход @${login}.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось сохранить доступ сотрудника.')
    }
  }

  async function disableTeamEmployeeAccess(employee) {
    if (!isAdmin || !employee?.id) return
    const account = teamAuthUserFor(employee.id)
    if (!account) return
    if (!window.confirm(`Отключить вход @${account.login} для ${employee.name}? Активные сессии будут закрыты.`)) return
    setError(null)
    try {
      const response = await apiFetch(`/api/auth/users/${account.id}`, { method: 'DELETE' })
      const data = await readJsonResponse(response, 'Отключение доступа')
      if (!response.ok) throw new Error(data.message || 'Не удалось отключить доступ.')
      await loadAuthUsers()
      closeTeamEmployeeAccess()
      setMessage(`Вход @${account.login} отключён.`)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Не удалось отключить доступ сотрудника.')
    }
  }

  const accessEditorEmployee = teamEmployees.find((employee) => employee.id === teamAccessEditorId) || null
  const accessEditorAccount = accessEditorEmployee
    ? authUsers.find((user) => user.managerId === accessEditorEmployee.id) || null
    : null
  const systemAdmins = authUsers.filter((user) => user.role === 'admin' && !user.managerId)

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
                        setTeamDraft({ id: 0, name: '', role: 'Менеджер', phone: '', colorKey: MANAGER_COLOR_OPTIONS[teamEmployees.length % MANAGER_COLOR_OPTIONS.length], hiredAt: formatLocalDateInput(), comment: '', isActive: true, createAccount: true, login: '', password: '', mustChangePassword: true })
                        setTeamFormOpen(true)
                      }}>+ Добавить сотрудника</button>
                    ) : null}
                  </div>
    
                  {teamFormOpen ? (
                    <section className="mini-panel team-editor-panel">
                      <div className="mini-panel-head">
                        <div>
                          <h3>{teamDraft.id ? 'Редактирование сотрудника' : 'Новый сотрудник'}</h3>
                          <p className="mini-panel-note">{teamDraft.id ? 'Здесь меняются данные сотрудника. Доступ в систему настраивается отдельно в таблице ниже.' : 'Создайте сотрудника и, если он будет работать в системе, сразу задайте ему логин и временный пароль.'}</p>
                        </div>
                        <button className="ghost compact" type="button" onClick={() => setTeamFormOpen(false)}>Закрыть</button>
                      </div>
                      <div className="form-grid compact-form team-editor-grid">
                        <label>Имя сотрудника
                          <input
                            disabled={!isAdmin}
                            value={teamDraft.name}
                            onChange={(event) => setTeamDraft((draft) => ({ ...draft, name: event.target.value }))}
                            onBlur={() => {
                              if (!teamDraft.id && teamDraft.createAccount !== false && !String(teamDraft.login || '').trim()) {
                                setTeamDraft((draft) => ({ ...draft, login: suggestTeamLogin(draft.name) }))
                              }
                            }}
                            placeholder="Например: АСЕЛЬ"
                          />
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
                        {(!teamDraft.id || teamDraft.createAccount) ? (
                          <section className="team-access-onboarding span-2">
                            <div className="team-access-onboarding-head">
                              <div>
                                <strong>Вход в систему</strong>
                                <span>Логин будет привязан именно к этому сотруднику, поэтому его заказы и действия останутся на правильном человеке.</span>
                              </div>
                              <label className="team-access-toggle">
                                <input
                                  type="checkbox"
                                  checked={teamDraft.createAccount !== false}
                                  disabled={Boolean(teamDraft.id)}
                                  onChange={(event) => setTeamDraft((draft) => ({ ...draft, createAccount: event.target.checked }))}
                                />
                                <span>{teamDraft.id ? 'Завершить настройку доступа' : 'Создать доступ сразу'}</span>
                              </label>
                            </div>
                            {teamDraft.createAccount !== false ? (
                              <>
                                <div className="team-access-fields">
                                  <label>Логин
                                    <input
                                      value={teamDraft.login || ''}
                                      onChange={(event) => setTeamDraft((draft) => ({ ...draft, login: event.target.value }))}
                                      placeholder={suggestTeamLogin(teamDraft.name) || 'например: asel'}
                                      autoComplete="off"
                                      minLength={3}
                                      maxLength={32}
                                    />
                                    <small>Можно оставить пустым — система возьмёт вариант из имени: <b>@{suggestTeamLogin(teamDraft.name)}</b></small>
                                  </label>
                                  <label>Временный пароль
                                    <input
                                      type="text"
                                      value={teamDraft.password || ''}
                                      onChange={(event) => setTeamDraft((draft) => ({ ...draft, password: event.target.value }))}
                                      placeholder="Минимум 8 символов"
                                      autoComplete="new-password"
                                      minLength={8}
                                    />
                                    <small>Передайте пароль сотруднику лично. После первого входа он сможет заменить его.</small>
                                  </label>
                                </div>
                                <label className="checkbox-row team-force-password-change">
                                  <input
                                    type="checkbox"
                                    checked={teamDraft.mustChangePassword !== false}
                                    onChange={(event) => setTeamDraft((draft) => ({ ...draft, mustChangePassword: event.target.checked }))}
                                  />
                                  <span>Потребовать сменить временный пароль при первом входе</span>
                                </label>
                              </>
                            ) : (
                              <div className="team-access-off-note">Сотрудник будет создан без входа. Доступ можно подключить позже одной кнопкой в его строке.</div>
                            )}
                          </section>
                        ) : null}
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
                          <tr><th>Сотрудник</th><th>Роль</th><th>Первый заказ</th><th>Цвет</th><th>Доступ</th><th>Действия</th></tr>
                        ) : (
                          <tr><th>Сотрудник</th><th>Роль</th><th>Первый заказ</th><th>Уволен</th><th>Доступ</th><th>Действия</th></tr>
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
                            <td>
                              {(() => {
                                const account = authUsers.find((user) => user.managerId === employee.id) || null
                                return (
                                  <div className="team-access-cell">
                                    {account ? (
                                      <div className="team-access-identity">
                                        <strong>@{account.login}</strong>
                                        <span className={`team-access-status ${account.isActive ? 'is-active' : 'is-disabled'}`}>
                                          {account.isActive ? 'Вход включён' : 'Вход отключён'}
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="team-access-identity is-missing">
                                        <strong>Нет аккаунта</strong>
                                        <span>Сотрудник пока не может войти</span>
                                      </div>
                                    )}
                                    {isAdmin && employee.isActive ? (
                                      <button
                                        className={account ? 'secondary compact' : 'primary compact team-access-create-button'}
                                        type="button"
                                        disabled={teamBusy || authUsersBusy}
                                        onClick={() => {
                                          setTeamFormOpen(false)
                                          openTeamEmployeeAccess(employee)
                                        }}
                                      >
                                        {account ? 'Настроить' : 'Создать вход'}
                                      </button>
                                    ) : null}
                                  </div>
                                )
                              })()}
                            </td>
                            <td>{isAdmin ? (
                              <div className="table-action-row">
                                <button className="secondary compact" type="button" onClick={() => {
                                  setTeamDraft({ id: employee.id, name: employee.name, role: employee.role || 'Менеджер', phone: employee.phone || '', colorKey: employee.colorKey || '#2563EB', hiredAt: employee.hiredAt || formatLocalDateInput(), comment: employee.comment || '', isActive: employee.isActive, createAccount: false, login: '', password: '', mustChangePassword: true })
                                  closeTeamEmployeeAccess()
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
                          <tr><td colSpan={6} className="empty-state">{teamRosterView === 'active' ? 'Активных сотрудников нет.' : 'Бывших сотрудников нет.'}</td></tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>

                  {isAdmin ? (
                    <section className="team-system-admins" aria-label="Системные администраторы">
                      <div className="team-system-admins-head">
                        <div>
                          <div className="card-label">Системные администраторы</div>
                          <h3>Служебные аккаунты без сотрудника</h3>
                          <p>Эти аккаунты имеют административный доступ, но не привязаны к сотрудникам и не участвуют в заказах, табеле, зарплате или рабочих отчётах.</p>
                        </div>
                        <div className="team-system-admins-head-actions">
                          <span className="team-system-admins-count">{systemAdmins.length}</span>
                          <button className="primary compact" type="button" onClick={() => openSystemAdminAccess()}>+ Добавить</button>
                        </div>
                      </div>
                      <div className="team-system-admins-list">
                        {systemAdmins.map((account) => (
                          <div className="team-system-admin-card" key={account.id}>
                            <div className="team-system-admin-identity">
                              <strong>@{account.login}</strong>
                              <span>{account.displayName || 'Системный администратор'}</span>
                            </div>
                            <div className="team-system-admin-card-actions">
                              <div className="team-system-admin-meta">
                                <span className={`team-access-status ${account.isActive ? 'is-active' : 'is-disabled'}`}>
                                  {account.isActive ? 'Вход включён' : 'Вход отключён'}
                                </span>
                                {account.mustChangePassword ? <span className="team-system-admin-temporary">Нужно сменить временный пароль</span> : null}
                                <span>{account.lastLoginAt ? `Последний вход: ${formatDateShort(account.lastLoginAt)}` : 'Входов ещё не было'}</span>
                              </div>
                              <button className="secondary compact" type="button" onClick={() => openSystemAdminAccess(account)}>Настроить</button>
                            </div>
                          </div>
                        ))}
                        {!systemAdmins.length ? <div className="team-system-admin-empty">Системных администраторов пока нет.</div> : null}
                      </div>
                    </section>
                  ) : null}

                  {systemAdminEditorOpen ? (
                    <div className="modal-backdrop team-access-modal-backdrop" role="presentation" onMouseDown={(event) => {
                      if (event.target === event.currentTarget) closeSystemAdminAccess()
                    }}>
                      <section className="modal-card team-access-modal" role="dialog" aria-modal="true" aria-labelledby="system-admin-modal-title">
                        <div className="modal-head team-access-modal-head">
                          <div>
                            <div className="card-label">Системный доступ</div>
                            <h3 id="system-admin-modal-title">{systemAdminDraft.id ? 'Настроить системного администратора' : 'Новый системный администратор'}</h3>
                            <p>Служебный администратор не становится сотрудником и не появляется в рабочих списках.</p>
                          </div>
                          <button className="ghost compact" type="button" onClick={closeSystemAdminAccess} aria-label="Закрыть окно">✕</button>
                        </div>
                        <div className="team-access-modal-fields">
                          <label>
                            <span>Логин</span>
                            <input ref={systemAdminLoginRef} value={systemAdminDraft.login} onChange={(event) => setSystemAdminDraft((draft) => ({ ...draft, login: event.target.value }))} autoComplete="off" minLength={3} maxLength={32} />
                            <small>Будет виден только другим администраторам в этом служебном блоке.</small>
                          </label>
                          <label>
                            <span>{systemAdminDraft.id ? 'Новый временный пароль' : 'Временный пароль'}</span>
                            <input type="text" value={systemAdminDraft.password} onChange={(event) => setSystemAdminDraft((draft) => ({ ...draft, password: event.target.value }))} placeholder={systemAdminDraft.id ? 'Оставьте пустым, если пароль не меняется' : 'Минимум 8 символов'} autoComplete="new-password" />
                            <small>{systemAdminDraft.id ? 'Заполните только для сброса пароля.' : 'При первом входе система потребует заменить пароль.'}</small>
                          </label>
                        </div>
                        <div className="team-access-modal-options">
                          <label className="team-access-option">
                            <input type="checkbox" checked={systemAdminDraft.isActive} onChange={(event) => setSystemAdminDraft((draft) => ({ ...draft, isActive: event.target.checked }))} />
                            <span><strong>Разрешить вход</strong><small>Отключённый аккаунт не сможет войти в систему.</small></span>
                          </label>
                          <label className="team-access-option">
                            <input type="checkbox" checked={systemAdminDraft.password ? true : systemAdminDraft.mustChangePassword} disabled={Boolean(systemAdminDraft.password)} onChange={(event) => setSystemAdminDraft((draft) => ({ ...draft, mustChangePassword: event.target.checked }))} />
                            <span><strong>Потребовать смену пароля</strong><small>Для нового или сброшенного пароля это включается автоматически.</small></span>
                          </label>
                        </div>
                        <div className="team-access-editor-help">Этот аккаунт не имеет managerId: он не будет использоваться как менеджер заказа, сотрудник табеля или получатель зарплаты.</div>
                        <div className="modal-actions team-access-modal-actions">
                          {systemAdminDraft.id && systemAdminDraft.isActive ? (
                            <button className="ghost danger" type="button" disabled={authUsersBusy} onClick={() => {
                              const account = authUsers.find((user) => user.id === systemAdminDraft.id)
                              if (account) void disableSystemAdminAccess(account)
                            }}>Отключить вход</button>
                          ) : <span />}
                          <div className="button-row">
                            <button className="secondary" type="button" onClick={closeSystemAdminAccess}>Отмена</button>
                            <button className="primary" type="button" disabled={authUsersBusy} onClick={() => void saveSystemAdminAccess()}>{authUsersBusy ? 'Сохраняю...' : 'Сохранить'}</button>
                          </div>
                        </div>
                      </section>
                    </div>
                  ) : null}

                  {accessEditorEmployee ? (
                    <div
                      className="modal-backdrop team-access-modal-backdrop"
                      role="presentation"
                      onMouseDown={(event) => {
                        if (event.target === event.currentTarget) closeTeamEmployeeAccess()
                      }}
                    >
                      <section
                        className="modal-card team-access-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="team-access-modal-title"
                      >
                        <div className="modal-head team-access-modal-head">
                          <div>
                            <div className="card-label">Доступ в систему</div>
                            <h3 id="team-access-modal-title">
                              {accessEditorAccount ? `Настроить вход для ${accessEditorEmployee.name}` : `Создать вход для ${accessEditorEmployee.name}`}
                            </h3>
                            <p>
                              {accessEditorAccount
                                ? `Текущий логин @${accessEditorAccount.login}. Изменения применятся только к этому сотруднику.`
                                : 'Аккаунт сразу привяжется к сотруднику. Ничего дополнительно выбирать не нужно.'}
                            </p>
                          </div>
                          <button className="ghost compact" type="button" onClick={closeTeamEmployeeAccess} aria-label="Закрыть окно">✕</button>
                        </div>

                        <div className="team-access-modal-employee">
                          <ManagerBadge
                            name={accessEditorEmployee.name}
                            id={accessEditorEmployee.id}
                            colorKey={accessEditorEmployee.colorKey}
                          />
                          <div>
                            <strong>{accessEditorEmployee.name}</strong>
                            <span>{accessEditorEmployee.role || 'Менеджер'} · {accessEditorEmployee.isActive ? 'активный сотрудник' : 'бывший сотрудник'}</span>
                          </div>
                        </div>

                        <div className="team-access-modal-fields">
                          <label>
                            <span>Логин</span>
                            <input
                              ref={teamAccessLoginRef}
                              value={teamAccessDraft.login}
                              onChange={(event) => setTeamAccessDraft((draft) => ({ ...draft, login: event.target.value }))}
                              placeholder={suggestTeamLogin(accessEditorEmployee.name, accessEditorAccount?.id || 0)}
                              autoComplete="off"
                              minLength={3}
                              maxLength={32}
                            />
                            <small>Сотрудник будет входить по этому логину.</small>
                          </label>

                          <label>
                            <span>{accessEditorAccount ? 'Новый временный пароль' : 'Временный пароль'}</span>
                            <input
                              type="text"
                              value={teamAccessDraft.password}
                              onChange={(event) => setTeamAccessDraft((draft) => ({ ...draft, password: event.target.value }))}
                              placeholder={accessEditorAccount ? 'Оставьте пустым, если пароль не меняется' : 'Минимум 8 символов'}
                              autoComplete="new-password"
                            />
                            <small>{accessEditorAccount ? 'Заполните только если нужно сбросить пароль.' : 'Передайте его сотруднику после создания.'}</small>
                          </label>

                          <label>
                            <span>Права</span>
                            <select value={teamAccessDraft.role} onChange={(event) => setTeamAccessDraft((draft) => ({ ...draft, role: event.target.value }))}>
                              <option value="manager">Менеджер</option>
                              <option value="admin">Администратор</option>
                            </select>
                            <small>{teamAccessDraft.role === 'admin' ? 'Администратор получит служебные права.' : 'Обычный рабочий доступ менеджера.'}</small>
                          </label>
                        </div>

                        <div className="team-access-modal-options">
                          <label className="team-access-option">
                            <input
                              type="checkbox"
                              checked={teamAccessDraft.isActive}
                              onChange={(event) => setTeamAccessDraft((draft) => ({ ...draft, isActive: event.target.checked }))}
                            />
                            <span>
                              <strong>Разрешить вход</strong>
                              <small>Если выключить, сотрудник не сможет войти в систему.</small>
                            </span>
                          </label>
                          <label className="team-access-option">
                            <input
                              type="checkbox"
                              checked={teamAccessDraft.password ? true : teamAccessDraft.mustChangePassword}
                              disabled={Boolean(teamAccessDraft.password)}
                              onChange={(event) => setTeamAccessDraft((draft) => ({ ...draft, mustChangePassword: event.target.checked }))}
                            />
                            <span>
                              <strong>{teamAccessDraft.password ? 'Сменить пароль после входа' : 'Потребовать смену пароля'}</strong>
                              <small>{teamAccessDraft.password ? 'После сброса временный пароль нельзя будет оставить постоянным.' : 'Полезно для первого входа нового сотрудника.'}</small>
                            </span>
                          </label>
                        </div>

                        <div className="team-access-editor-help">
                          {accessEditorAccount
                            ? 'Если задать новый временный пароль, старые сессии этого аккаунта будут закрыты.'
                            : 'После создания сообщите сотруднику логин и временный пароль. При первом входе система попросит заменить пароль.'}
                        </div>

                        <div className="modal-actions team-access-modal-actions">
                          {accessEditorAccount?.isActive ? (
                            <button className="ghost danger" type="button" disabled={authUsersBusy || teamBusy} onClick={() => void disableTeamEmployeeAccess(accessEditorEmployee)}>
                              Отключить вход
                            </button>
                          ) : <span />}
                          <div className="button-row">
                            <button className="secondary" type="button" onClick={closeTeamEmployeeAccess}>Отмена</button>
                            <button className="primary" type="button" disabled={authUsersBusy || teamBusy} onClick={() => void saveTeamEmployeeAccess(accessEditorEmployee)}>
                              {authUsersBusy ? 'Сохраняю...' : accessEditorAccount ? 'Сохранить' : 'Создать вход'}
                            </button>
                          </div>
                        </div>
                      </section>
                    </div>
                  ) : null}
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
