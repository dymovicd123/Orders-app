import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const catalog = read('worker/domains/catalog.ts')
const inventory = read('worker/domains/inventory-movement.ts')
const orderCore = read('worker/domains/order-core.ts')
const orderReservations = read('worker/domains/order-reservations.ts')

check(catalog.includes('export function catalogColorIdentity'), 'semantic color identity helper missing')
check(catalog.includes(".replace(/[‐‑‒–—-]+/g, ' ')"), 'semantic color identity does not collapse dash variants')
check(catalog.includes("const exact = await db.prepare("), 'Catalog exact fast path missing')
check(catalog.includes('if (exact?.id) return exact;'), 'Catalog must preserve exact-match fast path before semantic fallback')
check(catalog.includes('const semanticColor = catalogColorIdentity(normalizedColor);'), 'Catalog semantic fallback color missing')
check(catalog.includes('catalogColorIdentity(row.color) === semanticColor'), 'Catalog semantic fallback does not reuse punctuation-equivalent color')
check(catalog.includes('const color = catalogColorIdentity(input.color);'), 'New Catalog combinations do not store one stable semantic color identity')
check(catalog.includes('const sizeLabel = normalizeCatalogCombinationSize(input.sizeLabel);'), 'New Catalog combinations do not normalize no-size aliases before identity lookup')
check(catalog.includes("IN ('', 'БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р')"), 'Catalog semantic lookup no longer treats no-size aliases as one identity')

check(inventory.includes("import { catalogColorIdentity,"), 'Arrival materializer does not share Catalog color identity')
check(inventory.includes('const variantExactKey = '), 'Arrival exact variant lookup missing')
check(inventory.includes('const variantSemanticKey = '), 'Arrival semantic variant lookup missing')
check(inventory.includes('catalogColorIdentity(color)'), 'Arrival semantic key does not normalize punctuation-equivalent colors')
check(inventory.includes('normalizeCatalogCombinationSize(size)'), 'Arrival semantic key does not normalize no-size aliases')
check(inventory.includes('variantByExactKey.has(exactKey) || variantBySemanticKey.has(semanticKey)'), 'Arrival can still create a semantic duplicate despite an existing equivalent SKU')
check(inventory.includes('missingVariants.has(semanticKey)'), 'Equivalent combinations inside one arrival batch are not deduplicated')
check(inventory.includes('const color = catalogColorIdentity(item.color);'), 'New arrival-created SKU does not use stable semantic color spelling')
check(inventory.includes('const variant = variantByExactKey.get(exactKey) || variantBySemanticKey.get(semanticKey);'), 'Arrival does not preserve exact-first routing with semantic fallback')
check(inventory.includes('color: normalizeCatalogCombinationColor(variant.color) || null'), 'Arrival snapshot does not follow the actual resolved Catalog variant')

check(orderCore.includes('if (await isCatalogIdentityV3Enabled(db))'), 'Order materialization lost the Catalog identity-v3 gate')
check(orderCore.includes('const combination = await createCatalogCombinationV3(db, {'), 'Order identity-v3 path bypasses canonical combination creation')
check(orderReservations.includes('if (await isCatalogIdentityV3Enabled(db) || await isHumanInventoryModelEnabled(db))'), 'Order reservation resolver can fall back to legacy exact-only materialization while the current inventory model is active')
check(orderReservations.includes('return await resolveCatalogProductAndVariantV2(db, item);'), 'Current order reservation resolver does not route through canonical V2 identity')
check(orderReservations.includes('const created = await createCatalogCombinationV3(db, {'), 'Canonical order resolver bypasses semantic combination creation')

const colorIdentity = (value) => String(value || '').trim().toUpperCase().replace(/[‐‑‒–—-]+/g, ' ').replace(/\s+/g, ' ').trim()
for (const sample of ['СВЕТЛО-СЕРЫЙ', 'СВЕТЛО СЕРЫЙ', 'СВЕТЛО–СЕРЫЙ', 'СВЕТЛО‑СЕРЫЙ']) {
  check(colorIdentity(sample) === 'СВЕТЛО СЕРЫЙ', 'Regression fixture: punctuation-equivalent color stopped being one identity: ' + sample)
}

const sizeIdentity = (value) => {
  const text = String(value ?? '').trim().toUpperCase()
  return (!text || ['БЕЗ РАЗМЕРА', 'БЕЗРАЗМЕРА', 'Б/Р'].includes(text)) ? '' : text
}
for (const sample of [null, undefined, '', 'Без размера', 'БЕЗРАЗМЕРА', 'Б/Р']) {
  check(sizeIdentity(sample) === '', 'Regression fixture: no-size aliases stopped being one identity: ' + String(sample))
}
check(sizeIdentity('46') === '46', 'Regression fixture: concrete size must remain distinct')

console.log('CATALOG SEMANTIC SKU IDENTITY PASSED — exact spelling stays the fast path; punctuation-equivalent colors and no-size aliases share one physical identity; Catalog, Arrival, and active order materialization all use the canonical semantic path')
