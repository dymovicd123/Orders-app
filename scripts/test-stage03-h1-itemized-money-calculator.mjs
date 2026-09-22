import fs from 'node:fs'
import ts from 'typescript'

const source = fs.readFileSync('worker/domains/order-pricing.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(source.includes('export function calculateItemizedOrderMoney'), 'Pure itemized calculator export is missing')
check(source.includes('export function validateItemizedOrderMoneyForSave'), 'Itemized save validator export is missing')
check(!source.includes('catalog_execution_prices'), 'Itemized calculator must not read mutable Catalog prices')
check(!source.includes('catalogPriceSnapshot') && !source.includes('catalog_price_snapshot'), 'Itemized arithmetic must not reinterpret the Catalog snapshot')
check(!source.includes('totalOverride') && !source.includes('orderTotal'), 'itemized_v1 calculator must not accept a manual order-total override')
check(!source.includes('D1Database') && !source.includes('.prepare('), 'Itemized calculator must stay pure and database-independent')

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const mod = await import(`data:text/javascript;base64,${Buffer.from(transpiled).toString('base64')}`)

const preview = mod.calculateItemizedOrderMoney(
  [
    { quantity: 2, unitPrice: 36000 },
    { quantity: 1, unitPrice: 11000 },
  ],
  [
    { amount: 30000 },
    { amount: 10000 },
  ],
)
check(JSON.stringify(preview.lineTotals) === JSON.stringify([72000, 11000]), 'Line totals must be quantity × actual sold unit price')
check(preview.totalAmount === 83000, 'Itemized total must be the sum of active line totals')
check(preview.receivedAmount === 40000, 'Received money must be the sum of payment facts')
check(preview.debtAmount === 43000, 'Debt must be final itemized total minus actual received money')
check(preview.overpaymentAmount === 0, 'Normal partial payment must not report overpayment')

const freeExplicit = mod.validateItemizedOrderMoneyForSave(
  [{ quantity: 1, unitPrice: 0 }],
  [],
)
check(freeExplicit.totalAmount === 0 && freeExplicit.debtAmount === 0, 'Explicit zero price must remain distinguishable from a missing price; policy may decide later whether it is allowed')

let missingPriceRejected = false
try {
  mod.calculateItemizedOrderMoney([{ quantity: 1, unitPrice: null }], [])
} catch (error) {
  missingPriceRejected = error?.code === 'itemized_pricing_invalid'
}
check(missingPriceRejected, 'Missing final unit price must not silently collapse to zero')

const overpaid = mod.calculateItemizedOrderMoney(
  [{ quantity: 1, unitPrice: 47000 }],
  [{ amount: 30000 }, { amount: 20000 }],
)
check(overpaid.totalAmount === 47000 && overpaid.receivedAmount === 50000, 'Calculator must preserve independent payment facts even when they exceed price')
check(overpaid.debtAmount === 0 && overpaid.overpaymentAmount === 3000, 'Preview must expose overpayment without mutating payments')

let overpaymentBlocked = false
try {
  mod.validateItemizedOrderMoneyForSave(
    [{ quantity: 1, unitPrice: 47000 }],
    [{ amount: 30000 }, { amount: 20000 }],
  )
} catch (error) {
  overpaymentBlocked = error?.code === 'itemized_overpayment'
}
check(overpaymentBlocked, 'Save validator must explicitly block received money above final itemized total')

for (const [label, lines, payments] of [
  ['fractional quantity', [{ quantity: 1.5, unitPrice: 1000 }], []],
  ['negative price', [{ quantity: 1, unitPrice: -1 }], []],
  ['fractional price', [{ quantity: 1, unitPrice: 1000.5 }], []],
  ['negative payment', [{ quantity: 1, unitPrice: 1000 }], [{ amount: -1 }]],
]) {
  let rejected = false
  try {
    mod.calculateItemizedOrderMoney(lines, payments)
  } catch (error) {
    rejected = error?.code === 'itemized_pricing_invalid'
  }
  check(rejected, `${label} must be rejected instead of rounded/coerced`)
}

console.log('STAGE03-H1 ITEMIZED MONEY CALCULATOR PASSED — total is Σ(quantity × actual unit price), payments stay independent, debt/overpayment are derived, missing price never becomes zero, and no Catalog/manual-total source participates')
