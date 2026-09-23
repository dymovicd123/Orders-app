import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const worker = read('worker/domains/orders-write.ts')
const app = read('src/App.tsx')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const workerManifest = JSON.parse(read('scripts/stage03-h6a-itemized-edit-guard-worker-manifest.json'))
const frontendManifest = JSON.parse(read('scripts/stage03-h6a-itemized-edit-guard-frontend-manifest.json'))

check(workerManifest?.version === 1 && workerManifest?.revision === 'stage03-h6a-itemized-edit-guard', 'H6A Worker manifest missing')
check(frontendManifest?.version === 1 && frontendManifest?.revision === 'stage03-h6a-itemized-edit-guard', 'H6A frontend manifest missing')
check(Object.keys(workerManifest.files || {}).join(',') === 'worker/domains/orders-write.ts', 'H6A Worker allow-list widened')
check(Object.keys(frontendManifest.files || {}).join(',') === 'src/App.tsx', 'H6A frontend allow-list widened')

const updateStart = worker.indexOf('export async function updateOrderCritical')
const updateEnd = worker.indexOf('\n\nexport async function getOrder', updateStart)
check(updateStart >= 0 && updateEnd > updateStart, 'updateOrderCritical boundaries missing')
const updateOrder = worker.slice(updateStart, updateEnd)
check(updateOrder.includes("existingPricingMode = cleanText(existingAny.pricing_mode) === 'itemized_v1'"), 'Edit guard must use persisted pricing_mode')
check(updateOrder.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete'"), 'Itemized legacy PATCH must fail closed while dedicated delete stays separate')
check(updateOrder.includes('Старый редактор заказа для него отключён'), 'Controlled itemized edit conflict message missing')

check((app.match(/order\.pricing_mode === 'itemized_v1'/g) || []).length >= 2, 'Both editor entry and stale-save paths must guard itemized orders')
check(app.includes('async function handleEditOrder') && app.includes('async function persistOrder'), 'Frontend editor boundaries missing')
check(createUi.includes('Цена заказа'), 'Legacy Create UI unexpectedly changed in H6A')
check(!createUi.includes('pricingMode') && !createUi.includes('resolveCatalogOrderSalePrice'), 'H6A must not activate itemized Create UI or Catalog autofill')

console.log('STAGE03-H6A ITEMIZED EDIT GUARD PASSED — existing itemized orders fail closed in legacy PATCH/editor paths, dedicated lifecycle delete remains separate, and Create UI stays unchanged')
