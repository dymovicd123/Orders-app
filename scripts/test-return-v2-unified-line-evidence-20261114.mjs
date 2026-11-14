import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'
import { previewUnifiedReturnV2LineEvidence } from '../worker/domains/return-v2-unified-line-evidence.ts'

const sql=new DatabaseSync(':memory:')
for(const m of fs.readdirSync('migrations').filter(x=>/^\d{4}.*\.sql$/.test(x)).sort()){
  sql.exec(fs.readFileSync('migrations/'+m,'utf8'))
}
if(!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const stmt=(q,a=[])=>({
  bind(...args){return stmt(q,args)},
  async first(){return sql.prepare(q).get(...a)??null},
  async all(){return{results:sql.prepare(q).all(...a)}},
  async run(){const r=sql.prepare(q).run(...a);return{meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}},
})
const DB={
  prepare:q=>stmt(q),
  async batch(statements){
    sql.exec('SAVEPOINT stage5_http')
    try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('RELEASE stage5_http');return out}
    catch(e){sql.exec('ROLLBACK TO SAVEPOINT stage5_http');sql.exec('RELEASE stage5_http');throw e}
  },
}
const token='stage5-http-session',tokenHash=createHash('sha256').update(token).digest('base64url')
sql.prepare("INSERT OR IGNORE INTO managers(id,name,is_active) VALUES(9501,'Test manager',1)").run()
sql.prepare("INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9501,'stage5person','test-stage5@invalid','not-used','manager',9501,'Test manager',1,0)").run()
sql.prepare("INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(9501,?,'2099-01-01')").run(tokenHash)
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(9521,'STAGE 5 TEST WAREHOUSE','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9531,9521,'МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46','adult',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9541,'warehouse',9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',5,3)").run()
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9551,'ORD-TEST-STAGE5-HTTP','2026-11-01',9501,'active','warehouse','ready','not_sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(9561,9551,9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',3,2000,6000,0,'warehouse','reserved','2026-11-01T00:00:00Z','stage5-http-original','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9551,9561,'warehouse',9521,9531,3,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active'").run()
async function api(method,path,body,expected=200,authenticated=true){
 const headers={...(authenticated?{Cookie:'orders_session='+token}:{}),...(body?{'Content-Type':'application/json'}:{})}
 const response=await worker.fetch(new Request('https://test-only.invalid'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),{DB})
 const data=await response.json()
 assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(data))
 return data
}

const itemPrefix='/api/orders/9551/shipping'
sql.prepare("UPDATE orders SET total_amount=8000,pricing_mode='itemized_v1' WHERE id=9551").run()
sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES (9562,9551,9521,9531,'OTHER BOUTIQUE LINE',1,2000,2000,0,'boutique','reserved','2026-11-01T00:00:00Z','v2-evidence-boutique','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES (9542,'boutique',9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',2,1)").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9551,9562,'boutique',9521,9531,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()

const snapshot=()=>({
  order:{...sql.prepare('SELECT total_amount,updated_at,shipping_status FROM orders WHERE id=9551').get()},
  items:sql.prepare('SELECT id,quantity,line_total,stock_writeoff_status FROM order_items WHERE order_id=9551 ORDER BY id').all().map(r=>({...r})),
  stock:sql.prepare('SELECT id,quantity,reserved_quantity FROM inventory_stock WHERE id IN (9541,9542) ORDER BY id').all().map(r=>({...r})),
  reservations:sql.prepare('SELECT order_item_id,quantity,status FROM inventory_reservations WHERE order_id=9551 ORDER BY id').all().map(r=>({...r})),
  money:Number(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE order_id=9551').get().n),
  returns:Number(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9551').get().n),
  dispatches:Number(sql.prepare('SELECT COUNT(*) n FROM order_dispatches WHERE order_id=9551').get().n),
})
const snap0=snapshot()
const reserved=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(reserved.mode,'return_v2_unified_line_evidence')
assert.equal(reserved.readOnly,true)
assert.equal(reserved.commitAllowed,false)
assert.equal(reserved.allActiveQuantitiesSelectedByDefault,true)
assert.equal(reserved.lines.length,2)
assert.equal(reserved.summary.selectedQuantity,4)
assert.equal(reserved.summary.reservedCancellationQuantity,4)
assert.equal(reserved.summary.pendingPhysicalQuantity,0)
assert.equal(reserved.summary.selectedActiveReserveRelease,4)
assert.equal(reserved.summary.selectedSaleValue,8000)
assert.equal(reserved.summary.expectedImmediatePhysicalStockDelta,0)
assert.equal(reserved.summary.fullPurchaseTerminationCandidate,true)
assert(reserved.lines.every(x=>x.selectedQuantity===x.availableQuantity
 &&x.proposedAction==='cancel_unshipped_reservation'))
assert.deepEqual(snapshot(),snap0,'Stage1 preview must not alter inventory/reserve/order/money')

const ship=await api('POST',itemPrefix+'/dispatches',{
 requestId:'stage5-v2-evidence-dispatch-mixed-001',
 items:[{orderItemId:9561,quantity:2}],
})
assert.equal(ship.shippedQuantity,2)
const afterShip=snapshot()
assert.equal(afterShip.stock.find(r=>r.id===9541).quantity,3)
assert.equal(afterShip.stock.find(r=>r.id===9541).reserved_quantity,1)
assert.equal(afterShip.stock.find(r=>r.id===9542).quantity,2)
assert.equal(afterShip.stock.find(r=>r.id===9542).reserved_quantity,1)
const split=sql.prepare("SELECT id,quantity,unit_price,line_total,stock_writeoff_status FROM order_items WHERE order_id=9551 AND id NOT IN (9561,9562)").get()
assert(split&&split.quantity===1&&split.line_total===2000)
assert.equal(sql.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=9561').get().stock_writeoff_status,'fulfilled')
const shipped=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(shipped.lines.length,3)
const byId=id=>shipped.lines.find(x=>x.orderItemId===id)
assert.equal(byId(9561).proposedAction,'physical_return_pending')
assert.equal(byId(9561).status,'Отправлен — ожидаем физический возврат')
assert.equal(byId(9561).selectedQuantity,2)
assert.equal(byId(9561).dispatchedQuantity,2)
assert.equal(byId(9561).expectedPhysicalStockDelta,0)
assert.equal(byId(split.id).proposedAction,'cancel_unshipped_reservation')
assert.equal(byId(split.id).selectedQuantity,1)
assert.equal(byId(9562).proposedAction,'cancel_unshipped_reservation')
assert.equal(byId(9562).selectedQuantity,1)
assert.equal(shipped.summary.selectedQuantity,4,'Default selection includes sent and both unshipped siblings')
assert.equal(shipped.summary.pendingPhysicalQuantity,2)
assert.equal(shipped.summary.reservedCancellationQuantity,2)
assert.equal(shipped.summary.selectedActiveReserveRelease,2)
assert.equal(shipped.summary.selectedSaleValue,8000)
assert.equal(shipped.summary.requiresReviewQuantity,0)
assert.equal(shipped.summary.fullPurchaseTerminationCandidate,true)
assert.equal(shipped.summary.expectedImmediatePhysicalStockDelta,0)
assert.deepEqual(snapshot(),afterShip,'Mixed preview is strictly read-only')
assert.deepEqual(await previewUnifiedReturnV2LineEvidence(DB,9551),shipped,'Repeated previews deterministic')

const badReserveBefore=snapshot()
sql.prepare('UPDATE inventory_reservations SET quantity=2 WHERE order_item_id=9562 AND status=?').run('active')
const corrupted=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(corrupted.lines.find(x=>x.orderItemId===9562).proposedAction,'needs_review')
assert.equal(corrupted.lines.find(x=>x.orderItemId===9562).selectedQuantity,1,'Conflicted goods stay selected')
assert.equal(corrupted.summary.requiresReviewQuantity,1)
assert.equal(corrupted.summary.fullPurchaseTerminationCandidate,false)
assert.equal(corrupted.summary.selectedQuantity,4)
sql.prepare('UPDATE inventory_reservations SET quantity=1 WHERE order_item_id=9562 AND status=?').run('active')
assert.deepEqual(snapshot(),badReserveBefore)

const badDispatchBefore=snapshot()
sql.prepare("UPDATE inventory_reservations SET status='active' WHERE order_item_id=9561 AND status='fulfilled'").run()
const contradictory=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(contradictory.lines.find(x=>x.orderItemId===9561).reasonCode,'dispatch_or_reservation_mismatch')
assert.equal(contradictory.summary.requiresReviewQuantity,2)
assert.equal(contradictory.summary.selectedQuantity,4)
sql.prepare("UPDATE inventory_reservations SET status='fulfilled' WHERE order_item_id=9561 AND status='active'").run()
assert.deepEqual(snapshot(),badDispatchBefore)

async function insertReviewOrder(orderId,itemId,status,stockQty,resQty,workshop=0,shippingStatus='not_sent'){
 sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,pricing_mode,total_amount,created_at,updated_at) VALUES (?,?, '2026-11-01',9501,'active','warehouse','ready',?,'itemized_v1',3000,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run(orderId,'V2-EVIDENCE-'+orderId,shippingStatus)
 sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES (?,?,?,?,?,1,3000,3000,?,'warehouse',?,'2026-11-01T00:00:00Z',?,'2026-11-01T00:00:00Z')").run(itemId,orderId,9521,9531,'EDGE SCENARIO '+orderId,workshop,status,'edge-v2-'+orderId)
 if(stockQty){
  sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES (?,?,'warehouse',9521,9531,1,?,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run(orderId,itemId,resQty)
 }
 return await previewUnifiedReturnV2LineEvidence(DB,orderId)
}
const prior=await insertReviewOrder(9552,9563,'fulfilled',true,'fulfilled')
assert.equal(prior.lines[0].reasonCode,'issued_before_shipping_unconfirmed')
assert.equal(prior.lines[0].selectedQuantity,1)
assert.equal(prior.summary.requiresReviewQuantity,1)
assert.equal(prior.summary.expectedImmediatePhysicalStockDelta,0)
const oldSent=await insertReviewOrder(9553,9564,'reserved',true,'active',0,'sent')
assert.equal(oldSent.lines[0].reasonCode,'legacy_order_sent_without_line_proof')
assert.equal(oldSent.lines[0].selectedQuantity,1)
const workshop=await insertReviewOrder(9554,9565,'workshop',false,'',1)
assert.equal(workshop.lines[0].reasonCode,'workshop_unsent_needs_review')
assert.equal(workshop.lines[0].selectedQuantity,1)
const unresolved=await insertReviewOrder(9555,9566,'pending_reservation',true,'unresolved')
assert.equal(unresolved.lines[0].proposedAction,'cancel_unresolved_reservation')
assert.equal(unresolved.lines[0].plannedReserveRelease,0)
assert.equal(unresolved.lines[0].selectedQuantity,1)
assert.equal(unresolved.summary.fullPurchaseTerminationCandidate,true)
assert.equal(unresolved.summary.expectedImmediatePhysicalStockDelta,0)
const reviewAgain=await previewUnifiedReturnV2LineEvidence(DB,9552)
assert.deepEqual(reviewAgain,prior)

const originalTotals=snapshot()
sql.prepare("INSERT INTO returns(order_id,return_date,amount,status,created_at) VALUES (9551,'2026-11-14',0,'completed','2026-11-14T10:00:00Z')").run()
const returnId=Number(sql.prepare('SELECT last_insert_rowid() AS id').get().id)
sql.prepare("INSERT INTO return_items(return_id,order_item_id,product_name_snapshot,quantity,amount,created_at) VALUES (?,?, 'STAGE 5 TEST WAREHOUSE',1,2000,'2026-11-14T10:00:00Z')").run(returnId,9561)
const legacy=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(legacy.lines.find(x=>x.orderItemId===9561).alreadyReturnedWithoutContractReduction,1)
assert.equal(legacy.lines.find(x=>x.orderItemId===9561).availableQuantity,1)
assert.equal(legacy.lines.find(x=>x.orderItemId===9561).selectedQuantity,1)
assert.equal(legacy.lines.find(x=>x.orderItemId===9561).requiresReview,true)
assert.equal(legacy.summary.selectedQuantity,3)
assert.equal(legacy.summary.requiresReviewQuantity,1)
assert.equal(legacy.summary.fullPurchaseTerminationCandidate,false)
assert.equal(legacy.summary.expectedImmediatePhysicalStockDelta,0)
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9541').get().quantity,originalTotals.stock.find(x=>x.id===9541).quantity)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9541').get().reserved_quantity,originalTotals.stock.find(x=>x.id===9541).reserved_quantity)
sql.close()
console.log('RETURN_V2_UNIFIED_LINE_EVIDENCE_SQLITE_PASS: all items including unsent selected, split 2 shipped+2 reserved, exact sale price, no warehouse writes, conflicting issued/legacy/workshop/active reserve flagged, unresolved cancel no physical stock, old returns limit available quantity')
