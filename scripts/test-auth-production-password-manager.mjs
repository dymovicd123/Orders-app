import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const app = read('src/App.tsx')

  check(app.includes('async function offerBrowserPasswordSave'), 'Credential Management helper missing')
  check(app.includes('PasswordCredentialCtor') && app.includes('navigator.credentials.store(credential)'), 'Browser credential store integration missing')
  check(app.includes("if (!user.mustChangePassword) await offerBrowserPasswordSave(authLogin, authPassword)"), 'Temporary-password login is not excluded from browser save')
  check(app.includes('await offerBrowserPasswordSave(authLogin, authPassword)'), 'Successful permanent login is not offered to the browser password manager')
  check(app.includes('await offerBrowserPasswordSave(authUser.login, newPassword)'), 'Changed permanent password is not offered to the browser password manager')

  check(app.includes("action={authHasUsers ? '/api/auth/login' : '/api/auth/setup'}") && app.includes('method="post"'), 'Login form does not expose stable POST semantics')
  check((app.match(/action="\/api\/auth\/change-password"/g) || []).length === 2, 'Both password-change forms must expose the password-change action')
  check((app.match(/autoComplete="username"/g) || []).length >= 3, 'Username autocomplete is missing from a password-change flow')
  check((app.match(/autoComplete="current-password"/g) || []).length >= 3, 'Current-password autocomplete is missing from a password-change flow')
  check((app.match(/autoComplete="new-password"/g) || []).length >= 2, 'New-password autocomplete is missing from a password-change flow')

  const forcedChange = app.slice(app.indexOf('Первый вход сотрудника'), app.indexOf('return (\n    <main className="erp-shell"'))
  check(forcedChange.includes('value={authUser.login}') && forcedChange.includes('name="username"'), 'Forced password change does not carry the account username')
  check(forcedChange.includes('name="current-password"') && forcedChange.includes('name="new-password"'), 'Forced password change field semantics missing')

  const modalStart = app.indexOf('aria-label="Смена пароля"')
  const modalEnd = app.indexOf('{authUsersOpen && isAdmin', modalStart)
  const modal = app.slice(modalStart, modalEnd)
  check(modal.includes('value={authUser.login}') && modal.includes('name="username"'), 'Regular password-change modal does not carry the account username')
  check(modal.includes('autoComplete="current-password"') && modal.includes('autoComplete="new-password"'), 'Regular password-change modal autocomplete semantics missing')

  console.log('AUTH R6 PASSWORD MANAGER PASSED — permanent credentials are offered explicitly, temporary passwords are skipped, and both change-password forms carry username/current/new semantics.')
} catch (error) {
  console.error(`AUTH R6 PASSWORD MANAGER FAILED: ${error?.message || error}`)
  process.exit(1)
}
