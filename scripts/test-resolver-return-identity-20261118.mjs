import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'
import { previewUnifiedReturnV2LineEvidence } from '../worker/domains/return-v2-unified-line-evidence.ts'
import { postUnifiedReturnV2Prototype } from '../worker/domains/return-v2-unified-posting-prototype.ts'
import {readVersionedReturnMoney} from '../worker/domains/return-v2-financial-projection.ts'
import {listReturnHistory} from '../worker/domains/activity.ts'
import {fetchOrderRelations} from '../worker/domains/orders-relations.ts'

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
sql.prepare("INSERT INTO reference_values(kind,value,is_active) VALUES('payment_method','KASPI',1),('payment_method','CASH',1)").run()
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

sql.prepare("UPDATE orders SET total_amount=8000,pricing_mode='itemized_v1' WHERE id=9551").run()
sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES (9562,9551,9521,9531,'BOUTIQUE UNISSUED',1,2000,2000,0,'boutique','reserved','2026-11-01T00:00:00Z','v2-unified-boutique','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES (9542,'boutique',9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',2,1)").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES (9551,9562,'boutique',9521,9531,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(9551,'2026-11-01','KASPI',8000,'primary')").run()
// Production-style Resolver: immutable manager entry stays wrong while linked SKU is authoritative.
sql.prepare("UPDATE catalog_variants SET length='ДЛИННЫЙ',size_label='2' WHERE id=9531").run()
sql.prepare("UPDATE inventory_stock SET length_snapshot='ДЛИННЫЙ',size_snapshot='2' WHERE variant_id=9531").run()
sql.prepare("UPDATE order_items SET length_snapshot='СТАНДАРТ',size_snapshot='0' WHERE id=9561").run()
const beforeShip=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(beforeShip.summary.selectedQuantity,4)
assert.equal(beforeShip.summary.reservedCancellationQuantity,4)
const ship=await api('POST','/api/orders/9551/shipping/dispatches',{
  requestId:'v2-unified-dispatch-partial-001',items:[{orderItemId:9561,quantity:2}]
})
assert.equal(ship.shippedQuantity,2)
const split=sql.prepare('SELECT id,quantity FROM order_items WHERE order_id=9551 AND id NOT IN(9561,9562)').get()
assert.equal(split.quantity,1)
const state=()=>({
  order:{...sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount,updated_at FROM orders WHERE id=9551').get()},
  lines:sql.prepare('SELECT id,quantity,line_total,stock_writeoff_status FROM order_items WHERE order_id=9551 ORDER BY id').all().map(x=>({...x})),
  res:sql.prepare('SELECT id,order_item_id,quantity,status FROM inventory_reservations WHERE order_id=9551 ORDER BY id').all().map(x=>({...x})),
  stocks:sql.prepare('SELECT id,quantity,reserved_quantity FROM inventory_stock WHERE id IN (9541,9542) ORDER BY id').all().map(x=>({...x})),
  returns:sql.prepare('SELECT id,amount,status FROM returns WHERE order_id=9551 ORDER BY id').all().map(x=>({...x})),
  physical:sql.prepare('SELECT return_id,order_item_id,quantity,physical_tracking,contract_quantity_applied,physical_received_at FROM return_items WHERE return_id IN (SELECT id FROM returns WHERE order_id=9551)').all().map(x=>({...x})),
  provenance:sql.prepare('SELECT action,order_item_id,contracted_quantity,reservation_release,stock_quantity_change FROM return_v2_unified_lines ORDER BY id').all().map(x=>({...x})),
  cash:sql.prepare("SELECT event_key,amount_delta,payment_method FROM financial_events WHERE order_id=9551 AND event_type='order_refund'").all().map(x=>({...x})),
})
const offered=await previewUnifiedReturnV2LineEvidence(DB,9551)
const resolverReturnLine=offered.lines.find(x=>x.orderItemId===9561)
assert.equal(resolverReturnLine.length,'ДЛИННЫЙ','Return preview must show confirmed length')
assert.equal(resolverReturnLine.size,'2','Return preview must show confirmed age/size')
assert.equal(sql.prepare("SELECT length_snapshot FROM order_items WHERE id=9561").get().length_snapshot,'СТАНДАРТ','Historic manager snapshot remains untouched')
assert.equal(sql.prepare("SELECT size_snapshot FROM order_items WHERE id=9561").get().size_snapshot,'0')
assert.deepEqual(offered.lines.map(x=>x.selectedQuantity).sort((a,b)=>a-b),[1,1,2])
assert.deepEqual(offered.lines.map(x=>x.proposedAction).sort(),[
 'cancel_unshipped_reservation','cancel_unshipped_reservation','physical_return_pending'].sort())
assert.equal(offered.summary.selectedQuantity,4)
const request={
 requestId:'v2-unified-post-mixed-fully-001',orderId:9551,expectedOrderVersion:offered.orderVersion,
 items:offered.lines.map(x=>({orderItemId:x.orderItemId,quantity:x.selectedQuantity})),
 refundAmount:5000,refundMethod:'Kaspi'
}
const before=state()
assert.deepEqual(before.stocks,[{id:9541,quantity:3,reserved_quantity:1},{id:9542,quantity:2,reserved_quantity:1}])
await assert.rejects(postUnifiedReturnV2Prototype(DB,{...request,refundAmount:9000}),/превышает/)
assert.deepEqual(state(),before)
const posted=await postUnifiedReturnV2Prototype(DB,request)
assert.equal(posted.ok,true)
assert.equal(posted.replayed,false)
assert.equal(posted.remainingSale,0)
assert.equal(posted.fullTermination,true)
assert.equal(posted.cashRefund,5000)
const storedReturn=sql.prepare('SELECT length_snapshot,size_snapshot,gender_snapshot,color_snapshot FROM return_items WHERE return_id=? AND order_item_id=9561').get(posted.returnId)
assert.equal(storedReturn.length_snapshot,'ДЛИННЫЙ','New Return must freeze resolved length at posting')
assert.equal(storedReturn.size_snapshot,'2','New Return must freeze resolved size at posting')
assert.equal(storedReturn.gender_snapshot,'МУЖ')
const returnHistory=await listReturnHistory(DB,new URL('https://test-only.invalid/api/returns/history?limit=20'))
const historyItem=returnHistory.returns.flatMap(r=>r.items).find(x=>x.orderItemId===9561)
assert.equal(historyItem.length,'ДЛИННЫЙ','Return history shows saved canonical identity')
assert.equal(historyItem.size,'2')
sql.prepare('UPDATE return_items SET gender_snapshot=NULL,color_snapshot=NULL,material_snapshot=NULL,length_snapshot=NULL,size_snapshot=NULL WHERE return_id=? AND order_item_id=9561').run(posted.returnId)
const older=await listReturnHistory(DB,new URL('https://test-only.invalid/api/returns/history?limit=20'))
const olderLine=older.returns.flatMap(r=>r.items).find(x=>x.orderItemId===9561)
assert.equal(olderLine.length,'ДЛИННЫЙ','Prior Return V2 null snapshots must display linked canonical fallback')
assert.equal(olderLine.size,'2')
sql.prepare('UPDATE return_items SET gender_snapshot=?,color_snapshot=?,material_snapshot=?,length_snapshot=?,size_snapshot=? WHERE return_id=? AND order_item_id=9561').run('МУЖ','ЧЕРНЫЙ','СТАНДАРТ','ДЛИННЫЙ','2',posted.returnId)
const orderRelations=await fetchOrderRelations(DB,[9551])
const cancelledLine=orderRelations.returnHistoryItemsByOrderId.get(9551)?.find(x=>x.order_item_id===9561)
assert.equal(cancelledLine?.length_snapshot,'ДЛИННЫЙ','Order return history must show correct identity')
assert.equal(cancelledLine?.size_snapshot,'2')
const after=state()
assert.equal(after.order.total_amount,0)
assert.equal(after.order.received_amount,8000)
assert.equal(after.order.return_amount,5000)
assert.equal(after.order.debt_amount,0)
assert.equal(after.lines.length,3)
assert(after.lines.every(x=>x.quantity===0 &&x.line_total===0))
assert.deepEqual(after.stocks,[{id:9541,quantity:3,reserved_quantity:0},{id:9542,quantity:2,reserved_quantity:0}],'Physical stock MUST remain unchanged; reserve only removed')
assert.equal(after.res.filter(x=>x.status==='released').length,2)
assert(after.res.filter(x=>x.status==='released').every(x=>x.quantity===1),'Full release retains historical positive reserved quantity')
assert.equal(after.res.filter(x=>x.status==='fulfilled').length,1)
assert.equal(after.returns.length,1)
assert.equal(after.returns[0].amount,5000)
assert.equal(after.physical.length,1,'Only actually sent line is physical return')
assert.equal(after.physical[0].quantity,2)
assert.equal(after.physical[0].contract_quantity_applied,1)
assert.equal(after.physical[0].physical_tracking,1)
assert.equal(after.physical[0].physical_received_at,null)
assert.deepEqual(after.provenance.map(x=>x.stock_quantity_change),[0,0,0])
assert.equal(after.provenance.filter(x=>x.action==='physical_return_pending').length,1)
assert.equal(after.provenance.filter(x=>x.action==='cancel_unshipped_reservation').length,2)
assert.equal(after.provenance.reduce((s,x)=>s+x.reservation_release,0),2)
assert.equal(after.cash.length,1)
assert.equal(after.cash[0].amount_delta,-5000)
assert.equal(after.cash[0].payment_method,'KASPI')
const repeated=await postUnifiedReturnV2Prototype(DB,request)
assert.equal(repeated.replayed,true)
assert.equal(repeated.returnId,posted.returnId)
assert.deepEqual(state(),after,'Same request cannot create second refund, stock change or reserve release')
await assert.rejects(postUnifiedReturnV2Prototype(DB,{...request,refundAmount:4000}),/Идентификатор/)
assert.deepEqual(state(),after)
const shippingAfter=await api('GET','/api/orders/9551/shipping/plan')
assert.equal(shippingAfter.selectedQuantity,0,'No canceled goods offered for new shipment')
const previewAfter=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(previewAfter.lines.length,0)
assert.equal(previewAfter.summary.selectedQuantity,0)

// Real order and zero cash: canceled stock must only release its reserve.
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,pricing_mode,total_amount,created_at,updated_at) VALUES (9851,'V2-UNIFIED-UNSENT','2026-11-01',9501,'active','warehouse','ready','not_sent','itemized_v1',2500,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES (9861,9851,9521,9531,'V2 UNSENT RESERVE',2,1250,2500,0,'warehouse','reserved','2026-11-01T00:00:00Z','v2-unified-unsent','2026-11-01T00:00:00Z')").run()
sql.prepare("UPDATE inventory_stock SET reserved_quantity=reserved_quantity+2 WHERE id=9541").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES (9851,9861,'warehouse',9521,9531,2,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
const unsentPreview=await previewUnifiedReturnV2LineEvidence(DB,9851)
assert.equal(unsentPreview.lines[0].selectedQuantity,2)
const partial=await postUnifiedReturnV2Prototype(DB,{
 requestId:'v2-unified-partial-reserve-001',orderId:9851,
 expectedOrderVersion:unsentPreview.orderVersion,
 items:[{orderItemId:9861,quantity:1}],refundAmount:0
})
assert.equal(partial.fullTermination,false)
assert.equal(partial.cashRefund,0)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=9851').get().total_amount,1250)
assert.equal(sql.prepare('SELECT quantity,line_total FROM order_items WHERE id=9861').get().quantity,1)
assert.equal(sql.prepare('SELECT quantity,line_total FROM order_items WHERE id=9861').get().line_total,1250)
assert.equal(sql.prepare('SELECT quantity,status FROM inventory_reservations WHERE order_item_id=9861').get().quantity,1)
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9541').get().quantity,3)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9541').get().reserved_quantity,1)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM return_items WHERE return_id=?').get(partial.returnId).n,0,'Unsent cancellation does NOT create a physical Return line')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE order_id=9851 AND event_type=?').get('order_refund').n,0)
assert.equal((await api('GET','/api/orders/9851/shipping/plan')).selectedQuantity,1,'Uncanceled reserved piece remains sendable')

// The remainder of an UNSHIPPED, same-reservation line is now allowed to
// be cancelled again, without either physical +1 or a second release of
// a unit already removed from reserved_quantity.
const follow=await previewUnifiedReturnV2LineEvidence(DB,9851)
assert.equal(follow.lines[0].selectedQuantity,1)
assert.equal(follow.lines[0].proposedAction,'cancel_unshipped_reservation')
const nextInput={
 requestId:'v2-unified-second-purchase-001',orderId:9851,
 expectedOrderVersion:follow.orderVersion,
 items:[{orderItemId:9861,quantity:1}],refundAmount:0
}
const beforeSameLine={
 stock:{...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},
 returns:sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9851').get().n
}
const raceDb={
 ...DB,
 async batch(statements){
  sql.prepare('UPDATE return_v2_unified_lines SET reservation_release=0 WHERE posting_id=?')
   .run(partial.postingId)
  return DB.batch(statements)
 }
}
await assert.rejects(postUnifiedReturnV2Prototype(raceDb,{
 ...nextInput,requestId:'v2-unified-same-item-atomic-race-001'
}),/Ничего не проведено|изменились|проверка/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9851').get().n,beforeSameLine.returns)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},beforeSameLine.stock)
sql.prepare('UPDATE return_v2_unified_lines SET reservation_release=contracted_quantity WHERE posting_id=?')
 .run(partial.postingId)
const next=await postUnifiedReturnV2Prototype(DB,nextInput)
assert.equal(next.remainingSale,0)
assert.equal(next.fullTermination,true)
assert.equal(next.cashRefund,0)
assert.equal(sql.prepare('SELECT total_amount,return_amount,debt_amount FROM orders WHERE id=9851').get().total_amount,0)
assert.equal(sql.prepare('SELECT quantity,line_total FROM order_items WHERE id=9861').get().quantity,0)
assert.deepEqual({...sql.prepare('SELECT quantity,status FROM inventory_reservations WHERE order_item_id=9861').get()},{quantity:1,status:'released'})
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9541').get().quantity,beforeSameLine.stock.quantity)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9541').get().reserved_quantity,beforeSameLine.stock.reserved_quantity-1)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9851').get().n,2)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_items WHERE order_item_id=9861').get().n,0)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE order_id=9851 AND event_type=\'order_refund\'').get().n,0)
const duplicateNext=await postUnifiedReturnV2Prototype(DB,nextInput)
assert.equal(duplicateNext.replayed,true)
assert.equal(duplicateNext.returnId,next.returnId)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9851').get().n,2)
const sameLineMoney=await readVersionedReturnMoney(DB,9851)
assert.equal(sameLineMoney.currentSale,0)
assert.equal(sameLineMoney.customerDebt,0)


// Unresolved reservation: no physical/reserved cache change for an unconfirmed shortage.
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,pricing_mode,total_amount,created_at,updated_at) VALUES (9852,'V2-UNIFIED-UNRESOLVED','2026-11-01',9501,'active','warehouse','ready','not_sent','itemized_v1',1800,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES (9862,9852,9521,9531,'UNRESOLVED',1,1800,1800,0,'warehouse','pending_reservation','2026-11-01T00:00:00Z','v2-unified-unresolved','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES (9852,9862,'warehouse',9521,9531,1,'unresolved','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
const previewUnresolved=await previewUnifiedReturnV2LineEvidence(DB,9852)
assert.equal(previewUnresolved.lines[0].proposedAction,'cancel_unresolved_reservation')
const warehouseBefore={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()}
const zero=await postUnifiedReturnV2Prototype(DB,{
 requestId:'v2-unified-unresolved-full-001',orderId:9852,expectedOrderVersion:previewUnresolved.orderVersion,
 items:[{orderItemId:9862,quantity:1}],refundAmount:0
})
assert.equal(zero.fullTermination,true)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},warehouseBefore)
assert.deepEqual({...sql.prepare('SELECT quantity,status FROM inventory_reservations WHERE order_item_id=9862').get()},{quantity:1,status:'released'})

// Stale order version must never create an accounting event or remove a reserve.
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,pricing_mode,total_amount,created_at,updated_at) VALUES (9853,'V2-UNIFIED-STALE','2026-11-01',9501,'active','warehouse','ready','not_sent','itemized_v1',1250,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES (9863,9853,9521,9531,'STALE',1,1250,1250,0,'warehouse','reserved','2026-11-01T00:00:00Z','v2-unified-stale','2026-11-01T00:00:00Z')").run()
sql.prepare("UPDATE inventory_stock SET reserved_quantity=reserved_quantity+1 WHERE id=9541").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES (9853,9863,'warehouse',9521,9531,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
const stalePreview=await previewUnifiedReturnV2LineEvidence(DB,9853)
sql.prepare("UPDATE orders SET updated_at='2099-01-01T00:00:00Z' WHERE id=9853").run()
const staleStock={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()}
await assert.rejects(postUnifiedReturnV2Prototype(DB,{
 requestId:'v2-unified-stale-fail-001',orderId:9853,expectedOrderVersion:stalePreview.orderVersion,
 items:[{orderItemId:9863,quantity:1}],refundAmount:0
}),/изменился/)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},staleStock)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM returns WHERE order_id=9853').get().n,0)

// Forced crash inside the transaction, after the Return header and posting row.
sql.prepare("UPDATE orders SET updated_at='2026-11-01T00:00:00Z' WHERE id=9853").run()
const faultPreview=await previewUnifiedReturnV2LineEvidence(DB,9853)
const originalBatch=DB.batch.bind(DB)
let faultInjected=false
DB.batch=async statements=>{
 if(!faultInjected){
  faultInjected=true
  return originalBatch(statements.map((st,index)=>index===4
    ? {...st,run:async()=>{throw Error('INJECTED_UNIFIED_FAILURE_AFTER_HEADER')}}
    :st))
 }
 return originalBatch(statements)
}
const faultRequest={
 requestId:'v2-unified-fault-injected-001',orderId:9853,expectedOrderVersion:faultPreview.orderVersion,
 items:[{orderItemId:9863,quantity:1}],refundAmount:0
}
await assert.rejects(postUnifiedReturnV2Prototype(DB,faultRequest),/INJECTED_UNIFIED_FAILURE_AFTER_HEADER/)
DB.batch=originalBatch
assert.equal(faultInjected,true)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM returns WHERE order_id=9853').get().n,0)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM return_v2_unified_postings WHERE order_id=9853').get().n,0)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=9863').get().quantity,1)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},staleStock)
const afterFault=await postUnifiedReturnV2Prototype(DB,faultRequest)
assert.equal(afterFault.replayed,false)
assert.equal(afterFault.fullTermination,true)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM returns WHERE order_id=9853').get().n,1)

console.log('RETURN_V2_UNIFIED_ATOMIC_SQLITE_PASS: full selected mixed send+reserved and real Worker send/plan, no phantom stock, refund and all line writes atomic, idempotency, partial reservation, unresolved reservation, stale version and injected rollback')
sql.close()
