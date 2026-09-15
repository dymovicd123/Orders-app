import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const manifestPath = 'scripts/step1906a-worker-declaration-manifest.json'
const targets = [
  {
    path: 'worker/domains/order-reservations.ts',
    name: 'reserveOrderItemV2',
    before: '94823fc09cd0673397833e1055d7db55d3a95bae130140433071918ba35c84dc',
  },
  {
    path: 'worker/domains/catalog-review.ts',
    name: 'catalogReviewRowToOrderItem',
    before: '5d9c5e278430c71f60f257bf7ee1674571e0b5c49385473079acd24f7a171133',
  },
]

function declarationHash(path, name) {
  const text = fs.readFileSync(path, 'utf8')
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      const body = statement.getText(source).replace(/^export\s+/, '')
      return crypto.createHash('sha256').update(body).digest('hex')
    }
  }
  throw new Error(`Declaration not found: ${name}`)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
for (const target of targets) {
  const actualBefore = manifest.declarations?.[target.name]
  if (actualBefore !== target.before) {
    throw new Error(`Unexpected ${target.name} baseline: ${actualBefore}`)
  }
  const after = declarationHash(target.path, target.name)
  if (!after || after === target.before) throw new Error(`${target.name} expected a real declaration delta`)
  manifest.declarations[target.name] = after
  console.log(`${target.name}: ${target.before} -> ${after}`)
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
