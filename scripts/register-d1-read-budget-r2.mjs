import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const beforePath = path.join(root, 'scripts/.d1-read-budget-r2-before.json')
const manifestPath = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')
const targets = [
  ['worker/domains/order-reservations.ts', 'fetchOrderStockHandoverRows'],
  ['worker/domains/order-reservations.ts', 'stockHandoverItemFromRow'],
  ['worker/domains/warehouse-attention.ts', 'getWarehouseAttentionSummary'],
]
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')

function declarationBody(relative, name) {
  const file = path.join(root, relative)
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) {
      return statement.getText(source)
    }
  }
  throw new Error(`Declaration not found: ${relative}:${name}`)
}

function snapshot() {
  return Object.fromEntries(targets.map(([relative, name]) => [name, sha(declarationBody(relative, name))]))
}

const mode = process.argv[2]
if (mode === 'before') {
  fs.writeFileSync(beforePath, JSON.stringify(snapshot(), null, 2) + '\n')
  console.log('D1 read-budget R2 baseline captured')
} else if (mode === 'after') {
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
  const after = snapshot()
  const changes = {}
  for (const name of Object.keys(before)) {
    if (before[name] === after[name]) throw new Error(`Expected R2 declaration to change: ${name}`)
    changes[name] = { before: before[name], after: after[name] }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, revision: 'd1-read-budget-r2', changes }, null, 2) + '\n')
  console.log('D1 read-budget R2 manifest registered')
} else {
  throw new Error('Use before or after')
}
