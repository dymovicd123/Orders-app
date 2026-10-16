// Production SELECT ONLY: investigate screenshot Enlik Shapan orange size 46, Sep 30 reservation,
// verify whether last physical checkpoint is skipped because order has no workshop item.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {execFileSync} from 'node:child_process'
assert.equal(process.env.GITHUB_EVENT_NAME,'pull_request')
assert.equal(process.env.GITHUB_BASE_REF,'main')
const cfg=process.env.PROD_READONLY_CONFIG
assert(fs.readFileSync(cfg,'utf8').includes('17e68a41-1d58-4a36-8a63-47c3e32443c4'))
function read(sql){
 assert(/^SELECT\s/i.test(sql)&&!sql.includes(';'),'SELECT only')
 const x=JSON.parse(execFileSync('npx',['wrangler','d1','execute','orders_db_prod','--remote','--config',cfg,'--command='+sql,'--json'],{encoding:'utf8',timeout:90000,maxBuffer:8*1024*1024}))
 assert(x.length===1&&x[0].success===true,'query')
 return x[0].results
}
const orders=read("SELECT o.id,o.external_id,o.order_date,o.created_at,o.shipping_status,o.order_status,COUNT(DISTINCT CASE WHEN oi.is_workshop=1 THEN oi.id END) workshop_items FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.external_id IN ('ORD-20260930104804-75083DC1','ORD-20261010112750-53AFEE6F','ORD-20261016084336-9F7356B7') GROUP BY o.id ORDER BY o.order_date")
const ids=orders.map(x=>x.id).filter(Number.isSafeInteger)
assert(ids.length>=1,'No screenshot orders')
const items=read("SELECT oi.id item_id,oi.order_id,oi.variant_id,oi.is_workshop,oi.quantity,oi.created_at,oi.inventory_obligation_origin_at,oi.stock_writeoff_status,oi.product_name_snapshot,oi.color_snapshot,oi.size_snapshot,r.id reservation_id,r.status reservation_status,r.inventory_source,r.variant_id reserved_variant,r.quantity reserved_quantity,r.created_at reservation_created_at FROM order_items oi LEFT JOIN inventory_reservations r ON r.order_item_id=oi.id WHERE oi.order_id IN ("+ids.join(",")+") AND oi.quantity>0 ORDER BY oi.order_id,oi.id")
const targetItems=items.filter(x=>String(x.product_name_snapshot||'').toUpperCase().includes('ЕНЛ') && String(x.color_snapshot||'').toUpperCase().includes('ОРАНЖ') && String(x.size_snapshot||'')==='46')
console.log('ENLIK_TARGET_CHECK='+JSON.stringify({orders,orderItems:items.map(x=>({itemId:x.item_id,orderId:x.order_id,product:x.product_name_snapshot,color:x.color_snapshot,size:x.size_snapshot,reserveVariant:x.reserved_variant,reserveStatus:x.reservation_status}))}))
const variants=[...new Set((targetItems.length?targetItems:items).map(x=>x.reserved_variant).filter(Number.isSafeInteger))]
const current=read('SELECT id,variant_id,inventory_source,quantity,reserved_quantity FROM inventory_stock WHERE variant_id IN ('+variants.join(',')+') ORDER BY id')
const events=read("SELECT id,variant_id,inventory_source,checked_at,check_type,reference_type,reference_id,counted_quantity,expected_quantity FROM inventory_stock_checks WHERE variant_id IN ("+variants.join(",")+") AND checked_at>='2026-09-20' ORDER BY checked_at DESC,id DESC LIMIT 80")
const sessions=read("SELECT id,inventory_source,status,started_at,completed_at FROM inventory_stocktake_sessions WHERE status='completed' AND completed_at>='2026-09-20' ORDER BY completed_at DESC LIMIT 25")
const reviews=read('SELECT hr.order_id,hr.order_item_id,hr.reservation_id,hr.checkpoint_id,hr.checkpoint_at,hr.decision FROM inventory_handover_reviews hr WHERE hr.order_id IN ('+ids.join(',')+') ORDER BY hr.id DESC')
const results={orders,items:targetItems.map(x=>({itemId:x.item_id,orderId:x.order_id,variantId:x.variant_id,origin:x.inventory_obligation_origin_at||x.created_at,reservationId:x.reservation_id,reserveStatus:x.reservation_status,reservedVariant:x.reserved_variant,source:x.inventory_source,quantity:x.quantity,reservedQuantity:x.reserved_quantity,stockWriteoff:x.stock_writeoff_status})),stock:current,checks:events.map(x=>({id:x.id,variantId:x.variant_id,source:x.inventory_source,at:x.checked_at,type:x.check_type,reference:x.reference_type})),sessions:sessions.slice(0,12),existingReviews:reviews}
console.log('ENLIK_SEPT_ORDER_HANDBACK_AUDIT='+JSON.stringify(results))
console.log('ENLIK_SEPT_ORDER_READONLY_DONE')
