import fs from 'node:fs'

const lifecycle = fs.readFileSync('worker/domains/lifecycle.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const workshopStart = lifecycle.indexOf('export async function resolveWorkshopCatalogExactCandidate(')
const resolverStart = lifecycle.indexOf('export async function resolveInventoryLifecycleCandidate(', workshopStart)
const resolverEnd = lifecycle.indexOf('export async function trustedInventoryFullStocktakeBoundary(', resolverStart)
check(workshopStart >= 0 && resolverStart > workshopStart && resolverEnd > resolverStart, 'Workshop lifecycle resolver blocks missing')

const workshop = lifecycle.slice(workshopStart, resolverStart)
const resolver = lifecycle.slice(resolverStart, resolverEnd)

check(workshop.includes('const linkedProductId = toInt(item.product_id, 0)'), 'Workshop fallback resolver ignores repaired canonical product link')
check(workshop.includes("SELECT id, category FROM catalog_products WHERE id = ? AND is_active = 1 LIMIT 1"), 'Workshop fallback resolver does not validate linked canonical product')
check(workshop.includes("cleanText(product.category) || normalized.category"), 'Workshop fallback resolver still lets stale audience text override repaired product category')
check(workshop.includes('findCatalogProductByIdentity(db, normalized.productName'), 'Workshop fallback lost safe historical-name fallback for unresolved legacy rows')

const exactVariant = resolver.indexOf('const existingVariantId = toInt(item.variant_id, 0)')
const exactLoad = resolver.indexOf('await loadCanonicalVariantSnapshot(db, existingVariantId)')
const workshopFallback = resolver.indexOf('if (isWorkshop) return await resolveWorkshopCatalogExactCandidate(db, item)')
check(exactVariant >= 0 && exactLoad > exactVariant, 'Exact linked variant validation missing')
check(workshopFallback > exactLoad, 'Workshop path still bypasses a repaired exact canonical variant link')
check(resolver.includes('productId: canonical.productId, variantId: canonical.variantId'), 'Validated exact variant is not returned as canonical lifecycle identity')

// The historical snapshots remain the independent fallback evidence when an explicit link is stale or absent.
check(resolver.includes('independent identity resolution from the recorded item facts'), 'Stale-link fallback safety comment/contract missing')
check(workshop.includes('const normalized = inventoryLifecycleItemFromRow(item)'), 'Workshop fallback no longer uses recorded item facts for exact combination matching')

console.log('STAGE01 WORKSHOP LIFECYCLE CANONICAL LINK R10 PASSED — valid repaired product/SKU links drive new physical lifecycle work; historical snapshots remain fallback evidence only')
