import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const sourceText = fs.readFileSync('worker/domains/inventory-movement.ts', 'utf8')
const source = ts.createSourceFile('worker/domains/inventory-movement.ts', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
let declaration = null
for (const statement of source.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name?.text === 'resolveInventoryCreatableItemsBulk') {
    declaration = normalizeMovedDeclaration(statement.getText(source))
    break
  }
}
if (!declaration) throw new Error('resolveInventoryCreatableItemsBulk declaration missing')
const before = '03cdec8b24de8bc0de9ca570419ba84442427598c390c400e5ecfd0e61dd816e'
const after = sha(declaration)
if (after === before) throw new Error('ORDA resolver patch did not change declaration hash')
fs.writeFileSync('scripts/arrival-canonical-product-alias-r1-worker-manifest.json', `${JSON.stringify({
  version: 1,
  revision: 'arrival-canonical-product-alias-r1',
  changes: {
    resolveInventoryCreatableItemsBulk: { before, after },
  },
}, null, 2)}\n`)
console.log(`ORDA resolver manifest: ${before} -> ${after}`)
