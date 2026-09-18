import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/workshop.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

check(source.includes("import { canonicalItemProjection } from './orders-relations.ts'"), 'Workshop read path does not use shared canonical item projection')

const start = source.indexOf('export async function enrichWorkshopTaskRowsFromOrderItems(')
const end = source.indexOf('export const workshopStandaloneReturnOrdersCte', start)
check(start >= 0 && end > start, 'Workshop enrichment function missing')
const fn = source.slice(start, end)

check(fn.includes('p_direct.name AS canonical_product_name'), 'Workshop enrichment does not load canonical product name')
check(fn.includes('COALESCE(cv_direct.category, p_direct.category) AS direct_category'), 'Workshop enrichment does not load canonical product/category identity')
check(fn.includes('oi.variant_id') && fn.includes('COALESCE(oi.variant_id, cv_fallback.id) AS resolved_variant_id'), 'Workshop enrichment lost distinction between exact linked variant and legacy inferred fallback')
check(fn.includes('const projection = canonicalItemProjection({'), 'Workshop enrichment does not call shared canonical projection')
check(fn.includes('resolved_product_name: projection.productName'), 'Workshop live product name is not canonical-first')
check(fn.includes('resolved_gender: projection.gender') && fn.includes('resolved_size: projection.size'), 'Workshop exact SKU display is not projected through canonical item truth')
check(!fn.includes('variant_id: row.resolved_variant_id'), 'Legacy inferred Workshop variant is being promoted into canonical exact-SKU identity')
check(fn.includes('product_name_snapshot: cleanText(matchedItem?.resolved_product_name) || cleanText(matchedItem?.product_name_snapshot) || cleanText(row.product_name_snapshot)'), 'Workshop live task output still prefers historical name over repaired canonical product identity')

// This is read-model-only: immutable order/task snapshots remain stored and used for matching/fallback.
check(!fn.includes('UPDATE order_items'), 'Workshop canonical read projection unexpectedly mutates order item history')
check(!fn.includes('UPDATE workshop_tasks'), 'Workshop canonical read projection unexpectedly mutates Workshop snapshots')

console.log('STAGE01 WORKSHOP CANONICAL ITEM R9 PASSED — live Workshop identity follows shared canonical projection while legacy inferred variants and immutable snapshots remain fallback/matching evidence')
