import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const targets = [
  ['listFinanceReports', 'worker/domains/finance-reports.ts'],
  ['getWarehouseAttentionSummary', 'worker/domains/warehouse-attention.ts'],
]
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationText(text, file, wanted) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    let name = ''
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) name = statement.name.text
    if (!name && ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === wanted) return normalizeMovedDeclaration(statement.getText(source))
      }
    }
    if (name === wanted) return normalizeMovedDeclaration(statement.getText(source))
  }
  throw new Error(`Declaration not found: ${wanted} in ${file}`)
}

const changes = {}
for (const [name, file] of targets) {
  const beforeSource = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' })
  const afterSource = fs.readFileSync(file, 'utf8')
  const before = sha(declarationText(beforeSource, file, name))
  const after = sha(declarationText(afterSource, file, name))
  if (before === after) throw new Error(`R3 target did not change: ${name}`)
  changes[name] = { before, after, file }
}
fs.writeFileSync('scripts/d1-read-budget-r3-worker-manifest.json', JSON.stringify({
  version: 1,
  revision: 'd1-read-budget-r3',
  changes,
}, null, 2) + '\n')

const testPath = 'scripts/test-step1906a-worker-modularization.mjs'
let test = fs.readFileSync(testPath, 'utf8')
const pathAnchor = "const d1ReadBudgetR2Path = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')"
if (!test.includes("d1-read-budget-r3-worker-manifest.json")) {
  if (!test.includes(pathAnchor)) throw new Error('1906A R2 path anchor missing')
  test = test.replace(pathAnchor, `${pathAnchor}\nconst d1ReadBudgetR3Path = path.join(root, 'scripts/d1-read-budget-r3-worker-manifest.json')`)
}
const loadAnchor = "  const d1ReadBudgetR2Changes = d1ReadBudgetR2.changes || {}"
if (!test.includes("revision === 'd1-read-budget-r3'")) {
  if (!test.includes(loadAnchor)) throw new Error('1906A R2 load anchor missing')
  test = test.replace(loadAnchor, `${loadAnchor}\n  check(fs.existsSync(d1ReadBudgetR3Path), 'D1 read-budget R3 Worker manifest missing')\n  const d1ReadBudgetR3 = JSON.parse(fs.readFileSync(d1ReadBudgetR3Path, 'utf8'))\n  check(d1ReadBudgetR3?.version === 1 && d1ReadBudgetR3?.revision === 'd1-read-budget-r3', 'D1 read-budget R3 Worker manifest invalid')\n  const d1ReadBudgetR3Changes = d1ReadBudgetR3.changes || {}`)
}
const oldFinal = `    const d1ReadBudgetR2Changed = d1ReadBudgetR2Changes[name]\n    if (d1ReadBudgetR2Changed) {\n      check(d1ReadBudgetR2Changed.before === acceptedPostD1ReadBudgetHash, \`D1 read-budget R2 baseline hash mismatch: \${name}\`)\n      check(sha(declarations.get(name)) === d1ReadBudgetR2Changed.after, \`Worker declaration changed beyond exact D1 read-budget R2 allow-list: \${name}\`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetHash, \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`)\n    }`
const newFinal = `    const d1ReadBudgetR2Changed = d1ReadBudgetR2Changes[name]\n    let acceptedPostD1ReadBudgetR2Hash = acceptedPostD1ReadBudgetHash\n    if (d1ReadBudgetR2Changed) {\n      check(d1ReadBudgetR2Changed.before === acceptedPostD1ReadBudgetHash, \`D1 read-budget R2 baseline hash mismatch: \${name}\`)\n      acceptedPostD1ReadBudgetR2Hash = d1ReadBudgetR2Changed.after\n    }\n    const d1ReadBudgetR3Changed = d1ReadBudgetR3Changes[name]\n    if (d1ReadBudgetR3Changed) {\n      check(d1ReadBudgetR3Changed.before === acceptedPostD1ReadBudgetR2Hash, \`D1 read-budget R3 baseline hash mismatch: \${name}\`)\n      check(sha(declarations.get(name)) === d1ReadBudgetR3Changed.after, \`Worker declaration changed beyond exact D1 read-budget R3 allow-list: \${name}\`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR2Hash, \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`)\n    }`
if (!test.includes('d1ReadBudgetR3Changed')) {
  if (!test.includes(oldFinal)) throw new Error('1906A final R2 chain anchor missing')
  test = test.replace(oldFinal, newFinal)
}
fs.writeFileSync(testPath, test)
console.log('Registered exact D1 read-budget R3 Worker declaration deltas')
