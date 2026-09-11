import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import ts from 'typescript'

const root = process.cwd()
const catalogPath = path.join(root, 'worker/domains/catalog.ts')
const manifestPath = path.join(root, 'scripts/w6-4-catalog-sku-card-worker-manifest.json')
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex')
const normalizeMovedDeclaration = (text) => text.replace(/^export\s+/, '')

const catalog = fs.readFileSync(catalogPath, 'utf8')
const source = ts.createSourceFile(catalogPath, catalog, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const update = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === 'updateCatalogVariant')
if (!update) throw new Error('updateCatalogVariant declaration missing')

const updateText = update.getText(source)
const oldGenderLine = `  const gender = input.gender === undefined ? normalizeCatalogCombinationGender(existing.gender) : normalizeCatalogCombinationGender(input.gender);`
const newGenderBlock = `  const genderResolution = await resolveCatalogGenderForProduct(db, productId, input.gender === undefined ? existing.gender : input.gender);\n  const gender = genderResolution.gender;`

if ((updateText.split(newGenderBlock).length - 1) !== 1) {
  throw new Error('Expected exactly one intentional gender-scope change in updateCatalogVariant')
}
if (updateText.includes(oldGenderLine)) {
  throw new Error('Legacy updateCatalogVariant gender line unexpectedly remains')
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
if (manifest?.version !== 1 || manifest?.revision !== 'w6-4-catalog-sku-card') {
  throw new Error('Unexpected W6.4 manifest identity')
}
if (Object.keys(manifest.changes || {}).join(',') !== 'updateCatalogVariant') {
  throw new Error('W6.4 changed-declaration allow-list is not exact')
}
if (Object.keys(manifest.added || {}).join(',') !== 'assertCatalogVariantMayDeactivate') {
  throw new Error('W6.4 added-declaration allow-list is not exact')
}

// Prove the new declaration is exactly the previously accepted W6.4 declaration plus
// one intentional substitution: catalog gender resolution replaces raw normalization.
const reconstructedAccepted = updateText.replace(newGenderBlock, oldGenderLine)
const reconstructedHash = sha(normalizeMovedDeclaration(reconstructedAccepted))
const acceptedHash = String(manifest.changes.updateCatalogVariant.after || '')
if (reconstructedHash !== acceptedHash) {
  throw new Error(`Refusing manifest refresh: updateCatalogVariant has changes beyond the intended gender substitution (${reconstructedHash} != ${acceptedHash})`)
}

const newHash = sha(normalizeMovedDeclaration(updateText))
manifest.changes.updateCatalogVariant.after = newHash
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
console.log(`W6.4 manifest safely advanced for exact gender-scope delta: ${acceptedHash} -> ${newHash}`)
