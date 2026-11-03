import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival,transferClient3WatchStock} from '../../worker/domains/client3-watch-inventory.ts'
import {writeoffClient3WatchStock} from '../../worker/domains/client3-watch-writeoff.ts'
import {createClient3WatchOrder} from '../../worker/domains/client3-watch-create.ts'
import {dispatchClient3WatchOrder} from '../../worker/domains/client3-watch-dispatch.ts'
import {createClient3WatchReturn,receiveClient3WatchReturn,listPendingClient3WatchReturns} from '../../worker/domains/client3-watch-returns.ts'
import {updateClient3WatchCatalogPrice} from '../../worker/domains/client3-watch-pricing.ts'
import {exchangeClient3Watch} from '../../worker/domains/client3-watch-exchange.ts'

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
const fixtureEngravingReady=(orderId,when='2026-11-03T10:00:00Z')=>{
  sqlite.prepare("UPDATE watch_logistics_jobs SET status='ready',ready_at=? WHERE order_id=?").run(when,orderId)
  sqlite.prepare(`INSERT OR REPLACE INTO watch_engraving_item_readiness
    (order_item_id,engraving_text,ready_at,ready_by_user_id,request_id)
    SELECT oi.id,wi.engraving_text,?,NULL,'test-exchange-ready-'||oi.id
    FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
    WHERE oi.order_id=? AND TRIM(wi.engraving_text)<>''`).run(when,orderId)
}
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
assert.equal(deniedBrand.status,403,'Client3 checks manager brand authorization before any order or SKU writes')
const beforeShippingPayment=count('payments')
const beforeShip=stock('warehouse')
const blockedEngraving=await parse(dispatchClient3WatchOrder(db,manager,1,firstPurchase.orderId,{
  requestId:'watch-real-ship-000001',
}))
assert.equal(blockedEngraving.status,409,'Physical shipping must require engraving to be ready')
assert.equal(stock('warehouse').quantity,beforeShip.quantity)
fixtureEngravingReady(firstPurchase.orderId,'2026-11-02T12:00:00Z')
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
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])


sqlite.prepare("INSERT INTO watch_products(brand_id,model_name) VALUES(1,'REAL ENGINE EXCHANGE MODEL')").run()
sqlite.prepare("INSERT INTO watch_variants(watch_product_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES(2,'male','quartz','steel','silver','')").run()
const replacement=await parse(provisionClient3WatchSku(db,admin,1,2))
assert.equal(replacement.status,200,JSON.stringify(replacement))
const newCatalogVariantId=replacement.canonicalVariantId
assert(newCatalogVariantId>0)
const newArrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:2,quantity:3,comment:'Exchange watch test',requestId:'watch-exchange-stock-000001',
}))
assert.equal(newArrival.status,200,JSON.stringify(newArrival))
const exchangeOrder=await parse(createClient3WatchOrder(db,manager,1,{
 ...purchase,requestId:'watch-exchange-order-000001',
 engravingText:'OLD TEXT',receivedAmount:40000,
}))
assert.equal(exchangeOrder.status,201,JSON.stringify(exchangeOrder))
fixtureEngravingReady(exchangeOrder.orderId,'2026-11-02T12:00:00Z')
const exchangeOriginalSent=await parse(dispatchClient3WatchOrder(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-oldship-000001',
}))
assert.equal(exchangeOriginalSent.status,200,JSON.stringify(exchangeOriginalSent))
const beforeExchangeStock=sqlite.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='warehouse'")
 .get(newCatalogVariantId)
// Simulate a worker failure AFTER Main claimed the old item and exchange header,
// but BEFORE the watch metadata is durably attached. The same request must resume.
const actualPrepare=db.prepare
let interruptOnce=true
db.prepare=query=>{
  const statement=actualPrepare(query)
  if(!query.includes('INSERT INTO watch_order_item_details(order_item_id,watch_variant_id,engraving_text,created_at)'))
    return statement
  return {
    ...statement,
    bind(...args){
      const bound=statement.bind(...args)
      return {...bound,run:async()=>{
        if(interruptOnce){interruptOnce=false;throw new Error('SIMULATED_WATCH_ATTACHMENT_INTERRUPTED')}
        return bound.run()
      }}
    },
  }
}
const interruptedExchange=await parse(exchangeClient3Watch(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-operation-000001',newWatchVariantId:2,newSource:'office',
 engravingText:'NEW ENGRAVING',reason:'Customer requested steel strap',
}))
assert.equal(interruptedExchange.status,409,JSON.stringify(interruptedExchange))
assert.equal(interruptOnce,false)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM exchanges WHERE order_id=?').get(exchangeOrder.orderId).n,1,
 'Core exchange owns old SKU despite lost watch attachment')
db.prepare=actualPrepare
const newExchange=await parse(exchangeClient3Watch(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-operation-000001',newWatchVariantId:2,newSource:'office',
 engravingText:'NEW ENGRAVING',reason:'Customer requested steel strap',
}))
assert.equal(newExchange.status,200,JSON.stringify(newExchange))
assert.equal(newExchange.ok,true)
assert.equal(newExchange.newShippingStatus,'pending')
const repeatExchange=await parse(exchangeClient3Watch(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-operation-000001',newWatchVariantId:2,newSource:'office',
 engravingText:'NEW ENGRAVING',reason:'Customer requested steel strap',
}))
assert.equal(repeatExchange.status,200,JSON.stringify(repeatExchange))
assert.equal(repeatExchange.alreadyCommitted,true)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM exchanges WHERE order_id=?').get(exchangeOrder.orderId).n,1)
const changedReplay=await parse(exchangeClient3Watch(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-operation-000001',newWatchVariantId:2,newSource:'office',
 engravingText:'FRAUD DIFFERENT TEXT',reason:'Customer requested steel strap',
}))
assert.equal(changedReplay.status,409)

assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM exchanges WHERE order_id=?').get(exchangeOrder.orderId).n,1)
const exch=sqlite.prepare('SELECT old_order_item_id,new_order_item_id FROM exchanges WHERE order_id=?').get(exchangeOrder.orderId)
assert.equal(sqlite.prepare('SELECT quantity FROM order_items WHERE id=?').get(exch.old_order_item_id).quantity,0)
assert.equal(sqlite.prepare('SELECT quantity FROM order_items WHERE id=?').get(exch.new_order_item_id).quantity,1)
const insertedWatch=sqlite.prepare('SELECT watch_variant_id,engraving_text FROM watch_order_item_details WHERE order_item_id=?').get(exch.new_order_item_id)
assert.equal(insertedWatch.watch_variant_id,2)
assert.equal(insertedWatch.engraving_text,'NEW ENGRAVING')
assert.equal(sqlite.prepare('SELECT status FROM watch_logistics_jobs WHERE order_id=?').get(exchangeOrder.orderId).status,'pending')
const afterExchangeStock=sqlite.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='warehouse'")
 .get(newCatalogVariantId)
assert.equal(afterExchangeStock.quantity,beforeExchangeStock.quantity)
assert.equal(afterExchangeStock.reserved_quantity,beforeExchangeStock.reserved_quantity+1)
const foreignExchange=await parse(exchangeClient3Watch(db,manager,2,exchangeOrder.orderId,{
 requestId:'watch-exchange-operation-000002',newWatchVariantId:2,newSource:'office',
 engravingText:'WRONG',reason:'Wrong brand',
}))
assert.equal(foreignExchange.status,404)
const queue=await parse(listPendingClient3WatchReturns(db,manager,1))
assert.equal(queue.status,200)
const pendingExchange=queue.rows.find(row=>row.operationType==='exchange'&&row.orderId===exchangeOrder.orderId)
assert(pendingExchange,'Old watch after exchange must appear in physical intake queue')
const oldStockBefore=stock('warehouse').quantity
const intakeExchange=await parse(receiveClient3WatchReturn(db,manager,1,exchangeOrder.orderId,{
  operationType:'exchange',returnId:pendingExchange.returnId,returnItemId:pendingExchange.returnItemId,
  destination:'warehouse',requestId:'watch-exchange-intake-000001',
}))
assert.equal(intakeExchange.status,200,JSON.stringify(intakeExchange))
assert.equal(intakeExchange.ok,true)
assert.equal(stock('warehouse').quantity,oldStockBefore+1)
const repeatedIntake=await parse(receiveClient3WatchReturn(db,manager,1,exchangeOrder.orderId,{
  operationType:'exchange',returnId:pendingExchange.returnId,returnItemId:pendingExchange.returnItemId,
  destination:'warehouse',requestId:'watch-exchange-intake-000001',
}))
assert.equal(repeatedIntake.ok,true)
assert.equal(stock('warehouse').quantity,oldStockBefore+1)
const beforeNewShip=sqlite.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='warehouse'").get(newCatalogVariantId).quantity
const blockedNewShip=await parse(dispatchClient3WatchOrder(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-newship-000001',
}))
assert.equal(blockedNewShip.status,409,'Engraving after exchange must be completed separately')
fixtureEngravingReady(exchangeOrder.orderId,'2026-11-02T14:00:00Z')
const replacementSent=await parse(dispatchClient3WatchOrder(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-newship-000001',
}))
assert.equal(replacementSent.status,200,JSON.stringify(replacementSent))
assert.equal(replacementSent.ok,true)
assert.equal(sqlite.prepare("SELECT quantity FROM inventory_stock WHERE variant_id=? AND inventory_source='warehouse'").get(newCatalogVariantId).quantity,beforeNewShip-1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatches WHERE order_id=?').get(exchangeOrder.orderId).n,2)
const newShipReplay=await parse(dispatchClient3WatchOrder(db,manager,1,exchangeOrder.orderId,{
 requestId:'watch-exchange-newship-000001',
}))
assert.equal(newShipReplay.alreadyCommitted,true)
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_FULL_MAIN_ORDER_EXCHANGE_PASS: stock, order, payment, dispatch, return and exact watch brand exchange')
