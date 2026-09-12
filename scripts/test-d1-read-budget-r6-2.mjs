import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'worker/domains/finance-reports.ts'), 'utf8')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'scripts/d1-read-budget-r6-2-worker-manifest.json'), 'utf8'))

const requireMatch = (pattern, message) => {
  if (!pattern.test(source)) throw new Error(message)
}

requireMatch(
  /const paymentOperationCustomerSelect = financeWorkspaceOnly[\s\S]*'—' AS customer[\s\S]*COALESCE\(c\.display_name, c\.phone_normalized, '—'\) AS customer/,
  'R6.2: Finance-only payment reads must preserve the customer field without reading customers.'
)
requireMatch(
  /const paymentOperationCustomerJoin = financeWorkspaceOnly[\s\S]*LEFT JOIN customers c ON c\.id = o\.customer_id/,
  'R6.2: full reports must preserve the legacy customer join.'
)
const selectUses = source.match(/\$\{paymentOperationCustomerSelect\}/g) || []
const joinUses = source.match(/\$\{paymentOperationCustomerJoin\}/g) || []
if (selectUses.length !== 2 || joinUses.length !== 2) {
  throw new Error(`R6.2: expected two optimized payment-operation queries, got select=${selectUses.length}, join=${joinUses.length}.`)
}
if (manifest?.version !== 1 || manifest?.revision !== 'd1-read-budget-r6-2-finance-payment-customer-join-r1') {
  throw new Error('R6.2: Worker manifest identity changed unexpectedly.')
}
if (Object.keys(manifest.changes || {}).join(',') !== 'listFinanceReports') {
  throw new Error('R6.2: Worker structural allow-list widened beyond listFinanceReports.')
}

console.log('D1 read budget R6.2 checks passed.')
