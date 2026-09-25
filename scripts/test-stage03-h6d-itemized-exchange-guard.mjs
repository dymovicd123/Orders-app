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
check(createExchange.includes("cleanText((existing as any).pricing_mode) === 'itemized_v1'"), 'Exchange guard must use persisted order pricing mode')
check(createExchange.includes('CriticalOperationConflictError'), 'Itemized exchange guard must fail as controlled conflict')
check(createExchange.indexOf("pricing_mode) === 'itemized_v1'") < createExchange.indexOf('const oldItemId'), 'Itemized exchange must stop before item mutation planning')
check(createExchange.includes('unitPrice: 0') && createExchange.includes('lineTotal: 0'), 'Legacy exchange pricing assumption unexpectedly changed; H6D guard rationale must be reviewed')

const regularExchangeStart = app.indexOf('async function handleOpenExchange')
const regularExchangeEnd = app.indexOf('\n\n  function closeOrderEditor', regularExchangeStart)
const workshopExchangeStart = app.indexOf('async function openWorkshopExchange')
const workshopExchangeEnd = app.indexOf('\n\n  async function ', workshopExchangeStart + 40)
const regularExchange = app.slice(regularExchangeStart, regularExchangeEnd)
const workshopExchange = app.slice(workshopExchangeStart, workshopExchangeEnd)
check(regularExchange.includes("order.pricing_mode === 'itemized_v1'"), 'Ordinary exchange entry no longer blocks itemized orders')
check(workshopExchange.includes("order.pricing_mode === 'itemized_v1'"), 'Workshop exchange entry no longer blocks itemized orders')
check(app.includes("const isItemizedEdit = order.pricing_mode === 'itemized_v1'"), 'H8B restricted editor selector missing while exchange stays fail-closed')
check(regularExchangeStart >= 0 && workshopExchangeStart >= 0, 'Exchange UI boundaries missing')
check(app.includes('текущая форма обмена работает по старой общей цене'), 'Human-readable itemized exchange guard message missing')
check(contract.includes('replacement item is inserted with price 0') && contract.includes('do not switch exchanges to itemized semantics'), 'Stage03 exchange boundary contract drifted')

console.log('STAGE03-H6D ITEMIZED EXCHANGE GUARD PASSED — H8B restricted metadata editing is independent from exchange; legacy exchange arithmetic stays unchanged and both itemized exchange entry paths remain fail-closed')
