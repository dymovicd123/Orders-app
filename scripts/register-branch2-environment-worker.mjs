import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const name = 'verifySimpleAdminPassword'
const file = 'worker/domains/auth.ts'
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationText(text, sourceName, wanted) {
  const source = ts.createSourceFile(sourceName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === wanted) return normalizeMovedDeclaration(statement.getText(source))
  }
  throw new Error(`Declaration not found: ${wanted}`)
}

const beforeSource = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' })
const afterSource = fs.readFileSync(file, 'utf8')
const before = sha(declarationText(beforeSource, file, name))
const after = sha(declarationText(afterSource, file, name))
if (before === after) throw new Error('Branch2 auth delta did not change verifySimpleAdminPassword')
fs.writeFileSync('scripts/branch2-environment-worker-manifest.json', JSON.stringify({
  version: 1,
  revision: 'branch2-environment-r1',
  changes: { [name]: { before, after, file } },
}, null, 2) + '\n')

const testPath = 'scripts/test-step1906a-worker-modularization.mjs'
let test = fs.readFileSync(testPath, 'utf8')
const pathAnchor = "const d1ReadBudgetR3Path = path.join(root, 'scripts/d1-read-budget-r3-worker-manifest.json')"
if (!test.includes('branch2-environment-worker-manifest.json')) {
  if (!test.includes(pathAnchor)) throw new Error('R3 manifest path anchor missing')
  test = test.replace(pathAnchor, `${pathAnchor}\nconst branch2EnvironmentPath = path.join(root, 'scripts/branch2-environment-worker-manifest.json')`)
}
const loadAnchor = "  const d1ReadBudgetR3Changes = d1ReadBudgetR3.changes || {}"
if (!test.includes("revision === 'branch2-environment-r1'")) {
  if (!test.includes(loadAnchor)) throw new Error('R3 manifest load anchor missing')
  test = test.replace(loadAnchor, `${loadAnchor}\n  check(fs.existsSync(branch2EnvironmentPath), 'Branch2 environment Worker manifest missing')\n  const branch2Environment = JSON.parse(fs.readFileSync(branch2EnvironmentPath, 'utf8'))\n  check(branch2Environment?.version === 1 && branch2Environment?.revision === 'branch2-environment-r1', 'Branch2 environment Worker manifest invalid')\n  const branch2EnvironmentChanges = branch2Environment.changes || {}`)
}
const oldFinal = `    const d1ReadBudgetR3Changed = d1ReadBudgetR3Changes[name]\n    if (d1ReadBudgetR3Changed) {\n      check(d1ReadBudgetR3Changed.before === acceptedPostD1ReadBudgetR2Hash, \`D1 read-budget R3 baseline hash mismatch: \${name}\`)\n      check(sha(declarations.get(name)) === d1ReadBudgetR3Changed.after, \`Worker declaration changed beyond exact D1 read-budget R3 allow-list: \${name}\`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR2Hash, \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`)\n    }`
const newFinal = `    const d1ReadBudgetR3Changed = d1ReadBudgetR3Changes[name]\n    let acceptedPostD1ReadBudgetR3Hash = acceptedPostD1ReadBudgetR2Hash\n    if (d1ReadBudgetR3Changed) {\n      check(d1ReadBudgetR3Changed.before === acceptedPostD1ReadBudgetR2Hash, \`D1 read-budget R3 baseline hash mismatch: \${name}\`)\n      acceptedPostD1ReadBudgetR3Hash = d1ReadBudgetR3Changed.after\n    }\n    const branch2EnvironmentChanged = branch2EnvironmentChanges[name]\n    if (branch2EnvironmentChanged) {\n      check(branch2EnvironmentChanged.before === acceptedPostD1ReadBudgetR3Hash, \`Branch2 environment baseline hash mismatch: \${name}\`)\n      check(sha(declarations.get(name)) === branch2EnvironmentChanged.after, \`Worker declaration changed beyond exact Branch2 environment allow-list: \${name}\`)\n    } else {\n      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR3Hash, \`Worker declaration body changed beyond accepted cumulative deltas: \${name}\`)\n    }`
if (!test.includes('Worker declaration changed beyond exact Branch2 environment allow-list')) {
  if (!test.includes(oldFinal)) throw new Error('R3 final preservation chain anchor missing')
  test = test.replace(oldFinal, newFinal)
}
fs.writeFileSync(testPath, test)
console.log('Registered exact Branch2 auth declaration delta after R3')
