from pathlib import Path
import json
import re

path = Path('worker/domains/finance-reports.ts')
text = path.read_text()


def sub_once(pattern, replacement, label):
    global text
    text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{label}: expected 1 replacement, got {count}')


sub_once(
    r"\(\) => db\.prepare\(\n\s+`SELECT p\.method AS method, COUNT\(\*\) AS count, COALESCE\(SUM\(p\.amount\), 0\) AS total",
    "() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\n      `SELECT p.method AS method, COUNT(*) AS count, COALESCE(SUM(p.amount), 0) AS total",
    'payment methods query',
)

sub_once(
    r"\(\) => db\.prepare\(\n\s+`SELECT p\.payment_date AS date, p\.method AS method, COALESCE\(SUM\(p\.amount\), 0\) AS total",
    "() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\n      `SELECT p.payment_date AS date, p.method AS method, COALESCE(SUM(p.amount), 0) AS total",
    'payment by day query',
)

anchor = "  const returns = mapSqlRows(returnsRows);"
if text.count(anchor) != 1:
    raise SystemExit('returns anchor missing or ambiguous')
text = text.replace(anchor, "  const rawPaymentOperationRows = mapSqlRows(paymentOperationRows) as any[];\n" + anchor, 1)

sub_once(
    r"  const paymentMethodMap = new Map<string, \{ method: string; count: number; total: number \}>\(\);\n  for \(const row of mapSqlRows\(paymentMethods\) as any\[\]\) \{.*?\n  \}\n  const paymentRows = Array\.from\(paymentMethodMap\.values\(\)\)\.sort\(\(a, b\) => b\.total - a\.total \|\| a\.method\.localeCompare\(b\.method, 'ru'\)\);",
    """  const paymentMethodMap = new Map<string, { method: string; count: number; total: number }>();
  if (financeWorkspaceOnly) {
    for (const row of rawPaymentOperationRows) {
      const method = canonicalPaymentMethodName(row.method);
      const current = paymentMethodMap.get(method) || { method, count: 0, total: 0 };
      current.count += 1;
      current.total += Number(row.amount || 0);
      paymentMethodMap.set(method, current);
    }
  } else {
    for (const row of mapSqlRows(paymentMethods) as any[]) {
      const method = canonicalPaymentMethodName(row.method);
      const current = paymentMethodMap.get(method) || { method, count: 0, total: 0 };
      current.count += Number(row.count || 0);
      current.total += Number(row.total || 0);
      paymentMethodMap.set(method, current);
    }
  }
  const paymentRows = Array.from(paymentMethodMap.values()).sort((a, b) => b.total - a.total || a.method.localeCompare(b.method, 'ru'));""",
    'payment method aggregation',
)

old = "const paymentOperations = mapSqlRows(paymentOperationRows).map((row: any) => {"
if text.count(old) != 1:
    raise SystemExit('payment operations source missing or ambiguous')
text = text.replace(old, "const paymentOperations = rawPaymentOperationRows.map((row: any) => {", 1)

sub_once(
    r"  const paymentMethodsByDayMap = new Map<string, \{ date: string; total: number; methods: Record<string, number> \}>\(\);\n  for \(const row of mapSqlRows\(paymentByDayRows\) as any\[\]\) \{.*?\n  \}",
    """  const paymentMethodsByDayMap = new Map<string, { date: string; total: number; methods: Record<string, number> }>();
  const paymentMethodsByDaySource = financeWorkspaceOnly
    ? rawPaymentOperationRows.map((row: any) => ({ date: row.payment_date, method: row.method, total: row.amount }))
    : mapSqlRows(paymentByDayRows) as any[];
  for (const row of paymentMethodsByDaySource) {
    const date = cleanText(row.date);
    const method = canonicalPaymentMethodName(row.method);
    const total = Number(row.total || 0);
    if (!paymentMethodsByDayMap.has(date)) paymentMethodsByDayMap.set(date, { date, total: 0, methods: {} });
    const bucket = paymentMethodsByDayMap.get(date)!;
    bucket.methods[method] = (bucket.methods[method] || 0) + total;
    bucket.total += total;
  }""",
    'payment methods by day aggregation',
)

old = "paymentMethodsByDay: Array.from(paymentMethodsByDayMap.values()),"
if text.count(old) != 1:
    raise SystemExit('payment methods by day response anchor missing or ambiguous')
text = text.replace(old, "paymentMethodsByDay: Array.from(paymentMethodsByDayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),", 1)
path.write_text(text)

test = '''import fs from 'node:fs'

const finance = fs.readFileSync('worker/domains/finance-reports.ts', 'utf8')
const fail = (message) => { throw new Error(message) }
const check = (condition, message) => { if (!condition) fail(message) }

try {
  check(finance.includes("() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\\n      `SELECT p.method AS method"), 'R5.8 Finance scope must skip the standalone payment-method aggregate')
  check(finance.includes("() => financeWorkspaceOnly ? emptyRowsResult() : db.prepare(\\n      `SELECT p.payment_date AS date, p.method AS method"), 'R5.8 Finance scope must skip the standalone payment-by-day aggregate')
  check(finance.includes('const rawPaymentOperationRows = mapSqlRows(paymentOperationRows) as any[];'), 'R5.8 raw payment source must be materialized once')
  check(finance.includes('if (financeWorkspaceOnly) {\\n    for (const row of rawPaymentOperationRows)'), 'R5.8 payment-method summary must derive from the already-loaded Finance payment rows')
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
'''
Path('scripts/test-d1-read-budget-r5-8.mjs').write_text(test)

package_path = Path('package.json')
package = json.loads(package_path.read_text())
marker = 'node scripts/test-d1-read-budget-r5-7.mjs && '
if 'test-d1-read-budget-r5-8.mjs' not in package['scripts']['release:check']:
    if marker not in package['scripts']['release:check']:
        raise SystemExit('release-check R5.7 anchor missing')
    package['scripts']['release:check'] = package['scripts']['release:check'].replace(
        marker,
        marker + 'node scripts/test-d1-read-budget-r5-8.mjs && ',
        1,
    )
package['scripts']['test:d1-read-budget-r5-8'] = 'node scripts/test-d1-read-budget-r5-8.mjs'
package_path.write_text(json.dumps(package, ensure_ascii=False, indent=2) + '\n')
