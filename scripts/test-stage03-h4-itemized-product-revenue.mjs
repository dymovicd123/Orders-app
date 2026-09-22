import fs from 'node:fs'

const read = (path) => fs.readFileSync(path, 'utf8')
const check = (condition, message) => { if (!condition) throw new Error(message) }

const finance = read('worker/domains/finance-reports.ts')
const ui = read('src/features/renderers/FinanceReportContentRenderer.tsx')
const manifest = JSON.parse(read('scripts/stage03-h4-itemized-product-revenue-worker-manifest.json'))

check(manifest?.version === 1 && manifest?.revision === 'stage03-h4-itemized-product-revenue', 'H4 structural manifest missing')
check(Object.keys(manifest.files || {}).join(',') === 'worker/domains/finance-reports.ts', 'H4 Worker allow-list widened')
check(finance.includes("await isOrderPricingFoundationEnabled(db)"), 'Product report must detect 0073 safely before selecting pricing_mode')
check(finance.includes("CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.line_total ELSE 0 END"), 'Exact itemized product revenue must sum persisted line_total')
check(finance.includes('AS itemized_gross_sales'), 'Exact itemized product gross-sales field missing')
check(finance.includes("COUNT(DISTINCT CASE WHEN o.pricing_mode = 'itemized_v1' THEN oi.order_id END) AS itemized_order_count"), 'Itemized exact-order coverage count missing')
check(finance.includes("COUNT(DISTINCT CASE WHEN COALESCE(o.pricing_mode, 'legacy_manual_total') <> 'itemized_v1' THEN oi.order_id END) AS legacy_order_count"), 'Legacy ambiguity count missing')
check(finance.includes('0 AS itemized_gross_sales') && finance.includes('0 AS itemized_order_count'), 'Pre-0073 product report fallback must remain safe')
check(finance.includes('COALESCE(SUM(o.total_amount), 0) AS order_sales'), 'Legacy compatibility field must remain unchanged for existing callers')
check(!finance.includes('catalog_execution_prices'), 'Product reporting must never read mutable current Catalog price')
check(!finance.includes('catalog_price_snapshot'), 'Product revenue must use sold line_total, not Catalog recommendation snapshot')
check(!ui.includes('itemized_gross_sales'), 'H4 must not expose new product revenue UI before client/report policy is agreed')
check(!ui.includes('order_sales'), 'Unsafe legacy order_sales must remain hidden')

console.log('STAGE03-H4 ITEMIZED PRODUCT REVENUE PASSED — future itemized orders have exact gross product sales from persisted line totals, legacy ambiguity remains explicit, pre-0073 reports stay safe, and UI remains unchanged')
