import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const app = read('src/App.tsx')
  const team = read('src/features/sections/TeamSection.tsx')
  const teamWorker = read('worker/domains/team.ts')
  const authWorker = read('worker/domains/auth.ts')
  const styles = read('src/styles/10-workshop-reports-team.css')

  check(team.includes('teamAccessEditorId') && team.includes('teamAccessDraft'), 'Integrated Team access editor state missing')
  check(team.includes('suggestTeamLogin') && team.includes("Ә: 'a'") && team.includes("Қ: 'q'"), 'Human login suggestion/transliteration missing')
  check(app.includes("loadTeamEmployees(),") && app.includes("isAdmin ? loadAuthUsers() : Promise.resolve()"), 'Team screen does not load linked account state for admins')
  check(app.includes("shouldCreateAccount = teamDraft.createAccount !== false && !hasLinkedAccount"), 'New employee flow no longer supports immediate account creation')
  check(app.includes("managerId: employeeId") && app.includes("displayName: teamDraft.name"), 'New account is not bound to the newly created employee')
  check(app.includes("Сотрудник создан, но вход не настроен"), 'Partial employee/account failure is not recoverable in the UI')
  check(team.includes('saveTeamEmployeeAccess') && team.includes('disableTeamEmployeeAccess'), 'Existing-employee account management handlers missing')
  check(app.includes('duplicateManagerAccount'), 'UI does not guard one employee from accidental duplicate accounts')

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

  console.log('AUTH R3/R4 TEAM ACCESS UX PASSED — employee-first provisioning remains intact and row actions open a focused, keyboard-dismissable access modal.')
} catch (error) {
  console.error(`AUTH R3/R4 TEAM ACCESS UX FAILED: ${error?.message || error}`)
  process.exit(1)
}
