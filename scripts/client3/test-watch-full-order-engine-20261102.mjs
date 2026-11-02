import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival,transferClient3WatchStock} from '../../worker/domains/client3-watch-inventory.ts'
import {writeoffClient3WatchStock} from '../../worker/domains/client3-watch-writeoff.ts'
import {createClient3WatchOrder} from '../../worker/domains/client3-watch-create.ts'
import {dispatchClient3WatchOrder} from '../../worker/domains/client3-watch-dispatch.ts'
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
sqlite.prepare("UPDATE watch_logistics_jobs SET status='ready' WHERE order_id=?")
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
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])

sqlite.close()
console.log('CLIENT3_FULL_MAIN_ORDER_LIFECYCLE_PASS: stock, order, payment, engraving, dispatch, refund and physical return receipt')
