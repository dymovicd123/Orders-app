import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('worker/domains/order-pricing.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(source.includes('export function buildItemizedOrderWritePlan'), 'Itemized write-plan builder is missing')
check(!source.includes('D1Database') && !source.includes('.prepare('), 'H2 write plan must remain database-independent')
check(!source.includes('orderTotal') && !source.includes('totalOverride'), 'H2 must not reintroduce manual order total')
check(!source.includes('catalog_execution_prices'), 'H2 must not read mutable current Catalog price')

const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)

const plan = mod.buildItemizedOrderWritePlan(
  [
    { quantity: 2, unitPrice: 36000, catalogPriceSnapshot: 40000 },
    { quantity: 1, unitPrice: 11000, catalogPriceSnapshot: null },
  ],
  [{ amount: 40000 }],
)
check(plan.pricingMode === 'itemized_v1', 'Write plan must explicitly classify itemized_v1')
check(plan.totalAmount === 83000 && plan.receivedAmount === 40000 && plan.debtAmount === 43000, 'Write plan money must come from H1 calculator')
check(plan.lines[0].lineTotal === 72000 && plan.lines[1].lineTotal === 11000, 'Write plan must persist server-derived line totals')
check(plan.lines[0].catalogPriceSnapshot === 40000, 'Catalog recommendation snapshot must be preserved separately from sold price')
check(plan.lines[0].unitPrice === 36000, 'Actual sold price must remain independent from Catalog snapshot')
check(plan.lines[1].catalogPriceSnapshot === null, 'Missing Catalog recommendation must remain NULL, not zero')
check(plan.totalAmount !== 2 * plan.lines[0].catalogPriceSnapshot + 11000, 'Catalog snapshot must not participate in order total arithmetic')

const explicitZero = mod.buildItemizedOrderWritePlan(
  [{ quantity: 1, unitPrice: 0, catalogPriceSnapshot: 25000 }],
  [],
)
check(explicitZero.lines[0].unitPrice === 0 && explicitZero.totalAmount === 0, 'Explicit zero sold price stays representable pending client policy')
check(explicitZero.lines[0].catalogPriceSnapshot === 25000, 'Zero sold price must not erase original Catalog recommendation')

let invalidSnapshotRejected = false
try {
  mod.buildItemizedOrderWritePlan([{ quantity: 1, unitPrice: 1000, catalogPriceSnapshot: -1 }], [])
} catch (error) {
  invalidSnapshotRejected = error?.code === 'itemized_pricing_invalid'
}
check(invalidSnapshotRejected, 'Negative Catalog snapshot must be rejected')

let overpaymentRejected = false
try {
  mod.buildItemizedOrderWritePlan([{ quantity: 1, unitPrice: 1000, catalogPriceSnapshot: null }], [{ amount: 1001 }])
} catch (error) {
  overpaymentRejected = error?.code === 'itemized_overpayment'
}
check(overpaymentRejected, 'Write plan must not be produced while payments exceed final itemized total')

console.log('STAGE03-H2 ITEMIZED WRITE PLAN PASSED — save-ready values keep Catalog snapshot separate, persist server-derived line/order totals, preserve independent payments/debt, and remain pure/inactive')
