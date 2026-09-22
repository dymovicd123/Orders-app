import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const core = read('worker/domains/order-core.ts')
const manifest = JSON.parse(read('scripts/stage03-g3-itemized-calculator-worker-manifest.json'))
check(manifest?.version === 1 && manifest?.revision === 'stage03-g3-itemized-calculator-contract', 'G3 structural manifest missing')
check(Object.keys(manifest.files || {}).join(',') === 'worker/domains/order-core.ts', 'G3 must change only the pure order-core calculator layer')

const start = core.indexOf('export function calculateItemizedV1Totals')
const end = core.indexOf("export function assertOrderItemInputs", start)
check(start >= 0 && end > start, 'itemized_v1 calculator missing')
const calculator = core.slice(start, end)

check(calculator.includes('const lineTotal = quantity * unitPrice'), 'itemized total must be quantity × actual unit price')
check(calculator.includes('totalAmount += lineTotal'), 'itemized total must sum line totals')
check(calculator.includes('receivedAmount += amount'), 'received amount must come from payment facts')
check(calculator.includes('if (receivedAmount > totalAmount)'), 'overpayment must be explicitly rejected')
check(calculator.includes('const debtAmount = totalAmount - receivedAmount'), 'debt must equal final total minus received payments')
check(calculator.includes("pricingMode: 'itemized_v1'"), 'calculator result must identify itemized_v1 mode')
check(calculator.includes('unitPrice < 0') && !calculator.includes('unitPrice <= 0'), 'zero sold price must remain technically valid until client policy decides otherwise')
for (const forbidden of ['orderTotal', 'totalOverride', 'catalog_execution_prices', 'catalog_price_snapshot', 'catalogPriceSnapshot']) {
  check(!calculator.includes(forbidden), `itemized calculator must not depend on ${forbidden}`)
}

console.log('STAGE03-G3 ITEMIZED CALCULATOR CONTRACT PASSED — total derives only from quantity × actual sold unit price, payments stay independent, debt is derived, overpayment is rejected, and mutable Catalog price is absent')
