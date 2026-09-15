import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const sourcePath = 'worker/domains/catalog-review.ts'
const manifestPath = 'scripts/step1906a-worker-declaration-manifest.json'
const sourceText = fs.readFileSync(sourcePath, 'utf8')
const source = ts.createSourceFile(sourcePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
let body = ''
for (const statement of source.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'catalogReviewBasePredicate') {
    body = statement.getText(source).replace(/^export\s+/, '')
    break
  }
}
if (!body) throw new Error('catalogReviewBasePredicate declaration not found')
const hash = crypto.createHash('sha256').update(body).digest('hex')
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const before = manifest.declarations?.catalogReviewBasePredicate
if (before !== '61cbfae55e7e7757a9a668a4e743e7e35681310257394453de8a2f2b9cc28ceb') {
  throw new Error(`Unexpected catalogReviewBasePredicate baseline: ${before}`)
}
manifest.declarations.catalogReviewBasePredicate = hash
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`catalogReviewBasePredicate: ${before} -> ${hash}`)
