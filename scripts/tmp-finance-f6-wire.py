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


money_path = 'worker/domains/money.ts'
orders_path = 'worker/domains/orders-write.ts'
before_remove = declaration_hash(money_path, 'removeOrderPaymentsWithMoneyEvents')
before_update = declaration_hash(orders_path, 'updateOrderCritical')

replace_once(
    money_path,
    "  input: { orderId: number; externalOrderId: string; timestamp: string; reason: 'order_edit' | 'order_delete'; comment: string },\n",
    "  input: { orderId: number; externalOrderId: string; timestamp: string; reason: 'order_edit' | 'order_delete'; comment: string; preservePayments?: boolean },\n",
    'money preserve-payments option',
)
money = read(money_path)
start = money.index('export async function removeOrderPaymentsWithMoneyEvents(')
end = money.index('\n\nexport async function removeSinglePaymentWithMoneyEvent(', start)
block = money[start:end]
if block.count('  await db.batch([\n') != 1:
    raise SystemExit('money helper batch marker unexpected')
block = block.replace('  await db.batch([\n', '  const statements = [\n', 1)
old_tail = "    db.prepare('DELETE FROM payments WHERE order_id = ?').bind(input.orderId),\n  ]);\n}"
new_tail = "  ];\n  if (!input.preservePayments) statements.push(db.prepare('DELETE FROM payments WHERE order_id = ?').bind(input.orderId));\n  await db.batch(statements);\n}"
if block.count(old_tail) != 1:
    raise SystemExit('money helper tail marker unexpected')
block = block.replace(old_tail, new_tail, 1)
write(money_path, money[:start] + block + money[end:])

replace_once(
    orders_path,
    "      const rewritePayments = Boolean(requestedPayments && !sameNormalizedOrderPaymentsForEdit(existingPaymentsForEdit, requestedPayments));\n",
    "      const rewritePayments = !deletingOrder && Boolean(requestedPayments && !sameNormalizedOrderPaymentsForEdit(existingPaymentsForEdit, requestedPayments));\n",
    'delete does not rewrite payments',
)
replace_once(
    orders_path,
    "      const nextPayments = requestedPayments || existingPaymentsForEdit;\n",
    "      const nextPayments = deletingOrder ? existingPaymentsForEdit : (requestedPayments || existingPaymentsForEdit);\n",
    'delete preserves persisted payment set',
)
old = """      if (p.rewritePayments) {
        await removeOrderPaymentsWithMoneyEvents(db, {
          orderId: id, externalOrderId: p.externalId, timestamp: p.timestamp,
          reason: p.deletingOrder ? 'order_delete' : 'order_edit',
          comment: p.deletingOrder ? `Оплаты сняты при удалении заказа ${p.externalId}` : `Старые оплаты сняты при исправлении заказа ${p.externalId}`,
        });
      }
"""
new = """      if (p.deletingOrder) {
        // Deletion is logical for the order and must preserve original payment rows as historical facts.
        // Append one idempotent reversal per payment; the existing cash order-delete trigger owns physical cash out.
        await removeOrderPaymentsWithMoneyEvents(db, {
          orderId: id, externalOrderId: p.externalId, timestamp: p.timestamp,
          reason: 'order_delete',
          comment: `Оплаты сняты при удалении заказа ${p.externalId}`,
          preservePayments: true,
        });
      } else if (p.rewritePayments) {
        await removeOrderPaymentsWithMoneyEvents(db, {
          orderId: id, externalOrderId: p.externalId, timestamp: p.timestamp,
          reason: 'order_edit',
          comment: `Старые оплаты сняты при исправлении заказа ${p.externalId}`,
        });
      }
"""
replace_once(orders_path, old, new, 'delete appends money reversals')

after_remove = declaration_hash(money_path, 'removeOrderPaymentsWithMoneyEvents')
after_update = declaration_hash(orders_path, 'updateOrderCritical')
manifest_path = 'scripts/finance-f6-delete-money-history-worker-manifest.json'
write(manifest_path, json.dumps({
    'version': 1,
    'revision': 'finance-f6-delete-money-history-r1',
    'reason': 'Logical order deletion preserves payment rows, appends idempotent payment_reversal events, and prevents stale clients from rewriting payments during deletion.',
    'changes': {
        'removeOrderPaymentsWithMoneyEvents': {'before': before_remove, 'after': after_remove},
        'updateOrderCritical': {'before': before_update, 'after': after_update},
    },
}, ensure_ascii=False, indent=2) + '\n')
print(f'F6 manifest: {before_remove[:8]}->{after_remove[:8]}, {before_update[:8]}->{after_update[:8]}')

mod_path = 'scripts/test-step1906a-worker-modularization.mjs'
replace_once(mod_path,
    "const financeF5BusinessSemanticsPath = path.join(root, 'scripts/finance-f5-business-semantics-worker-manifest.json')\n",
    "const financeF5BusinessSemanticsPath = path.join(root, 'scripts/finance-f5-business-semantics-worker-manifest.json')\nconst financeF6DeleteMoneyHistoryPath = path.join(root, 'scripts/finance-f6-delete-money-history-worker-manifest.json')\n",
    '1906 F6 manifest path')
replace_once(mod_path,
    "  check(fs.existsSync(financeF5BusinessSemanticsPath), 'Finance F5 business semantics Worker manifest missing')\n",
    "  check(fs.existsSync(financeF5BusinessSemanticsPath), 'Finance F5 business semantics Worker manifest missing')\n  check(fs.existsSync(financeF6DeleteMoneyHistoryPath), 'Finance F6 delete-money-history Worker manifest missing')\n",
    '1906 F6 manifest required')
replace_once(mod_path,
    "  const financeF5BusinessSemanticsChanges = financeF5BusinessSemantics?.version === 1 ? (financeF5BusinessSemantics.changes || {}) : {}\n",
    "  const financeF5BusinessSemanticsChanges = financeF5BusinessSemantics?.version === 1 ? (financeF5BusinessSemantics.changes || {}) : {}\n  const financeF6DeleteMoneyHistory = fs.existsSync(financeF6DeleteMoneyHistoryPath) ? JSON.parse(fs.readFileSync(financeF6DeleteMoneyHistoryPath, 'utf8')) : null\n  const financeF6DeleteMoneyHistoryChanges = financeF6DeleteMoneyHistory?.version === 1 ? (financeF6DeleteMoneyHistory.changes || {}) : {}\n",
    '1906 F6 manifest load')
old_chain = """    const financeF5BusinessSemanticsChanged = financeF5BusinessSemanticsChanges[name]
    if (financeF5BusinessSemanticsChanged) {
      check(financeF5BusinessSemanticsChanged.before === acceptedPostFinanceF4MoneyJournalHash, `Finance F5 business semantics declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF5BusinessSemanticsChanged.after, `Worker declaration changed beyond exact Finance F5 business semantics allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF4MoneyJournalHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal/finance-f5-business deltas: ${name}`)
    }
"""
new_chain = """    const financeF5BusinessSemanticsChanged = financeF5BusinessSemanticsChanges[name]
    let acceptedPostFinanceF5BusinessSemanticsHash = acceptedPostFinanceF4MoneyJournalHash
    if (financeF5BusinessSemanticsChanged) {
      check(financeF5BusinessSemanticsChanged.before === acceptedPostFinanceF4MoneyJournalHash, `Finance F5 business semantics declaration baseline hash mismatch: ${name}`)
      acceptedPostFinanceF5BusinessSemanticsHash = financeF5BusinessSemanticsChanged.after
    }
    const financeF6DeleteMoneyHistoryChanged = financeF6DeleteMoneyHistoryChanges[name]
    if (financeF6DeleteMoneyHistoryChanged) {
      check(financeF6DeleteMoneyHistoryChanged.before === acceptedPostFinanceF5BusinessSemanticsHash, `Finance F6 delete-money-history declaration baseline hash mismatch: ${name}`)
      check(sha(declarations.get(name)) === financeF6DeleteMoneyHistoryChanged.after, `Worker declaration changed beyond exact Finance F6 delete-money-history allow-list: ${name}`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF5BusinessSemanticsHash, `Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal/finance-f5-business/finance-f6-delete-money deltas: ${name}`)
    }
"""
replace_once(mod_path, old_chain, new_chain, '1906 F6 hash chain')

f6_path = 'scripts/test-finance-f6-release-audit.mjs'
replace_once(f6_path,
    "  check(report.includes('paymentRows.reduce((sum, row) => sum + Number(row.total || 0), 0)'), 'Payment-method reconciliation total missing')\n  check(report.includes('paymentKinds.reduce((sum, row) => sum + row.total, 0)'), 'Payment-kind reconciliation total missing')\n",
    "  check(report.includes('methodsTotal: paymentRows.reduce') && report.includes('Number(row.total || 0)'), 'Payment-method reconciliation total missing')\n  check(report.includes('kindsTotal: paymentKinds.reduce') && report.includes('Number(row.total || 0)'), 'Payment-kind reconciliation total missing')\n",
    'F6 reconciliation matcher')
anchor = "  check(orderWrite.includes('removeOrderPaymentsWithMoneyEvents'), 'Explicit legacy/full-rewrite reversal primitive disappeared; review correction history semantics')\n"
extra = r"""  const updateOrder = between(orderWrite, 'export async function updateOrderCritical(', '\n\nexport async function getOrder(')
  const removePayments = between(money, 'export async function removeOrderPaymentsWithMoneyEvents(', '\n\nexport async function removeSinglePaymentWithMoneyEvent(')
  check(updateOrder.includes('const rewritePayments = !deletingOrder && Boolean('), 'Deleting an order can still reinterpret a stale-client payment collection as a payment edit')
  check(updateOrder.includes('const nextPayments = deletingOrder ? existingPaymentsForEdit'), 'Delete does not pin totals to the persisted payment facts')
  check(updateOrder.includes("reason: 'order_delete'") && updateOrder.includes('preservePayments: true'), 'Order delete does not append explicit money reversals while preserving payment history')
  check(removePayments.includes('preservePayments?: boolean') && removePayments.includes('if (!input.preservePayments) statements.push'), 'Money reversal helper cannot preserve payment rows for logical deletion')
  check(removePayments.includes("'189c:payment:' || p.id || ':reversal:' || ?"), 'Order-delete reversal key is not stable/idempotent per payment')
  check(cashMigration.includes("'order-cancel:' || NEW.id || ':payment:' || p.id"), 'Cash delete path lost its separate idempotent order-cancel key')
  check(cash.includes("if (reason === 'order_delete') return 'Оплата снята при удалении заказа'"), 'Money journal does not explain an order-delete payment reversal')
"""
replace_once(f6_path, anchor, anchor + extra, 'F6 delete-money regression')

release_path = 'scripts/release-check.mjs'
release = read(release_path)
source_marker = "    'scripts/test-finance-f5-adjacent-regression.mjs',\n"
if "'scripts/test-finance-f6-release-audit.mjs'" not in release:
    if release.count(source_marker) != 1:
        raise SystemExit('release F6 source marker unexpected')
    release = release.replace(source_marker, source_marker + "    'scripts/test-finance-f6-release-audit.mjs',\n", 1)
if "'scripts/finance-f6-delete-money-history-worker-manifest.json'" not in release:
    release = release.replace("    'scripts/test-finance-f6-release-audit.mjs',\n", "    'scripts/test-finance-f6-release-audit.mjs',\n    'scripts/finance-f6-delete-money-history-worker-manifest.json',\n", 1)
run_marker = "  run('Finance F5 adjacent finance/cash regression', process.execPath, [path.join(root, 'scripts/test-finance-f5-adjacent-regression.mjs')])\n"
if "run('Finance F6 aggregate release audit'" not in release:
    if release.count(run_marker) != 1:
        raise SystemExit('release F6 run marker unexpected')
    release = release.replace(run_marker, run_marker + "  run('Finance F6 aggregate release audit', process.execPath, [path.join(root, 'scripts/test-finance-f6-release-audit.mjs')])\n", 1)
write(release_path, release)

print('Finance F6 delete-money correctness patch + permanent gate wired')
