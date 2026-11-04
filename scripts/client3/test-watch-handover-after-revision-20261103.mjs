import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {createClient3WatchOrder} from '../../worker/domains/client3-watch-create.ts'
import {dispatchClient3WatchOrder} from '../../worker/domains/client3-watch-dispatch.ts'
import {readClient3WatchHandover,clarifyClient3WatchHandover} from '../../worker/domains/client3-watch-handover.ts'
import {watchReferenceLabel} from '../../shared/client3/watch-domain.ts'
import {startClient3WatchRevision,changeClient3WatchRevision} from '../../worker/domains/client3-watch-revision-session.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const filename of fs.readdirSync('migrations').filter(s=>/^\d+.*\.sql$/.test(s)).sort())
 sqlite.exec(fs.readFileSync('migrations/'+filename,'utf8'))
if(!sqlite.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
 sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
for(const filename of fs.readdirSync('migrations/client3-watch').filter(s=>/^\d+.*\.sql$/.test(s)).sort())
 sqlite.exec(fs.readFileSync('migrations/client3-watch/'+filename,'utf8'))
const stmt=(query,args=[])=>({
 bind(...values){return stmt(query,values)},
 async first(){return sqlite.prepare(query).get(...args)||null},
 async all(){return {results:sqlite.prepare(query).all(...args)}},
 async run(){const r=sqlite.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
})
const db={prepare:stmt,async batch(statements){
 sqlite.exec('SAVEPOINT watch_revision_test')
 try{
  const result=[]
  for(const row of statements)result.push(await row.run())
  sqlite.exec('RELEASE watch_revision_test')
  return result
 }catch(e){sqlite.exec('ROLLBACK TO SAVEPOINT watch_revision_test');sqlite.exec('RELEASE watch_revision_test');throw e}
}}
const parse=async promise=>{const response=await promise;return {status:response.status,...await response.json()}}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор'}
sqlite.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Revision tester')").run()
sqlite.prepare("INSERT INTO watch_products(id,brand_id,model_name,is_active) VALUES(900,1,'NEW EMPTY WATCH',1)").run()
sqlite.prepare("INSERT INTO watch_variants(id,watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color,is_active) VALUES(901,900,'male','quartz','steel','black','',1)").run()
const linked=await parse(provisionClient3WatchSku(db,admin,1,901))
assert.equal(linked.status,200,JSON.stringify(linked))
const cv=linked.canonicalVariantId
assert(cv>0)
const before=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_stock WHERE variant_id=?').get(cv)
assert.equal(before.n,0,'New watch SKU must have no physical stock entry')
const full=await parse(startClient3WatchRevision(db,admin,1,{source:'office',full:true}))
assert.equal(full.ok,true,JSON.stringify(full))
assert.equal(full.session.scope,'full')
assert.equal(full.session.totalItems,1,'Full revision must include stockless watches')
assert.equal(full.session.items[0].baselineQuantity,0)
assert.equal(full.session.items[0].stockId,null)
assert.equal(full.session.items[0].currentQuantity,0)
const item=full.session.items[0]
const counted=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId:full.session.id,itemId:item.id,countedQuantity:7,
}))
assert.equal(counted.ok,true,JSON.stringify(counted))
assert.equal(counted.session.items[0].countedQuantity,7)
const finished=await parse(changeClient3WatchRevision(db,admin,1,'complete',{sessionId:full.session.id}))
assert.equal(finished.ok,true,JSON.stringify(finished))
assert.equal(finished.session.status,'completed')
const physical=sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'warehouse')
assert.equal(physical.quantity,7,'Stocktake should create the missing physical record ONLY after confirmation')
assert.equal(physical.reserved_quantity,0)
const selective=await parse(startClient3WatchRevision(db,admin,1,{
 source:'showcase',full:false,modelIds:[900],
}))
assert.equal(selective.ok,true,JSON.stringify(selective))
assert.equal(selective.session.totalItems,1,'Selective check must include zero baseline at other point')
assert.equal(selective.session.items[0].baselineQuantity,0)
assert.equal(selective.session.items[0].stockId,null)
const countedZero=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId:selective.session.id,itemId:selective.session.items[0].id,countedQuantity:0,
}))
assert.equal(countedZero.ok,true)
const finishZero=await parse(changeClient3WatchRevision(db,admin,1,'complete',{sessionId:selective.session.id}))
assert.equal(finishZero.ok,true,JSON.stringify(finishZero))
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'boutique').n,0,
 'Counting zero does not create physical stock unnecessarily')
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
assert.equal(watchReferenceLabel('movements','quartz'),'КВАРЦЕВЫЕ')
assert.equal(watchReferenceLabel('bracelets','leather'),'КОЖА')
assert.equal(watchReferenceLabel('dials','white'),'БЕЛЫЙ')
assert.equal(watchReferenceLabel('dials','black'),'ЧЕРНЫЙ')
// Create an October 1 order AFTER a completed Nov revision. This exact
// backdating scenario must ask where the watch was during the revision.
sqlite.prepare("INSERT OR REPLACE INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-03')").run()
sqlite.prepare('INSERT OR IGNORE INTO watch_manager_brands(manager_id,brand_id) VALUES(1,1)').run()
const original={
 brand:'TAUWACH',source:'office',managerId:1,watchVariantId:901,catalogVariantId:cv,
 quantity:1,unitPrice:35000,receivedAmount:0,engravingText:'',
 recipientName:'Historic Watch Client',recipientPhone:'+77015550101',
 address:'Office',postalCode:'050001',city:'Алматы',deliveryMethod:'Курьер',
 shippingDeadlineLocal:'2026-11-15T17:00',urgent:false,paymentMethod:'KASPI GOLD',
 orderDate:'2026-10-01',requestId:'watch-old-order-issue-20261103a',
}
const firstOrder=await parse(createClient3WatchOrder(db,admin,1,original))
assert.equal(firstOrder.status,201,JSON.stringify(firstOrder))
assert.equal(sqlite.prepare('SELECT order_date FROM orders WHERE id=?').get(firstOrder.orderId).order_date,'2026-10-01')
const firstRead=await parse(readClient3WatchHandover(db,admin,1,firstOrder.orderId))
assert.equal(firstRead.status,200,JSON.stringify(firstRead))
assert.equal(firstRead.reviewCount,1,'Backdated October sale must trigger issuance review after later full revision')
const firstItem=firstRead.state.items.find(x=>x.reviewNeeded)
assert(firstItem?.checkpointId&&firstItem.checkpointAt)
const beforeOne=sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'warehouse')
const blockedSend=await parse(dispatchClient3WatchOrder(db,admin,1,firstOrder.orderId,{
 requestId:'watch-handover-gate-before-main-20261104',
 confirmPhysicalStock:true,
 items:[{orderItemId:firstItem.orderItemId,quantity:1}],
}))
assert.equal(blockedSend.status,409,JSON.stringify(blockedSend))
assert.equal(blockedSend.code,'WATCH_HANDOVER_REQUIRED',
 'Physical possession confirmation MUST NEVER bypass a later completed stocktake')
assert.deepEqual(blockedSend.reviewItemIds,[firstItem.orderItemId])
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?')
 .get(firstOrder.orderId).n,0,'Blocked dispatch has zero stock and payment movements')
const wrongBrand=await parse(readClient3WatchHandover(db,admin,2,firstOrder.orderId))
assert.equal(wrongBrand.status,404,'Cannot read another brand order')
const stale=await parse(clarifyClient3WatchHandover(db,admin,1,firstOrder.orderId,{
 action:'still_here',orderItemId:firstItem.orderItemId,checkpointId:999999,
 checkpointAt:firstItem.checkpointAt,
}))
assert.equal(stale.status,409,'Stale checkpoint cannot alter stock')
const stillHere=await parse(clarifyClient3WatchHandover(db,admin,1,firstOrder.orderId,{
 action:'still_here',orderItemId:firstItem.orderItemId,
 checkpointId:firstItem.checkpointId,checkpointAt:firstItem.checkpointAt,
}))
assert.equal(stillHere.status,200,JSON.stringify(stillHere))
assert.equal(stillHere.state.items.find(x=>x.orderItemId===firstItem.orderItemId).reviewNeeded,false)
assert.equal(sqlite.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?').get(firstItem.orderItemId).status,'active')
assert.deepEqual(sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'warehouse'),beforeOne)
const approvedSend=await parse(dispatchClient3WatchOrder(db,admin,1,firstOrder.orderId,{
 requestId:'watch-handover-gate-before-main-20261104',
 confirmPhysicalStock:true,
 items:[{orderItemId:firstItem.orderItemId,quantity:1}],
}))
assert.equal(approvedSend.status,200,JSON.stringify(approvedSend))
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?')
 .get(firstOrder.orderId).n,1,'After confirming STILL HERE, dispatch is allowed once')
const replay=await parse(dispatchClient3WatchOrder(db,admin,1,firstOrder.orderId,{
 requestId:'watch-handover-gate-before-main-20261104',
 confirmPhysicalStock:true,
 items:[{orderItemId:firstItem.orderItemId,quantity:1}],
}))
assert.equal(replay.status,200,'Idempotent retry of an already committed shipment remains possible')
// New October 2 order: was physically given to customer BEFORE the
// later revision. Main's CAS closes its reservation WITHOUT stock movement.
const secondOrder=await parse(createClient3WatchOrder(db,admin,1,{
 ...original,orderDate:'2026-10-02',requestId:'watch-old-order-issue-20261103b',
 recipientName:'Second Historic Watch Client',recipientPhone:'+77015550102',
}))
assert.equal(secondOrder.status,201,JSON.stringify(secondOrder))
const secondRead=await parse(readClient3WatchHandover(db,admin,1,secondOrder.orderId))
assert.equal(secondRead.reviewCount,1,JSON.stringify(secondRead))
const secondItem=secondRead.state.items.find(x=>x.reviewNeeded)
const prevPhysical=sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'warehouse').quantity
const prevMovements=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
const issued=await parse(clarifyClient3WatchHandover(db,admin,1,secondOrder.orderId,{
 action:'issued_before_checkpoint',orderItemId:secondItem.orderItemId,
 checkpointId:secondItem.checkpointId,checkpointAt:secondItem.checkpointAt,
}))
assert.equal(issued.status,200,JSON.stringify(issued))
assert.equal(sqlite.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?').get(secondItem.orderItemId).status,'fulfilled')
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source=?').get(cv,'warehouse').quantity,prevPhysical,
 'Backdated issuance must not subtract physical quantity again')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,prevMovements,
 'Historical issuance must not invent a new sale movement')
const repeated=await parse(clarifyClient3WatchHandover(db,admin,1,secondOrder.orderId,{
 action:'issued_before_checkpoint',orderItemId:secondItem.orderItemId,
 checkpointId:secondItem.checkpointId,checkpointAt:secondItem.checkpointAt,
}))
assert.equal(repeated.status,409,'Duplicate handover cannot spend physical stock twice')
// Reproduce real QA: Nov 1 order entered after the Nov 3 stocktake,
// with shortage/unresolved reservation. The ordinary physical checkbox
// previously let these watches leave without a handover review.
const shortageOrder=await parse(createClient3WatchOrder(db,admin,1,{
 ...original,quantity:8,orderDate:'2026-11-01',
 requestId:'watch-postdated-no-reserve-20261104',
 recipientName:'Shortage Watch Client',recipientPhone:'+77015550103',
}))
assert.equal(shortageOrder.status,201,JSON.stringify(shortageOrder))
const shortageRow=sqlite.prepare(`SELECT oi.id AS itemId,ir.status AS reservation
 FROM order_items oi JOIN inventory_reservations ir ON ir.order_item_id=oi.id
 WHERE oi.order_id=? LIMIT 1`).get(shortageOrder.orderId)
assert.equal(shortageRow?.reservation,'unresolved','Test needs actual reservation shortage')
const shortageHandover=await parse(readClient3WatchHandover(db,admin,1,shortageOrder.orderId))
assert.equal(shortageHandover.status,200,JSON.stringify(shortageHandover))
assert.equal(shortageHandover.reviewCount,1,
 'Nov 1 backdated order with unresolved reservation needs Nov 3 stocktake review')
const blockedUnresolved=await parse(dispatchClient3WatchOrder(db,admin,1,shortageOrder.orderId,{
 requestId:'watch-postdated-no-reserve-send-20261104',
 confirmPhysicalStock:true,items:[{orderItemId:shortageRow.itemId,quantity:8}],
}))
assert.equal(blockedUnresolved.status,409,JSON.stringify(blockedUnresolved))
assert.equal(blockedUnresolved.code,'WATCH_HANDOVER_REQUIRED',
 'No physical stock checkbox can bypass a post-stocktake unresolved reservation')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?')
 .get(shortageOrder.orderId).n,0)
const unresolvedReview=shortageHandover.state.items.find(x=>x.orderItemId===shortageRow.itemId)
const deniedClarification=await parse(clarifyClient3WatchHandover(db,admin,1,shortageOrder.orderId,{
 action:'still_here',orderItemId:shortageRow.itemId,
 checkpointId:unresolvedReview.checkpointId,checkpointAt:unresolvedReview.checkpointAt,
}))
assert.equal(deniedClarification.status,409,'Cannot fabricate reservation at stocktake review')
assert.equal(deniedClarification.code,'WATCH_HANDOVER_RESERVATION_REQUIRED')
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_OCT_1_2_MAIN_HANDOVER_AND_UNRESOLVED_STOCK_GATES_PASS')
