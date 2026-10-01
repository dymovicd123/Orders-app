import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const app = read('src/App.tsx')
  const team = read('src/features/sections/TeamSection.tsx')
  const teamWorker = read('worker/domains/team.ts')
  const styles = read('src/styles/10-workshop-reports-team.css')

  check(team.includes('teamAccessEditorId') && team.includes('teamAccessDraft'), 'Integrated Team access editor state missing')
  check(team.includes('suggestTeamLogin') && team.includes("Ә: 'a'") && team.includes("Қ: 'q'"), 'Human login suggestion/transliteration missing')
  check(app.includes("loadTeamEmployees(),") && app.includes("isAdmin ? loadAuthUsers() : Promise.resolve()"), 'Team screen does not load linked account state for admins')
  check(app.includes("shouldCreateAccount = isNewEmployee && teamDraft.createAccount !== false"), 'New employee flow no longer supports immediate account creation')
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
  check(team.includes('Сохранить доступ') && team.includes('Отключить вход'), 'Existing account management is not available from Team')
  check(team.includes('Аккаунт привязывается к сотруднику автоматически'), 'Access editor still asks the admin to manually re-select the employee')
  check(team.includes('Новый временный пароль'), 'Password reset is not available from the employee access editor')

  check(teamWorker.includes("DELETE FROM app_sessions WHERE user_id IN (SELECT id FROM app_users WHERE manager_id = ?)"), 'Dismissal does not revoke linked employee sessions')
  check(teamWorker.includes("UPDATE app_users SET is_active = 0, disabled_at = ?, updated_at = ? WHERE manager_id = ?"), 'Dismissal does not disable linked login accounts')
  check(teamWorker.includes("DELETE FROM app_users WHERE manager_id = ?"), 'Deleting an erroneous employee can leave an orphan account')
  check(teamWorker.includes('Доступ в систему при необходимости включите отдельно'), 'Employee restore can silently reactivate access')

  check(styles.includes('.team-access-onboarding') && styles.includes('.team-access-editor-panel'), 'Team access UI styles missing')
  check(styles.includes('@media (max-width: 720px)'), 'Team access UI has no mobile adaptation')

  console.log('AUTH R3 TEAM ACCESS UX PASSED — account provisioning is employee-first, linked, visible, recoverable, and dismissal revokes access.')
} catch (error) {
  console.error(`AUTH R3 TEAM ACCESS UX FAILED: ${error?.message || error}`)
  process.exit(1)
}
