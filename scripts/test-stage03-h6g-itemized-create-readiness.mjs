import fs from 'node:fs'
import ts from 'typescript'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const source = read('src/app/order-pricing.ts')
const createUi = read('src/features/sections/CreateOrderSection.tsx')
const app = read('src/App.tsx')
const manifest = JSON.parse(read('scripts/stage03-h6g-itemized-create-readiness-frontend-manifest.json'))

check(manifest?.version === 1 && manifest?.revision === 'stage03-h6g-itemized-create-readiness', 'H6G frontend manifest missing')
check(Object.keys(manifest.files || {}).join(',') === 'src/app/order-pricing.ts', 'H6G frontend allow-list widened')
check(source.includes('export function evaluateItemizedCreatePricing'), 'H6G pure readiness function missing')
check(source.includes("pricingMode: 'itemized_v1'"), 'H6G readiness must carry explicit itemized mode')
check(source.includes("'missing_unit_price'") && source.includes("'overpayment'"), 'H6G readiness blockers incomplete')
check(!createUi.includes('evaluateItemizedCreatePricing'), 'H6G readiness must not activate visible Create UI')
const createStart = app.indexOf('async function createOrderFromDraft')
const createEnd = app.indexOf('\n  function ', createStart + 40)
const createFlow = app.slice(createStart, createEnd > createStart ? createEnd : app.length)
check(!createFlow.includes('pricingMode:'), 'H6G must not activate itemized Create request')

const utilsSource = read('src/app/utils.ts')
const transpile = src => ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const modules = new Map()
function load(name, src) {
  if (modules.has(name)) return modules.get(name).exports
  const module = { exports: {} }
  modules.set(name, module)
  new Function('require','module','exports',transpile(src))((specifier) => {
    if (specifier === './utils') return load('utils', utilsSource)
    if (specifier === './types') return {}
    throw new Error('Unexpected import: ' + specifier)
  }, module, module.exports)
  return module.exports
}
const pricing = load('pricing', source)

let result = pricing.evaluateItemizedCreatePricing(
  [
    { productName: 'Платье', quantity: 2, unitPrice: 36000, catalogPriceSnapshot: 40000 },
    { productName: 'Аксессуар', quantity: 1, unitPrice: 11000, catalogPriceSnapshot: null },
    { productName: '', quantity: 99 },
  ],
  [{ method: 'НАЛИЧКА', amount: 30000 }, { method: 'KASPI PAY', amount: 10000 }],
)
check(result.status === 'ready', 'Complete itemized draft must be ready')
check(result.totalAmount === 83000 && result.receivedAmount === 40000 && result.debtAmount === 43000, 'H6G preview arithmetic drifted')
check(result.overpaymentAmount === 0, 'Ready draft must not report overpayment')
check(result.lines.length === 2 && result.lines[0].lineTotal === 72000, 'Blank item rows must be ignored and line total must be derived')
check(result.lines[0].catalogPriceSnapshot === 40000 && result.lines[0].unitPrice === 36000, 'Recommendation snapshot and final sold price must stay separate')

result = pricing.evaluateItemizedCreatePricing(
  [{ productName: 'Без цены', quantity: 1, catalogPriceSnapshot: null }],
  [],
)
check(result.status === 'blocked' && result.blockers.some(x => x.code === 'missing_unit_price'), 'Missing final price must block readiness without inventing zero')
check(result.totalAmount === null, 'Missing final price must not produce a fake total')

result = pricing.evaluateItemizedCreatePricing(
  [{ productName: 'Бесплатно', quantity: 1, unitPrice: 0, catalogPriceSnapshot: 1000 }],
  [],
)
check(result.status === 'ready' && result.totalAmount === 0, 'Explicit zero must remain technically representable pending client policy')

result = pricing.evaluateItemizedCreatePricing(
  [{ productName: 'Товар', quantity: 1, unitPrice: 1000, catalogPriceSnapshot: 1200 }],
  [{ method: 'НАЛИЧКА', amount: 1200 }],
)
check(result.status === 'blocked' && result.overpaymentAmount === 200 && result.blockers.some(x => x.code === 'overpayment'), 'Overpayment must block itemized readiness')

result = pricing.evaluateItemizedCreatePricing(
  [{ productName: 'Товар', quantity: 0, unitPrice: 1000 }],
  [],
)
check(result.status === 'blocked' && result.blockers.some(x => x.code === 'invalid_quantity'), 'Invalid quantity must block readiness')

result = pricing.evaluateItemizedCreatePricing(
  [{ productName: 'Товар', quantity: 1, unitPrice: 1000, catalogPriceSnapshot: -1 }],
  [],
)
check(result.status === 'blocked' && result.blockers.some(x => x.code === 'invalid_catalog_snapshot'), 'Invalid Catalog snapshot must fail closed')

result = pricing.evaluateItemizedCreatePricing(
  [{ productName: 'Товар', quantity: 1, unitPrice: 1000 }],
  [{ method: '', amount: 500 }],
)
check(result.status === 'blocked' && result.blockers.some(x => x.code === 'invalid_payment'), 'Payment amount without method must block readiness')

console.log('STAGE03-H6G ITEMIZED CREATE READINESS PASSED — frontend can preflight exact itemized line/payment/debt arithmetic without activating UI, inventing missing prices, collapsing Catalog snapshot into sold price, or deciding zero-price policy')
