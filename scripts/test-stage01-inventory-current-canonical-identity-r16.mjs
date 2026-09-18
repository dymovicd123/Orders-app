import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/inventory-read.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function listInventory(')
const end = source.indexOf('export type InventoryAuditExpected', start)
check(start >= 0 && end > start, 'listInventory block missing')
const listInventory = source.slice(start, end)

check(listInventory.includes("LEFT JOIN catalog_variants active_variant ON active_variant.id = s.variant_id"), 'Live inventory no longer resolves current canonical variant identity')
check(listInventory.includes("LEFT JOIN catalog_products active_product ON active_product.id = COALESCE(active_variant.product_id, s.product_id)"), 'Live inventory no longer resolves current canonical product identity')
check(listInventory.includes("COALESCE(NULLIF(active_product.name, ''), s.product_name_snapshot) AS working_product_name"), 'Live stock product label does not prefer current catalog identity')
check(listInventory.includes("CASE WHEN active_variant.id IS NOT NULL THEN COALESCE(NULLIF(active_variant.size_label, ''), s.size_snapshot) ELSE s.size_snapshot END AS working_size"), 'Live stock SKU label does not use exact current variant with snapshot fallback')
check(listInventory.includes("productName: cleanText(row.working_product_name) || cleanText(row.product_name_snapshot)"), 'Inventory API still publishes stale stock product snapshot first')
check(listInventory.includes("size: cleanText(row.working_size) || cleanText(row.size_snapshot)"), 'Inventory API still publishes stale stock size snapshot first')

const searchStart = listInventory.indexOf('const searchableSql =')
const stockStart = listInventory.indexOf('const stockSql =', searchStart)
check(searchStart >= 0 && stockStart > searchStart, 'Inventory search block missing')
const searchBlock = listInventory.slice(searchStart, stockStart)
check(searchBlock.includes("COALESCE(active_product.name, '')"), 'Inventory search cannot find a current canonical product name')
check(searchBlock.includes("COALESCE(active_variant.size_label, '')"), 'Inventory search cannot find a current canonical SKU value')
check(searchBlock.includes("COALESCE(s.product_name_snapshot, '')"), 'Inventory search stopped preserving old stock snapshot vocabulary')

check(listInventory.includes("ORDER BY working_product_name"), 'Live inventory sorting still follows stale stock snapshot identity')

// Inventory movements are historical physical evidence and must stay event-time snapshot based.
const movementsStart = listInventory.indexOf('movements: (movements.results || []).map')
check(movementsStart >= 0, 'Historical movement projection missing')
const movementsBlock = listInventory.slice(movementsStart)
check(movementsBlock.includes('productName: cleanText(row.product_name_snapshot)'), 'Historical movement product snapshot was converted to current catalog identity')
check(movementsBlock.includes('size: cleanText(row.size_snapshot)'), 'Historical movement SKU snapshot was converted to current catalog identity')

// R16 is a read-model change only.
check(!/UPDATE\s+inventory_stock/i.test(listInventory), 'R16 unexpectedly mutates live stock rows')
check(!/UPDATE\s+inventory_movements/i.test(listInventory), 'R16 unexpectedly mutates historical movement rows')

console.log('STAGE01 INVENTORY CURRENT CANONICAL IDENTITY R16 PASSED — live stock/search/sort follow current catalog identity while inventory movement history remains immutable snapshot evidence')
