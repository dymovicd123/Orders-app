import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const sourcePath = 'worker/domains/order-reservations.ts'
const gatePath = 'scripts/test-step1906a-worker-modularization.mjs'
const manifestPath = 'scripts/d1-read-budget-r5-4-worker-manifest.json'
const sourceText = fs.readFileSync(sourcePath, 'utf8')
const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const statement = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'fetchOrderStockHandoverRows')
if (!statement) throw new Error('fetchOrderStockHandoverRows declaration not found')
const normalized = statement.getText(source).replace(/^export\s+/, '')
const after = crypto.createHash('sha256').update(normalized).digest('hex')
const before = 'd15e854c00f6355edc32747b1b66330457e608d112f1caaefe719fadb53f3c4a'
if (after === before) throw new Error('R5.4 declaration hash did not change')
fs.writeFileSync(manifestPath, JSON.stringify({
  version: 1,
  revision: 'd1-read-budget-r5-4',
  changes: {
    fetchOrderStockHandoverRows: {
      before,
      after,
      file: sourcePath,
    },
  },
}, null, 2) + '\n')

let gate = fs.readFileSync(gatePath, 'utf8')
const replaceOnce = (oldText, newText, label) => {
  const count = gate.split(oldText).length - 1
  if (count !== 1) throw new Error(`${label}: expected 1 match, found ${count}`)
  gate = gate.replace(oldText, newText)
}
replaceOnce(
  "const d1ReadBudgetR53Path = path.join(root, 'scripts/d1-read-budget-r5-3-worker-manifest.json')\n",
  "const d1ReadBudgetR53Path = path.join(root, 'scripts/d1-read-budget-r5-3-worker-manifest.json')\nconst d1ReadBudgetR54Path = path.join(root, 'scripts/d1-read-budget-r5-4-worker-manifest.json')\n",
  'R5.4 path insertion',
)
replaceOnce(
  "  const d1ReadBudgetR53Changes = d1ReadBudgetR53.changes || {}\n",
  "  const d1ReadBudgetR53Changes = d1ReadBudgetR53.changes || {}\n  check(fs.existsSync(d1ReadBudgetR54Path), 'D1 read-budget R5.4 Worker manifest missing')\n  const d1ReadBudgetR54 = JSON.parse(fs.readFileSync(d1ReadBudgetR54Path, 'utf8'))\n  check(d1ReadBudgetR54?.version === 1 && d1ReadBudgetR54?.revision === 'd1-read-budget-r5-4', 'D1 read-budget R5.4 Worker manifest invalid')\n  const d1ReadBudgetR54Changes = d1ReadBudgetR54.changes || {}\n",
  'R5.4 manifest load insertion',
)
const oldAddedGate = `    const d1ReadBudgetR3Changed = d1ReadBudgetR3Changes[name]
    if (d1ReadBudgetR3Changed) {
      check(d1ReadBudgetR3Changed.before === acceptedPostD1ReadBudgetR2Hash, \`D1 read-budget R3 changed 192B1-added declaration baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === d1ReadBudgetR3Changed.after, \`192B1-added declaration changed beyond exact D1 read-budget R3 allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR2Hash, \`192B1 added Worker declaration changed beyond accepted deltas: \${name}\`)
    }
`
const newAddedGate = `    const d1ReadBudgetR3Changed = d1ReadBudgetR3Changes[name]
    let acceptedPostD1ReadBudgetR3Hash = acceptedPostD1ReadBudgetR2Hash
    if (d1ReadBudgetR3Changed) {
      check(d1ReadBudgetR3Changed.before === acceptedPostD1ReadBudgetR2Hash, \`D1 read-budget R3 changed 192B1-added declaration baseline hash mismatch: \${name}\`)
      acceptedPostD1ReadBudgetR3Hash = d1ReadBudgetR3Changed.after
    }
    const d1ReadBudgetR54Changed = d1ReadBudgetR54Changes[name]
    if (d1ReadBudgetR54Changed) {
      check(d1ReadBudgetR54Changed.before === acceptedPostD1ReadBudgetR3Hash, \`D1 read-budget R5.4 changed 192B1-added declaration baseline hash mismatch: \${name}\`)
      check(sha(declarations.get(name)) === d1ReadBudgetR54Changed.after, \`192B1-added declaration changed beyond exact D1 read-budget R5.4 allow-list: \${name}\`)
    } else {
      check(sha(declarations.get(name)) === acceptedPostD1ReadBudgetR3Hash, \`192B1 added Worker declaration changed beyond accepted deltas: \${name}\`)
    }
`
replaceOnce(oldAddedGate, newAddedGate, '192B1-added R5.4 cumulative gate')
fs.writeFileSync(gatePath, gate)
console.log(`R5.4 Worker manifest/gate finalized: ${before} -> ${after}`)
