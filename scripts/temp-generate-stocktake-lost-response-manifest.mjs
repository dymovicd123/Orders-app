import fs from 'node:fs'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

const workerPath = 'worker/domains/inventory-stocktake.ts'
const outputPath = 'scripts/stocktake-lost-response-worker-manifest.json'
const names = [
  'createInventoryStocktakeSession',
  'saveInventoryStocktakeCount',
  'quickInventoryStocktakeBatch',
  'quickInventoryStocktake',
  'completeInventoryStocktakeSession',
]

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationMap(text) {
  const source = ts.createSourceFile(workerPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const result = new Map()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      result.set(statement.name.text, normalizeMovedDeclaration(statement.getText(source)))
    }
  }
  return result
}

const beforeText = execFileSync('git', ['show', `HEAD:${workerPath}`], { encoding: 'utf8' })
const afterText = fs.readFileSync(workerPath, 'utf8')
const before = declarationMap(beforeText)
const after = declarationMap(afterText)
const changes = {}

for (const name of names) {
  if (!before.has(name) || !after.has(name)) throw new Error(`Missing stocktake declaration: ${name}`)
  const beforeHash = hash(before.get(name))
  const afterHash = hash(after.get(name))
  if (beforeHash === afterHash) throw new Error(`Expected stocktake declaration to change: ${name}`)
  changes[name] = { before: beforeHash, after: afterHash }
}

fs.writeFileSync(outputPath, JSON.stringify({
  version: 1,
  revision: 'stocktake-lost-response-r1',
  reason: 'Retry/lost-response safety for stocktake create, count save, quick/cycle checks and completion.',
  changes,
}, null, 2) + '\n')

console.log(`Generated ${outputPath} for ${Object.keys(changes).length} Worker declarations.`)
