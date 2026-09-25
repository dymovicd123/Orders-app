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
check(updateOrder.includes("const itemizedMetadataOnlyEdit = existingPricingMode === 'itemized_v1'"), 'Restricted itemized metadata-edit lane missing')
check(updateOrder.includes('input.items === undefined') && updateOrder.includes('input.payments === undefined') && updateOrder.includes('input.orderTotal === undefined'), 'Itemized metadata-edit lane must reject item/payment/total rewrites')
check(updateOrder.includes('input.sourceType === undefined') && updateOrder.includes('input.orderStatus === undefined') && updateOrder.includes('input.shippingStatus === undefined'), 'Itemized metadata-edit lane must reject source/lifecycle/shipping rewrites')
check(updateOrder.includes("existingPricingMode === 'itemized_v1' && options.lifecycleAction !== 'order_delete' && !itemizedMetadataOnlyEdit"), 'Unsupported itemized legacy PATCH must still fail closed while dedicated delete stays separate')
check(updateOrder.includes('Разрешены только безопасные исправления реквизитов и проведённых оплат'), 'Controlled itemized edit conflict message missing')

check((app.match(/order\.pricing_mode === 'itemized_v1'/g) || []).length >= 2, 'Both editor entry and stale-save paths must guard itemized orders')
check(app.includes('async function handleEditOrder') && app.includes('async function persistOrder'), 'Frontend editor boundaries missing')
check(createUi.includes('Цена продажи') && createUi.includes('Цена по каталогу'), 'H7 Create pricing UI disappeared while H6A existing-order guard is still required')
check(!createUi.includes('<span>pricingMode</span>') && !createUi.includes('<span>itemized_v1</span>'), 'Technical itemized mode leaked as visible Create UI copy')

console.log('STAGE03-H6A ITEMIZED EDIT GUARD PASSED — unsupported itemized rewrites still fail closed, dedicated delete remains separate, and H8A exposes only a backend metadata/payment-correction lane while frontend activation stays blocked')
