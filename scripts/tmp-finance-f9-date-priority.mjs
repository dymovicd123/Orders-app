import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const read = (p) => fs.readFileSync(p, 'utf8')
const write = (p, v) => fs.writeFileSync(p, v)
const replaceOnce = (source, from, to, label) => {
  const count = source.split(from).length - 1
  if (count !== 1) throw new Error(`${label}: expected one marker, found ${count}`)
  return source.replace(from, to)
}
const declarationHash = (file, name) => {
  const text = read(file)
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    const statementName = statement.name && ts.isIdentifier(statement.name) ? statement.name.text : ''
    if (statementName === name) return crypto.createHash('sha256').update(statement.getText(source).replace(/^export\s+/, '')).digest('hex')
  }
  throw new Error(`Declaration not found: ${name}`)
}

const financePath = 'worker/domains/finance-reports.ts'
const beforeHash = declarationHash(financePath, 'listFinanceReports')
let finance = read(financePath)
const oldBlock = `    if (operationType === 'debt_close') {\n      traceCode = 'debt_close';\n      traceTitle = 'Закрытие долга';\n      traceExplanation = 'Отдельная оплата долга после создания заказа — нормальная денежная операция.';\n    } else if (operationType === 'order_extra') {\n      traceCode = 'legacy_order_extra';\n      traceSeverity = 'info';\n      traceTitle = 'Закрытие долга (старый тип)';\n      traceExplanation = 'Старая запись использует прежний технический тип «extra». В текущей модели отдельной доплаты по обычному заказу нет: такая последующая оплата относится к закрытию долга.';\n    } else if (operationType === 'exchange_extra') {\n      traceCode = 'exchange_extra';\n      traceTitle = 'Доплата по обмену';\n      traceExplanation = 'Доплата связана с обменом и учитывается по дате операции обмена.';\n    } else if (eventLineageStatus === 'ambiguous') {`
const newBlock = `    if (dateRelation === 'before_order') {\n      traceCode = operationType === 'order_payment' ? 'primary_before_order' : \`${'${operationType}'}_before_order\`;\n      traceSeverity = 'review';\n      traceTitle = 'Оплата раньше даты заказа';\n      traceExplanation = operationType === 'debt_close'\n        ? 'Закрытие долга датировано раньше бизнес-даты самого заказа. Такая последовательность невозможна без ошибки в датах и требует проверки.'\n        : operationType === 'exchange_extra'\n          ? 'Доплата по обмену датирована раньше бизнес-даты исходного заказа. Дату операции нужно проверить.'\n          : operationType === 'order_extra'\n            ? 'Историческая последующая оплата датирована раньше бизнес-даты заказа. Несмотря на старый тип записи, дату нужно проверить.'\n            : 'Первичная оплата датирована раньше бизнес-даты заказа. Это требует проверки.';\n    } else if (operationType === 'debt_close') {\n      traceCode = 'debt_close';\n      traceTitle = 'Закрытие долга';\n      traceExplanation = 'Отдельная оплата долга после создания заказа — нормальная денежная операция.';\n    } else if (operationType === 'order_extra') {\n      traceCode = 'legacy_order_extra';\n      traceSeverity = 'info';\n      traceTitle = 'Закрытие долга (старый тип)';\n      traceExplanation = 'Старая запись использует прежний технический тип «extra». В текущей модели отдельной доплаты по обычному заказу нет: такая последующая оплата относится к закрытию долга.';\n    } else if (operationType === 'exchange_extra') {\n      traceCode = 'exchange_extra';\n      traceTitle = 'Доплата по обмену';\n      traceExplanation = 'Доплата связана с обменом и учитывается по дате операции обмена.';\n    } else if (eventLineageStatus === 'ambiguous') {`
finance = replaceOnce(finance, oldBlock, newBlock, 'F9.1 classification priority')
const duplicateBefore = `    } else if (dateRelation === 'before_order') {\n      traceCode = 'primary_before_order';\n      traceSeverity = 'review';\n      traceTitle = 'Оплата раньше даты заказа';\n      traceExplanation = 'Первичная оплата датирована раньше бизнес-даты заказа. Это требует проверки.';\n    } else if (dateRelation === 'after_order') {`
finance = replaceOnce(finance, duplicateBefore, `    } else if (dateRelation === 'after_order') {`, 'F9.1 remove old late before-order branch')
write(financePath, finance)

let f9 = read('scripts/test-finance-f9-summary-finish.mjs')
const insertAt = `  check(finance.includes("traceCode: 'payment_before_order_outside_period'") && finance.includes("traceSeverity: 'review' as const"), 'Out-of-period early payment is not a review-level trace row')\n`
const added = `  check(finance.indexOf("if (dateRelation === 'before_order')") < finance.indexOf("if (operationType === 'debt_close')"), 'Before-order date check does not take priority over debt/exchange operation type')\n  check(finance.includes("operationType === 'debt_close'\\n        ? 'Закрытие долга датировано раньше"), 'Debt close before order is not explicitly treated as a review error')\n  check(finance.includes("operationType === 'exchange_extra'\\n          ? 'Доплата по обмену датирована раньше"), 'Exchange extra before order is not explicitly treated as a review error')\n`
if (!f9.includes(added.trim())) f9 = replaceOnce(f9, insertAt, insertAt + added, 'F9.1 test insertion')
write('scripts/test-finance-f9-summary-finish.mjs', f9)

let release = read('scripts/release-check.mjs')
release = replaceOnce(release, `    'scripts/finance-f9-summary-worker-manifest.json',`, `    'scripts/finance-f9-summary-worker-manifest.json',\n    'scripts/finance-f9-date-priority-worker-manifest.json',`, 'F9.1 required manifest')
write('scripts/release-check.mjs', release)

let modular = read('scripts/test-step1906a-worker-modularization.mjs')
modular = replaceOnce(modular, `const financeF9SummaryPath = path.join(root, 'scripts/finance-f9-summary-worker-manifest.json')`, `const financeF9SummaryPath = path.join(root, 'scripts/finance-f9-summary-worker-manifest.json')\nconst financeF9DatePriorityPath = path.join(root, 'scripts/finance-f9-date-priority-worker-manifest.json')`, 'F9.1 modular path')
modular = replaceOnce(modular, `  check(fs.existsSync(financeF9SummaryPath), 'Finance F9 summary Worker manifest missing')`, `  check(fs.existsSync(financeF9SummaryPath), 'Finance F9 summary Worker manifest missing')\n  check(fs.existsSync(financeF9DatePriorityPath), 'Finance F9 date-priority Worker manifest missing')`, 'F9.1 modular existence')
modular = replaceOnce(modular, `  const financeF9SummaryChanges = financeF9Summary?.version === 1 ? (financeF9Summary.changes || {}) : {}`, `  const financeF9SummaryChanges = financeF9Summary?.version === 1 ? (financeF9Summary.changes || {}) : {}\n  const financeF9DatePriority = fs.existsSync(financeF9DatePriorityPath) ? JSON.parse(fs.readFileSync(financeF9DatePriorityPath, 'utf8')) : null\n  const financeF9DatePriorityChanges = financeF9DatePriority?.version === 1 ? (financeF9DatePriority.changes || {}) : {}`, 'F9.1 modular load')
const oldChain = `    const financeF9SummaryChanged = financeF9SummaryChanges[name]\n    if (financeF9SummaryChanged) {\n      check(financeF9SummaryChanged.before === acceptedPostFinanceF6DeadMetricsHash, \`Finance F9 summary declaration baseline hash mismatch: \${name}\`)\n      check(sha(declarations.get(name)) === financeF9SummaryChanged.after, \`Worker declaration changed beyond exact Finance F9 summary allow-list: \${name}\`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostFinanceF6DeadMetricsHash, \`Worker declaration body changed beyond accepted Finance F1-F9 deltas: \${name}\`)\n    }`
const newChain = `    const financeF9SummaryChanged = financeF9SummaryChanges[name]\n    const acceptedPostFinanceF9SummaryHash = financeF9SummaryChanged ? financeF9SummaryChanged.after : acceptedPostFinanceF6DeadMetricsHash\n    if (financeF9SummaryChanged) check(financeF9SummaryChanged.before === acceptedPostFinanceF6DeadMetricsHash, \`Finance F9 summary declaration baseline hash mismatch: \${name}\`)\n    const financeF9DatePriorityChanged = financeF9DatePriorityChanges[name]\n    if (financeF9DatePriorityChanged) {\n      check(financeF9DatePriorityChanged.before === acceptedPostFinanceF9SummaryHash, \`Finance F9 date-priority declaration baseline hash mismatch: \${name}\`)\n      check(sha(declarations.get(name)) === financeF9DatePriorityChanged.after, \`Worker declaration changed beyond exact Finance F9 date-priority allow-list: \${name}\`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostFinanceF9SummaryHash, \`Worker declaration body changed beyond accepted Finance F1-F9 deltas: \${name}\`)\n    }`
modular = replaceOnce(modular, oldChain, newChain, 'F9.1 modular chain')
write('scripts/test-step1906a-worker-modularization.mjs', modular)

const afterHash = declarationHash(financePath, 'listFinanceReports')
write('scripts/finance-f9-date-priority-worker-manifest.json', JSON.stringify({
  version: 1,
  revision: 'finance-f9-date-priority-r1',
  reason: 'Any money operation dated before the business date of its order must require review, regardless of whether it is primary, debt close, legacy extra or exchange extra.',
  changes: { listFinanceReports: { before: beforeHash, after: afterHash } },
}, null, 2) + '\n')
console.log(JSON.stringify({ beforeHash, afterHash }, null, 2))
