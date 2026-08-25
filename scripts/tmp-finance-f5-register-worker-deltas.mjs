import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const mode = process.argv[2]
const beforePath = '/tmp/finance-f5-before.json'
const manifestPath = 'scripts/finance-f5-business-semantics-worker-manifest.json'
const testPath = 'scripts/test-step1906a-worker-modularization.mjs'
const targets = {
  moneyHistoryOperationLabel: 'worker/domains/cash.ts',
  listFinancialHistory: 'worker/domains/cash.ts',
  createManualOrderPaymentCritical: 'worker/domains/money.ts',
  listFinanceReports: 'worker/domains/finance-reports.ts',
}
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function declarationHash(name, file) {
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find((node) => (
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node))
    && node.name?.text === name
  ))
  if (!statement) throw new Error(`Finance F5 declaration not found: ${name}`)
  return sha(statement.getText(source).replace(/^export\s+/, ''))
}

function hashes() {
  return Object.fromEntries(Object.entries(targets).map(([name, file]) => [name, declarationHash(name, file)]))
}

function replaceOnce(text, oldValue, newValue, label) {
  const count = text.split(oldValue).length - 1
  if (count !== 1) throw new Error(`${label}: expected exactly one marker, got ${count}`)
  return text.replace(oldValue, newValue)
}

if (mode === 'before') {
  fs.writeFileSync(beforePath, JSON.stringify(hashes(), null, 2))
  console.log('Finance F5 pre-change Worker hashes captured')
  process.exit(0)
}

if (mode !== 'after') throw new Error('Use: node scripts/tmp-finance-f5-register-worker-deltas.mjs before|after')

const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
const after = hashes()
const changes = {}
for (const name of Object.keys(targets)) {
  if (before[name] === after[name]) throw new Error(`Expected Finance F5 declaration did not change: ${name}`)
  changes[name] = { before: before[name], after: after[name] }
}
fs.writeFileSync(manifestPath, JSON.stringify({
  version: 1,
  revision: 'finance-f5-business-semantics-r1',
  reason: 'Ordinary orders expose only primary payment and debt close; manual primary is anchored to order date; ordinary extra is blocked while exchange extra remains isolated; legacy ordinary extra is presented under debt-close semantics.',
  changes,
}, null, 2) + '\n')

let text = fs.readFileSync(testPath, 'utf8')
let oldValue = "const financeF4MoneyJournalPath = path.join(root, 'scripts/finance-f4-money-journal-worker-manifest.json')\n"
text = replaceOnce(text, oldValue, oldValue + "const financeF5BusinessSemanticsPath = path.join(root, 'scripts/finance-f5-business-semantics-worker-manifest.json')\n", 'F5 manifest path')
oldValue = "  check(fs.existsSync(financeF4MoneyJournalPath), 'Finance F4 money journal Worker manifest missing')\n"
text = replaceOnce(text, oldValue, oldValue + "  check(fs.existsSync(financeF5BusinessSemanticsPath), 'Finance F5 business semantics Worker manifest missing')\n", 'F5 manifest existence')
oldValue = "  const financeF4MoneyJournal = fs.existsSync(financeF4MoneyJournalPath) ? JSON.parse(fs.readFileSync(financeF4MoneyJournalPath, 'utf8')) : null\n  const financeF4MoneyJournalChanges = financeF4MoneyJournal?.version === 1 ? (financeF4MoneyJournal.changes || {}) : {}\n"
text = replaceOnce(text, oldValue, oldValue + "  const financeF5BusinessSemantics = fs.existsSync(financeF5BusinessSemanticsPath) ? JSON.parse(fs.readFileSync(financeF5BusinessSemanticsPath, 'utf8')) : null\n  const financeF5BusinessSemanticsChanges = financeF5BusinessSemantics?.version === 1 ? (financeF5BusinessSemantics.changes || {}) : {}\n", 'F5 manifest load')
oldValue = `    const financeF4MoneyJournalChanged = financeF4MoneyJournalChanges[name]
    if (financeF4MoneyJournalChanged) {
      check(financeF4MoneyJournalChanged.before === acceptedPostFinanceF2TraceHash, \`Finance F4 money journal declaration baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === financeF4MoneyJournalChanged.after, \`Worker declaration changed beyond exact Finance F4 money journal allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF2TraceHash, \`Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal deltas: \${name}\`)
    }
`
const newValue = `    const financeF4MoneyJournalChanged = financeF4MoneyJournalChanges[name]
    let acceptedPostFinanceF4MoneyJournalHash = acceptedPostFinanceF2TraceHash
    if (financeF4MoneyJournalChanged) {
      check(financeF4MoneyJournalChanged.before === acceptedPostFinanceF2TraceHash, \`Finance F4 money journal declaration baseline hash mismatch: \${name}\`)
      acceptedPostFinanceF4MoneyJournalHash = financeF4MoneyJournalChanged.after
    }
    const financeF5BusinessSemanticsChanged = financeF5BusinessSemanticsChanges[name]
    if (financeF5BusinessSemanticsChanged) {
      check(financeF5BusinessSemanticsChanged.before === acceptedPostFinanceF4MoneyJournalHash, \`Finance F5 business semantics declaration baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === financeF5BusinessSemanticsChanged.after, \`Worker declaration changed beyond exact Finance F5 business semantics allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostFinanceF4MoneyJournalHash, \`Worker declaration body changed beyond accepted cleanup/boundary/runtime/security/warehouse/catalog/attention/daily-warehouse/context/sql-alias/order-save/stocktake-replay/finance-date-sync/finance-f2-trace/finance-f4-journal/finance-f5-business deltas: \${name}\`)
    }
`
text = replaceOnce(text, oldValue, newValue, 'F5 declaration chain')

oldValue = `  for (const [name, expectedHash] of Object.entries(orderCreateSaveIntegrityAdded)) {
    check(declarations.has(name), \`192B2A4 added Worker declaration missing: \${name}\`)
    check(sha(declarations.get(name)) === expectedHash, \`192B2A4 added Worker declaration changed: \${name}\`)
  }
`
const addedNewValue = `  for (const [name, expectedHash] of Object.entries(orderCreateSaveIntegrityAdded)) {
    check(declarations.has(name), \`192B2A4 added Worker declaration missing: \${name}\`)
    const financeF5BusinessSemanticsChanged = financeF5BusinessSemanticsChanges[name]
    if (financeF5BusinessSemanticsChanged) {
      check(financeF5BusinessSemanticsChanged.before === expectedHash, \`Finance F5 changed 192B2A4-added declaration baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === financeF5BusinessSemanticsChanged.after, \`192B2A4-added declaration changed beyond exact Finance F5 business semantics allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === expectedHash, \`192B2A4 added Worker declaration changed: \${name}\`)
    }
  }
`
text = replaceOnce(text, oldValue, addedNewValue, 'F5 post-192B2A4 added declaration chain')

oldValue = "  const orderCreateSaveIntegrityNote = orderCreateSaveIntegrity ? `, ${Object.keys(orderCreateSaveIntegrityChanges).length} changed + ${Object.keys(orderCreateSaveIntegrityAdded).length} added 192B2A4 order-save declarations` : ''\n"
text = replaceOnce(text, oldValue, oldValue + "  const financeF5BusinessSemanticsNote = financeF5BusinessSemantics ? `, ${Object.keys(financeF5BusinessSemanticsChanges).length} exact Finance F5 business-semantics deltas` : ''\n", 'F5 note')
oldValue = '${orderCreateSaveIntegrityNote}, 0 import cycles`)'
text = replaceOnce(text, oldValue, '${orderCreateSaveIntegrityNote}${financeF5BusinessSemanticsNote}, 0 import cycles`)', 'F5 status output')
fs.writeFileSync(testPath, text)
console.log('Finance F5 exact Worker manifest registered')
