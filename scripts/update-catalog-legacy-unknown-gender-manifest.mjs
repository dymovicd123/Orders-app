import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const manifestPath = 'scripts/step1906a-worker-declaration-manifest.json'
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))

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

const changes = [
  ['worker/domains/catalog-review.ts', 'catalogReviewBasePredicate'],
  ['worker/domains/catalog-review.ts', 'resolveCatalogReviewFacts'],
  ['worker/domains/order-reservations.ts', 'getOrderShipmentInventoryBlockers'],
]

for (const [path, name] of changes) {
  if (!manifest.declarations?.[name]) throw new Error(`Missing accepted baseline declaration: ${name}`)
  const before = manifest.declarations[name]
  const after = declarationHash(path, name)
  if (before === after) throw new Error(`Expected real declaration delta for ${name}`)
  manifest.declarations[name] = after
  console.log(`${name}: ${before} -> ${after}`)
}

fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
