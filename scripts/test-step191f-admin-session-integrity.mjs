import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  const auth = read('worker/domains/auth.ts')
  const worker = read('worker/index.ts')
  const types = read('worker/core/types.ts')
  const uiUtils = read('src/app/utils.ts')
  const release = read('scripts/release-check.mjs')

  check(types.includes('ADMIN_MODE_SESSION_SECRET?: string;'), 'Worker Env does not expose ADMIN_MODE_SESSION_SECRET')
  check(!auth.includes("return readCookie(request, SIMPLE_ADMIN_COOKIE) === '1';"), 'Legacy forgeable admin cookie check returned')
  check(auth.includes("const secret = cleanText(env.ADMIN_MODE_SESSION_SECRET);"), 'Admin session secret is not read from Worker env')
  check(auth.includes("secret.length < 32"), 'Short/missing admin session secret is not rejected')
  check(auth.includes("parts.length !== 4 || parts[0] !== 'v1'"), 'Signed admin cookie version/shape guard missing')
  check(auth.includes("expiresAt <= now") && auth.includes("expiresAt > now + (60 * 60 * 12) + 60"), 'Signed admin cookie expiry bounds missing')
  check(auth.includes("{ name: 'HMAC', hash: 'SHA-256' }"), 'HMAC-SHA256 session signing missing')
  check(auth.includes("['verify']") && auth.includes("crypto.subtle.verify("), 'Cryptographic cookie verification missing')
  check(auth.includes("['sign']") && auth.includes("crypto.subtle.sign('HMAC'"), 'Cryptographic cookie signing missing')
  check(auth.includes('`v1.${expiresAt}.${randomToken(16)}`'), 'Signed admin cookie nonce/payload shape missing')
  check(auth.includes('`${payload}.${signature}`'), 'Signed cookie is not emitted after login')
  check(auth.includes("return text === 'admin' || text === 'админ' ? 'admin' : 'manager';"), 'Worker access role is not fail-closed to manager')
  check(uiUtils.includes("return text === 'admin' || text === 'админ' ? 'admin' : 'manager'"), 'Frontend access role is not fail-closed to manager')
  check(auth.includes("headers.set('X-Access-User', actor);"), 'Authenticated actor header is not overwritten server-side')
  check(auth.includes("headers.set('X-Archive-Actor', actor);"), 'Archive actor header is not overwritten server-side')
  check(auth.includes("normalizeAccessRole(request.headers.get('X-Access-Role')) !== 'admin'"), 'Admin access gate does not use server-normalized role')
  check(worker.includes('authUser = await makeSimpleAccessUser(request, env);'), 'API requests do not await signed admin-session verification')
  check(worker.includes('return handleSimpleAdminStatus(env, request);'), 'Admin status does not verify signed session with env secret')
  check(worker.includes("adminSessionIntegrity: '191f'"), '191F live health marker missing')
  const authHeaderRewrite = worker.indexOf('request = withAuthenticatedHeaders(request, authUser)')
  const firstLegacyGate = worker.indexOf('requireAdminAccess(request)')
  check(authHeaderRewrite >= 0 && firstLegacyGate > authHeaderRewrite, 'A requireAdminAccess route can run before server header normalization')
  check(release.includes('test-step191f-admin-session-integrity.mjs'), '191F security test is not wired into cumulative release gate')

  console.log('STEP 191F ADMIN SESSION INTEGRITY TESTS PASSED — signed 12h HMAC cookie, forged legacy cookie retired, fail-closed roles, server-owned actor headers')
} catch (error) {
  console.error(`STEP 191F ADMIN SESSION INTEGRITY TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
