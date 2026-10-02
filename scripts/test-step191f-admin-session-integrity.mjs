import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const auth = read('worker/domains/auth.ts')
  const worker = read('worker/index.ts')
  const apiClient = read('src/app/controllers/useApiClient.ts')
  const migration = read('migrations/0080_v72_auth_login_identity.sql')
  const release = read('scripts/release-check.mjs')

  check(migration.includes('ALTER TABLE app_users ADD COLUMN login TEXT'), 'Dedicated login identity migration missing')
  check(migration.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_login_nocase'), 'Case-insensitive unique login index missing')
  check(auth.includes("return `orders_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax;"), 'Account session cookie is not HttpOnly/SameSite protected')
  check(auth.includes('const tokenHash = await sha256Base64Url(token);'), 'Session token is not hashed before D1 lookup/storage')
  check(auth.includes("INSERT INTO app_sessions (user_id, token_hash, expires_at, last_seen_at)"), 'Hashed account session persistence missing')
  check(auth.includes("WHERE s.token_hash = ?") && auth.includes("s.expires_at > ?") && auth.includes("u.is_active = 1"), 'Current-user lookup does not verify live session and active account')
  check(!auth.includes("UPDATE app_sessions SET last_seen_at = ? WHERE token_hash = ?"), 'Authenticated reads still write last_seen_at on every API request')
  check(auth.includes("WHERE lower(u.login) = lower(?)"), 'Login no longer uses the dedicated case-insensitive identity')
  check(auth.includes("bootstrapLogin !== getAdminModeLogin(env)") && auth.includes('verifySimpleAdminPassword(db, env, bootstrapPassword)'), 'First-admin bootstrap is not protected by the existing admin credential')
  check(auth.includes("SELECT COUNT(*) AS count FROM app_users WHERE login IS NOT NULL"), 'Bootstrap status does not count provisioned login accounts')
  check(auth.includes("headers.set('X-Access-Role', user.role);"), 'Server does not overwrite legacy role compatibility header from session identity')
  check(auth.includes("headers.set('X-Access-User', actor);") && auth.includes("headers.set('X-Archive-Actor', actor);"), 'Server-owned actor compatibility headers missing')
  check(auth.includes("headers.set('X-Access-Login', user.login);") && auth.includes("headers.delete('X-Access-Email');"), 'Server does not replace legacy email identity with login identity')
  check(!apiClient.includes("headers.set('X-Access-Role'"), 'Frontend can still claim its own access role')
  check(!apiClient.includes("headers.set('X-Archive-Actor'"), 'Frontend can still claim its own archive actor')

  check(worker.includes('authUser = await getCurrentAuthUser(env.DB, request);'), 'Protected API requests are not authenticated through orders_session')
  check(worker.includes("if (!authUser) return json({ ok: false, message: 'Войдите в систему.' }, { status: 401 });"), 'Unauthenticated API access is not rejected')
  check(worker.includes('authUser.mustChangePassword && !passwordChangeOnlyPath(url.pathname)'), 'Temporary-password accounts can reach normal API routes before changing password')
  check(!worker.includes("url.pathname === '/api/admin-mode/"), 'Legacy Admin-mode routes are still exposed')
  check(worker.includes("return handleAuthLogin(env.DB, request);"), 'Normal account login route is not active')
  check(worker.includes("return handleAuthLogout(env.DB, request);"), 'Normal account logout route is not active')

  check(auth.includes('countActiveAdmins(db)') && auth.includes('Нельзя убрать последнего активного администратора.'), 'Last-active-admin protection missing')
  check(auth.includes("DELETE FROM app_sessions WHERE user_id = ?"), 'Account disable/reset does not revoke sessions')
  check(worker.includes("adminSessionIntegrity: 'account-auth-r2'"), 'Account-auth live health marker missing')
  const authHeaderRewrite = worker.indexOf('request = withAuthenticatedHeaders(request, authUser)')
  const firstLegacyGate = worker.indexOf('requireAdminAccess(request)')
  check(authHeaderRewrite >= 0 && firstLegacyGate > authHeaderRewrite, 'A legacy Admin gate can run before server session header normalization')
  check(release.includes('test-step191f-admin-session-integrity.mjs'), 'Account-session security test is not wired into cumulative release gate')

  console.log('STEP 191F / AUTH R2 SESSION INTEGRITY PASSED — login accounts, hashed HttpOnly sessions, server-owned role/actor, forced-password gate, bootstrap and last-admin safety.')
} catch (error) {
  console.error(`STEP 191F / AUTH R2 SESSION INTEGRITY FAILED: ${error?.message || error}`)
  process.exit(1)
}
