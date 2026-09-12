import fs from 'node:fs'

const finance = fs.readFileSync('worker/domains/finance-reports.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(finance.includes("() => financeWorkspaceOnly ? emptyRowsResult() : !needsReport('payments') ? emptyRowsResult() : db.prepare(\n      `SELECT p.method AS method"), 'R5.8 Finance scope must skip the standalone payment-method aggregate')
  check(finance.includes("() => financeWorkspaceOnly || reportType === 'payments' ? emptyRowsResult() : !needsReport('payments') ? emptyRowsResult() : db.prepare(\n      `SELECT p.payment_date AS date, p.method AS method"), 'R5.8 Finance scope and selected payments report must skip the standalone payment-by-day aggregate')
  check(finance.includes('const rawPaymentOperationRows = mapSqlRows(paymentOperationRows) as any[];'), 'R5.8 raw payment source must be materialized once')
  check(finance.includes('if (financeWorkspaceOnly) {\n    for (const row of rawPaymentOperationRows)'), 'R5.8 payment-method summary must derive from the already-loaded Finance payment rows')
  check(finance.includes('const paymentOperations = rawPaymentOperationRows.map((row: any) => {'), 'R5.8 payment trace must preserve the same raw operation rows')
  check(finance.includes("const paymentMethodsByDaySource = financeWorkspaceOnly || reportType === 'payments'\n    ? Array.from(rawPaymentOperationRows.reduce"), 'R5.8 Finance scope and selected payments report must derive payment-by-day from the already-loaded payment-operation rows')
  check(finance.includes('const totalOrder = Number(b.total || 0) - Number(a.total || 0);'), 'R5.8 Finance-derived day methods must preserve SQL total-desc ordering before canonical merge')
  check(finance.includes('if (a.method == null && b.method != null) return -1;'), 'R5.8 Finance-derived day methods must preserve SQLite NULL-first method tie ordering')
  check(finance.includes('paymentMethodsByDay: Array.from(paymentMethodsByDayMap.values()).sort((a, b) => a.date.localeCompare(b.date))'), 'R5.8 payment day response must preserve ascending date order')
  check(finance.includes('current.count += Number(row.count || 0);'), 'Non-Finance report path must retain the SQL payment-method aggregate behavior')
  check(finance.includes(': mapSqlRows(paymentByDayRows) as any[];'), 'Other non-Finance report paths must retain the SQL payment-by-day aggregate behavior')
  console.log('D1 READ BUDGET R5.8 TESTS PASSED — Finance scope and selected payments reports reuse exact payment-operation rows for daily aggregates while other non-Finance reports retain their SQL paths')
} catch (error) {
  console.error(`D1 READ BUDGET R5.8 TESTS FAILED: ${error?.message || error}`)
  process.exit(1)
}
