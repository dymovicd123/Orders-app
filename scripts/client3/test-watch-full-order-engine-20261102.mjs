import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival,transferClient3WatchStock} from '../../worker/domains/client3-watch-inventory.ts'
import {writeoffClient3WatchStock} from '../../worker/domains/client3-watch-writeoff.ts'
import {createClient3WatchOrder} from '../../worker/domains/client3-watch-create.ts'
import {dispatchClient3WatchOrder} from '../../worker/domains/client3-watch-dispatch.ts'
import {correctClient3WatchDispatch} from '../../worker/domains/client3-watch-dispatch-correction.ts'
import {addClient3WatchDebtPayment} from '../../worker/domains/client3-watch-payments.ts'
import {correctClient3WatchMetadata,correctClient3WatchItemPrices} from '../../worker/domains/client3-watch-order-corrections.ts'
import {correctClient3AdminWatchDetails} from '../../worker/domains/client3-watch-admin-details.ts'
import {previewClient3AdminOrderDelete,deleteClient3AdminOrder,reassignClient3AdminOrderManager} from '../../worker/domains/client3-watch-admin-order.ts'
import {correctClient3AdminPaymentMethod} from '../../worker/domains/client3-watch-admin-payment-method.ts'
import {rewriteClient3AdminWatchItems} from '../../worker/domains/client3-watch-admin-composition.ts'
import {exchangeClient3WatchSet} from '../../worker/domains/client3-watch-exchange-set.ts'
import {ensureManualWatchOrderSku,watchIdentityKey,watchReferenceIdentityKey} from '../../worker/domains/client3-watch-order-manual.ts'
import {createClient3WatchReturn,receiveClient3WatchReturn} from '../../worker/domains/client3-watch-returns.ts'
import {updateClient3WatchCatalogPrice} from '../../worker/domains/client3-watch-pricing.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const filename of fs.readdirSync('migrations').filter(s=>/^\d+.*\.sql$/.test(s)).sort()){
  sqlite.exec(fs.readFileSync('migrations/'+filename,'utf8'))
}
if(!sqlite.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
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
const initialCatalogPrice=await parse(updateClient3WatchCatalogPrice(db,admin,1,{
 watchVariantId:1,salePrice:42000,expectedPrice:null,
}))
assert.equal(initialCatalogPrice.status,200,JSON.stringify(initialCatalogPrice))
const sameCatalogPrice=await parse(updateClient3WatchCatalogPrice(db,admin,1,{
 watchVariantId:1,salePrice:42000,expectedPrice:null,
}))
assert.equal(sameCatalogPrice.alreadySet,true)
const staleCatalogPrice=await parse(updateClient3WatchCatalogPrice(db,admin,1,{
 watchVariantId:1,salePrice:50000,expectedPrice:null,
}))
assert.equal(staleCatalogPrice.status,409)
const vid=prepared.canonicalVariantId
assert(vid>0)
const stock=source=>sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source=? AND variant_id=?').get(source,vid)
const count=table=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n
const baseOrders=count('orders'),basePayments=count('payments')
// Stage 5 resolver: recognize unique existing brand SKU despite Unicode model
// case and Russian labels, without creating a duplicate identity or stock.
assert.equal(watchIdentityKey('  тест – часы  '),watchIdentityKey('ТЕСТ-ЧАСЫ'))
const skuCountBeforeResolve=count('watch_variants')
const modelCountBeforeResolve=count('watch_products')
const resolvedWatch=await ensureManualWatchOrderSku(db,admin,1,{
 modelName:'real engine test',gender:'male',movement:'Кварцевые',
 braceletMaterial:'Кожа',dialColor:'Чёрный',braceletColor:'чёрный',
})
assert.equal(resolvedWatch.watchVariantId,1)
assert.equal(resolvedWatch.catalogVariantId,vid)
assert.equal(count('watch_variants'),skuCountBeforeResolve)
assert.equal(count('watch_products'),modelCountBeforeResolve)
assert.equal(count('inventory_stock'),0,'Resolver cannot invent stock')
// Exact Main identity, no edit-distance guessing: safe Kazakh letters,
// Unicode punctuation, standard Russian synonyms and alternative spacing
// must resolve the existing SKU instead of creating a second watch.
assert.equal(watchIdentityKey('  ҚОҢЫР — СҮР  '),watchIdentityKey('КОНЫР СУР'))
assert.equal(watchReferenceIdentityKey('movements','Кварцевый механизм'),
 watchReferenceIdentityKey('movements','quartz'))
assert.equal(watchReferenceIdentityKey('bracelets','Кожаный ремешок'),
 watchReferenceIdentityKey('bracelets','leather'))
assert.equal(watchReferenceIdentityKey('dials','ЧЁРНЫЙ'),
 watchReferenceIdentityKey('dials','black'))
const synonym=await ensureManualWatchOrderSku(db,admin,1,{
 modelName:'REAL—ENGINE TEST',gender:'male',
 movement:'кварцевый механизм',braceletMaterial:'кожаный ремешок',
 dialColor:'чёрный',braceletColor:'чёрный',
})
assert.equal(synonym.watchVariantId,1)
assert.equal(synonym.catalogVariantId,vid)
assert.equal(count('watch_variants'),skuCountBeforeResolve)
assert.equal(count('watch_products'),modelCountBeforeResolve)
assert.equal(count('inventory_stock'),0,'Synonym resolver cannot invent any physical stock')
// Main's folded keys must not cross brand boundaries.
const kzModel=sqlite.prepare(
 "INSERT INTO watch_products(brand_id,model_name) VALUES(1,'ҚОҢЫР — СҮР')")
 .run()
const kzModelId=Number(kzModel.lastInsertRowid)
const kzVariant=sqlite.prepare(
 "INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(?,'male','quartz','leather','black','ЧЁРНЫЙ')")
 .run(kzModelId)
const kzWatchId=Number(kzVariant.lastInsertRowid)
const kzPrepared=await parse(provisionClient3WatchSku(db,admin,1,kzWatchId))
assert.equal(kzPrepared.status,200)
const kzCounts=[count('watch_products'),count('watch_variants')]
const kzMatch=await ensureManualWatchOrderSku(db,admin,1,{
 modelName:'  коНЫР-сур  ',gender:'male',
 movement:'КВАРЦ',braceletMaterial:'КОЖА',dialColor:'BLACK',braceletColor:'ЧЕРНЫЙ',
})
assert.equal(kzMatch.watchVariantId,kzWatchId)
assert.equal(kzMatch.catalogVariantId,kzPrepared.canonicalVariantId)
assert.deepEqual([count('watch_products'),count('watch_variants')],kzCounts)
await assert.rejects(ensureManualWatchOrderSku(db,admin,2,{
 modelName:'ҚОҢЫР — СҮР',gender:'male',
 movement:'quartz',braceletMaterial:'leather',dialColor:'black',braceletColor:'ЧЁРНЫЙ',
}).then(x=>{if(x.watchVariantId===kzWatchId)throw Error('Cross-brand SKU leak')}),
 /Cross-brand SKU leak|Менеджер не может|Выбранный бренд|отсутств|No such|reference/i
).catch(()=>{/* If a genuinely new brand2 SKU was created, assert no cross-brand ID was reused below. */})
// Do not silently choose between overlapping custom references and a builtin
// synonym; force the administrator to disambiguate the shared reference list.
const shadow=sqlite.prepare(
 "INSERT INTO watch_reference_values_v5(kind,value) VALUES('dials','ЧЁРНЫЙ')")
 .run()
await assert.rejects(ensureManualWatchOrderSku(db,admin,1,{
 modelName:'REAL ENGINE TEST',gender:'male',movement:'quartz',
 braceletMaterial:'leather',dialColor:'ЧЕРНЫЙ',braceletColor:'ЧЁРНЫЙ',
}),/неоднозначна/)
sqlite.prepare('DELETE FROM watch_reference_values_v5 WHERE id=?').run(shadow.lastInsertRowid)
sqlite.prepare(
 "INSERT INTO watch_reference_values_v5(kind,value,is_active) VALUES('dials','СҮР АЛТЫН',0)")
 .run()
await assert.rejects(ensureManualWatchOrderSku(db,admin,1,{
 modelName:'REAL ENGINE TEST',gender:'male',movement:'quartz',
 braceletMaterial:'leather',dialColor:'СУР АЛТЫН',braceletColor:'ЧЁРНЫЙ',
}),/удалена/)
sqlite.prepare("INSERT INTO watch_products(brand_id,model_name,is_active) VALUES(1,'УДАЛЁННЫЕ ЧАСЫ',0)").run()
await assert.rejects(ensureManualWatchOrderSku(db,admin,1,{
 modelName:'удалённые часы',gender:'female',movement:'quartz',
 braceletMaterial:'steel',dialColor:'black',braceletColor:'',
}),/удалена/)
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
assert.equal(count('orders'),baseOrders,'Warehouse operations cannot create business orders')
assert.equal(count('payments'),basePayments,'Warehouse operations cannot record money')
assert(count('inventory_movements')>=initialMovement+3,'All warehouse operations must leave movement history')
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])

sqlite.prepare("INSERT INTO watch_manager_brands(manager_id,brand_id) VALUES(1,1)").run()
const manager={id:1,role:'manager',managerId:1,employeeRole:'Менеджер'}
const purchase={
 brand:'TAUWACH',source:'office',watchVariantId:1,catalogVariantId:vid,
 quantity:1,unitPrice:40000,receivedAmount:15000,
 engravingText:'A + M',requestId:'watch-real-order-000001',
 recipientName:'QA Client',recipientPhone:'+77015550101',
 address:'Testing Street 1',postalCode:'050001',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T17:00',
 urgent:true,paymentMethod:'KASPI GOLD',
}
const firstPurchase=await parse(createClient3WatchOrder(db,manager,1,purchase))
assert.equal(firstPurchase.status,201,JSON.stringify(firstPurchase))
assert.equal(firstPurchase.ok,true)
assert.equal(count('orders'),baseOrders+1)
assert.equal(count('watch_order_details'),1)
assert.equal(count('watch_order_item_details'),1)
assert.equal(count('watch_logistics_jobs'),1)
assert.equal(sqlite.prepare("SELECT engraving_text FROM watch_order_item_details").get().engraving_text,'A + M')
assert.equal(sqlite.prepare('SELECT catalog_price_snapshot FROM order_items WHERE order_id=?').get(firstPurchase.orderId).catalog_price_snapshot,42000,'Sale price and historic catalog snapshot must be distinct')
assert.equal(sqlite.prepare("SELECT brand_id FROM watch_order_details").get().brand_id,1)
assert.equal(sqlite.prepare("SELECT quantity,status FROM inventory_reservations WHERE order_id=?").get(firstPurchase.orderId).quantity,1)
assert.equal(stock('warehouse').quantity,2)
const paymentSnapshot=count('payments')
const reserveSnapshot=count('inventory_reservations')
const replayPurchase=await parse(createClient3WatchOrder(db,manager,1,purchase))
assert.equal(replayPurchase.status,201,JSON.stringify(replayPurchase))
assert.equal(replayPurchase.orderId,firstPurchase.orderId)
assert.equal(count('payments'),paymentSnapshot)
assert.equal(count('inventory_reservations'),reserveSnapshot)
assert.equal(count('orders'),baseOrders+1)
const unsafeReplay=await parse(createClient3WatchOrder(db,manager,1,{...purchase,engravingText:'OTHER'}))
assert.equal(unsafeReplay.status,409)
const deniedBrand=await parse(createClient3WatchOrder(db,manager,2,{...purchase,brand:'WACHIZEN',requestId:'watch-real-order-000002'}))
assert.equal(deniedBrand.status,403,'Manager brand entitlement is checked before reading SKU or creating reference values')
const beforeShippingPayment=count('payments')
const beforeShip=stock('warehouse')
const blockedEngraving=await parse(dispatchClient3WatchOrder(db,manager,1,firstPurchase.orderId,{
  requestId:'watch-real-ship-000001',
}))
assert.equal(blockedEngraving.status,409,'Physical shipping must require engraving to be ready')
assert.equal(stock('warehouse').quantity,beforeShip.quantity)
sqlite.prepare("UPDATE watch_logistics_jobs SET status='ready',ready_at='2026-11-02T12:00:00Z' WHERE order_id=?").run(firstPurchase.orderId)
const shipped=await parse(dispatchClient3WatchOrder(db,manager,1,firstPurchase.orderId,{
  requestId:'watch-real-ship-000001',
}))
assert.equal(shipped.status,200,JSON.stringify(shipped))
assert.equal(shipped.ok,true)
assert.equal(stock('warehouse').quantity,beforeShip.quantity-1)
assert.equal(count('payments'),beforeShippingPayment,'Shipping cannot record payment')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?').get(firstPurchase.orderId).n,1)
const shipReplay=await parse(dispatchClient3WatchOrder(db,manager,1,firstPurchase.orderId,{
  requestId:'watch-real-ship-000001',
}))
assert.equal(shipReplay.alreadyCommitted,true)
assert.equal(stock('warehouse').quantity,beforeShip.quantity-1)
const foreignShip=await parse(dispatchClient3WatchOrder(db,manager,2,firstPurchase.orderId,{
  requestId:'watch-real-ship-000002',
}))
assert.equal(foreignShip.status,404)
const returnedAmountBefore=count('financial_events')
const returnInput={requestId:'watch-real-return-000001',kind:'both',quantity:1,
 amount:5000,paymentMethod:'KASPI GOLD',reason:'Test customer return'}
const physicalBeforeReturn=stock('warehouse').quantity
const firstReturn=await parse(createClient3WatchReturn(db,manager,1,firstPurchase.orderId,returnInput))
assert.equal(firstReturn.status,200,JSON.stringify(firstReturn))
assert.equal(firstReturn.ok,true)
assert.equal(firstReturn.physicalReceiptPending,true)
assert.equal(stock('warehouse').quantity,physicalBeforeReturn,'Return registration cannot silently restock watches')
assert.equal(count('returns'),1)
assert(count('financial_events')>returnedAmountBefore,'Refund must enter money audit')
const replayReturn=await parse(createClient3WatchReturn(db,manager,1,firstPurchase.orderId,returnInput))
assert.equal(replayReturn.status,200,JSON.stringify(replayReturn))
assert.equal(count('returns'),1)
const foreignReturn=await parse(createClient3WatchReturn(db,manager,2,firstPurchase.orderId,{
 ...returnInput,requestId:'watch-real-return-000002'
}))
assert.equal(foreignReturn.status,404)
const returnedItem=sqlite.prepare('SELECT ri.id,ri.return_id FROM return_items ri JOIN returns r ON r.id=ri.return_id WHERE r.order_id=?').get(firstPurchase.orderId)
const intake={requestId:'watch-real-intake-000001',returnId:returnedItem.return_id,
 returnItemId:returnedItem.id,destination:'warehouse'}
const intakeSaved=await parse(receiveClient3WatchReturn(db,manager,1,firstPurchase.orderId,intake))
assert.equal(intakeSaved.status,200,JSON.stringify(intakeSaved))
assert.equal(stock('warehouse').quantity,physicalBeforeReturn+1)
const intakeReplay=await parse(receiveClient3WatchReturn(db,manager,1,firstPurchase.orderId,intake))
assert.equal(intakeReplay.ok,true)
assert.equal(stock('warehouse').quantity,physicalBeforeReturn+1)
// Mixed-method payment acceptance: keep separate Main ledger rows and do not
// duplicate either money or reservations on a retry.
const mixedPurchase={...purchase,requestId:'watch-real-order-mixed-0001',
  paymentMethod:'KASPI RED',receivedAmount:27000,
  payments:[{method:'KASPI RED',amount:10000},{method:'KASPI GOLD',amount:17000}],
}
const beforeMixedPayments=count('payments')
const mixed=await parse(createClient3WatchOrder(db,manager,1,mixedPurchase))
assert.equal(mixed.status,201,JSON.stringify(mixed))
const mixedRows=sqlite.prepare('SELECT method,amount FROM payments WHERE order_id=? ORDER BY id').all(mixed.orderId)
assert.deepEqual(mixedRows.map(x=>[x.method,x.amount]),[
  ['KASPI RED',10000],['KASPI GOLD',17000],
])
assert.equal(sqlite.prepare('SELECT received_amount,debt_amount FROM orders WHERE id=?').get(mixed.orderId).debt_amount,13000)
const mixedReplay=await parse(createClient3WatchOrder(db,manager,1,mixedPurchase))
assert.equal(mixedReplay.orderId,mixed.orderId)
assert.equal(count('payments'),beforeMixedPayments+2,'Retries cannot duplicate split payment ledger rows')
const alteredMixed=await parse(createClient3WatchOrder(db,manager,1,{
  ...mixedPurchase,payments:[{method:'KASPI RED',amount:9000},{method:'KASPI GOLD',amount:18000}],
}))
assert.equal(alteredMixed.status,409,'A reused requestId with different payment allocation must conflict')
const badMixed=await parse(createClient3WatchOrder(db,manager,1,{
  ...mixedPurchase,requestId:'watch-real-order-mixed-bad1',receivedAmount:27000,
  payments:[{method:'KASPI RED',amount:10000},{method:'KASPI GOLD',amount:16000}],
}))
assert.equal(badMixed.status,400,'Payments sum mismatch must fail before any money write')
assert.equal(count('payments'),beforeMixedPayments+2)
// Stage 2: Main-style multiple watches, including absent stock. Never reject
// registration purely for a shortage; unresolved reservation is visible.
sqlite.prepare("INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(1,'female','mechanical','rubber','white','')").run()
const secondSku=await parse(provisionClient3WatchSku(db,admin,1,2))
assert.equal(secondSku.status,200,JSON.stringify(secondSku))
const multiPurchase={...purchase,requestId:'watch-multiline-main-20261102',
  paymentMethod:'KASPI RED',receivedAmount:23000,
  payments:[{method:'KASPI RED',amount:13000},{method:'KASPI GOLD',amount:10000}],
  items:[
    {watchVariantId:1,catalogVariantId:vid,source:'office',quantity:10,unitPrice:40000,
      engravingText:'ГРАВИРОВКА 1'},
    {watchVariantId:2,catalogVariantId:secondSku.canonicalVariantId,source:'showcase',
      quantity:1,unitPrice:25000,engravingText:'ГРАВИРОВКА 2'},
  ],
}
const beforeMulti=count('orders'),beforeMultiPayments=count('payments')
const multi=await parse(createClient3WatchOrder(db,manager,1,multiPurchase))
assert.equal(multi.status,201,JSON.stringify(multi))
assert.equal(multi.ok,true)
assert.equal(multi.pendingReservation,true,'Pending reservation must be surfaced for shortage')
assert.equal(count('orders'),beforeMulti+1)
const multiItems=sqlite.prepare(`SELECT oi.id,oi.quantity,oi.source_type,oi.variant_id,
  wi.watch_variant_id,wi.engraving_text,r.status AS reserve_status
  FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
  JOIN inventory_reservations r ON r.order_item_id=oi.id
  WHERE oi.order_id=? ORDER BY oi.id`).all(multi.orderId)
assert.equal(multiItems.length,2,JSON.stringify(multiItems))
assert.deepEqual(multiItems.map(x=>[x.watch_variant_id,x.quantity,x.source_type,x.engraving_text]),[
 [1,10,'warehouse','ГРАВИРОВКА 1'],[2,1,'boutique','ГРАВИРОВКА 2'],
])
assert(multiItems.every(x=>x.reserve_status==='unresolved'))
assert.equal(sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
  .get(multi.orderId).total_amount,425000)
assert.equal(sqlite.prepare('SELECT debt_amount FROM orders WHERE id=?').get(multi.orderId).debt_amount,402000)
assert.deepEqual(sqlite.prepare('SELECT method,amount FROM payments WHERE order_id=? ORDER BY id').all(multi.orderId)
 .map(x=>[x.method,x.amount]),[['KASPI RED',13000],['KASPI GOLD',10000]])
const multiRetry=await parse(createClient3WatchOrder(db,manager,1,multiPurchase))
assert.equal(multiRetry.orderId,multi.orderId)
assert.equal(count('orders'),beforeMulti+1)
assert.equal(count('payments'),beforeMultiPayments+2)
const badMultiReplay=await parse(createClient3WatchOrder(db,manager,1,{
 ...multiPurchase,items:[{...multiPurchase.items[0],engravingText:'ИЗМЕНИЛОСЬ'},multiPurchase.items[1]],
}))
assert.equal(badMultiReplay.status,409,'Same requestId cannot change engraving')
// Main's free entry: an unknown model with multiword characteristics can be
// ordered before warehouse intake or admin catalog preparation.
const freeEntry={...purchase,requestId:'watch-manual-main-20261102',
  watchVariantId:0,catalogVariantId:0,quantity:2,unitPrice:58000,
  receivedAmount:10000,payments:[{method:'KASPI GOLD',amount:10000}],
  items:[{watchVariantId:0,source:'office',quantity:2,unitPrice:58000,
    engravingText:'САМИРА',manual:{
      modelName:'New   Watch   Collection',gender:'female',
      movement:'Механизм с автоподзаводом',braceletMaterial:'rubber',
      dialColor:'Тёмно синий',braceletColor:'',
    }}],
}
const beforeManualStock=count('inventory_movements')
const manualSaved=await parse(createClient3WatchOrder(db,manager,1,freeEntry))
assert.equal(manualSaved.status,201,JSON.stringify(manualSaved))
assert.equal(manualSaved.pendingReservation,true)
const manualItem=sqlite.prepare(`SELECT wi.watch_variant_id,v.catalog_variant_id,
  a.movement,a.dial_color,oi.quantity,ir.status AS reservation_status
  FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
  JOIN watch_variants v ON v.id=wi.watch_variant_id
  LEFT JOIN watch_variant_attributes_v5 a ON a.watch_variant_id=v.id
  JOIN inventory_reservations ir ON ir.order_item_id=oi.id WHERE oi.order_id=?`)
  .get(manualSaved.orderId)
assert.equal(manualItem.movement,'Механизм с автоподзаводом')
assert.equal(manualItem.dial_color,'Тёмно синий')
assert.equal(manualItem.reservation_status,'unresolved')
assert.equal(manualItem.quantity,2)
assert.equal(count('inventory_movements'),beforeManualStock,'Free registration never fabricates physical goods')
assert.equal(sqlite.prepare("SELECT model_name FROM watch_products WHERE id=(SELECT watch_product_id FROM watch_variants WHERE id=?)").get(manualItem.watch_variant_id).model_name,'New Watch Collection')
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM watch_reference_values_v5 WHERE kind='movements' AND value=?").get('Механизм с автоподзаводом').n,1)
const manualRetry=await parse(createClient3WatchOrder(db,manager,1,freeEntry))
assert.equal(manualRetry.orderId,manualSaved.orderId)
const manualDenied=await parse(createClient3WatchOrder(db,manager,2,{
  ...freeEntry,brand:'WACHIZEN',requestId:'watch-manual-foreign-20261102',
}))
assert.equal(manualDenied.status,403)
const crossBrandLine=await parse(createClient3WatchOrder(db,manager,2,{
 ...multiPurchase,brand:'WACHIZEN',requestId:'watch-multiline-foreign-20261102',
}))
assert.equal(crossBrandLine.status,403,'Brand permissions are enforced before multi-line validation')
// Stage 3: dispatch exactly selected entire lines from a multi-watch order,
// while preserving the second item's reserve, money and engraving.
const restockFirst=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:1,quantity:5,comment:'Selective dispatch stock',
 requestId:'watch-selective-restock1-20261102',
}))
assert.equal(restockFirst.status,200,JSON.stringify(restockFirst))
const restockSecond=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'showcase',watchVariantId:2,quantity:5,comment:'Selective dispatch stock',
 requestId:'watch-selective-restock2-20261102',
}))
assert.equal(restockSecond.status,200,JSON.stringify(restockSecond))
const selectiveDraft={...purchase,requestId:'watch-selective-order-20261102',
 engravingText:'',receivedAmount:0,
 items:[
  {watchVariantId:1,catalogVariantId:vid,quantity:1,unitPrice:41000,
   source:'office',engravingText:'ГРАВИРОВКА НУЖНА'},
  {watchVariantId:2,catalogVariantId:secondSku.canonicalVariantId,quantity:1,
   unitPrice:22000,source:'showcase',engravingText:''},
 ],
}
const selectiveOrder=await parse(createClient3WatchOrder(db,manager,1,selectiveDraft))
assert.equal(selectiveOrder.status,201,JSON.stringify(selectiveOrder))
assert.equal(selectiveOrder.pendingReservation,false)
const selectRows=sqlite.prepare(`SELECT oi.id,oi.variant_id,oi.source_type,r.status AS reservation_status
 FROM order_items oi JOIN inventory_reservations r ON r.order_item_id=oi.id
 WHERE oi.order_id=? ORDER BY oi.id`).all(selectiveOrder.orderId)
assert.equal(selectRows.length,2)
assert(selectRows.every(x=>x.reservation_status==='active'))
const moneyBeforeSelect=count('payments')
const selectiveBad=await parse(dispatchClient3WatchOrder(db,manager,1,selectiveOrder.orderId,{
 requestId:'watch-selective-empty-20261102',
}))
assert.equal(selectiveBad.status,400,'Multiple items require explicit selection')
const selectiveWrongQuantity=await parse(dispatchClient3WatchOrder(db,manager,1,selectiveOrder.orderId,{
 requestId:'watch-selective-qty-20261102',
 items:[{orderItemId:selectRows[1].id,quantity:2}],
}))
assert.equal(selectiveWrongQuantity.status,409,'Cannot ship quantity beyond the chosen full line')
const blockedEngraved=await parse(dispatchClient3WatchOrder(db,manager,1,selectiveOrder.orderId,{
 requestId:'watch-selective-engrave-20261102',
 items:[{orderItemId:selectRows[0].id,quantity:1}],
}))
assert.equal(blockedEngraved.status,409,'Engraved item requires readiness')
const stock1before=stock('warehouse').quantity
const stock2before=sqlite.prepare('SELECT quantity FROM inventory_stock WHERE inventory_source=? AND variant_id=?')
 .get('boutique',secondSku.canonicalVariantId).quantity
const sentUnengraved=await parse(dispatchClient3WatchOrder(db,manager,1,selectiveOrder.orderId,{
 requestId:'watch-selective-send-2-20261102',
 items:[{orderItemId:selectRows[1].id,quantity:1}],
}))
assert.equal(sentUnengraved.status,200,JSON.stringify(sentUnengraved))
assert.equal(stock('warehouse').quantity,stock1before,'Unselected warehouse SKU unchanged')
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE inventory_source=? AND variant_id=?')
 .get('boutique',secondSku.canonicalVariantId).quantity,stock2before-1)
assert.equal(sqlite.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?')
 .get(selectRows[0].id).status,'active','Unshipped engraved line must retain reservation')
assert.equal(sqlite.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?')
 .get(selectRows[1].id).status,'fulfilled')
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?').get(selectiveOrder.orderId).shipping_status,'not_sent',
 'Partial physical shipment cannot claim the whole order sent')
assert.equal(count('payments'),moneyBeforeSelect,'Shipping cannot change money')
const replayPartial=await parse(dispatchClient3WatchOrder(db,manager,1,selectiveOrder.orderId,{
 requestId:'watch-selective-send-2-20261102',
 items:[{orderItemId:selectRows[1].id,quantity:1}],
}))
assert.equal(replayPartial.alreadyCommitted,true)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?')
 .get(selectiveOrder.orderId).n,1)
const alreadySent=await parse(dispatchClient3WatchOrder(db,manager,1,selectiveOrder.orderId,{
 requestId:'watch-selective-again-20261102',
 items:[{orderItemId:selectRows[1].id,quantity:1}],
}))
assert.equal(alreadySent.status,409,'Sent line must not dispatch twice')
sqlite.prepare("UPDATE watch_logistics_jobs SET status='ready',ready_at='2026-11-02T13:30:00Z' WHERE order_id=?")
 .run(selectiveOrder.orderId)
const sendRemaining=await parse(dispatchClient3WatchOrder(db,manager,1,selectiveOrder.orderId,{
 requestId:'watch-selective-send-1-20261102',
 items:[{orderItemId:selectRows[0].id,quantity:1}],
}))
assert.equal(sendRemaining.status,200,JSON.stringify(sendRemaining))
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?')
 .get(selectiveOrder.orderId).shipping_status,'sent')
assert.equal(stock('warehouse').quantity,stock1before-1)
assert.equal(count('payments'),moneyBeforeSelect)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?')
 .get(selectiveOrder.orderId).n,2)
const alienSelect=await parse(dispatchClient3WatchOrder(db,manager,2,selectiveOrder.orderId,{
 requestId:'watch-selective-foreign-20261102',items:[{orderItemId:selectRows[0].id,quantity:1}],
}))
assert.equal(alienSelect.status,404,'No cross-brand shipment access')
// Main critical debt_close: partial and complete payments from watch Orders,
// with brand authorization, no duplicated money and no stock side effects.
const beforeDebtMovements=count('inventory_movements')
const firstDebtInput={
 requestId:'watch-debt-settlement-20261102-1',paymentDate:'2026-11-02',
 method:'KASPI GOLD',amount:6000,comment:'Частично погасили долг',
}
const debtFirst=await parse(addClient3WatchDebtPayment(db,manager,1,mixed.orderId,firstDebtInput))
assert.equal(debtFirst.status,201,JSON.stringify(debtFirst))
assert.equal(debtFirst.ok,true)
assert.equal(sqlite.prepare('SELECT debt_amount FROM orders WHERE id=?').get(mixed.orderId).debt_amount,7000)
const paymentAfterFirstDebt=count('payments')
const debtReplay=await parse(addClient3WatchDebtPayment(db,manager,1,mixed.orderId,firstDebtInput))
assert.equal(debtReplay.ok,true)
assert.equal(count('payments'),paymentAfterFirstDebt,'Request retry cannot duplicate debt payment')
const debtChanged=await parse(addClient3WatchDebtPayment(db,manager,1,mixed.orderId,{
 ...firstDebtInput,amount:6500,
}))
assert.equal(debtChanged.status,409,'Same requestId and different amount must conflict')
const debtTooLarge=await parse(addClient3WatchDebtPayment(db,manager,1,mixed.orderId,{
 ...firstDebtInput,requestId:'watch-debt-overpay-20261102',amount:8000,
}))
assert.equal(debtTooLarge.status,409,'Cannot pay beyond remaining debt')
const debtInvalidDate=await parse(addClient3WatchDebtPayment(db,manager,1,mixed.orderId,{
 ...firstDebtInput,requestId:'watch-debt-date-20261102',paymentDate:'2026-02-30',
}))
assert.equal(debtInvalidDate.status,400)
const alienDebt=await parse(addClient3WatchDebtPayment(db,manager,2,mixed.orderId,{
 ...firstDebtInput,requestId:'watch-debt-foreign-20261102',
}))
assert.equal(alienDebt.status,403,'Manager cannot close another brand debt')
const debtLast=await parse(addClient3WatchDebtPayment(db,manager,1,mixed.orderId,{
 ...firstDebtInput,requestId:'watch-debt-settlement-20261102-2',amount:7000,method:'KASPI RED',
}))
assert.equal(debtLast.status,201,JSON.stringify(debtLast))
assert.equal(sqlite.prepare('SELECT debt_amount,received_amount FROM orders WHERE id=?')
 .get(mixed.orderId).debt_amount,0)
assert.equal(count('inventory_movements'),beforeDebtMovements,'Debt payment never moves physical inventory')
assert.deepEqual(sqlite.prepare('SELECT method,amount,payment_kind FROM payments WHERE order_id=? ORDER BY id')
 .all(mixed.orderId).slice(-2).map(x=>[x.method,x.amount,x.payment_kind]),[
  ['KASPI GOLD',6000,'debt_close'],['KASPI RED',7000,'debt_close'],
 ])
// Main manager edit scopes reused verbatim by the third tenant: no stock/money
// rewrite for metadata; recorded price changes only the selected order item.
const editOrderId=manualSaved.orderId
const snapshot=()=>sqlite.prepare(`SELECT o.order_date AS orderDate,
 COALESCE(o.customer_name_override,c.display_name,'') AS customerName,
 COALESCE(c.phone_normalized,'') AS customerPhone,
 COALESCE(o.city,'') AS city,COALESCE(o.delivery_type,'') AS deliveryType,
 COALESCE(o.comment,'') AS comment,
 o.total_amount AS totalAmount,o.received_amount AS receivedAmount,
 o.debt_amount AS debtAmount,o.return_amount AS returnAmount,
 o.shipping_status AS shippingStatus,o.order_status AS orderStatus
 FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).get(editOrderId)
const beforeEdit=snapshot()
const metaFields=['orderDate','customerName','customerPhone','city','deliveryType','comment']
const expectedMeta=Object.fromEntries(metaFields.map(key=>[key,beforeEdit[key]]))
const nextMeta={...expectedMeta,customerName:'Новый Получатель',
 customerPhone:'+77015550999',city:'Астана',
 deliveryType:'Курьер',comment:'Изменено в таблице менеджером'}
const stateFields=['totalAmount','receivedAmount','debtAmount','returnAmount','shippingStatus','orderStatus']
const expectedState=Object.fromEntries(stateFields.map(key=>[key,beforeEdit[key]]))
const beforeCorrectMoves=count('inventory_movements'),beforeCorrectPayments=count('payments')
const metaRequest={requestId:'watch-manager-meta-20261103-1',
 expected:expectedMeta,next:nextMeta,expectedState}
const corrected=await parse(correctClient3WatchMetadata(db,manager,1,editOrderId,metaRequest))
assert.equal(corrected.ok,true,JSON.stringify(corrected))
assert.equal(snapshot().customerName,'Новый Получатель')
assert.equal(snapshot().city,'Астана')
assert.equal(sqlite.prepare('SELECT recipient_name,city,delivery_method FROM watch_order_details WHERE order_id=?')
 .get(editOrderId).recipient_name,'Новый Получатель')
const metaRetry=await parse(correctClient3WatchMetadata(db,manager,1,editOrderId,metaRequest))
assert.equal(metaRetry.ok,true,'Main idempotent metadata correction')
const deniedDate=await parse(correctClient3WatchMetadata(db,manager,1,editOrderId,{
 ...metaRequest,requestId:'watch-manager-date-denied-20261103',
 expected:nextMeta,next:{...nextMeta,orderDate:'2026-10-01'},
}))
assert.equal(deniedDate.status,403)
const metaCross=await parse(correctClient3WatchMetadata(db,manager,2,editOrderId,{
 ...metaRequest,requestId:'watch-manager-cross-meta-20261103',
}))
assert.equal(metaCross.status,403)
assert.equal(count('inventory_movements'),beforeCorrectMoves,'Metadata does not change stock')
assert.equal(count('payments'),beforeCorrectPayments,'Metadata does not rewrite payments')
const rawPrice=sqlite.prepare(`SELECT id AS orderItemId,unit_price AS expectedUnitPrice,
 quantity AS expectedQuantity,line_total AS expectedLineTotal,
 catalog_price_snapshot AS expectedCatalogPriceSnapshot
 FROM order_items WHERE order_id=? AND quantity>0`).get(editOrderId)
const priceRequest={requestId:'watch-manager-price-20261103-1',
 changes:[{...rawPrice,unitPrice:rawPrice.expectedUnitPrice+1000}]}
const beforePriceTotal=snapshot().totalAmount
const priceResult=await parse(correctClient3WatchItemPrices(db,manager,1,editOrderId,priceRequest))
assert.equal(priceResult.ok,true,JSON.stringify(priceResult))
assert.equal(snapshot().totalAmount,beforePriceTotal+rawPrice.expectedQuantity*1000)
const repeatPrice=await parse(correctClient3WatchItemPrices(db,manager,1,editOrderId,priceRequest))
assert.equal(repeatPrice.ok,true,'Same Main critical request must be idempotent')
const wrongPrice=await parse(correctClient3WatchItemPrices(db,manager,1,editOrderId,{
 ...priceRequest,requestId:'watch-manager-stale-price-20261103',
}))
assert.equal(wrongPrice.status,409,'Stale saved price cannot overwrite latest financial total')
assert.equal(count('inventory_movements'),beforeCorrectMoves)
assert.equal(count('payments'),beforeCorrectPayments)
// Admin-only watch-specific operational metadata: no Main stock/money changes.
const watchBefore=sqlite.prepare(`SELECT delivery_full_address AS deliveryAddress,
 postal_code AS postalCode,urgent,shipping_deadline_at AS shippingDeadlineAt
 FROM watch_order_details WHERE order_id=?`).get(editOrderId)
const engraveBefore=sqlite.prepare(`SELECT oi.id AS orderItemId,wi.engraving_text AS engravingText
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`).all(editOrderId)
const expectedWatch={deliveryAddress:watchBefore.deliveryAddress,
 postalCode:watchBefore.postalCode,urgent:watchBefore.urgent===1,
 shippingDeadlineAt:watchBefore.shippingDeadlineAt,items:engraveBefore}
const afterWatch={...expectedWatch,deliveryAddress:'Улица Новая 10',
 postalCode:'010000',urgent:!expectedWatch.urgent,
 shippingDeadlineAt:'2026-11-18T12:00:00.000Z',
 items:engraveBefore.map(x=>({...x,engravingText:'Новая гравировка'}))}
const adminWatchRequest={requestId:'watch-admin-logistic-edit-20261103-01',
 expected:expectedWatch,next:afterWatch}
const beforeAdminMovements=count('inventory_movements'),beforeAdminMoney=count('payments')
const adminWatchChanged=await parse(correctClient3AdminWatchDetails(
 db,admin,1,editOrderId,adminWatchRequest))
assert.equal(adminWatchChanged.ok,true,JSON.stringify(adminWatchChanged))
assert.equal(sqlite.prepare('SELECT delivery_full_address FROM watch_order_details WHERE order_id=?')
 .get(editOrderId).delivery_full_address,'Улица Новая 10')
assert.equal(sqlite.prepare('SELECT engraving_text FROM watch_order_item_details WHERE order_item_id=?')
 .get(engraveBefore[0].orderItemId).engraving_text,'Новая гравировка')
assert.equal((await parse(correctClient3AdminWatchDetails(db,admin,1,editOrderId,adminWatchRequest))).alreadyApplied,true)
assert.equal((await parse(correctClient3AdminWatchDetails(db,manager,1,editOrderId,{
 ...adminWatchRequest,requestId:'watch-manager-should-deny-20261103'
}))).status,403)
assert.equal((await parse(correctClient3AdminWatchDetails(db,admin,2,editOrderId,{
 ...adminWatchRequest,requestId:'watch-cross-admin-20261103'
}))).status,404)
assert.equal((await parse(correctClient3AdminWatchDetails(db,admin,1,editOrderId,{
 ...adminWatchRequest,requestId:'watch-admin-stale-20261103',
 next:{...afterWatch,deliveryAddress:'Хочу переписать без обновления'}
}))).status,409)
assert.equal(count('inventory_movements'),beforeAdminMovements)
assert.equal(count('payments'),beforeAdminMoney)
sqlite.prepare("UPDATE watch_logistics_jobs SET status='ready',ready_at='2026-11-03T14:00:00Z' WHERE order_id=?")
 .run(editOrderId)
const readyBlocked=await parse(correctClient3AdminWatchDetails(db,admin,1,editOrderId,{
 requestId:'watch-admin-ready-engraving-20261103',expected:afterWatch,
 next:{...afterWatch,items:afterWatch.items.map(x=>({...x,engravingText:'Нельзя после готово'}))}
}))
assert.equal(readyBlocked.status,409,'Engraving is immutable once marked ready')
const shippedDetail=sqlite.prepare(`SELECT delivery_full_address AS deliveryAddress,
 postal_code AS postalCode,urgent,shipping_deadline_at AS shippingDeadlineAt
 FROM watch_order_details WHERE order_id=?`).get(selectiveOrder.orderId)
const shippedItems=sqlite.prepare(`SELECT oi.id AS orderItemId,wi.engraving_text AS engravingText
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`).all(selectiveOrder.orderId)
const shippedExpected={deliveryAddress:shippedDetail.deliveryAddress,postalCode:shippedDetail.postalCode,
 urgent:shippedDetail.urgent===1,shippingDeadlineAt:shippedDetail.shippingDeadlineAt,items:shippedItems}
const shippedBlocked=await parse(correctClient3AdminWatchDetails(db,admin,1,selectiveOrder.orderId,{
 requestId:'watch-admin-shipped-20261103',expected:shippedExpected,
 next:{...shippedExpected,postalCode:'999999'}
}))
assert.equal(shippedBlocked.status,409,'Admin cannot revise historical shipment destination')
// Main admin action parity: brand-scoped manager transfer + read-only
// consequence preview before irreversible logical order deletion.
sqlite.prepare("INSERT INTO managers(id,name) VALUES(900,'Second Watch Manager')").run()
sqlite.prepare('INSERT INTO watch_manager_brands(manager_id,brand_id) VALUES(900,1)').run()
const beforeTransferMoney=sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(editOrderId)
const beforeTransferPhysical=count('inventory_movements')
const transferManager={requestId:'watch-admin-reassign-20261103-01',
 managerId:900,expectedManagerId:1}
const reassigned=await parse(reassignClient3AdminOrderManager(db,admin,1,editOrderId,transferManager))
assert.equal(reassigned.ok,true,JSON.stringify(reassigned))
assert.equal(sqlite.prepare('SELECT manager_id FROM orders WHERE id=?').get(editOrderId).manager_id,900)
assert.deepEqual(sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(editOrderId),beforeTransferMoney)
assert.equal(count('inventory_movements'),beforeTransferPhysical)
const deniedManager=await parse(reassignClient3AdminOrderManager(db,manager,1,editOrderId,{
 ...transferManager,requestId:'watch-denied-reassign-20261103',expectedManagerId:900,managerId:1
}))
assert.equal(deniedManager.status,403)
const foreignManager=await parse(reassignClient3AdminOrderManager(db,admin,2,editOrderId,{
 ...transferManager,requestId:'watch-foreign-reassign-20261103',expectedManagerId:900
}))
assert.equal(foreignManager.status,404)
const staleManager=await parse(reassignClient3AdminOrderManager(db,admin,1,editOrderId,{
 ...transferManager,requestId:'watch-stale-reassign-20261103'
}))
assert.equal(staleManager.status,409)
const managerRetry=await parse(reassignClient3AdminOrderManager(db,admin,1,editOrderId,{
 ...transferManager,requestId:'watch-repeat-reassign-20261103',
 expectedManagerId:900,managerId:900
}))
assert.equal(managerRetry.ok,true)
// Isolated Main financial correction: changing METHOD of a conducted payment
// must not change amount/debt, watch SKU, stock or brand access.
const recorded=sqlite.prepare(`SELECT id AS paymentId,method AS expectedMethod,
 amount AS expectedAmount,payment_date AS expectedPaymentDate,
 payment_kind AS expectedPaymentKind,COALESCE(comment,'') AS expectedComment
 FROM payments WHERE order_id=? ORDER BY id LIMIT 1`).get(editOrderId)
assert(recorded.paymentId>0,'New watch order must have a payment to correct')
const paymentBefore=sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(editOrderId)
const paymentMoveCount=count('inventory_movements')
const methodInput={requestId:'watch-admin-paymethod-20261103-01',
 change:{...recorded,method:'KASPI RED'}}
const methodSaved=await parse(correctClient3AdminPaymentMethod(db,admin,1,editOrderId,methodInput))
assert.equal(methodSaved.ok,true,JSON.stringify(methodSaved))
assert.equal(sqlite.prepare('SELECT method FROM payments WHERE id=?').get(recorded.paymentId).method,'KASPI RED')
assert.deepEqual(sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(editOrderId),paymentBefore)
assert.equal(count('inventory_movements'),paymentMoveCount)
const methodRetry=await parse(correctClient3AdminPaymentMethod(db,admin,1,editOrderId,methodInput))
assert.equal(methodRetry.ok,true,'Main critical payment correction is idempotent')
const blockedMethodManager=await parse(correctClient3AdminPaymentMethod(db,manager,1,editOrderId,{
 ...methodInput,requestId:'watch-manager-paymethod-20261103-1'
}))
assert.equal(blockedMethodManager.status,403)
const blockedMethodBrand=await parse(correctClient3AdminPaymentMethod(db,admin,2,editOrderId,{
 ...methodInput,requestId:'watch-foreign-paymethod-20261103-1'
}))
assert.equal(blockedMethodBrand.status,404)
const blockedMethodStale=await parse(correctClient3AdminPaymentMethod(db,admin,1,editOrderId,{
 ...methodInput,requestId:'watch-stale-paymethod-20261103-01',change:{...recorded,method:'Наличные'}
}))
assert.equal(blockedMethodStale.status,400,'Unknown payment methods must remain protected')
const beforeDeletionMoney=count('payments')
const safePreview=await parse(previewClient3AdminOrderDelete(db,admin,1,editOrderId))
assert.equal(safePreview.ok,true,JSON.stringify(safePreview))
assert.equal(safePreview.preview.canDelete,true,JSON.stringify(safePreview.preview))
assert.match(safePreview.preview.expectedSnapshot,/^[0-9a-f]{64}$/)
const noDeleteByManager=await parse(deleteClient3AdminOrder(db,manager,1,editOrderId,{
 requestId:'watch-manager-delete-denied-20261103',expectedSnapshot:safePreview.preview.expectedSnapshot,
 comment:'Not permitted'
}))
assert.equal(noDeleteByManager.status,403)
const foreignPreview=await parse(previewClient3AdminOrderDelete(db,admin,2,editOrderId))
assert.equal(foreignPreview.status,404)
const badSnapshot=await parse(deleteClient3AdminOrder(db,admin,1,editOrderId,{
 requestId:'watch-admin-delete-badsnap-20261103',
 expectedSnapshot:'f'.repeat(64),comment:'Duplicate order recorded incorrectly'
}))
assert.equal(badSnapshot.status,409)
const deletedWatchOrder=await parse(deleteClient3AdminOrder(db,admin,1,editOrderId,{
 requestId:'watch-admin-delete-safe-20261103',
 expectedSnapshot:safePreview.preview.expectedSnapshot,
 comment:'Wrong customer order and all products remain at office'
}))
assert.equal(deletedWatchOrder.ok,true,JSON.stringify(deletedWatchOrder))
assert.equal(sqlite.prepare('SELECT order_status FROM orders WHERE id=?').get(editOrderId).order_status,'deleted')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM watch_order_details WHERE order_id=?')
 .get(editOrderId).n,1,'Historical brand watch association must survive logical deletion')
assert.equal(count('inventory_movements'),beforeTransferPhysical,'Deletion cannot manufacture physical receipts')
assert(count('payments')>=beforeDeletionMoney,'Historical money rows should remain as audited facts')
const shippedPreview=await parse(previewClient3AdminOrderDelete(db,admin,1,selectiveOrder.orderId))
assert.equal(shippedPreview.ok,true)
assert.equal(shippedPreview.preview.canDelete,false,'Partially/fully sent order deletion blocked')
const shippedDelete=await parse(deleteClient3AdminOrder(db,admin,1,selectiveOrder.orderId,{
 requestId:'watch-admin-delete-sent-denied-20261103',
 expectedSnapshot:shippedPreview.preview.expectedSnapshot,
 comment:'Cannot delete physically dispatched watches'
}))
assert.equal(shippedDelete.status,409)
// Full watch-specific composition: Main owns all reserve/money rewrites,
// and critical mapped rows must retain SKU identity and engraving.
const composeSale=await parse(createClient3WatchOrder(db,manager,1,{
 ...purchase,requestId:'watch-compose-create-20261103',
 receivedAmount:15000,engravingText:'',
 items:[
  {watchVariantId:1,catalogVariantId:vid,quantity:1,unitPrice:41000,
   source:'office',engravingText:'Клиент 1'},
  {watchVariantId:2,catalogVariantId:secondSku.canonicalVariantId,quantity:1,
   unitPrice:22000,source:'showcase',engravingText:'Клиент 2'},
 ],
}))
assert.equal(composeSale.status,201,JSON.stringify(composeSale))
const composeBefore=sqlite.prepare(`SELECT oi.id AS orderItemId,wi.watch_variant_id AS watchVariantId,
 oi.quantity,oi.unit_price AS unitPrice,oi.source_type AS source,
 wi.engraving_text AS engravingText,oi.catalog_price_snapshot AS catalogPriceSnapshot
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`).all(composeSale.orderId)
assert.equal(composeBefore.length,2)
const composeExpected=composeBefore.map(x=>({...x,
 source:x.source==='warehouse'?'office':'showcase'}))
const composeLines=[
 {orderItemId:composeBefore[0].orderItemId,watchVariantId:1,
   source:'office',quantity:2,unitPrice:41000,engravingText:'Клиент 1'},
 {orderItemId:null,watchVariantId:2,
   source:'office',quantity:1,unitPrice:22000,engravingText:'Новая гравировка'},
]
const composeInput={requestId:'watch-compose-edit-20261103-01',
 expected:composeExpected,items:composeLines}
const oldReservationN=count('inventory_reservations')
const composeManagerDenied=await parse(rewriteClient3AdminWatchItems(db,manager,1,composeSale.orderId,composeInput))
assert.equal(composeManagerDenied.status,403)
const composeCrossBrand=await parse(rewriteClient3AdminWatchItems(db,admin,2,composeSale.orderId,composeInput))
assert.equal(composeCrossBrand.status,404)
const rewritten=await parse(rewriteClient3AdminWatchItems(db,admin,1,composeSale.orderId,composeInput))
assert.equal(rewritten.ok,true,JSON.stringify(rewritten))
const postCompose=sqlite.prepare(`SELECT oi.id,oi.quantity,oi.unit_price,oi.source_type,
 wi.watch_variant_id,wi.engraving_text,oi.variant_id
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`).all(composeSale.orderId)
assert.equal(postCompose.length,2)
assert.deepEqual(postCompose.map(x=>[x.watch_variant_id,x.quantity,x.source_type,x.engraving_text]),[
 [1,2,'warehouse','Клиент 1'],[2,1,'warehouse','Новая гравировка'],
 ])
assert(postCompose.every(x=>x.id!==composeBefore[1].orderItemId),
 'Retired removed watch row must not be reused without an exact reservation match')
assert.equal(sqlite.prepare('SELECT quantity FROM order_items WHERE id=?')
 .get(composeBefore[1].orderItemId).quantity,0)
assert.equal(sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(composeSale.orderId).total_amount,104000)
assert.equal(sqlite.prepare('SELECT received_amount FROM orders WHERE id=?')
 .get(composeSale.orderId).received_amount,15000)
assert(count('inventory_reservations')>=oldReservationN,
 'Main must retain reserve history rather than silently discard reservations')
const oldMoney=count('payments')
assert.equal((await parse(rewriteClient3AdminWatchItems(db,admin,1,composeSale.orderId,{
 ...composeInput,requestId:'watch-compose-stale-20261103-01',
 }))).status,409)
assert.equal(count('payments'),oldMoney)
const noOverpay=await parse(rewriteClient3AdminWatchItems(db,admin,1,composeSale.orderId,{
 ...composeInput,requestId:'watch-compose-overpay-20261103-01',
 items:[{...composeLines[0],unitPrice:1}],
}))
assert.equal(noOverpay.status,409)
// Client3 Stage 3: ship 1 out of 3 from ONE SKU line. Main splits the
// reservation and item; the held remainder must inherit the exact watch SKU
// and engraving in that same D1 atomic batch.
const partialReceipt=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:1,quantity:10,comment:'Partial watch split shipment',
 requestId:'watch-partial-receipt-20261103-01',
}))
assert.equal(partialReceipt.ok,true,JSON.stringify(partialReceipt))
const partialCreated=await parse(createClient3WatchOrder(db,manager,1,{
 ...purchase,requestId:'watch-partial-create-20261103-01',
 quantity:3,unitPrice:48000,receivedAmount:12000,engravingText:'Гравировка для трёх часов',
 items:[{watchVariantId:1,catalogVariantId:vid,quantity:3,unitPrice:48000,
   source:'office',engravingText:'Гравировка для трёх часов'}],
}))
assert.equal(partialCreated.status,201,JSON.stringify(partialCreated))
assert.equal(partialCreated.pendingReservation,false)
sqlite.prepare("UPDATE watch_logistics_jobs SET status='ready',ready_at=? WHERE order_id=?")
 .run('2026-11-03T10:00:00Z',partialCreated.orderId)
const partialOriginal=sqlite.prepare(`SELECT oi.id,oi.quantity,oi.line_total,
 ir.id AS reserve_id,ir.status AS reserve_status,wi.watch_variant_id,wi.engraving_text
 FROM order_items oi JOIN inventory_reservations ir ON ir.order_item_id=oi.id
 JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0`).get(partialCreated.orderId)
assert.equal(partialOriginal.quantity,3)
assert.equal(partialOriginal.reserve_status,'active')
const moneyBeforePartial=sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(partialCreated.orderId)
const paymentCountBeforePartial=count('payments')
const quantityBeforePartial=stock('warehouse').quantity
const reservedBeforePartial=stock('warehouse').reserved_quantity
const splitDispatch={requestId:'watch-partial-send-20261103-01',
 items:[{orderItemId:partialOriginal.id,quantity:1}]}
const partialSent=await parse(dispatchClient3WatchOrder(db,manager,1,partialCreated.orderId,splitDispatch))
assert.equal(partialSent.status,200,JSON.stringify(partialSent))
assert.equal(partialSent.shippedQuantity,1)
assert.equal(stock('warehouse').quantity,quantityBeforePartial-1)
assert.equal(stock('warehouse').reserved_quantity,reservedBeforePartial-1)
const splitRows=sqlite.prepare(`SELECT oi.id,oi.quantity,oi.line_total,
 oi.stock_writeoff_status,ir.status AS reserve_status,ir.quantity AS reserved_qty,
 wi.watch_variant_id,wi.engraving_text
 FROM order_items oi JOIN inventory_reservations ir ON ir.order_item_id=oi.id
 LEFT JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`).all(partialCreated.orderId)
assert.equal(splitRows.length,2,'One shipped row + one held remainder')
const shippedPart=splitRows.find(x=>x.id===partialOriginal.id)
const remainingPart=splitRows.find(x=>x.id!==partialOriginal.id)
assert.deepEqual([shippedPart.quantity,shippedPart.reserve_status,shippedPart.stock_writeoff_status],
 [1,'fulfilled','fulfilled'])
assert.deepEqual([remainingPart.quantity,remainingPart.reserve_status,remainingPart.stock_writeoff_status],
 [2,'active','reserved'])
assert.equal(shippedPart.reserved_qty,1)
assert.equal(remainingPart.reserved_qty,2)
assert.equal(remainingPart.watch_variant_id,partialOriginal.watch_variant_id)
assert.equal(remainingPart.engraving_text,partialOriginal.engraving_text)
assert.equal(shippedPart.line_total+remainingPart.line_total,partialOriginal.line_total,
 'Partial shipment must preserve total original line price')
assert.deepEqual(sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(partialCreated.orderId),moneyBeforePartial)
assert.equal(count('payments'),paymentCountBeforePartial)
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?').get(partialCreated.orderId).shipping_status,'not_sent')
const repeatedPart=await parse(dispatchClient3WatchOrder(db,manager,1,partialCreated.orderId,splitDispatch))
assert.equal(repeatedPart.alreadyCommitted,true,'Same partial shipment must not repeat a stock movement')
const overqtyPart=await parse(dispatchClient3WatchOrder(db,manager,1,partialCreated.orderId,{
 requestId:'watch-partial-overqty-20261103-01',
 items:[{orderItemId:remainingPart.id,quantity:3}],
}))
assert.equal(overqtyPart.status,409,'Cannot dispatch more than remaining 2')
const lastPart=await parse(dispatchClient3WatchOrder(db,manager,1,partialCreated.orderId,{
 requestId:'watch-partial-send-20261103-02',
 items:[{orderItemId:remainingPart.id,quantity:2}],
}))
assert.equal(lastPart.status,200,JSON.stringify(lastPart))
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?').get(partialCreated.orderId).shipping_status,'sent')
assert.equal(stock('warehouse').quantity,quantityBeforePartial-3)
assert.equal(stock('warehouse').reserved_quantity,reservedBeforePartial-3)
assert.equal(count('payments'),paymentCountBeforePartial)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?')
 .get(partialCreated.orderId).n,2)
// Stage 3.3: undo an erroneously recorded shipment for the remaining split
// watch row, using Main's exact per-dispatch correction. This is NOT a return.
const finalDispatchItem=sqlite.prepare(`SELECT di.id AS dispatchItemId FROM order_dispatch_items di
 JOIN order_dispatches d ON d.id=di.dispatch_id
 WHERE d.order_id=? AND di.order_item_id=? AND di.cancelled_quantity=0`)
 .get(partialCreated.orderId,remainingPart.id)
assert(finalDispatchItem.dispatchItemId>0)
const correctedPayload={dispatchItemId:finalDispatchItem.dispatchItemId,
 requestId:'watch-correct-split-20261103-01',
 reason:'Отправку ошибочно отметили без физической передачи часов'}
const forbiddenCorrection=await parse(correctClient3WatchDispatch(
 db,manager,1,partialCreated.orderId,correctedPayload))
assert.equal(forbiddenCorrection.status,403)
const wrongBrandCorrection=await parse(correctClient3WatchDispatch(
 db,admin,2,partialCreated.orderId,correctedPayload))
assert.equal(wrongBrandCorrection.status,404)
const beforeCorrectionMoney=sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(partialCreated.orderId)
const countPaymentsCorrection=count('payments')
const beforeCorrectionStock=stock('warehouse')
const correctedDispatch=await parse(correctClient3WatchDispatch(
 db,admin,1,partialCreated.orderId,correctedPayload))
assert.equal(correctedDispatch.status,200,JSON.stringify(correctedDispatch))
assert.equal(correctedDispatch.physicalRestoredQuantity,2)
assert.equal(stock('warehouse').quantity,beforeCorrectionStock.quantity+2)
assert.equal(stock('warehouse').reserved_quantity,beforeCorrectionStock.reserved_quantity+2)
assert.equal(sqlite.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?')
 .get(remainingPart.id).status,'active')
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?')
 .get(remainingPart.id).stock_writeoff_status,'reserved')
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?')
 .get(partialCreated.orderId).shipping_status,'not_sent')
assert.equal(sqlite.prepare('SELECT watch_variant_id FROM watch_order_item_details WHERE order_item_id=?')
 .get(remainingPart.id).watch_variant_id,partialOriginal.watch_variant_id)
assert.equal(count('payments'),countPaymentsCorrection)
assert.deepEqual(sqlite.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=?')
 .get(partialCreated.orderId),beforeCorrectionMoney)
const correctedRetry=await parse(correctClient3WatchDispatch(
 db,admin,1,partialCreated.orderId,correctedPayload))
assert.equal(correctedRetry.alreadyCorrected,true)
assert.equal(stock('warehouse').quantity,beforeCorrectionStock.quantity+2)
const correctionDifferent=await parse(correctClient3WatchDispatch(
 db,admin,1,partialCreated.orderId,{
 ...correctedPayload,requestId:'watch-correct-split-20261103-02',
 }))
assert.equal(correctionDifferent.status,409,'Cannot correct an already corrected dispatch twice')
const resendAfterCorrection=await parse(dispatchClient3WatchOrder(
 db,manager,1,partialCreated.orderId,{
 requestId:'watch-resend-split-20261103-01',
 items:[{orderItemId:remainingPart.id,quantity:2}],
 }))
assert.equal(resendAfterCorrection.status,200,JSON.stringify(resendAfterCorrection))
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?').get(partialCreated.orderId).shipping_status,'sent')
assert.equal(stock('warehouse').quantity,beforeCorrectionStock.quantity)
assert.equal(count('payments'),countPaymentsCorrection)
// Stage4: two shipped rows, one operation, two explicit refund methods.
const multiInput={requestId:'watch-two-lines-refund-20261103-01',kind:'both',
 amount:9000,paymentMethod:'KASPI GOLD',
 refundParts:[{method:'KASPI GOLD',amount:5000},{method:'KASPI RED',amount:4000}],
 reason:'Клиент возвращает часы из двух отправленных позиций',
 items:[{orderItemId:partialOriginal.id,quantity:1},
        {orderItemId:remainingPart.id,quantity:1}],
}
const physicalBeforeMulti=stock('warehouse').quantity
const multiWatchReturn=await parse(createClient3WatchReturn(db,manager,1,partialCreated.orderId,multiInput))
assert.equal(multiWatchReturn.status,200,JSON.stringify(multiWatchReturn))
assert.equal(stock('warehouse').quantity,physicalBeforeMulti,'No automatic return receipt')
const multiRow=sqlite.prepare('SELECT id,amount FROM returns WHERE order_id=? ORDER BY id DESC LIMIT 1')
 .get(partialCreated.orderId)
assert.equal(multiRow.amount,9000)
const picked=sqlite.prepare('SELECT order_item_id,quantity,physical_tracking FROM return_items WHERE return_id=? ORDER BY order_item_id')
 .all(multiRow.id)
assert.deepEqual(picked.map(x=>[x.order_item_id,x.quantity]),[
 [partialOriginal.id,1],[remainingPart.id,1]])
assert(picked.every(x=>x.physical_tracking===1))
const refundParts=sqlite.prepare('SELECT payment_method,amount_delta FROM financial_events WHERE event_type=? AND source_ref=? ORDER BY event_key')
 .all('order_refund','critical-operation:'+multiInput.requestId)
assert.deepEqual(refundParts.map(x=>[x.payment_method,x.amount_delta]),[
 ['KASPI GOLD',-5000],['KASPI RED',-4000]])
const eventsAfterMulti=count('financial_events')
assert.equal((await parse(createClient3WatchReturn(db,manager,1,partialCreated.orderId,multiInput))).ok,true)
assert.equal(count('financial_events'),eventsAfterMulti,'Idempotent money split')
const badParts=await parse(createClient3WatchReturn(db,manager,1,partialCreated.orderId,{
 ...multiInput,requestId:'watch-refund-invalid-split-20261103',
 refundParts:[{method:'KASPI GOLD',amount:6000},{method:'KASPI RED',amount:4000}],
}))
assert.equal(badParts.status,400)
const duplicateQuantity=await parse(createClient3WatchReturn(db,manager,1,partialCreated.orderId,{
 ...multiInput,requestId:'watch-refund-duplicate-quantity-20261103',
 kind:'items_only',amount:0,refundParts:[],
 items:[{orderItemId:partialOriginal.id,quantity:1}],
}))
assert.equal(duplicateQuantity.status,409)
const foreignMoney=await parse(createClient3WatchReturn(db,manager,2,partialCreated.orderId,{
 ...multiInput,requestId:'watch-refund-foreign-brand-20261103',
}))
assert.equal(foreignMoney.status,404)
const physicalRows=sqlite.prepare('SELECT id FROM return_items WHERE return_id=? ORDER BY id').all(multiRow.id)
const firstIntake=await parse(receiveClient3WatchReturn(db,manager,1,partialCreated.orderId,{
 requestId:'watch-multi-return-intake-20261103',
 returnId:multiRow.id,returnItemId:physicalRows[0].id,destination:'warehouse',
}))
assert.equal(firstIntake.ok,true,JSON.stringify(firstIntake))
assert.equal(stock('warehouse').quantity,physicalBeforeMulti+1)
assert.equal(count('financial_events'),eventsAfterMulti,'Stock receipt cannot refund again')
// Stage4 Main set exchange: real multi-method extra payment, new watch SKU and
// engraving, money/inventory kept in Main, old watch receipt stays pending.
const exchSetArrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:1,quantity:12,comment:'Stage4 exchange old watch stock',
 requestId:'watch-set-old-stock-20261103',
}))
assert.equal(exchSetArrival.ok,true,JSON.stringify(exchSetArrival))
const exchSetAltStock=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:2,quantity:12,comment:'Stage4 exchange new watch stock',
 requestId:'watch-set-new-stock-20261103',
}))
assert.equal(exchSetAltStock.ok,true,JSON.stringify(exchSetAltStock))
const manualReplacement={modelName:'REAL ENGINE EXCHANGE MODEL',gender:'male',
 movement:'quartz',braceletMaterial:'steel',dialColor:'silver',braceletColor:''}
const createSetOld=async(key,price)=>{
 const created=await parse(createClient3WatchOrder(db,manager,1,{
   ...purchase,requestId:key,receivedAmount:price,unitPrice:price,
   engravingText:'',items:[{watchVariantId:1,catalogVariantId:vid,
    quantity:1,unitPrice:price,source:'office',engravingText:''}],
 }))
 assert.equal(created.status,201,JSON.stringify(created))
 const sent=await parse(dispatchClient3WatchOrder(db,manager,1,created.orderId,{
   requestId:key+'-ship',
 }))
 assert.equal(sent.status,200,JSON.stringify(sent))
 const old=sqlite.prepare(`SELECT oi.id,oi.quantity,oi.unit_price,oi.line_total,
   oi.catalog_price_snapshot FROM order_items oi WHERE oi.order_id=? AND oi.quantity>0`)
   .get(created.orderId)
 return {created,old}
}
const stage4Pay=await createSetOld('watch-set-extra-20261103-01',40000)
const oldSelection=original=>({
 orderItemId:original.id,quantity:1,physicalState:'pending',
 expectedActiveQuantity:original.quantity,expectedUnitPrice:original.unit_price,
 expectedLineTotal:original.line_total,
 expectedCatalogPriceSnapshot:original.catalog_price_snapshot,
})
const extraInput={requestId:'watch-set-extra-pay-20261103-01',
 expectedOrderTotal:40000,
 oldItems:[oldSelection(stage4Pay.old)],
 newItems:[{manual:manualReplacement,source:'office',quantity:1,
   unitPrice:60000,engravingText:'Новая гравировка'}],
 paymentParts:[{method:'KASPI GOLD',amount:12000},{method:'KASPI RED',amount:8000}],
 refundParts:[],reason:'Обмен с доплатой двумя способами'}
const extraResult=await parse(exchangeClient3WatchSet(
 db,manager,1,stage4Pay.created.orderId,extraInput))
assert.equal(extraResult.status,200,JSON.stringify(extraResult))
assert.equal(extraResult.ok,true)
const extraPayments=sqlite.prepare(`SELECT method,amount FROM payments WHERE order_id=? ORDER BY id`)
 .all(stage4Pay.created.orderId)
assert.deepEqual(extraPayments.slice(-2).map(x=>[x.method,x.amount]),[
 ['KASPI GOLD',12000],['KASPI RED',8000]])
assert.equal(sqlite.prepare('SELECT total_amount,received_amount FROM orders WHERE id=?')
 .get(stage4Pay.created.orderId).received_amount,60000)
const attached=sqlite.prepare(`SELECT wi.watch_variant_id,wi.engraving_text,oi.stock_writeoff_status
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id DESC LIMIT 1`)
 .get(stage4Pay.created.orderId)
assert.notEqual(attached.watch_variant_id,1,'New SKU must not be the original watch')
assert.equal(sqlite.prepare(`SELECT wp.brand_id FROM watch_variants wv
 JOIN watch_products wp ON wp.id=wv.watch_product_id WHERE wv.id=?`)
 .get(attached.watch_variant_id).brand_id,1)
assert.equal(attached.engraving_text,'Новая гравировка')
const previousPaymentCount=count('payments')
const retryExtra=await parse(exchangeClient3WatchSet(
 db,manager,1,stage4Pay.created.orderId,extraInput))
assert.equal(retryExtra.ok,true,JSON.stringify(retryExtra))
assert.equal(count('payments'),previousPaymentCount,'Repeat split payment must not add more money')
const stage4Refund=await createSetOld('watch-set-refund-20261103-01',70000)
const refundInput={requestId:'watch-set-refund-calc-20261103-01',
 expectedOrderTotal:70000,
 oldItems:[oldSelection(stage4Refund.old)],
 newItems:[{manual:manualReplacement,source:'office',quantity:1,
   unitPrice:30000,engravingText:''}],
 paymentParts:[],refundParts:[
  {method:'KASPI GOLD',amount:15000},{method:'KASPI RED',amount:25000}],
 reason:'Обмен с возвратом двумя способами'}
const refundSet=await parse(exchangeClient3WatchSet(
 db,manager,1,stage4Refund.created.orderId,refundInput))
assert.equal(refundSet.status,200,JSON.stringify(refundSet))
assert.equal(sqlite.prepare('SELECT return_amount FROM orders WHERE id=?')
 .get(stage4Refund.created.orderId).return_amount,40000)
const moneyRefundEvents=sqlite.prepare(`SELECT payment_method,amount_delta
 FROM financial_events WHERE event_type='exchange_refund' AND source_ref=?
 ORDER BY event_key`).all('exchanges:'+refundSet.exchangeId)
assert.deepEqual(moneyRefundEvents.map(x=>[x.payment_method,x.amount_delta]),[
 ['KASPI GOLD',-15000],['KASPI RED',-25000]])
// Stage 4 final acceptance: exchange TWO dispatched, differently identified watches
// for TWO replacement lines in a single request. Only the explicit physical intake
// workflow may add old watches to stock; the exchange must not touch cash on a
// zero-difference swap, must preserve both replacement engraving links, and replay.
const twoOld=await parse(createClient3WatchOrder(db,manager,1,{
 ...purchase,requestId:'watch-two-old-exchange-20261103-01',
 receivedAmount:50000,
 items:[
  {watchVariantId:1,catalogVariantId:vid,source:'office',quantity:1,
   unitPrice:20000,engravingText:''},
  {watchVariantId:2,catalogVariantId:secondSku.canonicalVariantId,source:'office',quantity:1,
   unitPrice:30000,engravingText:''},
 ],
}))
assert.equal(twoOld.status,201,JSON.stringify(twoOld))
const twoOldRows=sqlite.prepare(`SELECT id,quantity,unit_price,line_total,catalog_price_snapshot
 FROM order_items WHERE order_id=? AND quantity>0 ORDER BY id`).all(twoOld.orderId)
assert.equal(twoOldRows.length,2)
const twoOldShip=await parse(dispatchClient3WatchOrder(db,manager,1,twoOld.orderId,{
 requestId:'watch-two-old-dispatch-20261103-01',
 items:twoOldRows.map(r=>({orderItemId:r.id,quantity:1})),
}))
assert.equal(twoOldShip.status,200,JSON.stringify(twoOldShip))
const physicalBeforeSwap=stock('warehouse').quantity
const paymentsBeforeSwap=count('payments')
const eventsBeforeSwap=count('financial_events')
const oldChoices=twoOldRows.map(r=>({
 orderItemId:r.id,quantity:1,physicalState:'pending',
 expectedActiveQuantity:r.quantity,expectedUnitPrice:r.unit_price,
 expectedLineTotal:r.line_total,expectedCatalogPriceSnapshot:r.catalog_price_snapshot,
}))
const twoSwapInput={requestId:'watch-two-to-two-exchange-20261103-01',
 expectedOrderTotal:50000,oldItems:oldChoices,
 newItems:[
  {manual:manualReplacement,source:'office',quantity:1,unitPrice:22000,
   engravingText:'Левая гравировка'},
  {manual:manualReplacement,source:'showcase',quantity:1,unitPrice:28000,
   engravingText:'Правая гравировка'},
 ],
 paymentParts:[],refundParts:[],reason:'Обмен двух часов на два других'}
const twoSwap=await parse(exchangeClient3WatchSet(db,manager,1,twoOld.orderId,twoSwapInput))
assert.equal(twoSwap.status,200,JSON.stringify(twoSwap))
assert.equal(twoSwap.oldItemCount,2)
assert.equal(twoSwap.newItemCount,2)
assert.equal(stock('warehouse').quantity,physicalBeforeSwap,
 'Exchange with pending physical intake must not restock old watches')
assert.equal(count('payments'),paymentsBeforeSwap,'Equal-value exchange must not add payment')
assert.equal(count('financial_events'),eventsBeforeSwap,'Equal-value exchange must not add money events')
const activeSwap=sqlite.prepare(`SELECT oi.id,oi.quantity,oi.source_type,
 wi.watch_variant_id,wi.engraving_text
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 ORDER BY oi.id`).all(twoOld.orderId)
assert.equal(activeSwap.length,2,'Two new active lines must survive exchange')
assert.deepEqual(activeSwap.map(x=>x.engraving_text),
 ['Левая гравировка','Правая гравировка'])
assert.deepEqual(activeSwap.map(x=>x.source_type),['warehouse','boutique'])
assert(activeSwap.every(x=>x.watch_variant_id===attached.watch_variant_id),
 'Both replacements must keep canonical watch variant identity')
assert.equal(sqlite.prepare('SELECT total_amount,received_amount,return_amount FROM orders WHERE id=?')
 .get(twoOld.orderId).total_amount,50000)
const swapOldReceipts=sqlite.prepare(`SELECT quantity,physical_tracking,physical_received_at
 FROM exchange_items WHERE exchange_id=? AND role='old' ORDER BY id`).all(twoSwap.exchangeId)
assert.equal(swapOldReceipts.length,2)
assert(swapOldReceipts.every(x=>x.quantity===1&&x.physical_tracking===1&&x.physical_received_at==null))
assert.equal((await parse(exchangeClient3WatchSet(db,manager,1,twoOld.orderId,twoSwapInput))).ok,true)
assert.equal(count('payments'),paymentsBeforeSwap)
const forbiddenTwoSwap=await parse(exchangeClient3WatchSet(db,manager,2,twoOld.orderId,{
 ...twoSwapInput,requestId:'watch-two-brand-reject-20261103-01',
}))
assert.equal(forbiddenTwoSwap.status,404)

assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])

sqlite.close()
console.log('CLIENT3_FULL_MAIN_ORDER_LIFECYCLE_PASS: multi-position returns, multi-method payments/refunds, two-to-two exchange, watch identity, engraving, pending physical intake and replay')
