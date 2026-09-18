import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/warehouse-attention.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function getWarehouseAttentionSummary(')
check(start >= 0, 'getWarehouseAttentionSummary missing')
const fn = source.slice(start)

check(fn.includes('WITH found_stock AS ('), 'Found-stock attention no longer isolates unresolved stock rows before current identity projection')
check(fn.includes('LEFT JOIN catalog_variants exact_variant ON exact_variant.id = found_stock.exact_variant_id'), 'Found-stock attention does not load the exact current canonical variant')
check(fn.includes('LEFT JOIN catalog_products exact_product ON exact_product.id = exact_variant.product_id'), 'Found-stock attention does not load the exact current canonical product')
check(fn.includes('exact_product.name AS exact_product_name'), 'Found-stock attention lacks current canonical product label')
check(fn.includes('exact_variant.size_label AS exact_size'), 'Found-stock attention lacks current canonical SKU details')

const foundStart = fn.indexOf('found: (foundResult.results || []).map')
const stocktakesStart = fn.indexOf('stocktakes:', foundStart)
check(foundStart >= 0 && stocktakesStart > foundStart, 'Found-stock response projection missing')
const found = fn.slice(foundStart, stocktakesStart)

check(found.includes('const exactVariantId = toInt(row.exact_variant_id, 0)'), 'Found-stock projection lost exact variant identity')
check(found.includes('const exactKnown = Boolean(exactVariantId)'), 'Found-stock exact-known flag drifted')
check(found.includes("productName: exactKnown ? (cleanText(row.exact_product_name) || cleanText(row.product_name_snapshot)) : cleanText(row.product_name_snapshot)"), 'Direct found-stock binding still shows stale product snapshot before current canonical identity')
check(found.includes("size: exactKnown ? (cleanText(row.exact_size) || cleanText(row.size_snapshot)) : cleanText(row.size_snapshot)"), 'Direct found-stock binding still shows stale SKU size before current canonical identity')
check(found.includes("productId: exactKnown ? (toInt(row.exact_product_id, 0) || toInt(row.product_id, 0)) : toInt(row.product_id, 0)"), 'Found-stock current product FK is not aligned with the exact variant')
check(found.includes('exactVariantId: exactVariantId || null'), 'Found-stock exact variant is not exposed to the live attention model')

// Rows without an exact candidate are still unresolved historical/evidence input.
check(found.includes(": cleanText(row.product_name_snapshot)"), 'Unresolved found-stock row stopped retaining snapshot product evidence')
check(found.includes(": normalizeAudienceCategory(row.category_snapshot, row.size_snapshot)"), 'Unresolved found-stock row stopped retaining snapshot category evidence')
check(found.includes(": cleanText(row.size_snapshot)"), 'Unresolved found-stock row stopped retaining snapshot SKU evidence')

// R18 is presentation/read-model only; the actual identity mutation remains in the existing reconcile endpoint.
check(!/UPDATE\s+inventory_stock/i.test(fn), 'R18 unexpectedly mutates stock from the Warehouse Attention read path')
check(!/UPDATE\s+catalog_/i.test(fn), 'R18 unexpectedly mutates catalog data')

console.log('STAGE01 FOUND STOCK CURRENT CANONICAL IDENTITY R18 PASSED — exact found-stock candidates show the current SKU before direct binding while unresolved rows retain snapshot evidence')
