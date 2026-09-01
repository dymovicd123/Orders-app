import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const beforePath = path.join(root, 'scripts/.d1-read-budget-r1-before.json')
const manifestPath = path.join(root, 'scripts/d1-read-budget-r1-worker-manifest.json')
const targets = [
  ['worker/domains/orders-relations.ts', 'fetchOrderRelations'],
  ['worker/domains/orders-read.ts', 'listOrders'],
]

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationNames(statement) {
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return [statement.name.text]
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name) ? [declaration.name.text] : [])
  return []
}

function declarationHash(relativePath, targetName) {
  const file = path.join(root, relativePath)
  const text = fs.readFileSync(file, 'utf8')
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (!declarationNames(statement).includes(targetName)) continue
    return sha(normalizeMovedDeclaration(statement.getText(source)))
  }
  throw new Error(`Declaration not found: ${targetName} in ${relativePath}`)
}

function snapshot() {
  return Object.fromEntries(targets.map(([file, name]) => [name, declarationHash(file, name)]))
}

const mode = process.argv[2]
if (mode === 'before') {
  fs.writeFileSync(beforePath, JSON.stringify(snapshot(), null, 2) + '\n')
  console.log('D1 read-budget R1 baseline captured')
} else if (mode === 'after') {
  if (!fs.existsSync(beforePath)) throw new Error('D1 read-budget baseline is missing')
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
  const after = snapshot()
  const changes = {}
  for (const [, name] of targets) {
    if (!before[name] || !after[name]) throw new Error(`Missing hash for ${name}`)
    if (before[name] === after[name]) throw new Error(`Expected declaration to change: ${name}`)
    changes[name] = { before: before[name], after: after[name] }
  }
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, revision: 'd1-read-budget-r1', changes }, null, 2) + '\n')
  fs.rmSync(beforePath, { force: true })
  console.log('D1 read-budget R1 manifest registered')
} else {
  throw new Error('Usage: node scripts/register-d1-read-budget-r1.mjs before|after')
}
