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
replace_once(
    finance_path,
    "      collectionRate: sales > 0 ? received / sales : 0,\n      returnRate: sales > 0 ? periodReturns / sales : 0,\n",
    "",
    'remove mixed-cohort dead rates',
)
after_finance = declaration_hash(finance_path, 'listFinanceReports')
manifest_path = 'scripts/finance-f6-dead-metrics-worker-manifest.json'
write(manifest_path, json.dumps({
    'version': 1,
    'revision': 'finance-f6-dead-metrics-r1',
    'reason': 'Remove unused collectionRate and returnRate fields because they divide operation-date money/returns by order-date sales and therefore have no coherent period cohort.',
    'changes': {
        'listFinanceReports': {'before': before_finance, 'after': after_finance},
    },
}, ensure_ascii=False, indent=2) + '\n')
print(f'Finance dead-metric manifest: {before_finance[:8]}->{after_finance[:8]}')

replace_once(
    'src/app/types.ts',
    "    collectionRate: number\n    returnRate: number\n",
    "",
    'remove dead rates from frontend contract',
)

f6_path = 'scripts/test-finance-f6-release-audit.mjs'
anchor = "  check(reportUi.includes('<td className=\"num\">{row.clients}</td><td className=\"num\">{row.managers}</td>'), 'City aggregate still renders fake client/manager placeholders')\n"
addition = "  check(!finance.includes('collectionRate:') && !finance.includes('returnRate:'), 'Mixed-cohort dead rate fields returned to Finance API')\n  check(!read('src/app/types.ts').includes('collectionRate:') && !read('src/app/types.ts').includes('returnRate:'), 'Mixed-cohort dead rate fields returned to frontend contract')\n"
text = read(f6_path)
if text.count(anchor) != 1:
    raise SystemExit(f'F6 dead-rate anchor count={text.count(anchor)}')
write(f6_path, text.replace(anchor, anchor + addition, 1))
print('F6 dead-rate regression: patched')

mod_path = 'scripts/test-step1906a-worker-modularization.mjs'
replace_once(
    mod_path,
    "const financeF6ReportSemanticsPath = path.join(root, 'scripts/finance-f6-report-semantics-worker-manifest.json')\n",
    "const financeF6ReportSemanticsPath = path.join(root, 'scripts/finance-f6-report-semantics-worker-manifest.json')\nconst financeF6DeadMetricsPath = path.join(root, 'scripts/finance-f6-dead-metrics-worker-manifest.json')\n",
    '1906 F6 dead metric manifest path',
)
replace_once(
    mod_path,
    "  check(fs.existsSync(financeF6ReportSemanticsPath), 'Finance F6 report semantics Worker manifest missing')\n",
    "  check(fs.existsSync(financeF6ReportSemanticsPath), 'Finance F6 report semantics Worker manifest missing')\n  check(fs.existsSync(financeF6DeadMetricsPath), 'Finance F6 dead metrics Worker manifest missing')\n",
    '1906 F6 dead metric manifest required',
)
replace_once(
    mod_path,
    "  const financeF6ReportSemanticsChanges = financeF6ReportSemantics?.version === 1 ? (financeF6ReportSemantics.changes || {}) : {}\n",
    "  const financeF6ReportSemanticsChanges = financeF6ReportSemantics?.version === 1 ? (financeF6ReportSemantics.changes || {}) : {}\n  const financeF6DeadMetrics = fs.existsSync(financeF6DeadMetricsPath) ? JSON.parse(fs.readFileSync(financeF6DeadMetricsPath, 'utf8')) : null\n  const financeF6DeadMetricsChanges = financeF6DeadMetrics?.version === 1 ? (financeF6DeadMetrics.changes || {}) : {}\n",
    '1906 F6 dead metric manifest load',
)
old_chain = """    const financeF6ReportSemanticsChanged = financeF6ReportSemanticsChanges[name]
    if (financeF6ReportSemanticsChanged) {
      check(financeF6ReportSemanticsChanged.before === acceptedPostFinanceF6DeleteMoneyHistoryHash, `Finance F6 report-semantics declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF6ReportSemanticsChanged.after, `Worker declaration changed beyond exact Finance F6 report-semantics allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF6DeleteMoneyHistoryHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal/finance-f5-business/finance-f6-delete-money/finance-f6-report-semantics deltas: ${name}`)
    }
"""
new_chain = """    const financeF6ReportSemanticsChanged = financeF6ReportSemanticsChanges[name]
    let acceptedPostFinanceF6ReportSemanticsHash = acceptedPostFinanceF6DeleteMoneyHistoryHash
    if (financeF6ReportSemanticsChanged) {
      check(financeF6ReportSemanticsChanged.before === acceptedPostFinanceF6DeleteMoneyHistoryHash, `Finance F6 report-semantics declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF6ReportSemanticsHash = financeF6ReportSemanticsChanged.after
    }
    const financeF6DeadMetricsChanged = financeF6DeadMetricsChanges[name]
    if (financeF6DeadMetricsChanged) {
      check(financeF6DeadMetricsChanged.before === acceptedPostFinanceF6ReportSemanticsHash, `Finance F6 dead-metrics declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF6DeadMetricsChanged.after, `Worker declaration changed beyond exact Finance F6 dead-metrics allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF6ReportSemanticsHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal/finance-f5-business/finance-f6-delete-money/finance-f6-report-semantics/finance-f6-dead-metrics deltas: ${name}`)
    }
"""
replace_once(mod_path, old_chain, new_chain, '1906 F6 dead metric hash chain')

replace_once(
    'scripts/release-check.mjs',
    "    'scripts/finance-f6-report-semantics-worker-manifest.json',\n",
    "    'scripts/finance-f6-report-semantics-worker-manifest.json',\n    'scripts/finance-f6-dead-metrics-worker-manifest.json',\n",
    'release F6 dead metric manifest',
)

print('Finance F6 dead metric cleanup complete')
