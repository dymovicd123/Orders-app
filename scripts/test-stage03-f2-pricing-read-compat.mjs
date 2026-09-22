import fs from 'node:fs'
const read=(p)=>fs.readFileSync(p,'utf8')
const check=(c,m)=>{if(!c)throw new Error(m)}
const w=read('wrangler.jsonc'), r=read('worker/domains/orders-relations.ts'), o=read('worker/domains/orders-read.ts'), g=read('worker/domains/orders-write.ts'), a=read('src/App.tsx'), f=read('worker/domains/finance-reports.ts')
check(w.includes('"database_name": "orders_db_branch2"')&&w.includes('"database_id": "40065052-854e-44b8-bcd5-251bdd488301"')&&!w.includes('orders_db_prod'),'Branch2 isolation')
check(r.includes('isOrderPricingFoundationEnabled')&&r.includes('(SELECT pricing_mode FROM orders LIMIT 1)')&&r.includes('(SELECT catalog_price_snapshot FROM order_items LIMIT 1)'),'0073 probe missing')
check(o.includes("'legacy_manual_total' AS pricing_mode")&&g.includes("'legacy_manual_total' AS pricing_mode"),'pre-0073 legacy fallback missing')
check(o.includes("pricing_mode: order.pricing_mode === 'itemized_v1' ? 'itemized_v1' : 'legacy_manual_total'")&&g.includes("pricing_mode: order.pricing_mode === 'itemized_v1' ? 'itemized_v1' : 'legacy_manual_total'"),'pricing mode projection missing')
check(o.includes('catalogPriceSnapshot: (item as any).catalog_price_snapshot == null ? null')&&g.includes('catalogPriceSnapshot: (item as any).catalog_price_snapshot == null ? null'),'snapshot projection missing')
check(o.includes("pricing_mode: 'legacy_manual_total'"),'retained legacy marker missing')
check(!o.includes('catalog_execution_prices')&&!/UPDATE\s+orders\s+SET\s+pricing_mode/i.test(g)&&!/SET[\\s\\S]{0,240}catalog_price_snapshot\s*=/i.test(g),'read path widened into repricing/write')
check(!a.includes('catalogPriceSnapshot:'),'UI write activated too early')
check(!f.includes('catalog_execution_prices'),'Finance repricing introduced')
console.log('STAGE03-F2 PRICING READ COMPAT PASSED — legacy-safe before 0073, metadata-readable after 0073, no pricing writes/autofill/report repricing')
