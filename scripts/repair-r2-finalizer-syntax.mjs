import fs from 'node:fs'

const file = 'scripts/apply-stabilization-20260912-r2-manager-date.mjs'
let text = fs.readFileSync(file, 'utf8')

const escapedExportNormalizer = "statement.getText(source).replace(/^export\\\\s+/, '')"
const gateExportNormalizer = "statement.getText(source).replace(/^export\\s+/, '')"
if (!text.includes(escapedExportNormalizer)) throw new Error('R2 declaration normalizer repair anchor missing')
text = text.replace(escapedExportNormalizer, gateExportNormalizer)

function replaceSection(startMarker, endMarker, replacement) {
  const start = text.indexOf(startMarker)
  if (start < 0) throw new Error(`Missing start marker: ${startMarker}`)
  const end = text.indexOf(endMarker, start)
  if (end < 0) throw new Error(`Missing end marker: ${endMarker}`)
  text = text.slice(0, start) + replacement + text.slice(end)
}

const r63Replacement = `const r63Test = [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  "import { fileURLToPath } from 'node:url'",
  '',
  "const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')",
  "const source = fs.readFileSync(path.join(root, 'worker/domains/finance-reports.ts'), 'utf8')",
  '',
  "const requireText = (needle, message) => { if (!source.includes(needle)) throw new Error(message) }",
  '',
  "if (source.includes('managerRows') || source.includes('managerCashRows')) throw new Error('R6.3: dedicated manager summary result sets must remain removed.')",
  "requireText('COUNT(CASE WHEN o.total_amount <> 0 THEN 1 END) AS nonzero_order_count', 'R6.3: manager day rows must preserve the non-zero-order denominator.')",
  "requireText('const managerIdentityKey = (managerId: number, managerName: unknown)', 'R6.3: collision-safe manager identity missing.')",
  "requireText('return managerId > 0 ?', 'R6.3: live manager identity missing.')",
  "requireText('legacy:', 'R6.3: historical manager identity must use snapshot name instead of id 0.')",
  "requireText('const managerSummaryMap = new Map<string, any>()', 'R6.3: manager summary must use collision-safe string identities.')",
  "requireText('summary.order_count += managerRow.order_count', 'R6.3: manager order facts must accumulate instead of overwrite.')",
  "requireText('summary.total_returns += managerRow.total_returns', 'R6.3: manager return facts must accumulate instead of overwrite.')",
  "requireText('summary.nonzero_order_count += nonzeroOrderCount', 'R6.3: manager avg-check denominator must accumulate instead of overwrite.')",
  "requireText('for (const operation of paymentOperations)', 'R6.3: manager received summary must reuse already-loaded payment operations.')",
  "requireText('const summaryKey = managerIdentityKey(managerId, manager)', 'R6.3: payment summary must use the same collision-safe identity.')",
  "requireText('summary.total_received += Number(operation.amount || 0)', 'R6.3: payment operations must accumulate into manager received total.')",
  "requireText('avg_check: summary.nonzero_order_count > 0 ? summary.total_sales / summary.nonzero_order_count : 0', 'R6.3: avg_check semantics changed unexpectedly.')",
  '',
  "console.log('D1 read budget R6.3 checks passed.')",
].join('\\n') + '\\n'
write('scripts/test-d1-read-budget-r6-3.mjs', r63Test)`

const focusedReplacement = `const focusedR2Test = [
  "import fs from 'node:fs'",
  "import assert from 'node:assert/strict'",
  '',
  "const dashboard = fs.readFileSync('worker/domains/inventory-read.ts', 'utf8')",
  "const finance = fs.readFileSync('worker/domains/finance-reports.ts', 'utf8')",
  '',
  "const dashboardStart = dashboard.indexOf('export async function getDashboardInsights')",
  "assert.ok(dashboardStart >= 0, 'Dashboard declaration missing')",
  "const dashboardBody = dashboard.slice(dashboardStart)",
  "assert.ok(dashboardBody.includes('Asia/Almaty'), 'Dashboard must use Kazakhstan business timezone')",
  "assert.ok(dashboardBody.includes('.formatToParts(new Date())'), 'Dashboard date must be assembled from timezone-aware parts')",
  "assert.ok(!dashboardBody.includes('new Date().toISOString().slice(0, 10)'), 'Dashboard must not derive business day from UTC')",
  '',
  "assert.ok(finance.includes('const managerIdentityKey = (managerId: number, managerName: unknown)'), 'Collision-safe manager identity missing')",
  "assert.ok(finance.includes('const managerSummaryMap = new Map<string, any>()'), 'Manager summary must use stable string identities')",
  "assert.ok(finance.includes('current.order_count += Number(row.order_count || 0)'), 'Split manager order groups must accumulate instead of overwrite')",
  "assert.ok(finance.includes('current.primary_received += Number(row.primary_received || 0)'), 'Split manager payment groups must accumulate instead of overwrite')",
  "assert.ok(finance.includes('current.totalReturns += Number(row.total_returns || 0)'), 'Split manager return groups must accumulate instead of overwrite')",
  "assert.ok(!finance.includes('const managerSummaryMap = new Map<number, any>()'), 'Old numeric-only manager summary key must stay removed')",
  '',
  "console.log('September 12 stabilization R2 manager/date regression: OK')",
].join('\\n') + '\\n'
write('scripts/test-stabilization-20260912-r2-manager-date.mjs', focusedR2Test)`

replaceSection(
  "write('scripts/test-d1-read-budget-r6-3.mjs', `",
  "\n\nwrite('scripts/test-stabilization-20260912-r2-manager-date.mjs', `",
  r63Replacement,
)
replaceSection(
  "write('scripts/test-stabilization-20260912-r2-manager-date.mjs', `",
  "\n\nreplaceOnce(\n  'package.json'",
  focusedReplacement,
)

fs.writeFileSync(file, text)
console.log('R2 finalizer syntax repaired.')
