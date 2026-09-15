import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const declarationManifestPath = 'scripts/step1906a-worker-declaration-manifest.json'
const shippingShortageManifestPath = 'scripts/shipping-shortage-hotfix-worker-manifest.json'
const declarationManifest = JSON.parse(fs.readFileSync(declarationManifestPath, 'utf8'))
const shippingShortageManifest = JSON.parse(fs.readFileSync(shippingShortageManifestPath, 'utf8'))

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

const baseManifestChanges = [
  ['worker/domains/catalog-review.ts', 'catalogReviewBasePredicate'],
  ['worker/domains/catalog-review.ts', 'resolveCatalogReviewFacts'],
]

for (const [path, name] of baseManifestChanges) {
  if (!declarationManifest.declarations?.[name]) throw new Error(`Missing accepted baseline declaration: ${name}`)
  const before = declarationManifest.declarations[name]
  const after = declarationHash(path, name)
  if (before === after) throw new Error(`Expected real declaration delta for ${name}`)
  declarationManifest.declarations[name] = after
  console.log(`${name}: ${before} -> ${after}`)
}

const shipmentName = 'getOrderShipmentInventoryBlockers'
const shipmentChange = shippingShortageManifest.changes?.[shipmentName]
if (!shipmentChange?.before || !shipmentChange?.after) {
  throw new Error(`Missing shipping-shortage accepted delta: ${shipmentName}`)
}
if (shipmentChange.before !== declarationManifest.declarations?.[shipmentName]) {
  throw new Error(`Shipping-shortage baseline chain mismatch: ${shipmentName}`)
}
const shipmentAfter = declarationHash('worker/domains/order-reservations.ts', shipmentName)
if (shipmentAfter === shipmentChange.after) throw new Error(`Expected real declaration delta for ${shipmentName}`)
console.log(`${shipmentName}: ${shipmentChange.after} -> ${shipmentAfter}`)
shipmentChange.after = shipmentAfter

fs.writeFileSync(declarationManifestPath, JSON.stringify(declarationManifest, null, 2) + '\n')
fs.writeFileSync(shippingShortageManifestPath, JSON.stringify(shippingShortageManifest, null, 2) + '\n')
