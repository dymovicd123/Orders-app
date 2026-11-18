import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const config=fs.readFileSync('wrangler.jsonc','utf8')
assert(config.includes('"name": "orders-app"'))
assert(config.includes('"database_name": "orders_db_prod"'))
assert(config.includes('"database_id": "17e68a41-1d58-4a36-8a63-47c3e32443c4"'))
assert(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)
const external='ORD-20261115101428-19D3A8C8'
const orders=Object.freeze({
  order: `SELECT o.id order_id, o.order_status, o.shipping_status, o.archived_at, oi.id item_id, oi.product_id, oi.variant_id, oi.product_name_snapshot name, oi.audience_type, oi.gender_snapshot gender, oi.color_snapshot color, oi.material_snapshot material, oi.length_snapshot length, oi.size_snapshot size, oi.quantity, oi.source_type, oi.stock_writeoff_status, oi.is_workshop, r.id reservation_id, r.status reservation_status, r.unresolved_reason, r.quantity reserved_quantity, r.variant_id reservation_variant_id, r.product_id reservation_product_id, r.inventory_source reservation_source FROM orders o JOIN order_items oi ON oi.order_id=o.id LEFT JOIN inventory_reservations r ON r.order_item_id=oi.id WHERE o.external_id='${external}' ORDER BY oi.id LIMIT 30`,
  catalog: `SELECT p.id product_id,p.name,p.is_active product_active,p.gender_scope,sp.id execution_id,sp.is_active execution_active,sp.material,sp.length,v.id variant_id,v.is_active variant_active,v.category,v.gender,v.color,v.size_label FROM catalog_products p LEFT JOIN catalog_stock_positions sp ON sp.product_id=p.id LEFT JOIN catalog_variants v ON v.stock_position_id=sp.id WHERE p.name LIKE 'КЕРБЕЗ%' ORDER BY p.id,sp.id,v.id LIMIT 80`,
  references: "SELECT kind,value,is_active FROM reference_values WHERE (kind='size' AND value IN ('СТАНДАРТ','БЕЗ РАЗМЕРА')) OR (kind='color' AND value='ОРАНЖЕВЫЙ') OR (kind='material' AND value='ДАК') ORDER BY kind,value",
  stock: "SELECT s.variant_id,s.inventory_source,s.quantity,s.reserved_quantity FROM inventory_stock s JOIN catalog_variants v ON v.id=s.variant_id JOIN catalog_products p ON p.id=v.product_id WHERE p.name LIKE 'КЕРБЕЗ%' LIMIT 40",
  tables: "SELECT name FROM pragma_table_info('catalog_stock_positions') WHERE name IN ('gender_scope','material','length','is_active') UNION ALL SELECT name FROM pragma_table_info('inventory_reservations') WHERE name IN ('unresolved_reason','status','variant_id')",
})
function remoteRead(name,sql){
  assert(/^SELECT /i.test(sql),'Only read-only SELECT permitted')
  const run=spawnSync('npx',['--no-install','wrangler','d1','execute','orders_db_prod','--config','wrangler.jsonc','--remote','--command',sql,'--json'],{encoding:'utf8',timeout:90_000,maxBuffer:1024*1024*5})
  if(run.error || run.status!==0) throw new Error('READ_ONLY_QUERY_FAILED '+name+' '+String(run.error||run.stderr||'wrangler failed').slice(0,600))
  const response=JSON.parse(run.stdout.trim())
  assert(Array.isArray(response)&&response[0]?.success===true,'D1 SQL failed: '+name)
  const rows=response[0]?.results||[]
  console.log('KERBEZ_PROD_READ_ONLY '+name+' '+JSON.stringify(rows))
}
for(const [name,sql] of Object.entries(orders))remoteRead(name,sql)
console.log('KERBEZ_PROD_READ_ONLY_COMPLETE; NO D1 WRITES')
