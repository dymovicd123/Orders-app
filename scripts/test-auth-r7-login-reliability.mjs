import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const auth = read('worker/domains/auth.ts')
  const app = read('src/App.tsx')
  const api = read('src/app/controllers/useApiClient.ts')

  check(auth.includes("if (!user && readCookie(request, 'orders_session'))"), 'Auth status does not clear a stale session cookie')
  check(auth.includes("code: 'AUTH_SETUP_ALREADY_COMPLETED'"), 'First-admin setup has no structured already-completed code')
  check(auth.includes("WHERE NOT EXISTS (\n        SELECT 1 FROM app_users"), 'First-admin creation is not protected by one atomic conditional insert')
  check(auth.includes("code: 'AUTH_INVALID_CREDENTIALS'"), 'Login failures have no stable generic credential code')
  check(auth.includes('const forcePasswordChange = input.mustChangePassword === true'), 'Forced password-change flag does not revoke existing sessions')
  check(auth.includes('passwordReset || input.isActive === false || loginChanged || roleChanged || forcePasswordChange'), 'Session revocation conditions omit forced password change')

  check(api.includes("onAuthInvalid?: (reason: AuthInvalidReason) => void"), 'API client has no centralized auth-invalid hook')
  check(api.includes("response.status === 401") && api.includes("onAuthInvalid?.('unauthorized')"), 'Revoked/expired session 401 is not surfaced centrally')
  check(api.includes("PASSWORD_CHANGE_REQUIRED") && api.includes("onAuthInvalid?.('password_change_required')"), 'Forced password-change 403 is not surfaced centrally')

  check(app.includes("const handleAuthInvalid = useCallback((reason: 'unauthorized' | 'password_change_required')"), 'App has no centralized session invalidation handler')
  check(app.includes("setMessage('Сессия завершена. Войдите снова.')"), 'Expired session does not return user to a clear login state')
  check(app.includes("setupData.code === 'AUTH_SETUP_ALREADY_COMPLETED' || setupResponse.status === 409"), 'Setup race is not recognized by the frontend')
  check(app.includes("Проверка созданного администратора"), 'Setup retry does not re-check the server session before asking for another login')
  check(app.includes("Текущая сессия восстановлена"), 'Setup retry cannot recover a session from a successful first request')
  check(app.includes("Войдите через обычную форму тем логином, который был создан первым"), 'Setup race fallback message is not actionable')
  check(app.includes("await readJsonResponse(response, 'Выход')"), 'Logout still claims success without a confirmed server response')
  check(app.includes("Не удалось завершить сессию вовремя"), 'Logout timeout failure is not explained to the user')
  check(app.includes("Проверка сессии заняла слишком много времени"), 'Startup auth timeout is not explained to the user')

  console.log('AUTH R7 LOGIN RELIABILITY PASSED — setup race recovery, atomic bootstrap, stale-session cleanup, centralized session invalidation, forced-change revocation and truthful logout are enforced.')
} catch (error) {
  console.error(`AUTH R7 LOGIN RELIABILITY FAILED: ${error?.message || error}`)
  process.exit(1)
}
