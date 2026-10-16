// Production read-only preflight for user-confirmed historical issue order #1658.
// No customer names, addresses, contact data, or mutable SQL. PR-only.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

assert.equal(process.env.GITHUB_ACTIONS, 'true')
assert.equal(process.env.GITHUB_EVENT_NAME, 'pull_request')
assert.equal(process.env.GITHUB_BASE_REF, 'main')
const config = process.env.PROD_READONLY_CONFIG
assert(config && fs.readFileSync(config,'utf8').includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'), 'Wrong D1 identity')

function select(sql) {
  assert(/^SELECT\s/i.test(sql) && !sql.includes(';'), 'Only a single SELECT allowed')
  const result = JSON.parse(execFileSync('npx',[
    'wrangler','d1','execute','orders_db_prod','--remote','--config',config,
    '--command='+sql,'--json'
  ],{encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024}))
  assert(result.length===1 && result[0].success===true && Array.isArray(result[0].results),'Remote SELECT failed')
  return result[0].results
}
const order = select("SELECT id,external_id,order_date,created_at,order_status,archived_at,shipping_status FROM orders WHERE id=1658")
const items = select("SELECT id,order_id,variant_id,quantity,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_origin_at FROM order_items WHERE order_id=1658 ORDER BY id")
const sku = select("SELECT v.id,v.product_id,v.gender,v.color,v.material,v.length,v.size_label,v.is_active,p.name AS product_name FROM catalog_variants v JOIN catalog_products p ON p.id=v.product_id WHERE v.id=240")
const stock = select("SELECT id,inventory_source,variant_id,quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=240")
const reserves = select("SELECT id,order_id,order_item_id,inventory_source,variant_id,quantity,status,created_at,fulfilled_at,released_at FROM inventory_reservations WHERE inventory_source='warehouse' AND variant_id=240 ORDER BY id")
const checks = select("SELECT id,checked_at,check_type,reference_type,reference_id,inventory_source,variant_id FROM inventory_stock_checks WHERE inventory_source='warehouse' AND variant_id=240 AND checked_at>='2026-09-30' ORDER BY datetime(checked_at) DESC,id DESC LIMIT 30")
const reviews = select("SELECT id,order_id,order_item_id,reservation_id,decision,checkpoint_id,checkpoint_at,reviewed_at FROM inventory_handover_reviews WHERE order_id=1658 ORDER BY id DESC")
const activeStocktakes = select("SELECT id,inventory_source,status,started_at FROM inventory_stocktake_sessions WHERE inventory_source='warehouse' AND status='active' ORDER BY started_at DESC LIMIT 10")
const fullStocktakes = select("SELECT id,inventory_source,status,started_at,completed_at FROM inventory_stocktake_sessions WHERE inventory_source='warehouse' AND status='completed' AND completed_at>='2026-09-30' AND id NOT LIKE 'REV-%-P-%' ORDER BY datetime(completed_at) DESC LIMIT 10")
const audit={
  order, items, sku, stock,
  reservations:reserves,
  reviews,
  latestExactChecks:checks,
  activeStocktakes,
  fullStocktakes
}
console.log('ORDER_1658_PRODUCTION_SELECT_ONLY_PREFLIGHT='+JSON.stringify(audit))
const ownItems = new Set(items.map(x=>Number(x.id)))
const target = reserves.filter(r=>Number(r.order_id)===1658 && ownItems.has(Number(r.order_item_id)))
const active = reserves.filter(r=>r.status==='active')
const sum = active.reduce((n,r)=>n+Number(r.quantity||0),0)
const result={
  targetOrderPresent:order.length===1 && order[0].id===1658,
  stillNotSent:order.length===1 && order[0].shipping_status!=='sent',
  targetReservationCount:target.length,
  targetReserves:target.map(r=>({id:r.id,itemId:r.order_item_id,status:r.status,quantity:r.quantity})),
  physicalStock:stock.length===1?stock[0].quantity:null,
  stockReserved:stock.length===1?stock[0].reserved_quantity:null,
  derivedActiveReserveTotal:sum,
  activeReservationCount:active.length,
  recordedReviewCount:reviews.length,
  latestExactCheckpoint:checks[0]?.id??null,
  activeWarehouseStocktakes:activeStocktakes.length,
  integrityMatches:stock.length===1 && Number(stock[0].reserved_quantity)===sum
}
console.log('ORDER_1658_PREFLIGHT_SUMMARY='+JSON.stringify(result))
assert(result.targetOrderPresent,'Order missing')
assert(result.stillNotSent,'Order already marked sent, do not repeat')
assert(sku.length===1 && Number(sku[0].id)===240,'Variant identity changed')
assert(target.length===1 && target[0].status==='active' && Number(target[0].quantity)===1,'Order target reserve changed')
assert(stock.length===1 && result.integrityMatches,'Stock missing or reserved drift')
assert(result.activeWarehouseStocktakes===0,'Active revision: do not confirm now')
assert(reviews.length===0,'Already has review records: inspect before clicking again')
assert(checks.length>0,'No physical checkpoint found')
console.log('ORDER_1658_SELECT_ONLY_PRECHECK_PASSED; no production writes; refresh once more immediately before employee action.')
