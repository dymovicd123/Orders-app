import fs from 'node:fs'

const read = path => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const migration = read('migrations/0074_v72_retained_order_pricing_mode.sql')
const storage = read('worker/domains/storage.ts')
const ordersRead = read('worker/domains/orders-read.ts')
const manifest = JSON.parse(read('scripts/stage03-h6h-retained-pricing-mode-worker-manifest.json'))

check(manifest?.version === 1 && manifest?.revision === 'stage03-h6h-retained-pricing-mode', 'H6H Worker manifest missing')
check(Object.keys(manifest.files || {}).sort().join(',') === ['worker/domains/orders-read.ts','worker/domains/storage.ts'].sort().join(','), 'H6H Worker allow-list widened')

check(migration.includes('ALTER TABLE retained_order_summaries'), '0074 must extend retained summaries additively')
check(migration.includes("DEFAULT 'legacy_manual_total'"), 'Existing retained history must default to legacy classification')
check(migration.includes("'itemized_v1'"), '0074 itemized retained classification missing')
check(!migration.includes('UPDATE orders') && !migration.includes('UPDATE order_items') && !migration.includes('catalog_execution_prices'), '0074 must not reprice or rewrite live orders')

check(storage.includes('export async function isRetainedOrderPricingModeEnabled'), 'Pre-0074 retained capability check missing')
check(storage.includes("SELECT pricing_mode FROM retained_order_summaries LIMIT 1"), 'Retained capability probe missing')
check(storage.includes("retainedPricingModeEnabled ? ', pricing_mode' : ''"), 'Storage cleanup must remain pre-0074 safe')
check(storage.includes("COALESCE(o.pricing_mode, 'legacy_manual_total')"), 'Post-0074 retained summary must copy persisted order pricing mode')
check(storage.includes("pricing_mode = excluded.pricing_mode"), 'Retained summary upsert must preserve pricing mode on retry')
check(storage.includes("await deleteByNumericIds(db, 'order_items', 'order_id', orderIds)"), 'Storage cleanup detailed-item retention boundary unexpectedly changed')

check(ordersRead.includes("cleanText(row.pricing_mode) === 'itemized_v1' ? 'itemized_v1' : 'legacy_manual_total'"), 'Retained read must preserve itemized classification and safely fall back for older rows')
check(!storage.includes('catalog_execution_prices'), 'Storage cleanup must never reinterpret history from current Catalog')
check(!storage.includes('catalog_price_snapshot'), 'Compact retained summary must not invent a Catalog snapshot after detailed rows are intentionally deleted')

console.log('STAGE03-H6H RETAINED PRICING MODE PASSED — compact storage history preserves itemized vs legacy classification after 0074, remains safe before migration, and never reprices retained history from current Catalog')
