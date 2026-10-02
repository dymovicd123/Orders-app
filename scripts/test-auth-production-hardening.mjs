import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

try {
  const auth = read('worker/domains/auth.ts')
  const worker = read('worker/index.ts')
  const app = read('src/App.tsx')
  const migration80 = read('migrations/0080_v72_auth_login_identity.sql')
  const migration81 = read('migrations/0081_v72_auth_hardening.sql')
  const workflow = read('.github/workflows/auth-production-migrations-0080-0081.yml')

  check(migration80.includes('ALTER TABLE app_users ADD COLUMN login TEXT'), 'Dedicated login identity migration missing')
  check(migration80.includes('idx_app_users_login_nocase'), 'Case-insensitive login index missing')
  check(migration81.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_manager_unique'), 'One-account-per-employee unique index missing')
  check(migration81.includes('WHERE manager_id IS NOT NULL'), 'Manager account uniqueness is not partial for nullable admin identities')
  check(migration81.includes('CREATE TABLE IF NOT EXISTS auth_login_throttle'), 'Persistent auth throttle table missing')
  check(migration81.includes('CREATE TABLE IF NOT EXISTS auth_audit_log'), 'Dedicated auth audit table missing')

  check(auth.includes('export const PASSWORD_HASH_ITERATIONS = 30000'), 'New password hashes are not using the accepted 30k PBKDF2 edge budget')
  check(auth.includes('passwordHashNeedsUpgrade') && auth.includes("UPDATE app_users SET password_hash = ?, updated_at = ?"), 'Legacy password hashes are not upgraded after successful login')
  check(auth.includes('AUTH_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14'), 'Session lifetime is no longer explicit 14 days')
  check(auth.includes('AUTH_LOGIN_FAILURE_LIMIT = 5'), 'Login failure limit missing')
  check(auth.includes('AUTH_LOGIN_WINDOW_MS = 15 * 60 * 1000') && auth.includes('AUTH_LOGIN_BLOCK_MS = 15 * 60 * 1000'), 'Login throttle window/block duration missing')
  check(auth.includes("request.headers.get('CF-Connecting-IP')"), 'Login throttle is not scoped by Cloudflare client IP')
  check(auth.includes("code: 'AUTH_RATE_LIMITED'") && auth.includes('status: 429') && auth.includes("'Retry-After'"), 'Login throttle does not return a standard retry signal')
  check(auth.includes('recordAuthLoginFailure(db, throttle.keyHash)') && auth.includes('clearAuthLoginFailures(db, throttle.keyHash)'), 'Failed/successful login throttle accounting is incomplete')

  for (const eventType of ['auth_first_admin_created','auth_login_success','auth_user_created','auth_user_updated','auth_password_changed','auth_user_disabled']) {
    check(auth.includes(`eventType: '${eventType}'`), `Auth audit event missing: ${eventType}`)
  }
  check(!auth.includes('details: password') && !auth.includes('details: newPassword') && !auth.includes('details: currentPassword'), 'Auth audit risks persisting a plaintext password')
  check(worker.includes('createAuthUser(env.DB, request, authUser as AuthUser)'), 'Account creation audit is not attributed to the authenticated Admin')

  check(app.includes('name="username"') && app.includes('autoComplete="username"'), 'Login field is not password-manager friendly')
  check(app.includes('name="password"') && app.includes("autoComplete={authHasUsers ? 'current-password' : 'new-password'}"), 'Password field is not password-manager friendly')
  check(app.includes('name="current-password"') && app.includes('name="new-password"'), 'Password change form autocomplete semantics missing')

  check(workflow.includes('orders_db_prod') && workflow.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Auth migration workflow is not hard-locked to Production D1')
  check(workflow.includes('duplicate_manager_links') && workflow.includes('Duplicate manager-account links exist'), 'Production workflow does not fail closed on duplicate employee accounts')
  check(workflow.includes('orders_db_branch2') && workflow.includes('Refusing Production auth migration'), 'Production workflow does not reject Branch2 identity')
  check(workflow.includes('Production row fingerprint changed during auth schema migration'), 'Production workflow does not verify business-row preservation')

  console.log('AUTH PRODUCTION HARDENING PASSED — account uniqueness, persistent throttling, 30k PBKDF2, 14-day sessions, auth audit, password-manager semantics and guarded Production schema are enforced.')
} catch (error) {
  console.error(`AUTH PRODUCTION HARDENING FAILED: ${error?.message || error}`)
  process.exit(1)
}
