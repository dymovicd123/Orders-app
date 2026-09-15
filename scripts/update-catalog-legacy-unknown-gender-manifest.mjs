import fs from 'node:fs'
import crypto from 'node:crypto'
import ts from 'typescript'

const declarationManifestPath = 'scripts/step1906a-worker-declaration-manifest.json'
const shippingShortageManifestPath = 'scripts/shipping-shortage-hotfix-worker-manifest.json'
const catalogGenderManifestPath = 'scripts/catalog-gender-scope-r1-worker-manifest.json'
const declarationManifest = JSON.parse(fs.readFileSync(declarationManifestPath, 'utf8'))
const shippingShortageManifest = JSON.parse(fs.readFileSync(shippingShortageManifestPath, 'utf8'))
const catalogGenderManifest = JSON.parse(fs.readFileSync(catalogGenderManifestPath, 'utf8'))

function declarationHash(filePath, name) {
  const text = fs.readFileSync(filePath, 'utf8')
  const source = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  for (const statement of source.statements) {
    const namedDeclaration = (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
    ) && statement.name?.text === name
    if (namedDeclaration) {
      const body = statement.getText(source).replace(/^export\s+/, '')
      return crypto.createHash('sha256').update(body).digest('hex')
    }
  }
  throw new Error(`Declaration not found: ${name}`)
}

const predicateName = 'catalogReviewBasePredicate'
if (!declarationManifest.declarations?.[predicateName]) throw new Error(`Missing accepted baseline declaration: ${predicateName}`)
const predicateBefore = declarationManifest.declarations[predicateName]
const predicateAfter = declarationHash('worker/domains/catalog-review.ts', predicateName)
if (predicateBefore === predicateAfter) throw new Error(`Expected real declaration delta for ${predicateName}`)
declarationManifest.declarations[predicateName] = predicateAfter
console.log(`${predicateName}: ${predicateBefore} -> ${predicateAfter}`)

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

if (catalogGenderManifest?.version !== 1 || catalogGenderManifest?.revision !== 'catalog-gender-scope-r1') {
  throw new Error('Catalog gender scope R1 manifest invalid')
}
const factsTypeName = 'CatalogReviewFactsInput'
const factsTypeChange = catalogGenderManifest.typeChanges?.[factsTypeName]
if (!factsTypeChange?.before || !factsTypeChange?.after) throw new Error(`Missing catalog-gender type delta: ${factsTypeName}`)
if (factsTypeChange.after !== 'f25a3584694a7d4a57c3102645d457a7c3bba399a348e75a04da01a78ef91a12') {
  throw new Error(`Unexpected prior catalog-gender type state: ${factsTypeName}`)
}
const factsTypeAfter = declarationHash('worker/domains/catalog-review.ts', factsTypeName)
if (factsTypeAfter === factsTypeChange.after) throw new Error(`Expected real declaration delta for ${factsTypeName}`)
console.log(`${factsTypeName}: ${factsTypeChange.after} -> ${factsTypeAfter}`)
factsTypeChange.after = factsTypeAfter

const resolverName = 'resolveCatalogReviewFacts'
const resolverChange = catalogGenderManifest.functionChanges?.[resolverName]
if (!resolverChange?.before || !resolverChange?.after) throw new Error(`Missing catalog-gender function delta: ${resolverName}`)
if (resolverChange.after !== 'af41858526981a511487ae323c607a8d3da2e081f9bd07193ed00d190b8a94ce') {
  throw new Error(`Unexpected prior catalog-gender function state: ${resolverName}`)
}
const resolverAfter = declarationHash('worker/domains/catalog-review.ts', resolverName)
if (resolverAfter === resolverChange.after) throw new Error(`Expected real declaration delta for ${resolverName}`)
console.log(`${resolverName}: ${resolverChange.after} -> ${resolverAfter}`)
resolverChange.after = resolverAfter

fs.writeFileSync(declarationManifestPath, JSON.stringify(declarationManifest, null, 2) + '\n')
fs.writeFileSync(shippingShortageManifestPath, JSON.stringify(shippingShortageManifest, null, 2) + '\n')
fs.writeFileSync(catalogGenderManifestPath, JSON.stringify(catalogGenderManifest, null, 2) + '\n')
