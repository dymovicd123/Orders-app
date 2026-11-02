import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival,transferClient3WatchStock} from '../../worker/domains/client3-watch-inventory.ts'
import {writeoffClient3WatchStock} from '../../worker/domains/client3-watch-writeoff.ts'
import {countClient3WatchStock,countClient3WatchStockBatch} from '../../worker/domains/client3-watch-stocktake.ts'
import {listClient3WatchStockHistory} from '../../worker/domains/client3-watch-history.ts'
import {applyClient3WatchBulkOperation} from '../../worker/domains/client3-watch-bulk.ts'
import {registerWatchModel,registerWatchVariant,listWatchCatalogDrafts} from '../../worker/domains/client3-watch-catalog.ts'
import {getClient3WatchRevision,startClient3WatchRevision,changeClient3WatchRevision} from '../../worker/domains/client3-watch-revision-session.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const filename of fs.readdirSync('migrations').filter(s=>/^\d+.*\.sql$/.test(s)).sort()){
  sqlite.exec(fs.readFileSync('migrations/'+filename,'utf8'))
}
for(const filename of fs.readdirSync('migrations/client3-watch').filter(s=>/^\d+.*\.sql$/.test(s)).sort()){
  sqlite.exec(fs.readFileSync('migrations/client3-watch/'+filename,'utf8'))
}
const stmt=(query,args=[])=>({
  bind(...values){return stmt(query,values)},
  async first(){return sqlite.prepare(query).get(...args)||null},
  async all(){return {results:sqlite.prepare(query).all(...args)}},
  async run(){const r=sqlite.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
})
const db={
  prepare:stmt,
  async batch(statements){
    sqlite.exec('SAVEPOINT watch_full_stock')
    try{
      const out=[]
      for(const item of statements)out.push(await item.run())
      sqlite.exec('RELEASE watch_full_stock')
      return out
    }catch(cause){
      sqlite.exec('ROLLBACK TO SAVEPOINT watch_full_stock')
      sqlite.exec('RELEASE watch_full_stock')
      throw cause
    }
  },
}
const parse=async promised=>{
  const response=await promised
  return {status:response.status,...await response.json()}
}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор'}
sqlite.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Test Admin')").run()
sqlite.prepare("INSERT OR REPLACE INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-02')").run()
sqlite.prepare("INSERT INTO watch_products(brand_id,model_name) VALUES(1,'REAL ENGINE TEST')").run()
sqlite.prepare("INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'male','quartz','leather','black','ЧЁРНЫЙ')").run()
const prepared=await parse(provisionClient3WatchSku(db,admin,1,1))
assert.equal(prepared.status,200,JSON.stringify(prepared))
const vid=prepared.canonicalVariantId
assert(vid>0)
const stock=source=>sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source=? AND variant_id=?').get(source,vid)
const count=table=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n
const baseOrders=count('orders'),basePayments=count('payments')
const initialMovement=count('inventory_movements')
const receipt={source:'office',watchVariantId:1,quantity:5,comment:'Physical receipt test',requestId:'watch-real-receipt-0001'}
const a=await parse(receiveClient3WatchArrival(db,admin,1,receipt))
assert.equal(a.status,200,JSON.stringify(a))
assert.equal(a.ok,true)
assert.equal(stock('warehouse').quantity,5)
const receiptRepeat=await parse(receiveClient3WatchArrival(db,admin,1,receipt))
assert.equal(receiptRepeat.duplicate,true)
assert.equal(stock('warehouse').quantity,5)
assert.equal((await parse(receiveClient3WatchArrival(db,admin,1,{...receipt,quantity:8}))).status,409)
const transfer={source:'office',watchVariantId:1,quantity:2,expectedPhysical:5,comment:'Test stock move',requestId:'watch-real-transfer-0001'}
const b=await parse(transferClient3WatchStock(db,admin,1,transfer))
assert.equal(b.status,200,JSON.stringify(b))
assert.equal(b.ok,true)
assert.equal(stock('warehouse').quantity,3)
assert.equal(stock('boutique').quantity,2)
const transferRepeat=await parse(transferClient3WatchStock(db,admin,1,transfer))
assert.equal(transferRepeat.duplicate,true)
assert.equal(stock('warehouse').quantity,3)
assert.equal(stock('boutique').quantity,2)
assert.equal((await parse(transferClient3WatchStock(db,admin,1,{...transfer,quantity:1}))).status,409)
const writeoff={source:'office',watchVariantId:1,quantity:1,expectedPhysical:3,comment:'Physical damage test',requestId:'watch-real-writeoff-0001'}
const c=await parse(writeoffClient3WatchStock(db,admin,1,writeoff))
assert.equal(c.status,200,JSON.stringify(c))
assert.equal(c.ok,true)
assert.equal(stock('warehouse').quantity,2)
const writeoffRepeat=await parse(writeoffClient3WatchStock(db,admin,1,writeoff))
assert.equal(writeoffRepeat.duplicate,true)
assert.equal(stock('warehouse').quantity,2)
assert.equal((await parse(writeoffClient3WatchStock(db,admin,1,{...writeoff,quantity:2}))).status,409)
const physicalCount={watchVariantId:1,source:'office',expectedPhysical:2,countedQuantity:3,
 confirmed:true,requestId:'watch-recount-real-001'}
const counted=await parse(countClient3WatchStock(db,admin,1,physicalCount))
assert.equal(counted.status,200,JSON.stringify(counted))
assert.equal(counted.ok,true)
assert.equal(stock('warehouse').quantity,3)
const countReplay=await parse(countClient3WatchStock(db,admin,1,physicalCount))
assert.equal(countReplay.ok,true)
assert.equal(stock('warehouse').quantity,3)
const countConflict=await parse(countClient3WatchStock(db,admin,1,{...physicalCount,countedQuantity:5}))
assert.equal(countConflict.status,409)
assert.equal(stock('warehouse').quantity,3)
const testNew=sqlite.prepare("INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'female','mechanical','steel','silver','')").run()
const newWatchId=Number(testNew.lastInsertRowid)
const second=await parse(provisionClient3WatchSku(db,admin,1,newWatchId))
assert.equal(second.ok,true,JSON.stringify(second))
const arrival2=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:newWatchId,quantity:4,requestId:'watch-stage5-second-arrival',
}))
assert.equal(arrival2.ok,true,JSON.stringify(arrival2))
const physical2=()=>sqlite.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='warehouse'")
 .get(second.canonicalVariantId).quantity
assert.equal(physical2(),4)
const checkBatch={source:'office',confirmed:true,requestId:'watch-stage5-two-item-batch',items:[
 {watchVariantId:1,expectedPhysical:3,countedQuantity:2},
 {watchVariantId:newWatchId,expectedPhysical:4,countedQuantity:5},
]}
const beforeBatchMovements=count('inventory_movements')
const changedBatch=await parse(countClient3WatchStockBatch(db,admin,1,checkBatch))
assert.equal(changedBatch.status,200,JSON.stringify(changedBatch))
assert.equal(changedBatch.watchItemCount,2)
assert.equal(stock('warehouse').quantity,2)
assert.equal(physical2(),5)
const batchReplay=await parse(countClient3WatchStockBatch(db,admin,1,checkBatch))
assert.equal(batchReplay.ok,true,JSON.stringify(batchReplay))
assert.equal(stock('warehouse').quantity,2)
assert.equal(physical2(),5)
assert.equal(count('inventory_movements'),beforeBatchMovements+2,
 'Main atomic revision records a physical movement for each changed SKU')
const changedReplay=await parse(countClient3WatchStockBatch(db,admin,1,{
 ...checkBatch,items:[checkBatch.items[0],{...checkBatch.items[1],countedQuantity:6}],
}))
assert.equal(changedReplay.status,409,'A reused request ID with different quantity must conflict')
const staleBatch=await parse(countClient3WatchStockBatch(db,admin,1,{
 ...checkBatch,requestId:'watch-stage5-stale-batch',
 items:[{...checkBatch.items[0],expectedPhysical:3},
        {...checkBatch.items[1],expectedPhysical:4}],
}))
assert.equal(staleBatch.status,409,'Atomic batch rejects if ANY old physical quantity changed')
assert.equal(stock('warehouse').quantity,2)
assert.equal(physical2(),5)
const duplicate=await parse(countClient3WatchStockBatch(db,admin,1,{
 ...checkBatch,requestId:'watch-stage5-duplicate',
 items:[checkBatch.items[0],checkBatch.items[0]],
}))
assert.equal(duplicate.status,409)
const stranger=await parse(countClient3WatchStockBatch(db,admin,2,{
 ...checkBatch,requestId:'watch-stage5-wrong-brand',
}))
assert.equal(stranger.status,409,'Brand ownership must be enforced before stock engine')
const notAdmin=await parse(countClient3WatchStockBatch(db,{
 id:2,role:'manager',managerId:2,employeeRole:'Менеджер',
},1,{...checkBatch,requestId:'watch-stage5-denied'}))
assert.equal(notAdmin.status,403)
const readHistory=async(source,brandId=1,actor=admin,beforeId=0)=>
 parse(listClient3WatchStockHistory(db,actor,brandId,new URL(
  'https://example.test/?source='+source+(beforeId?'&beforeId='+beforeId:''))))
const history=await readHistory('office')
assert.equal(history.ok,true,JSON.stringify(history))
assert(history.rows.some(row=>row.modelName==='REAL ENGINE TEST'&&row.source==='office'))
assert(history.rows.every(row=>row.watchVariantId===1||row.watchVariantId===newWatchId))
assert(history.rows.every(row=>row.source==='office'))
assert.equal((await readHistory('office',2)).rows.length,0)
assert.equal((await readHistory('office',1,{id:2,role:'manager',employeeRole:'Менеджер'})).status,403)
const showcaseHistory=await readHistory('showcase')
assert(showcaseHistory.rows.every(x=>x.source==='showcase'))
const invalidHistory=await readHistory('bogus')
assert.equal(invalidHistory.status,400)
// Stage 5 next block: all 3 multi-SKU movements use ONE Main transaction,
// never 2 sequential calls; brand, reserves, stale and request replay are guarded.
const withRows=(kind,requestId,items,comment='Test multi-watch operation')=>({
 kind,source:'office',requestId,comment,items,
})
const bulkArrival=withRows('arrival','watch-bulk-arrival-20261103-01',[
 {watchVariantId:1,quantity:1},
 {watchVariantId:newWatchId,quantity:2},
])
const arrivalResult=await parse(applyClient3WatchBulkOperation(db,admin,1,bulkArrival))
assert.equal(arrivalResult.status,200,JSON.stringify(arrivalResult))
assert.equal(stock('warehouse').quantity,3)
assert.equal(physical2(),7)
const movementAfterArrival=count('inventory_movements')
const sameArrival=await parse(applyClient3WatchBulkOperation(db,admin,1,bulkArrival))
assert.equal(sameArrival.duplicate,true)
assert.equal(count('inventory_movements'),movementAfterArrival)
const corruptArrival=await parse(applyClient3WatchBulkOperation(db,admin,1,{
 ...bulkArrival,items:[...bulkArrival.items.slice(0,1),
  {...bulkArrival.items[1],quantity:3}],
}))
assert.equal(corruptArrival.status,409)
const bulkWriteoff=withRows('writeoff','watch-bulk-writeoff-20261103-01',[
 {watchVariantId:1,quantity:1,expectedPhysical:3},
 {watchVariantId:newWatchId,quantity:2,expectedPhysical:7},
],'Two physically damaged watch sets')
const writeoffResult=await parse(applyClient3WatchBulkOperation(db,admin,1,bulkWriteoff))
assert.equal(writeoffResult.status,200,JSON.stringify(writeoffResult))
assert.equal(stock('warehouse').quantity,2)
assert.equal(physical2(),5)
assert.equal((await parse(applyClient3WatchBulkOperation(db,admin,1,bulkWriteoff))).duplicate,true)
const staleBundle=await parse(applyClient3WatchBulkOperation(db,admin,1,{
 ...bulkWriteoff,requestId:'watch-bulk-stale-20261103-01',
 items:[{watchVariantId:1,quantity:1,expectedPhysical:2},
        {watchVariantId:newWatchId,quantity:1,expectedPhysical:7}],
}))
assert.equal(staleBundle.status,409)
assert.equal(stock('warehouse').quantity,2)
assert.equal(physical2(),5)
const bulkTransfer=withRows('transfer','watch-bulk-transfer-20261103-01',[
 {watchVariantId:1,quantity:1,expectedPhysical:2},
 {watchVariantId:newWatchId,quantity:1,expectedPhysical:5},
])
const transferResult=await parse(applyClient3WatchBulkOperation(db,admin,1,bulkTransfer))
assert.equal(transferResult.status,200,JSON.stringify(transferResult))
assert.equal(stock('warehouse').quantity,1)
assert.equal(physical2(),4)
assert.equal(stock('boutique').quantity,3)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='boutique'")
 .get(second.canonicalVariantId).quantity,1)
const repeatTransfer=await parse(applyClient3WatchBulkOperation(db,admin,1,bulkTransfer))
assert.equal(repeatTransfer.duplicate,true)
const wrongBrand=await parse(applyClient3WatchBulkOperation(db,admin,2,{
 ...bulkArrival,requestId:'watch-bulk-foreign-20261103-01',
}))
assert.equal(wrongBrand.status,409)
const duplicateItem=await parse(applyClient3WatchBulkOperation(db,admin,1,{
 ...bulkArrival,requestId:'watch-bulk-duplicate-20261103-01',
 items:[bulkArrival.items[0],bulkArrival.items[0]],
}))
assert.equal(duplicateItem.status,409)
sqlite.prepare("UPDATE inventory_stock SET reserved_quantity=1 WHERE inventory_source='warehouse' AND variant_id=?")
 .run(vid)
const reserveBlocked=await parse(applyClient3WatchBulkOperation(db,admin,1,{
 ...bulkTransfer,requestId:'watch-bulk-reserved-20261103-01',
 items:[{watchVariantId:1,quantity:1,expectedPhysical:1}],
}))
assert.equal(reserveBlocked.status,409)
sqlite.prepare("UPDATE inventory_stock SET reserved_quantity=0 WHERE inventory_source='warehouse' AND variant_id=?")
 .run(vid)
const roleBlocked=await parse(applyClient3WatchBulkOperation(db,{
 id:2,role:'manager',managerId:2,employeeRole:'Менеджер',
},1,{...bulkArrival,requestId:'watch-bulk-manager-20261103-01'}))
assert.equal(roleBlocked.status,403)
// Main-critical regression from actual client screenshots: OTAN is a valid
// brand product even before it has ANY watch variants. Inline creation must
// register the missing identity and allow a physical receipt from the same
// stock workflow without creating phantom stock at the catalog step.
const modelOnly=await parse(registerWatchModel(db,admin,1,{modelName:'OTAN'}))
assert.equal(modelOnly.status,201,JSON.stringify(modelOnly))
const otanModelId=modelOnly.watchProductId
const catalogBefore=await parse(listWatchCatalogDrafts(db,admin,1))
assert.equal(catalogBefore.ok,true)
const otanShell=catalogBefore.rows.filter(r=>r.watchProductId===otanModelId)
assert.equal(otanShell.length,1)
assert.equal(otanShell[0].watchVariantId,null,
 'Model-only item must remain in catalog (Main arrival selection shows it)')
const physicalBeforeVariant=count('inventory_movements')
const defaultsFor=kind=>sqlite.prepare(
 'SELECT value FROM watch_reference_values_v5 WHERE kind=? AND is_active=1 ORDER BY id LIMIT 1')
 .get(kind)?.value
const chosenMovement=defaultsFor('movements')
const chosenBracelet=sqlite.prepare(
 "SELECT value FROM watch_reference_values_v5 WHERE kind='bracelets' AND value='steel' AND is_active=1 LIMIT 1")
 .get()?.value || defaultsFor('bracelets')
const chosenDial=defaultsFor('dials')
const leatherColor=chosenBracelet==='leather'?sqlite.prepare(
 "SELECT value FROM watch_reference_values WHERE kind='leatherColors' AND is_active=1 LIMIT 1")
 .get()?.value:''
assert(chosenMovement&&chosenBracelet&&chosenDial&&
 (chosenBracelet!=='leather'||leatherColor),'Main-backed watch references must exist for inline registration')
const variantPayload={
 watchProductId:otanModelId,gender:'male',movement:chosenMovement,
 braceletMaterial:chosenBracelet,dialColor:chosenDial,braceletColor:leatherColor,
}
const newVariant=await parse(registerWatchVariant(db,admin,1,variantPayload))
assert.equal(newVariant.status,201,JSON.stringify(newVariant))
const otanWatchId=newVariant.watchVariantId
const duplicateVariant=await parse(registerWatchVariant(db,admin,1,variantPayload))
assert.equal(duplicateVariant.watchVariantId,otanWatchId,'No duplicate watch variants')
const canonical=await parse(provisionClient3WatchSku(db,admin,1,otanWatchId))
assert.equal(canonical.status,200,JSON.stringify(canonical))
assert(Number(canonical.canonicalVariantId)>0)
const reProvision=await parse(provisionClient3WatchSku(db,admin,1,otanWatchId))
assert.equal(reProvision.canonicalVariantId,canonical.canonicalVariantId)
assert.equal(count('inventory_movements'),physicalBeforeVariant,
 'Adding product, variant, and SKU cannot silently receive goods')
const catalogAfter=await parse(listWatchCatalogDrafts(db,admin,1))
assert(catalogAfter.rows.some(r=>r.watchProductId===otanModelId &&
 r.watchVariantId===otanWatchId&&r.catalogVariantId===canonical.canonicalVariantId))
const otanArrival={
 kind:'arrival',source:'office',requestId:'otan-model-only-to-arrival-test-20261103',
 items:[{watchVariantId:otanWatchId,quantity:4}],comment:'Main missing variant inline admission',
}
const receivedOtan=await parse(applyClient3WatchBulkOperation(db,admin,1,otanArrival))
assert.equal(receivedOtan.status,200,JSON.stringify(receivedOtan))
const otanStock=()=>sqlite.prepare(
 "SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='warehouse'")
 .get(canonical.canonicalVariantId)?.quantity||0
assert.equal(otanStock(),4)
assert.equal((await parse(applyClient3WatchBulkOperation(db,admin,1,otanArrival))).duplicate,true)
assert.equal(otanStock(),4)
const foreignOtan=await parse(applyClient3WatchBulkOperation(db,admin,2,{
 ...otanArrival,requestId:'otan-model-foreign-brand-20261103',
}))
assert.equal(foreignOtan.status,409,'Cannot select other brand model from Main-backed stock')
assert.equal(otanStock(),4)
const otanCorrection=await parse(countClient3WatchStockBatch(db,admin,1,{
 source:'office',confirmed:true,requestId:'otan-new-sku-recount-20261103',
 items:[{watchVariantId:otanWatchId,expectedPhysical:4,countedQuantity:5}],
}))
assert.equal(otanCorrection.status,200,JSON.stringify(otanCorrection))
assert.equal(otanStock(),5)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
// Stage5 durable sessions: use the actual Main stocktake tables, auto-recovery,
// stale-write conflict detection, no cross-brand read/write and atomic completion.
// No extra parallel UI or hidden physical/financial movement on draft save.
const makeUrl=(src='office')=>new URL('https://test.local/api/client3/watches/stock/revision?source='+src)
const stockState=variantId=>sqlite.prepare(
 "SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source='warehouse' AND variant_id=?"
).get(variantId)
const full=await parse(startClient3WatchRevision(db,admin,1,{source:'office',full:true}))
assert.equal(full.status,200,JSON.stringify(full))
assert.equal(full.session.scope,'full')
assert(full.session.items.length>=3,'Brand full stocktake must include active stocked watch variants')
assert(full.session.items.every(x=>x.watchVariantId>0))
const sessionId=full.session.id
const resume=await parse(startClient3WatchRevision(db,admin,1,{
 source:'office',full:false,modelIds:[otanModelId],
}))
assert.equal(resume.resumed,true)
assert.equal(resume.session.id,sessionId)
const owned=await parse(getClient3WatchRevision(db,admin,1,makeUrl()))
assert.equal(owned.session.id,sessionId)
const otherBrand=await parse(getClient3WatchRevision(db,admin,2,makeUrl()))
assert.equal(otherBrand.session,null)
assert.equal(otherBrand.blocked,true)
const otherStart=await parse(startClient3WatchRevision(db,admin,2,{
 source:'office',full:true,
}))
assert.equal(otherStart.status,409)
const wrongModel=await parse(startClient3WatchRevision(db,admin,1,{
 source:'showcase',full:false,modelIds:[9999999],
}))
assert.equal(wrongModel.status,409)
const first=full.session.items.find(x=>x.variantId===vid)
assert(first,'Full brand check must include initial real watch')
const starting=stockState(vid).quantity
const stored=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId,itemId:first.id,countedQuantity:starting+2,
}))
assert.equal(stored.status,200,JSON.stringify(stored))
assert.equal(stored.session.countedCount,1)
assert.equal(stockState(vid).quantity,starting,'Draft count must not change stock before completion')
const afterReload=await parse(getClient3WatchRevision(db,admin,1,makeUrl()))
assert.equal(afterReload.session.items.find(x=>x.id===first.id).countedQuantity,starting+2,
 'Count survives a fresh session read/reopen')
const foreignCount=await parse(changeClient3WatchRevision(db,admin,2,'count',{
 sessionId,itemId:first.id,countedQuantity:100,
}))
assert.equal(foreignCount.status,409)
const wrongItem=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId,itemId:99999999,countedQuantity:3,
}))
assert.equal(wrongItem.status,404)
sqlite.prepare("UPDATE inventory_stock SET quantity=quantity+1 WHERE variant_id=? AND inventory_source='warehouse'")
 .run(vid)
const physicalMoved=stockState(vid).quantity
const blockedCompletion=await parse(changeClient3WatchRevision(db,admin,1,'complete',{sessionId}))
assert.equal(blockedCompletion.status,409,'Main refuses stale completion atomically')
assert.equal(blockedCompletion.code,'recount_required')
assert.equal(stockState(vid).quantity,physicalMoved)
const recount=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId,itemId:first.id,countedQuantity:physicalMoved+1,
}))
assert.equal(recount.status,200,JSON.stringify(recount))
assert.equal(recount.session.recountCount,0)
const movementCountBeforeClosing=count('inventory_movements')
const doneRevision=await parse(changeClient3WatchRevision(db,admin,1,'complete',{sessionId}))
assert.equal(doneRevision.status,200,JSON.stringify(doneRevision))
assert.equal(doneRevision.session.status,'completed')
assert.equal(stockState(vid).quantity,physicalMoved+1)
assert.equal(count('inventory_movements'),movementCountBeforeClosing+1)
const repeatClose=await parse(changeClient3WatchRevision(db,admin,1,'complete',{sessionId}))
assert.equal(repeatClose.status,200)
assert.equal(count('inventory_movements'),movementCountBeforeClosing+1,
 'Main completed session idempotence prevents duplicate movements')
assert.equal((await parse(getClient3WatchRevision(db,admin,1,makeUrl()))).session,null)
const selective=await parse(startClient3WatchRevision(db,admin,1,{
 source:'office',full:false,modelIds:[otanModelId],
}))
assert.equal(selective.status,200)
assert.equal(selective.session.scope,'selective')
assert(selective.session.items.every(x=>x.productName==='OTAN'))
const selectiveId=selective.session.id
const selectiveItem=selective.session.items[0]
const currentOtan=otanStock()
const held=await parse(changeClient3WatchRevision(db,admin,1,'count',{
 sessionId:selectiveId,itemId:selectiveItem.id,countedQuantity:currentOtan+7,
}))
assert.equal(held.status,200)
const canceled=await parse(changeClient3WatchRevision(db,admin,1,'cancel',{
 sessionId:selectiveId,
}))
assert.equal(canceled.status,200)
assert.equal(canceled.session.status,'cancelled')
assert.equal(otanStock(),currentOtan,'Cancellation cannot write physical quantity')
assert.equal((await parse(getClient3WatchRevision(db,admin,1,makeUrl()))).session,null)
const managerDenied=await parse(startClient3WatchRevision(db,{
 id:100,role:'manager',managerId:1,employeeRole:'Менеджер',
},1,{source:'office',full:true}))
assert.equal(managerDenied.status,403)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
assert.equal(count('orders'),baseOrders,'Warehouse operations cannot create business orders')
assert.equal(count('payments'),basePayments,'Warehouse operations cannot record money')
assert(count('inventory_movements')>=initialMovement+3,'All warehouse operations must leave movement history')
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_FULL_MAIN_STOCK_ENGINE_PASS: Main model-only to inline variant and physical receipt, 4 operation modes, brand/reservation/replay/foreign keys')
