import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival,transferClient3WatchStock} from '../../worker/domains/client3-watch-inventory.ts'
import {writeoffClient3WatchStock} from '../../worker/domains/client3-watch-writeoff.ts'
import {createClient3WatchOrder} from '../../worker/domains/client3-watch-create.ts'
import {dispatchClient3WatchOrder} from '../../worker/domains/client3-watch-dispatch.ts'

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
assert.equal(deniedBrand.status,409,'Direct handler denies a SKU that is not owned by the supplied brand; outer route enforces manager 403')
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
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])

sqlite.close()
console.log('CLIENT3_FULL_MAIN_STOCK_ORDER_DISPATCH_PASS: real stock, order, reserve, payment, engraving gate and Stage5 shipping')
