// Exercise the ACTUAL worker.fetch HTTP router and authenticated session,
// not only its isolated reservation functions. No network or remote D1.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import worker from '../worker/index.ts'

const sqlite=new DatabaseSync(':memory:')
sqlite.exec([
  "CREATE TABLE app_users (id INTEGER PRIMARY KEY, login TEXT,email TEXT,role TEXT,manager_id INTEGER,display_name TEXT,is_active INTEGER,must_change_password INTEGER)",
  "CREATE TABLE app_sessions (user_id INTEGER,token_hash TEXT,expires_at TEXT)",
  "CREATE TABLE managers (id INTEGER PRIMARY KEY,name TEXT,role TEXT,is_active INTEGER)",
  "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,archived_at TEXT,shipping_status TEXT)",
  "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,stock_writeoff_status TEXT,is_workshop INTEGER,quantity INTEGER,source_type TEXT,variant_id INTEGER,product_name_snapshot TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER)",
  "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,updated_at TEXT,last_action TEXT,last_source_ref TEXT)",
  "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,inventory_source TEXT,variant_id INTEGER,status TEXT,unresolved_reason TEXT,reference_type TEXT,quantity INTEGER,updated_at TEXT)",
  "CREATE TABLE returns(id INTEGER PRIMARY KEY,status TEXT)",
  "CREATE TABLE return_items(id INTEGER PRIMARY KEY,order_item_id INTEGER,return_id INTEGER,quantity INTEGER)",
  "CREATE TABLE activity_log(id INTEGER PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id INTEGER,order_id INTEGER,external_order_id TEXT,title TEXT,details TEXT,amount INTEGER,created_at TEXT)",
  "INSERT INTO managers VALUES(1,'Manager Test','Менеджер',1),(2,'Packing Test','Упаковщик',1)",
  "INSERT INTO app_users VALUES(11,'manager','test.manager@invalid','manager',1,'Manager',1,0)",
  "INSERT INTO app_users VALUES(12,'packer','test.packer@invalid','manager',2,'Packer',1,0)",
  "INSERT INTO orders VALUES(33,'HTTP-TEST','active',NULL,'not_sent')",
  "INSERT INTO order_items(id,order_id,stock_writeoff_status,is_workshop,quantity,source_type,variant_id,product_name_snapshot) VALUES(330,33,'pending_reservation',0,1,'warehouse',77,'ТЕСТОВЫЙ ТОВАР')",
  "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(5,'warehouse',77,1,1)",
  "INSERT INTO inventory_reservations(id,order_id,order_item_id,inventory_source,variant_id,status,unresolved_reason,reference_type,quantity) VALUES(10,33,330,'warehouse',77,'unresolved','concurrent_shortage','order',1)",
].join(';\n')+';')
const token=(name)=>'local-e2e-token-'+name
const hash=(token)=>createHash('sha256').update(token).digest('base64url')
for(const [id,name] of [[11,'manager'],[12,'packer']]){
 sqlite.prepare('INSERT INTO app_sessions VALUES(?,?,?)').run(id,hash(token(name)),'2099-01-01T00:00:00.000Z')
}
function stmt(sql,args=[]){
 return {
  bind(...values){return stmt(sql,values)},
  async first(){return sqlite.prepare(sql).get(...args)??null},
  async all(){return {results:sqlite.prepare(sql).all(...args)}},
  async run(){const res=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(res.changes),last_row_id:Number(res.lastInsertRowid)}}},
 }
}
const db={
 prepare:sql=>stmt(sql),
 async batch(statements){
  sqlite.exec('BEGIN IMMEDIATE')
  try{const results=[];for(const statement of statements)results.push(await statement.run());sqlite.exec('COMMIT');return results}
  catch(error){sqlite.exec('ROLLBACK');throw error}
 }
}
async function http(method,path,as='manager',payload=null){
 const headers=new Headers()
 if(as!=='anonymous')headers.set('Cookie','orders_session='+token(as))
 if(payload!==null)headers.set('Content-Type','application/json')
 const request=new Request('https://test.invalid'+path,{method,headers,
   ...(payload!==null?{body:JSON.stringify(payload)}:{})})
 const response=await worker.fetch(request,{DB:db})
 let data;try{data=await response.json()}catch{data={}}
 return {status:response.status,data}
}
const path='/api/orders/33/items/330/pending-reservation'
const unauth=await http('GET',path,'anonymous')
assert.equal(unauth.status,401,'Real router must authenticate before reading stock')
const preview=await http('GET',path)
assert.equal(preview.status,200,JSON.stringify(preview.data))
assert.equal(preview.data.pending,true)
assert.equal(preview.data.snapshot.variantId,77)
assert.equal(preview.data.snapshot.physicalQuantity,1)
assert.equal(preview.data.snapshot.reservedQuantity,1)
assert.equal(preview.data.shortage,1)
const choice={snapshot:preview.data.snapshot,allowShortage:true}
const packing=await http('POST',path,'packer',choice)
assert.equal(packing.status,403,'Packing-only role must not approve over-reservation')
const unconfirmed=await http('POST',path,'manager',{...choice,allowShortage:false})
assert.equal(unconfirmed.status,409,'Manager must explicitly approve shortage')
const stale=await http('POST',path,'manager',{...choice,snapshot:{...choice.snapshot,reservedQuantity:0}})
assert.equal(stale.status,409)
const success=await http('POST',path,'manager',choice)
assert.equal(success.status,200,JSON.stringify(success.data))
assert.equal(success.data.resolved,true)
const replay=await http('POST',path,'manager',choice)
assert.equal(replay.status,200)
assert.equal(replay.data.alreadyResolved,true)
const stock=sqlite.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=5').get()
assert.equal(stock.quantity,1)
assert.equal(stock.reserved_quantity,2)
assert.equal(sqlite.prepare("SELECT status FROM inventory_reservations WHERE id=10").get().status,'active')
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=330').get().stock_writeoff_status,'reserved')
assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE event_type='order_pending_reservation_resolved'").get().n,1)
const notFound=await http('GET','/api/orders/33/items/999/pending-reservation')
assert.equal(notFound.status,409)
console.log('P0_HTTP_PENDING_RESERVATION_PASSED: actual Worker HTTP session, manager/packer/anonymous, snapshot conflict, consent, evidence, retry, no physical stock mutation')
