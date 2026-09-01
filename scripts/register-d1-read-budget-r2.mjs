import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const beforePath = path.join(root, 'scripts/.d1-read-budget-r2-before.json')
const manifestPath = path.join(root, 'scripts/d1-read-budget-r2-worker-manifest.json')
const targets = [
  ['worker/domains/order-reservations.ts', 'fetchOrderStockHandoverRows'],
  ['worker/domains/warehouse-attention.ts', 'getWarehouseAttentionSummary'],
  ['worker/domains/orders-read.ts', 'listOrders'],
  ['worker/domains/inventory-read.ts', 'listInventory'],
  ['worker/domains/team.ts', 'listTeamEmployees'],
  ['worker/domains/clients.ts', 'listClients'],
]

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (text) => text.replace(/^export\s+/, '')

function declarationText(relative, name) {
  const file = path.join(root, relative)
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return normalize(statement.getText(source))
  }
  throw new Error(`Declaration missing: ${relative}:${name}`)
}

const snapshot = () => Object.fromEntries(targets.map(([file, name]) => [name, { file, hash: sha(declarationText(file, name)) }]))
const mode = process.argv[2]
if (mode === 'before') {
  fs.writeFileSync(beforePath, JSON.stringify(snapshot(), null, 2) + '\n')
  console.log('D1 read-budget R2 baseline captured')
} else if (mode === 'after') {
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
  const after = snapshot()
  const changes = {}
  for (const [name, current] of Object.entries(after)) {
    const previous = before[name]
    if (!previous || previous.file !== current.file) throw new Error(`Baseline mismatch: ${name}`)
    if (previous.hash !== current.hash) changes[name] = { before: previous.hash, after: current.hash, file: current.file }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, revision: 'd1-read-budget-r2', changes }, null, 2) + '\n')
  fs.rmSync(beforePath, { force: true })
  console.log(`D1 read-budget R2 manifest registered (${Object.keys(changes).length} declarations)`) 
} else {
  throw new Error('Use: node scripts/register-d1-read-budget-r2.mjs before|after')
}
