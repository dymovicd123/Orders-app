import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const wrangler = read('wrangler.jsonc')
const app = read('src/App.tsx')
const vm = read('src/app/controllers/useWorkspaceViewModel.tsx')
const ui = read('src/features/sections/CreateOrderSection.tsx')
const pricing = read('src/app/order-pricing.ts')
const manifest = JSON.parse(read('scripts/stage03-h8g-direct-create-price-frontend-manifest.json'))

check(wrangler.includes('"name": "orders-app-branch2"'), 'H8G: Branch2 Worker identity drifted')
check(wrangler.includes('"database_name": "orders_db_branch2"') && wrangler.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"'), 'H8G: Branch2 D1 identity drifted')
check(!wrangler.includes('orders_db_prod') && !wrangler.includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'H8G: Production D1 identity leaked into Branch2')

check(manifest?.version === 1 && manifest?.revision === 'stage03-h8g-direct-create-price', 'H8G structural manifest missing')
check(Object.keys(manifest.files || {}).sort().join(',') === [
  'src/App.tsx',
  'src/app/controllers/useWorkspaceViewModel.tsx',
  'src/app/order-pricing.ts',
  'src/features/sections/CreateOrderSection.tsx',
].sort().join(','), 'H8G frontend allow-list widened')

check(!ui.includes('Подтвердить цену') && !ui.includes('нужно подтвердить заново'), 'H8G redundant manual-price confirmation is still visible')
check(ui.includes('ваша цена останется без дополнительного подтверждения'), 'H8G preserved-manual-price behavior is not explained')
check(!pricing.includes("'price_confirmation_required'"), 'H8G readiness still blocks on confirmation instead of real validation')
check(!app.includes("blocker?.code === 'price_confirmation_required'"), 'H8G Create save still handles obsolete confirmation blocker')

const createUpdateStart = app.indexOf('function updateCreateItem(')
const createUpdateEnd = app.indexOf('\n\n  function addCreateItem', createUpdateStart)
const updateCreate = app.slice(createUpdateStart, createUpdateEnd)
check(updateCreate.includes("const keepManualPrice = item.priceOrigin === 'manual'"), 'H8G manual sold price is not preserved across Catalog-driving changes')
check(updateCreate.includes("nextItem.priceOrigin = 'manual'") && updateCreate.includes('nextItem.priceNeedsConfirmation = false'), 'H8G preserved manual sold price still requires a second acknowledgement')
check(!updateCreate.includes('nextItem.priceNeedsConfirmation = true'), 'H8G Create can still generate confirmation-required state')

const pickStart = vm.indexOf('function applyCreateProductPick(')
const pickEnd = vm.indexOf('\n\n  function applyEditorProductPick', pickStart)
const pick = vm.slice(pickStart, pickEnd)
check(pick.includes("keepManualPrice = item.priceOrigin === 'manual'"), 'H8G product pick drops a deliberate manual sold price')
check(pick.includes('priceNeedsConfirmation: false'), 'H8G product pick reintroduced confirmation state')

check(ui.includes('Цена по каталогу') && ui.includes('Цена продажи'), 'H8G Catalog recommendation/final sold price distinction disappeared')
check(pricing.includes("'missing_unit_price'") && pricing.includes("'invalid_unit_price'") && pricing.includes("'overpayment'"), 'H8G removed real pricing safety blockers')

console.log('STAGE03-H8G DIRECT CREATE PRICE PASSED — manager-entered sold price remains direct, Catalog recommendation refreshes independently, and Save validates real money/stock rules without a redundant per-price confirmation click')
