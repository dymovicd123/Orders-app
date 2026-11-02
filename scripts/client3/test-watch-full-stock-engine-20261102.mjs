import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival,transferClient3WatchStock} from '../../worker/domains/client3-watch-inventory.ts'
import {writeoffClient3WatchStock} from '../../worker/domains/client3-watch-writeoff.ts'

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
assert.equal(count('orders'),baseOrders,'Warehouse operations cannot create business orders')
assert.equal(count('payments'),basePayments,'Warehouse operations cannot record money')
assert(count('inventory_movements')>=initialMovement+3,'All warehouse operations must leave movement history')
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_FULL_MAIN_STOCK_ENGINE_PASS: 115 migrations + watches, real arrival/transfer/writeoff, idempotence, FK and money/order isolation')
