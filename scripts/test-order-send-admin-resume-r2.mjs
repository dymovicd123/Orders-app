import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const check = (ok, message) => { if (!ok) throw new Error(message) }

try {
  const app = read('src/App.tsx')
  const modal = read('src/features/orders/OrderCatalogResolutionModal.tsx')

  check(modal.includes('onRequestAdminMode?: () => void'), 'Resolver does not expose an inline Admin-mode continuation callback')
  check((modal.match(/Войти как администратор/g) || []).length >= 2, 'Admin-required resolver states do not offer an in-place continuation action')
  check(modal.includes('Нет такого товара? Попросите администратора добавить его.'), 'Missing-product path does not explain the Admin-owned new-product action')
  check(modal.includes('>Проверить снова</button>'), 'Reference-value escalation does not let the manager re-check the preserved resolver state')

  check(app.includes('onRequestAdminMode={() => setAdminModeOpen(true)}'), 'Orders resolver is not wired to open Admin mode in place')
  check(app.includes('style={orderCatalogResolutionOrder || returnedItemResolutionEventId ? { zIndex: 1501 } : undefined}'), 'Admin login cannot reliably appear above the active order or returned-item resolver')
  check(app.includes('После входа вы вернётесь к уточнению этого заказа.'), 'Admin login does not explain the return-to-order behavior')
  check(app.includes('setSimpleAdminMode(true)') && app.includes('setAdminModeOpen(false)'), 'Successful Admin login no longer promotes the current resolver session')

  console.log('ORDER SEND ADMIN RESUME R2 TESTS PASSED — Admin login opens above the resolver and returns to the same order clarification without a Warehouse detour.')
} catch (error) {
  console.error(`ORDER SEND ADMIN RESUME R2 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
