import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'
import { execFileSync } from 'node:child_process'

const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

function declarationHash(sourceText, fileName) {
  const source = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'rememberCatalogValueAlias') {
      return sha(normalizeMovedDeclaration(statement.getText(source)))
    }
  }
  throw new Error(`rememberCatalogValueAlias not found in ${fileName}`)
}

const manifest = JSON.parse(fs.readFileSync('scripts/step1906a-worker-declaration-manifest.json', 'utf8'))
const acceptedBase = manifest.declarations?.rememberCatalogValueAlias || ''
const headText = fs.readFileSync('worker/domains/catalog.ts', 'utf8')
execFileSync('git', ['fetch', 'origin', 'main', '--depth=1'], { stdio: 'ignore' })
const mainText = execFileSync('git', ['show', 'origin/main:worker/domains/catalog.ts'], { encoding: 'utf8' })
console.log(JSON.stringify({ acceptedBase, main: declarationHash(mainText, 'main/catalog.ts'), r2: declarationHash(headText, 'head/catalog.ts') }, null, 2))
