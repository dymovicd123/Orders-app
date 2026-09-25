import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const worker = read('worker/domains/returns-exchanges.ts')
const app = read('src/App.tsx')
const contract = read('docs/continuation/STAGE03_E_PRICING_CONTRACT_V1_20260922.md')
const workerManifest = JSON.parse(read('scripts/stage03-h6d-itemized-exchange-guard-worker-manifest.json'))
const frontendManifest = JSON.parse(read('scripts/stage03-h6d-itemized-exchange-guard-frontend-manifest.json'))

check(workerManifest?.version === 1 && workerManifest?.revision === 'stage03-h6d-itemized-exchange-guard', 'H6D Worker manifest missing')
check(frontendManifest?.version === 1 && frontendManifest?.revision === 'stage03-h6d-itemized-exchange-guard', 'H6D frontend manifest missing')
check(Object.keys(workerManifest.files || {}).join(',') === 'worker/domains/returns-exchanges.ts', 'H6D Worker allow-list widened')
check(Object.keys(frontendManifest.files || {}).join(',') === 'src/App.tsx', 'H6D frontend allow-list widened')

const exchangeStart = worker.indexOf('export async function createExchange')
const exchangeEnd = worker.indexOf('\n\nexport async function', exchangeStart + 40)
const createExchange = worker.slice(exchangeStart, exchangeEnd > exchangeStart ? exchangeEnd : worker.length)
check(createExchange.includes("const isItemizedExchange = cleanText((existing as any).pricing_mode) === 'itemized_v1'"), 'Exchange path must still branch on persisted order pricing mode')
check(createExchange.includes('CriticalOperationConflictError'), 'Exchange path must retain controlled conflict protection')
check(createExchange.includes('expectedOldCatalogPriceSnapshot') && createExchange.includes('itemizedExchangePricingPlan'), 'H9A itemized backend contract is missing after H6D guard retirement')
check(createExchange.includes('unitPrice: isItemizedExchange ? itemizedExchangePricingPlan!.newUnitPrice : 0'), 'Legacy exchange zero-price behavior must remain isolated to legacy pricing mode')

const regularExchangeStart = app.indexOf('async function handleOpenExchange')
const regularExchangeEnd = app.indexOf('\n\n  function closeOrderEditor', regularExchangeStart)
const workshopExchangeStart = app.indexOf('async function openWorkshopExchange')
const workshopExchangeEnd = app.indexOf('\n\n  async function ', workshopExchangeStart + 40)
const regularExchange = app.slice(regularExchangeStart, regularExchangeEnd)
const workshopExchange = app.slice(workshopExchangeStart, workshopExchangeEnd)
check(!regularExchange.includes("order.pricing_mode === 'itemized_v1'"), 'H9B ordinary itemized Exchange entry is still blocked by the historical guard')
check(!workshopExchange.includes("order.pricing_mode === 'itemized_v1'"), 'H9B Workshop itemized Exchange entry is still blocked by the historical guard')
check(app.includes("const isItemizedEdit = order.pricing_mode === 'itemized_v1'"), 'H8B itemized editor selector disappeared while H9B activates Exchange separately')
check(regularExchangeStart >= 0 && workshopExchangeStart >= 0, 'Exchange UI boundaries missing')
check(!app.includes('текущая форма обмена работает по старой общей цене'), 'Historical itemized Exchange guard copy leaked into H9B')
check(app.includes('expectedOldCatalogPriceSnapshot') && app.includes('expectedOldLineTotal'), 'H9B stale commercial snapshot is not sent by the UI')
check(contract.includes('replacement item is inserted with price 0') && contract.includes('do not switch exchanges to itemized semantics'), 'Historical Stage03 exchange boundary contract drifted')
check(createExchange.includes('isItemizedExchange ? itemizedExchangeWritePlan : null'), 'H9A must supersede only the backend guard with an explicit itemized write path')

console.log('STAGE03-H6D ITEMIZED EXCHANGE BOUNDARY PASSED — historical legacy assumptions remain documented, H9A supersedes the backend guard, and H9B deliberately supersedes the temporary UI guard with stale-safe itemized payloads')
