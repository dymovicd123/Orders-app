import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationHash(text, fileName, wanted) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    let name = ''
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) name = statement.name.text
    if (name === wanted) return sha(normalizeMovedDeclaration(statement.getText(source)))
  }
  throw new Error(`Declaration not found: ${wanted}`)
}

const path = 'worker/domains/orders-read.ts'
const beforeText = execFileSync('git', ['show', `origin/main:${path}`], { encoding: 'utf8' })
const afterText = fs.readFileSync(path, 'utf8')
const before = declarationHash(beforeText, path, 'listOrders')
const after = declarationHash(afterText, path, 'listOrders')
if (before === after) throw new Error('R4 listOrders declaration did not change')
fs.writeFileSync('scripts/d1-read-budget-r4-worker-manifest.json', JSON.stringify({
  version: 1,
  revision: 'd1-read-budget-r4',
  changes: { listOrders: { before, after } },
}, null, 2) + '\n')
console.log(`R4 listOrders manifest: ${before} -> ${after}`)
