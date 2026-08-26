import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const file = 'worker/domains/returns-exchanges.ts'
const sourceText = fs.readFileSync(file, 'utf8')
const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const wanted = new Set(['createReturn', 'createExchange'])
const hashes = {}

for (const statement of source.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name && wanted.has(statement.name.text)) {
    hashes[statement.name.text] = sha(statement.getText(source).replace(/^export\s+/, ''))
  }
}
for (const name of wanted) {
  if (!hashes[name]) throw new Error(`Declaration not found for manifest refresh: ${name}`)
}

const manifestPath = 'scripts/step192a1-warehouse-truth-freshness-manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
for (const name of wanted) manifest.changes[name].after = hashes[name]
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
console.log('Updated Phase 1B declaration hashes:', hashes)
