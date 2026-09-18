import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const relations = read('worker/domains/orders-relations.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const ordersWrite = read('worker/domains/orders-write.ts')
const catalogReview = read('worker/domains/catalog-review.ts')
const types = read('src/app/types.ts')
const details = read('src/features/sections/OrderDetailsSection.tsx')

check(relations.includes('export function canonicalItemProjection'), 'Shared canonical item projection is missing')
check(relations.includes("catalogIdentity: hasCanonicalVariant ? 'variant' : (hasCanonicalProduct ? 'product' : 'snapshot')"), 'Canonical item projection lost explicit identity levels')
check(relations.includes("productName: (hasCanonicalProduct ? canonicalProductName : '') || originalSnapshot.productName"), 'Resolved product name is not canonical-first')
check(relations.includes("gender: hasCanonicalVariant ? (cleanText(item.canonical_gender) || originalSnapshot.gender) : originalSnapshot.gender"), 'Exact SKU gender is not canonical-first with snapshot fallback')
check(relations.includes("color: hasCanonicalVariant ? (cleanText(item.canonical_color) || originalSnapshot.color) : originalSnapshot.color"), 'Exact SKU color is not canonical-first with snapshot fallback')
check(relations.includes('originalSnapshot,'), 'Order-time item snapshot is no longer exposed separately')

for (const [name, source] of [['listOrders', ordersRead], ['getOrder', ordersWrite]]) {
  check(source.includes("import { canonicalItemProjection, fetchOrderRelations, workshopTaskStatusForOrderItem }"), name + ' does not import the shared canonical projection')
  check(source.includes('...canonicalItemProjection(item as Record<string, unknown>)'), name + ' does not use the shared canonical projection')
}

check(types.includes("catalogIdentity?: 'snapshot' | 'product' | 'variant'"), 'Frontend OrderRecord does not expose catalog identity state')
check(types.includes('originalSnapshot?: {'), 'Frontend OrderRecord does not preserve original item snapshot')
check(details.includes('Изначально при оформлении:'), 'Order details do not surface changed historical input separately')
check(details.includes('originalTitle !== currentTitle'), 'Order details should hide duplicate historical text when canonical and original values match')

const resolverStart = catalogReview.indexOf('async function resolveCatalogReviewRows')
const resolverEnd = catalogReview.indexOf('export async function reconcileCatalogReviewQueue', resolverStart)
check(resolverStart >= 0 && resolverEnd > resolverStart, 'Resolver row helper not found')
const resolverRows = catalogReview.slice(resolverStart, resolverEnd)
check(resolverRows.includes('UPDATE order_items SET product_id = ?, variant_id = ? WHERE id = ?'), 'Resolver no longer links exact canonical product/SKU')
check(!resolverRows.includes('product_name_snapshot ='), 'Normal Resolver path must not rewrite historical product snapshot')
check(!resolverRows.includes('gender_snapshot ='), 'Normal Resolver path must not rewrite historical SKU snapshot')

console.log('STAGE01 CANONICAL ITEM PROJECTION R2 PASSED — working orders follow current catalog identity while original snapshots remain separate history')
