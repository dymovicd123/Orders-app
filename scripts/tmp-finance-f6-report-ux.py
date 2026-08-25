from pathlib import Path
import json
import subprocess


def read(path):
    return Path(path).read_text(encoding='utf-8')


def write(path, text):
    Path(path).write_text(text, encoding='utf-8')


def replace_once(path, old, new, label):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: marker count={count}')
    write(path, text.replace(old, new, 1))
    print(f'{label}: patched')


def declaration_hash(path, name):
    script = r"""
import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'
const [file, target] = process.argv.slice(1)
const text = fs.readFileSync(file, 'utf8')
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
for (const statement of source.statements) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name?.text === target) {
    const normalized = statement.getText(source).replace(/^export\s+/, '')
    console.log(crypto.createHash('sha256').update(normalized).digest('hex'))
    process.exit(0)
  }
}
throw new Error(`Declaration not found: ${target}`)
"""
    return subprocess.check_output(['node', '--input-type=module', '-e', script, path, name], text=True).strip()


finance_path = 'worker/domains/finance-reports.ts'
before_finance = declaration_hash(finance_path, 'listFinanceReports')

# 1. City aggregate must contain real distinct-client/manager counts, not placeholder columns.
old_city = """      `SELECT COALESCE(NULLIF(o.city, ''), 'Не указан') AS city,
              COUNT(*) AS order_count,
              COALESCE(SUM(o.total_amount), 0) AS total_sales,
              COALESCE(SUM(o.received_amount), 0) AS total_received,
              COALESCE(SUM(o.debt_amount), 0) AS total_debt,
              COALESCE(SUM(o.return_amount), 0) AS total_returns
       FROM orders o
"""
new_city = """      `SELECT COALESCE(NULLIF(o.city, ''), 'Не указан') AS city,
              COUNT(*) AS order_count,
              COUNT(DISTINCT o.customer_id) AS clients,
              COUNT(DISTINCT o.manager_id) AS managers,
              COALESCE(SUM(o.total_amount), 0) AS total_sales,
              COALESCE(SUM(o.received_amount), 0) AS total_received,
              COALESCE(SUM(o.debt_amount), 0) AS total_debt,
              COALESCE(SUM(o.return_amount), 0) AS total_returns
       FROM orders o
"""
replace_once(finance_path, old_city, new_city, 'city aggregate distinct counts')
after_finance = declaration_hash(finance_path, 'listFinanceReports')

manifest_path = 'scripts/finance-f6-report-semantics-worker-manifest.json'
write(manifest_path, json.dumps({
    'version': 1,
    'revision': 'finance-f6-report-semantics-r1',
    'reason': 'Strict Finance reports distinguish business order date from recorded-at semantics, avoid cross-cohort return totals in product reports, and provide real aggregate city client/manager counts.',
    'changes': {
        'listFinanceReports': {'before': before_finance, 'after': after_finance},
    },
}, ensure_ascii=False, indent=2) + '\n')
print(f'Finance report manifest: {before_finance[:8]}->{after_finance[:8]}')

# 2. Frontend report wording/columns: no false cohort claims and no fake placeholders.
renderer_path = 'src/features/renderers/FinanceReportContentRenderer.tsx'
renderer = read(renderer_path)
renderer = renderer.replace('Нет оплат по выбранным заказам.', 'Нет оплат за выбранный период.')
if 'Нет оплат по выбранным заказам.' in renderer:
    raise SystemExit('payment empty-state wording still present')
old = "{ label: 'Возвраты по заказам', value: formatMoney(activeReturnTotal) },"
if renderer.count(old) != 2:
    raise SystemExit(f'return label marker count={renderer.count(old)}')
renderer = renderer.replace(old, "{ label: 'Возвраты по дате операции', value: formatMoney(activeReturnTotal) },", 1)
renderer = renderer.replace(old, '', 1)
renderer = renderer.replace(
    "renderHeader('Товары из заказов, созданных в выбранный период.')",
    "renderHeader('Товары из заказов с бизнес-датой заказа в выбранном периоде.')",
    1,
)
old_cells = '<td className="num">—</td><td className="num">—</td><td className="num">{formatMoney(row.order_count ? Number(row.total_sales || 0) / Number(row.order_count || 1) : 0)}</td>'
new_cells = '<td className="num">{row.clients}</td><td className="num">{row.managers}</td><td className="num">{formatMoney(row.order_count ? Number(row.total_sales || 0) / Number(row.order_count || 1) : 0)}</td>'
if renderer.count(old_cells) != 1:
    raise SystemExit(f'city placeholder cells count={renderer.count(old_cells)}')
renderer = renderer.replace(old_cells, new_cells, 1)
write(renderer_path, renderer)
print('strict report UX semantics: patched')

# 3. Frontend contract now exposes aggregate city counts.
types_path = 'src/app/types.ts'
replace_once(
    types_path,
    "    cities: Array<{ city: string; order_count: number; total_sales: number; total_received: number; total_debt: number; total_returns: number }>\n",
    "    cities: Array<{ city: string; order_count: number; total_sales: number; total_received: number; total_debt: number; total_returns: number; clients: number; managers: number }>\n",
    'city report contract counts',
)

# 4. Extend F6 regression with the exact adjacent issues found in review.
f6_path = 'scripts/test-finance-f6-release-audit.mjs'
f6 = read(f6_path)
anchor = "  check(financeUi.includes('openMoneyHistoryForOrder') && financeUi.includes('openOrderFromFinance'), 'Finance drilldown actions disappeared')\n"
addition = """

  // Adjacent strict-report semantics: do not mix business-order cohorts with operation-date totals
  // or show placeholder aggregate columns as if they were implemented.
  check(report.includes('COUNT(DISTINCT o.customer_id) AS clients') && report.includes('COUNT(DISTINCT o.manager_id) AS managers'), 'City aggregate still lacks real distinct client/manager counts')
  check(reportUi.includes('Товары из заказов с бизнес-датой заказа в выбранном периоде.'), 'Product report confuses business order date with system creation time')
  const productReportBlock = between(reportUi, 'const renderProductReport = () => (', 'const renderCityReport = () => (')
  check(!productReportBlock.includes('Возвраты по заказам') && !productReportBlock.includes('activeReturnTotal'), 'Product report mixes operation-date returns into the order-date product cohort')
  check(reportUi.includes("{ label: 'Возвраты по дате операции', value: formatMoney(activeReturnTotal) }"), 'Manager report does not label return-period semantics honestly')
  check(!reportUi.includes('Нет оплат по выбранным заказам.'), 'Payment report empty state incorrectly claims an order-date cohort')
  check(reportUi.includes('Нет оплат за выбранный период.'), 'Payment report has no operation-period empty wording')
  check(reportUi.includes('<td className=\"num\">{row.clients}</td><td className=\"num\">{row.managers}</td>'), 'City aggregate still renders fake client/manager placeholders')
"""
if f6.count(anchor) != 1:
    raise SystemExit(f'F6 adjacent test anchor count={f6.count(anchor)}')
f6 = f6.replace(anchor, anchor + addition, 1)
write(f6_path, f6)
print('F6 adjacent report regression: patched')

# 5. Extend Step1906A exact Worker hash chain after delete-money F6 delta.
mod_path = 'scripts/test-step1906a-worker-modularization.mjs'
replace_once(
    mod_path,
    "const financeF6DeleteMoneyHistoryPath = path.join(root, 'scripts/finance-f6-delete-money-history-worker-manifest.json')\n",
    "const financeF6DeleteMoneyHistoryPath = path.join(root, 'scripts/finance-f6-delete-money-history-worker-manifest.json')\nconst financeF6ReportSemanticsPath = path.join(root, 'scripts/finance-f6-report-semantics-worker-manifest.json')\n",
    '1906 F6 report manifest path',
)
replace_once(
    mod_path,
    "  check(fs.existsSync(financeF6DeleteMoneyHistoryPath), 'Finance F6 delete-money-history Worker manifest missing')\n",
    "  check(fs.existsSync(financeF6DeleteMoneyHistoryPath), 'Finance F6 delete-money-history Worker manifest missing')\n  check(fs.existsSync(financeF6ReportSemanticsPath), 'Finance F6 report semantics Worker manifest missing')\n",
    '1906 F6 report manifest required',
)
replace_once(
    mod_path,
    "  const financeF6DeleteMoneyHistoryChanges = financeF6DeleteMoneyHistory?.version === 1 ? (financeF6DeleteMoneyHistory.changes || {}) : {}\n",
    "  const financeF6DeleteMoneyHistoryChanges = financeF6DeleteMoneyHistory?.version === 1 ? (financeF6DeleteMoneyHistory.changes || {}) : {}\n  const financeF6ReportSemantics = fs.existsSync(financeF6ReportSemanticsPath) ? JSON.parse(fs.readFileSync(financeF6ReportSemanticsPath, 'utf8')) : null\n  const financeF6ReportSemanticsChanges = financeF6ReportSemantics?.version === 1 ? (financeF6ReportSemantics.changes || {}) : {}\n",
    '1906 F6 report manifest load',
)
old_chain = """    const financeF6DeleteMoneyHistoryChanged = financeF6DeleteMoneyHistoryChanges[name]
    if (financeF6DeleteMoneyHistoryChanged) {
      check(financeF6DeleteMoneyHistoryChanged.before === acceptedPostFinanceF5BusinessSemanticsHash, `Finance F6 delete-money-history declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF6DeleteMoneyHistoryChanged.after, `Worker declaration changed beyond exact Finance F6 delete-money-history allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF5BusinessSemanticsHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal/finance-f5-business/finance-f6-delete-money deltas: ${name}`)
    }
"""
new_chain = """    const financeF6DeleteMoneyHistoryChanged = financeF6DeleteMoneyHistoryChanges[name]
    let acceptedPostFinanceF6DeleteMoneyHistoryHash = acceptedPostFinanceF5BusinessSemanticsHash
    if (financeF6DeleteMoneyHistoryChanged) {
      check(financeF6DeleteMoneyHistoryChanged.before === acceptedPostFinanceF5BusinessSemanticsHash, `Finance F6 delete-money-history declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF6DeleteMoneyHistoryHash = financeF6DeleteMoneyHistoryChanged.after
    }
    const financeF6ReportSemanticsChanged = financeF6ReportSemanticsChanges[name]
    if (financeF6ReportSemanticsChanged) {
      check(financeF6ReportSemanticsChanged.before === acceptedPostFinanceF6DeleteMoneyHistoryHash, `Finance F6 report-semantics declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF6ReportSemanticsChanged.after, `Worker declaration changed beyond exact Finance F6 report-semantics allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF6DeleteMoneyHistoryHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal/finance-f5-business/finance-f6-delete-money/finance-f6-report-semantics deltas: ${name}`)
    }
"""
replace_once(mod_path, old_chain, new_chain, '1906 F6 report hash chain')

# 6. Release gate must require the new exact Worker manifest.
release_path = 'scripts/release-check.mjs'
replace_once(
    release_path,
    "    'scripts/finance-f6-delete-money-history-worker-manifest.json',\n",
    "    'scripts/finance-f6-delete-money-history-worker-manifest.json',\n    'scripts/finance-f6-report-semantics-worker-manifest.json',\n",
    'release F6 report manifest',
)

print('Finance F6 adjacent report semantics patch complete')
