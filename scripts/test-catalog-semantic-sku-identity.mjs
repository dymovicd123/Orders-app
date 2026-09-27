import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const catalog = read('worker/domains/catalog.ts')
const inventory = read('worker/domains/inventory-movement.ts')

check(catalog.includes('export function catalogColorIdentity'), 'semantic color identity helper missing')
check(catalog.includes(".replace(/[‐‑‒–—-]+/g, ' ')"), 'semantic color identity does not collapse dash variants')
check(catalog.includes("const exact = await db.prepare("), 'Catalog exact fast path missing')
check(catalog.includes('if (exact?.id) return exact;'), 'Catalog must preserve exact-match fast path before semantic fallback')
check(catalog.includes('const semanticColor = catalogColorIdentity(normalizedColor);'), 'Catalog semantic fallback color missing')
check(catalog.includes('catalogColorIdentity(row.color) === semanticColor'), 'Catalog semantic fallback does not reuse punctuation-equivalent color')
check(catalog.includes('const color = catalogColorIdentity(input.color);'), 'New Catalog combinations do not store one stable semantic color identity')

check(inventory.includes("import { catalogColorIdentity,"), 'Arrival materializer does not share Catalog color identity')
check(inventory.includes('const variantExactKey = '), 'Arrival exact variant lookup missing')
check(inventory.includes('const variantSemanticKey = '), 'Arrival semantic variant lookup missing')
check(inventory.includes('catalogColorIdentity(color)'), 'Arrival semantic key does not normalize punctuation-equivalent colors')
check(inventory.includes('variantByExactKey.has(exactKey) || variantBySemanticKey.has(semanticKey)'), 'Arrival can still create a semantic duplicate despite an existing equivalent SKU')
check(inventory.includes('missingVariants.has(semanticKey)'), 'Equivalent colors inside one arrival batch are not deduplicated')
check(inventory.includes('const color = catalogColorIdentity(item.color);'), 'New arrival-created SKU does not use stable semantic color spelling')
check(inventory.includes('const variant = variantByExactKey.get(exactKey) || variantBySemanticKey.get(semanticKey);'), 'Arrival does not preserve exact-first routing with semantic fallback')
check(inventory.includes('color: normalizeCatalogCombinationColor(variant.color) || null'), 'Arrival snapshot does not follow the actual resolved Catalog variant')

const identity = (value) => String(value || '').trim().toUpperCase().replace(/[‐‑‒–—-]+/g, ' ').replace(/\s+/g, ' ').trim()
for (const sample of ['СВЕТЛО-СЕРЫЙ', 'СВЕТЛО СЕРЫЙ', 'СВЕТЛО–СЕРЫЙ', 'СВЕТЛО‑СЕРЫЙ']) {
  check(identity(sample) === 'СВЕТЛО СЕРЫЙ', 'Regression fixture: punctuation-equivalent color stopped being one identity: ' + sample)
}

console.log('CATALOG SEMANTIC SKU IDENTITY PASSED — exact spelling remains the fast path, punctuation-equivalent colors reuse an existing SKU, and new arrival/order materialization cannot create a second physical identity for hyphen/space variants')
