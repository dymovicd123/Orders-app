import fs from 'node:fs'

const path = 'scripts/test-finance-f6-release-audit.mjs'
let source = fs.readFileSync(path, 'utf8')
const oldLine = "  check(financeUi.includes('consistency.difference') && financeUi.includes('0 разницы'), 'Finance UI no longer surfaces arithmetic reconciliation')"
const newLine = "  check(financeUi.includes('consistency.difference') && financeUi.includes('Финансовая сверка') && financeUi.includes('Суммы сошлись'), 'Finance UI no longer surfaces arithmetic reconciliation')"
if (source.includes(oldLine)) {
  source = source.replace(oldLine, newLine)
} else if (!source.includes(newLine)) {
  throw new Error('F8: F6 reconciliation gate marker not found')
}
fs.writeFileSync(path, source)
console.log('F6 reconciliation gate adapted to F8 UX.')
