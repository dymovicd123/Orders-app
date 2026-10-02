import fs from 'node:fs'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const read = (path) => fs.readFileSync(path, 'utf8')

try {
  const orderResolver = read('src/features/orders/OrderCatalogResolutionModal.tsx')
  const returnResolver = read('src/features/orders/ReturnedItemResolutionModal.tsx')
  const app = read('src/App.tsx')
  const worker = read('worker/index.ts')
  const apiClient = read('src/app/controllers/useApiClient.ts')

  check(!orderResolver.includes('onRequestAdminMode'), 'Order resolver still exposes inline Admin-mode escalation')
  check(!returnResolver.includes('onRequestAdminMode'), 'Returned-item resolver still exposes inline Admin-mode escalation')
  check(!orderResolver.includes('Войти как администратор') && !orderResolver.includes('Войти в админ режим'), 'Order resolver still renders an inline Admin login action')
  check(!returnResolver.includes('Войти как администратор') && !returnResolver.includes('Войти в админ режим'), 'Returned-item resolver still renders an inline Admin login action')
  check(orderResolver.includes('под своим аккаунтом'), 'Order resolver no longer explains that Admin work must happen under an Admin account')
  check(returnResolver.includes('под своим аккаунтом'), 'Returned-item resolver no longer explains account-owned Admin continuation')

  check(!app.includes('setAdminModeOpen') && !app.includes('submitAdminMode'), 'App still contains runtime Admin-mode promotion UI')
  check(!app.includes('/api/admin-mode/'), 'App still calls legacy Admin-mode endpoints')
  check(app.includes("'/api/auth/login'") && app.includes("'/api/auth/logout'"), 'App is not wired to normal account login/logout')
  check(worker.includes('authUser = await getCurrentAuthUser(env.DB, request);'), 'Worker does not resolve API identity from the account session')
  check(!worker.includes("url.pathname === '/api/admin-mode/"), 'Worker still exposes legacy Admin-mode routes')

  check(!apiClient.includes("headers.set('X-Access-Role'"), 'Browser can still assert its own access role')
  check(!apiClient.includes("headers.set('X-Archive-Actor'"), 'Browser can still assert its own archive actor')

  console.log('AUTH R2 RESOLVER ESCALATION TESTS PASSED — resolvers preserve Admin-only boundaries without in-place password escalation; account sessions own identity and role.')
} catch (error) {
  console.error(`AUTH R2 RESOLVER ESCALATION TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
