import fs from 'node:fs'

const source = fs.readFileSync('worker/domains/inventory-stocktake.ts', 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const start = source.indexOf('export async function createInventoryStocktakeSession(')
const end = source.indexOf('export async function saveInventoryStocktakeCount(', start)
check(start >= 0 && end > start, 'createInventoryStocktakeSession block missing')
const block = source.slice(start, end)

check(block.includes("LEFT JOIN catalog_products p ON p.id = v.product_id"), 'New stocktake does not resolve the current canonical product')
check(block.includes("COALESCE(NULLIF(p.name, ''), s.product_name_snapshot)"), 'New stocktake still snapshots the stale inventory_stock product name first')
check(block.includes("COALESCE(v.product_id, s.product_id)"), 'New stocktake does not prefer the variant current product link')
check(block.includes("OR (COALESCE(v.is_active, 0) = 1 AND COALESCE(p.is_active, 0) = 1)"), 'New stocktake no longer requires a valid active current catalog link')
check(block.includes("s.variant_id IS NULL"), 'Legacy/orphan stock rows lost their snapshot fallback path')
check(!/UPDATE\s+inventory_stock\s+SET\s+product_name_snapshot/i.test(block), 'Starting a stocktake must not rewrite live inventory_stock snapshots')

console.log('STAGE01 STOCKTAKE CANONICAL SEED R20 PASSED — new sessions capture current catalog identity while existing stock snapshots remain untouched fallback evidence')
