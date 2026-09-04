import fs from 'node:fs'

const finance = fs.readFileSync('worker/domains/finance-reports.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(finance.includes("() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\n      `SELECT p.method AS method"), 'R5.8 Finance scope must skip the standalone payment-method aggregate')
  check(finance.includes("() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\n      `SELECT p.payment_date AS date, p.method AS method"), 'R5.8 Finance scope must skip the standalone payment-by-day aggregate')
  check(finance.includes('const rawPaymentOperationRows = mapSqlRows(paymentOperationRows) as any[];'), 'R5.8 raw payment source must be materialized once')
  check(finance.includes('if (financeWorkspaceOnly) {\n    for (const row of rawPaymentOperationRows)'), 'R5.8 payment-method summary must derive from the already-loaded Finance payment rows')
  check(finance.includes('const paymentOperations = rawPaymentOperationRows.map((row: any) => {'), 'R5.8 payment trace must preserve the same raw operation rows')
  check(finance.includes('? rawPaymentOperationRows.map((row: any) => ({ date: row.payment_date, method: row.method, total: row.amount }))'), 'R5.8 payment-by-day must derive from payment operations inside Finance scope')
  check(finance.includes('paymentMethodsByDay: Array.from(paymentMethodsByDayMap.values()).sort((a, b) => a.date.localeCompare(b.date))'), 'R5.8 payment day response must preserve ascending date order')
  check(finance.includes('current.count += Number(row.count || 0);'), 'Non-Finance report path must retain the SQL payment-method aggregate behavior')
  check(finance.includes(': mapSqlRows(paymentByDayRows) as any[];'), 'Non-Finance report path must retain the SQL payment-by-day aggregate behavior')
  console.log('D1 READ BUDGET R5.8 TESTS PASSED — Finance scope reuses exact payment-operation rows for payment-method and payment-by-day aggregates while non-Finance reports retain their existing SQL paths')
} catch (error) {
  console.error(`D1 READ BUDGET R5.8 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
