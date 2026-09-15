import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const baselineManifestPath = 'scripts/step1906a-worker-declaration-manifest.json'
const orderCreateManifestPath = 'scripts/step192b2a4-order-create-save-integrity-manifest.json'

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

const baseline = JSON.parse(fs.readFileSync(baselineManifestPath, 'utf8'))
const orderCreate = JSON.parse(fs.readFileSync(orderCreateManifestPath, 'utf8'))

// reserveOrderItemV2 already has a later accepted owner: Step 192B2A4.
// Keep the historical 1906A baseline and 192B2A4.before intact; only advance that layer's after hash.
const reserveBaseline = '94823fc09cd0673397833e1055d7db55d3a95bae130140433071918ba35c84dc'
const reservePreviousAfter = '7e170771def60e3551bb2267d5fa40ac5f98a6e7da07bc2cd203e1364ef02c84'
if (baseline.declarations?.reserveOrderItemV2 !== reserveBaseline) {
  throw new Error(`Unexpected reserveOrderItemV2 1906A baseline: ${baseline.declarations?.reserveOrderItemV2}`)
}
const reserveDelta = orderCreate.changes?.reserveOrderItemV2
if (reserveDelta?.before !== reserveBaseline || reserveDelta?.after !== reservePreviousAfter) {
  throw new Error(`Unexpected 192B2A4 reserveOrderItemV2 chain: ${JSON.stringify(reserveDelta)}`)
}
const reserveAfter = declarationHash('worker/domains/order-reservations.ts', 'reserveOrderItemV2')
if (!reserveAfter || reserveAfter === reservePreviousAfter) throw new Error('reserveOrderItemV2 expected a real post-192B2A4 delta')
reserveDelta.after = reserveAfter
console.log(`reserveOrderItemV2 192B2A4.after: ${reservePreviousAfter} -> ${reserveAfter}`)

// catalogReviewRowToOrderItem has no later declaration owner, so its exact 1906A accepted hash advances directly.
const reviewBefore = '5d9c5e278430c71f60f257bf7ee1674571e0b5c49385473079acd24f7a171133'
if (baseline.declarations?.catalogReviewRowToOrderItem !== reviewBefore) {
  throw new Error(`Unexpected catalogReviewRowToOrderItem baseline: ${baseline.declarations?.catalogReviewRowToOrderItem}`)
}
const reviewAfter = declarationHash('worker/domains/catalog-review.ts', 'catalogReviewRowToOrderItem')
if (!reviewAfter || reviewAfter === reviewBefore) throw new Error('catalogReviewRowToOrderItem expected a real declaration delta')
baseline.declarations.catalogReviewRowToOrderItem = reviewAfter
console.log(`catalogReviewRowToOrderItem: ${reviewBefore} -> ${reviewAfter}`)

fs.writeFileSync(baselineManifestPath, JSON.stringify(baseline, null, 2) + '\n')
fs.writeFileSync(orderCreateManifestPath, JSON.stringify(orderCreate, null, 2) + '\n')
