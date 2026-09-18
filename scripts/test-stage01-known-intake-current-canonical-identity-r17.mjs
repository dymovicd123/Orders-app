import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/warehouse-attention.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function getWarehouseAttentionSummary(')
check(start >= 0, 'getWarehouseAttentionSummary missing')
const fn = source.slice(start)

check(fn.includes('WITH pending_lifecycle AS ('), 'Known-intake attention no longer isolates pending lifecycle rows before canonical projection')
check(fn.includes('LEFT JOIN catalog_variants exact_variant ON exact_variant.id = pending_lifecycle.exact_variant_id'), 'Known-intake attention does not load the exact current canonical variant')
check(fn.includes('LEFT JOIN catalog_products exact_product ON exact_product.id = exact_variant.product_id'), 'Known-intake attention does not load the exact current canonical product')
check(fn.includes('exact_product.name AS exact_product_name'), 'Known-intake attention lacks current canonical product label')
check(fn.includes('exact_variant.size_label AS exact_size'), 'Known-intake attention lacks current canonical SKU details')

check(fn.includes("const exactKnown = Boolean(exactVariantId && cleanText(row.direction) === 'in')"), 'Known intake classification drifted')
check(fn.includes("productName: exactKnown ? (cleanText(row.exact_product_name) || cleanText(row.product_name_snapshot)) : cleanText(row.product_name_snapshot)"), 'Known intake still displays event-time product snapshot before current canonical identity')
check(fn.includes("size: exactKnown ? (cleanText(row.exact_size) || cleanText(row.size_snapshot)) : cleanText(row.size_snapshot)"), 'Known intake still displays event-time SKU size before current canonical identity')
check(fn.includes("productId: exactKnown ? (toInt(row.exact_product_id, 0) || toInt(row.product_id, 0) || null)"), 'Known intake product FK is not aligned with the exact current variant')
check(fn.includes('variantId: exactVariantId || toInt(row.variant_id, 0) || null'), 'Known intake exact current variant FK is not published')

// Unresolved lifecycle review is intentionally historical/evidence-first until identity is known.
check(fn.includes(": cleanText(row.product_name_snapshot)"), 'Unresolved lifecycle rows stopped retaining event-time product evidence')
check(fn.includes(": normalizeAudienceCategory(row.audience_type, row.size_snapshot)"), 'Unresolved lifecycle rows stopped retaining event-time category evidence')
check(fn.includes(": cleanText(row.size_snapshot)"), 'Unresolved lifecycle rows stopped retaining event-time SKU evidence')

// R17 is read-model only.
check(!/UPDATE\s+inventory_lifecycle_events/i.test(fn), 'R17 unexpectedly rewrites lifecycle event history')
check(!/UPDATE\s+order_items/i.test(fn), 'R17 unexpectedly mutates order item identity')

console.log('STAGE01 KNOWN INTAKE CURRENT CANONICAL IDENTITY R17 PASSED — direct known-intake actions show the exact current SKU while unresolved lifecycle rows keep event-time snapshot evidence')
