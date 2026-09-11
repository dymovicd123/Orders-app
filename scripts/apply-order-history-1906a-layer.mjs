import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalize = (text) => text.replace(/^export\s+/, '')

function declarationHashes(text, fileName) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const out = new Map()
  for (const statement of source.statements) {
    const names = []
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) names.push(statement.name.text)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text)
    }
    for (const name of names) out.set(name, sha(normalize(statement.getText(source))))
  }
  return out
}

const targets = [
  ['worker/domains/orders-read.ts', ['listOrders', 'listOpenDebtOrders']],
  ['worker/domains/orders-write.ts', ['getOrder']],
]
const changes = {}
for (const [file, names] of targets) {
  const currentText = fs.readFileSync(path.join(root, file), 'utf8')
  const baseText = execFileSync('git', ['show', `origin/main:${file}`], { cwd: root, encoding: 'utf8' })
  const current = declarationHashes(currentText, file)
  const base = declarationHashes(baseText, file)
  for (const name of names) {
    if (!current.has(name) || !base.has(name)) throw new Error(`Order-history declaration missing: ${name}`)
    const before = base.get(name)
    const after = current.get(name)
    if (before === after) throw new Error(`Order-history declaration unexpectedly unchanged: ${name}`)
    changes[name] = { before, after }
  }
}

const manifest = {
  version: 1,
  revision: 'catalog-order-history-preservation-r1',
  changes,
}
fs.writeFileSync(path.join(root, 'scripts/catalog-order-history-preservation-worker-manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('Catalog order-history preservation exact Worker manifest generated:', Object.keys(changes).join(', '))
