import fs from 'node:fs'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const app = read('src/App.tsx')
  const employeeActions = read('src/features/team/teamEmployeeActions.ts')
  const timesheetActions = read('src/features/team/teamTimesheetActions.ts')
  const team = read('src/features/sections/TeamSection.tsx')
  const teamWorker = read('worker/domains/team.ts')
  const authWorker = read('worker/domains/auth.ts')
  const styles = read('src/styles/10-workshop-reports-team.css')

  check(team.includes('teamAccessEditorId') && team.includes('teamAccessDraft'), 'Integrated Team access editor state missing')
  check(team.includes('suggestTeamLogin') && team.includes("Ә: 'a'") && team.includes("Қ: 'q'"), 'Human login suggestion/transliteration missing')
  check(app.includes("loadTeamEmployees(),") && app.includes("isAdmin ? loadAuthUsers() : Promise.resolve()"), 'Team screen does not load linked account state for admins')
  check(app.includes('createTeamEmployeeActions({') && employeeActions.includes("shouldCreateAccount = teamDraft.createAccount !== false && !hasLinkedAccount"), 'New employee flow no longer supports immediate account creation')
  check(employeeActions.includes("managerId: employeeId") && employeeActions.includes("displayName: teamDraft.name"), 'New account is not bound to the newly created employee')
  check(employeeActions.includes("Сотрудник создан, но вход не настроен"), 'Partial employee/account failure is not recoverable in the UI')
  check(team.includes('saveTeamEmployeeAccess') && team.includes('disableTeamEmployeeAccess'), 'Existing-employee account management handlers missing')
  const managedAccountActions = read('src/features/auth/managedAccountActions.ts')
  check(app.includes('saveManagedAuthUser(') && managedAccountActions.includes('duplicateManagerAccount'), 'UI does not guard one employee from accidental duplicate accounts')

  check(team.includes('Вход в систему') && team.includes('Создать доступ сразу'), 'New employee form does not expose friendly access onboarding')
  check(team.includes("Можно оставить пустым — система возьмёт вариант из имени"), 'New employee login suggestion is not explained')
  check(team.includes('Временный пароль') && team.includes('Потребовать сменить временный пароль при первом входе'), 'Temporary password onboarding is unclear or missing')
  check(team.includes('<th>Доступ</th>'), 'Team roster has no visible access column')
  check(team.includes('Нет аккаунта') && team.includes('Создать вход'), 'Existing employees without accounts cannot be provisioned from Team')
  check(team.includes('Вход включён') && team.includes('Вход отключён'), 'Account state is not visible in Team')
  check(team.includes("accessEditorAccount ? 'Сохранить' : 'Создать вход'") && team.includes('Отключить вход'), 'Existing account management is not available from Team')
  check(team.includes('Аккаунт сразу привяжется к сотруднику') && team.includes('Ничего дополнительно выбирать не нужно'), 'Access editor still asks the admin to manually re-select the employee')
  check(team.includes('Новый временный пароль'), 'Password reset is not available from the employee access editor')

  check(teamWorker.includes("DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM app_users WHERE manager_id = ?)"), 'Dismissal does not revoke linked employee sessions')
  check(teamWorker.includes("UPDATE app_users SET is_active = 0, disabled_at = ?, updated_at = ? WHERE manager_id = ?"), 'Dismissal does not disable linked login accounts')
  check(teamWorker.includes("DELETE FROM app_users WHERE manager_id = ?"), 'Deleting an erroneous employee can leave an orphan account')
  check(teamWorker.includes('ensureTeamEmployeeCanLoseAccess') && teamWorker.includes('последний активный администратор'), 'Employee dismissal/delete can remove the last active Admin')
  check(teamWorker.includes('Доступ в систему при необходимости включите отдельно'), 'Employee restore can silently reactivate access')

  check(authWorker.includes('ensureManagerAccountAvailable'), 'Server does not enforce one account per employee')
  check(authWorker.includes("'SELECT id, login FROM app_users WHERE manager_id = ? AND id <> ? LIMIT 1'"), 'Duplicate employee account check is not server-side')
  check(authWorker.includes('const managerAccountError = await ensureManagerAccountAvailable(db, managerId)'), 'Account creation can still duplicate an employee identity')
  check(authWorker.includes('const managerAccountError = await ensureManagerAccountAvailable(db, nextManagerId, userId)'), 'Account editing can still create duplicate employee identity')

  check(!team.includes('className="mini-panel team-access-editor-panel"'), 'Employee access still opens as an inline panel below the roster')
  check(team.includes('className="modal-backdrop team-access-modal-backdrop"') && team.includes('className="modal-card team-access-modal"'), 'Employee access does not open in a dedicated modal')
  check(team.includes('role="dialog"') && team.includes('aria-modal="true"'), 'Team access modal accessibility contract missing')
  check(team.includes("event.key === 'Escape'") && team.includes('event.target === event.currentTarget'), 'Team access modal cannot be dismissed naturally')
  check(team.includes('teamAccessLoginRef.current?.focus()') && team.includes('ref={teamAccessLoginRef}'), 'Team access modal does not focus the login field')
  check(styles.includes('.team-access-onboarding') && styles.includes('.team-access-modal-backdrop') && styles.includes('.team-access-modal'), 'Team access modal styles missing')
  check(styles.includes('@media (max-width: 720px)') && styles.includes('align-items: flex-end'), 'Team access modal has no mobile sheet adaptation')


  // The moved actions must execute the original HTTP/role/partial-account contracts.
  async function compiledActions(path) {
    const result = await build({
      entryPoints: [path], bundle: true, platform: 'node', format: 'esm',
      target: 'es2022', write: false, logLevel: 'silent',
    })
    return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
  }
  const { createTeamEmployeeActions } = await compiledActions('src/features/team/teamEmployeeActions.ts')
  const { createTeamTimesheetActions } = await compiledActions('src/features/team/teamTimesheetActions.ts')
  const calls = []
  const draft = {
    id: 0, name: 'Тестовый сотрудник', role: 'Менеджер', phone: '', birthDate: '',
    colorKey: '#2563EB', hiredAt: '2026-11-09', comment: '', isActive: true,
    createAccount: true, login: 'employee101', password: 'test-password-123', mustChangePassword: true,
  }
  let employeeDraft = draft
  let employeeError = null
  let employeeMessage = null
  let formOpen = true
  let teamReloads = 0
  let accountReloads = 0
  let refsReloads = 0
  let accountHttpStatus = 200
  const respond = (body, status=200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  })
  const teamDialogMessages = []
  const args = {
    isAdmin: true, teamDraft: draft, teamEmployees: [], authUsers: [],
    askActionConfirmation: async (message) => { teamDialogMessages.push(message); return true },
    setTeamBusy: () => {},
    setTeamEmployees: () => {},
    setTeamDraft: (fn) => { employeeDraft = typeof fn === 'function' ? fn(employeeDraft) : fn },
    setTeamFormOpen: (value) => { formOpen = value },
    setTeamColorEditorId: () => {},
    setError: (value) => { employeeError = value },
    setMessage: (value) => { employeeMessage = value },
    apiFetch: async (url, init) => {
      calls.push({ url, init })
      if (url === '/api/team/employees') return respond({ ok: true, employeeId: 101 })
      if (url === '/api/auth/users') return respond(
        accountHttpStatus === 200 ? { ok: true } : { ok: false, message: 'Логин занят' }, accountHttpStatus
      )
      if (url === '/api/team') { teamReloads += 1; return respond({ ok: true, employees: [] }) }
      if (typeof url === 'string' && url.endsWith('/status')) return respond({ ok: true, message: 'Статус сохранён' })
      if (typeof url === 'string' && url.includes('/api/team/employees/')) return respond({ ok: true, message: 'Удалено' })
      throw new Error('Unexpected Team HTTP ' + url)
    },
    reportReadFailure: (error) => { throw error },
    loadAuthUsers: async () => { accountReloads += 1 },
    loadReferencesData: async () => { refsReloads += 1 },
  }
  const employees = createTeamEmployeeActions(args)
  await employees.saveTeamEmployee()
  assert.equal(calls[0].url, '/api/team/employees')
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[1].url, '/api/auth/users')
  assert.equal(JSON.parse(calls[1].init.body).managerId, 101)
  assert.equal(JSON.parse(calls[1].init.body).mustChangePassword, true)
  assert.match(employeeMessage, /Вход @employee101 создан/)
  assert.equal(employeeError, null)
  assert.equal(formOpen, false)
  assert.equal(teamReloads, 1)
  assert.equal(accountReloads, 1)
  assert.equal(refsReloads, 1)

  // A saved employee with failed account creation remains editable with employeeId.
  calls.length = 0
  formOpen = true
  employeeDraft = draft
  employeeError = null
  accountHttpStatus = 409
  await createTeamEmployeeActions({ ...args, teamDraft: draft }).saveTeamEmployee()
  assert.equal(calls.filter((c) => c.url === '/api/team/employees').length, 1)
  assert.equal(calls.filter((c) => c.url === '/api/auth/users').length, 1)
  assert.equal(employeeDraft.id, 101)
  assert.equal(employeeDraft.login, 'employee101')
  assert.equal(employeeDraft.createAccount, true)
  assert.match(employeeError, /Сотрудник создан, но вход не настроен/)
  assert.equal(formOpen, true)

  // Admin-only employee mutations fail before writing when role is insufficient.
  calls.length = 0
  employeeError = null
  const managerEmployees = createTeamEmployeeActions({ ...args, isAdmin: false })
  await managerEmployees.saveTeamEmployee()
  await managerEmployees.setTeamEmployeeEmploymentStatus({ id: 101, name: 'Тестовый сотрудник' }, false)
  await managerEmployees.removeTeamEmployee({ id: 101, name: 'Тестовый сотрудник' })
  assert.equal(calls.length, 0)
  assert.match(employeeError, /только администратору/)

  // Timesheet calendar and server write preserve exact dates/managers/clock and refresh chain.
  const timesheetCalls = []
  let savedTimesheet = null
  let timesheetMessage = null
  let timesheetError = null
  let salaryRefresh = 0
  let activityRefresh = 0
  let timesheetHttpStatus = 200
  let selectedDays = ['2026-11-02', '2026-11-03']
  let selectedManagers = [101, 102]
  let currentMonth = '2026-11'
  const timeArgs = {
    isAdmin: true, timesheetMonth: '2026-11', timesheetData: null,
    timesheetSelectedDays: selectedDays, timesheetSelectedManagers: selectedManagers,
    timesheetWorkUntil: '18:00', timesheetComment: 'Смена',
    setTimesheetMonth: (value) => { currentMonth = value },
    setTimesheetSelectedDays: (fn) => { selectedDays = typeof fn === 'function' ? fn(selectedDays) : fn },
    setTimesheetSelectedManagers: (fn) => { selectedManagers = typeof fn === 'function' ? fn(selectedManagers) : fn },
    setTimesheetData: (value) => { savedTimesheet = value },
    setTimesheetBusy: () => {},
    setError: (value) => { timesheetError = value },
    setMessage: (value) => { timesheetMessage = value },
    apiFetch: async (url, init) => {
      timesheetCalls.push({ url, init })
      if (url === '/api/team/timesheet') return respond(
        timesheetHttpStatus === 200 ? { ok: true } : { ok: false, message: 'Табель устарел' },
        timesheetHttpStatus
      )
      if (url === '/api/team/timesheet?month=2026-11') return respond({
        ok: true, month: '2026-11', startDate: '2026-11-01', endDate: '2026-11-30', employees: [], entries: [],
      })
      throw new Error('Unexpected Timesheet HTTP ' + url)
    },
    reportReadFailure: (err) => { throw err },
    loadTeamSalaryReport: async () => { salaryRefresh += 1 },
    refreshActivityLogIfVisible: async () => { activityRefresh += 1 },
  }
  const timesheet = createTeamTimesheetActions(timeArgs)
  assert.equal(timesheet.getTimesheetMonthDays('2026-02').length, 28)
  assert.equal(timesheet.getTimesheetMonthDays('2028-02').length, 29)
  assert.equal(timesheet.getTimesheetCalendarSlots().filter(Boolean).length, 30)
  timesheet.shiftTimesheetMonth(1)
  assert.equal(currentMonth, '2026-12')
  assert.deepEqual(selectedDays, [])
  await timesheet.saveTeamTimesheet()
  assert.equal(timesheetCalls[0].url, '/api/team/timesheet')
  assert.equal(timesheetCalls[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(timesheetCalls[0].init.body), {
    dates: ['2026-11-02', '2026-11-03'], managerIds: [101, 102],
    workUntil: '18:00', comment: 'Смена', clear: false,
  })
  assert.equal(savedTimesheet.month, '2026-11')
  assert.equal(salaryRefresh, 1)
  assert.equal(activityRefresh, 1)
  assert.equal(timesheetMessage, 'Табель сохранён.')

  timesheetHttpStatus = 409
  savedTimesheet = null
  await timesheet.saveTeamTimesheet(true)
  assert.equal(savedTimesheet, null)
  assert.equal(salaryRefresh, 1)
  assert.match(timesheetError, /Табель устарел/)

  const managerTimesheet = createTeamTimesheetActions({ ...timeArgs, isAdmin: false })
  const beforeDenied = timesheetCalls.length
  await managerTimesheet.saveTeamTimesheet()
  assert.equal(timesheetCalls.length, beforeDenied)
  assert.match(timesheetError, /только администратору/)


  // Check the actual extracted admin account controller (not an invented mock).
  const { loadManagedAuthUsers, saveManagedAuthUser, disableManagedAuthUser } =
    await compiledActions('src/features/auth/managedAccountActions.ts')
  let managedError = null
  let managedMessage = null
  let managedUsers = []
  let draftAfterSave = null
  let managedBusy = false
  let managedReloads = 0
  let canDisable = false
  let managedResponseCode = 200
  const managedCalls = []
  const authDraft = {
    id:0, login:'manager17', password:'test-password-123', role:'manager',
    managerId:17, displayName:'Менеджер', isActive:true, mustChangePassword:true,
  }
  const managedArgs = {
    isAdmin:true, apiFetch:async (url,init) => {
      managedCalls.push({ url,init })
      const list = url === '/api/auth/users' && !init
      return respond(list
        ? {ok:true,items:[{id:1,login:'manager17',managerId:17}]}
        : managedResponseCode === 200 ? {ok:true} : {ok:false,message:'Запись устарела'},
        list ? 200 : managedResponseCode)
    },
    setAuthUsersBusy: v => { managedBusy = v },
    setAuthUsers: value => { managedUsers = value },
    setError: value => { managedError = value },
    setMessage: value => { managedMessage = value },
    setAuthUserDraft: value => { draftAfterSave = value },
    authUserDraft:authDraft, authUsers:[],
    loadAuthUsers:async () => { managedReloads++ },
    askActionConfirmation: async () => canDisable,
  }
  await loadManagedAuthUsers(managedArgs)
  assert.equal(managedUsers[0].managerId,17)
  assert.equal(managedBusy,false)
  await saveManagedAuthUser(managedArgs)
  assert.equal(managedCalls.at(-1).url,'/api/auth/users')
  assert.equal(managedCalls.at(-1).init.method,'POST')
  assert.equal(JSON.parse(managedCalls.at(-1).init.body).mustChangePassword,true)
  assert.equal(draftAfterSave.id,0)
  assert.equal(managedReloads,1)
  assert.match(managedMessage,/Аккаунт создан/)
  await saveManagedAuthUser({ ...managedArgs, authUsers:[{id:12,managerId:17,login:'manager17'}] })
  assert.equal(managedCalls.length,2,'Duplicate linked employee must be rejected before HTTP')
  assert.match(managedError,/уже есть аккаунт/)
  const beforeManager = managedCalls.length
  await saveManagedAuthUser({ ...managedArgs, isAdmin:false })
  await loadManagedAuthUsers({ ...managedArgs, isAdmin:false })
  await disableManagedAuthUser(12,{ ...managedArgs, isAdmin:false })
  assert.equal(managedCalls.length,beforeManager)
  await disableManagedAuthUser(12,managedArgs)
  assert.equal(managedCalls.length,beforeManager)
  canDisable = true
  await disableManagedAuthUser(12,managedArgs)
  assert.equal(managedCalls.at(-1).url,'/api/auth/users/12')
  assert.equal(managedCalls.at(-1).init.method,'DELETE')
  assert.equal(managedReloads,2)
  managedResponseCode = 409
  managedMessage = null
  await saveManagedAuthUser(managedArgs)
  assert.equal(managedMessage,null)
  assert.match(managedError,/Запись устарела/)

  console.log('AUTH R3/R4 TEAM ACCESS UX PASSED — employee-first provisioning remains intact and row actions open a focused, keyboard-dismissable access modal.')
} catch (error) {
  console.error(`AUTH R3/R4 TEAM ACCESS UX FAILED: ${error?.message || error}`)
  process.exit(1)
}
