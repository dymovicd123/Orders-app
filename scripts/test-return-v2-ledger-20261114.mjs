// Integration harness: run the actual versioned SQL migrations against a
// brand-new in-memory SQLite D1 shim. No Cloudflare network, no remote D1.
import assert from 'node:assert/strict'
import { prepareReturnV2 } from '../worker/domains/return-v2-preparation.ts'
import { postPreparedReturnV2Prototype } from '../worker/domains/return-v2-posting-prototype.ts'
import { readReturnV2ContractCapacity } from '../worker/domains/return-v2-contract-capacity.ts'
import { readOrderFinancialLedger, syncOrderFinancialLedger } from '../worker/domains/money.ts'
import { readVersionedReturnMoney, syncVersionedReturnMoneyPrototype } from '../worker/domains/return-v2-financial-projection.ts'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'
import { planOrderManagerSchemaReconciliation } from './order-manager-schema-reconciliation-20261030.mjs'

const sql=new DatabaseSync(':memory:')
const migrations=fs.readdirSync('migrations').filter(name=>/^\d{4}.*\.sql$/.test(name)).sort()
assert(migrations.length>=110,'Expected complete schema migration chain')
let last=''
for(const name of migrations){
 try {sql.exec(fs.readFileSync('migrations/'+name,'utf8'));last=name}
 catch(error){throw new Error('Fresh SQLite migration '+name+' failed after '+last+': '+(error?.message||error))}
}
// The migration gap #648 is handled by the pure, fail-closed planner. This
// test explicitly applies the result to DISPOSABLE LOCAL SQLite only.
// No remote DB, network, or migration executor is available in this script.
const auditTableExists = Boolean(sql.prepare(
  "SELECT name FROM sqlite_schema WHERE type='table' AND name='order_manager_audit'"
).get())
const localObservation = {
  ordersColumns:sql.prepare('PRAGMA table_info(orders)').all(),
  auditTableExists,
  auditColumns:auditTableExists ? sql.prepare('PRAGMA table_info(order_manager_audit)').all() : [],
}
const schemaPlan=planOrderManagerSchemaReconciliation(localObservation)
const localSchemaGaps=schemaPlan.steps.map(step=>step.object)
assert.deepEqual(localSchemaGaps,['orders.manager_snapshot_name','order_manager_audit'])
for(const step of schemaPlan.steps)sql.exec(step.sql)
console.log('P0_HTTP_LOCAL_SCHEMA_GAPS: '+JSON.stringify(localSchemaGaps)+' (explicit test-only repair; #648)')
const tables=()=>new Set(sql.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name))
for(const n of ['app_users','app_sessions','inventory_stock','inventory_reservations','critical_operations','orders','order_items','catalog_products','catalog_variants']){
 assert(tables().has(n),'Fresh complete schema must have '+n)
}
function stmt(statement,params=[]){
 return {
  sql:statement,
  bind(...values){return stmt(statement,values)},
  async first(){return sql.prepare(statement).get(...params)??null},
  async all(){return {results:sql.prepare(statement).all(...params)}},
  async run(){
   const m=sql.prepare(statement).run(...params)
   // Simulate failure AFTER the completion UPDATE committed but BEFORE
   // the caller received its result. This is a real persisted critical op.
   if(loseCriticalCompleteResponseOnce
       && statement.includes('UPDATE critical_operations')
       && statement.includes("SET status = 'completed'")){
     loseCriticalCompleteResponseOnce=false
     throw new Error('INJECTED: lost response after critical-operation completion')
   }
   return {success:true,meta:{changes:Number(m.changes),last_row_id:Number(m.lastInsertRowid)}}
  },
 }
}
let loseReservationBatchResponseOnce=false
let loseCriticalCompleteResponseOnce=false
let stealCreateLeaseAtBatchOnce=false
const db={
 prepare:q=>stmt(q),
 async batch(stmts){
  // Simulate a concurrent retry stealing the lease immediately before the
  // atomic header INSERT+target UPDATE (not before request validation).
  if(stealCreateLeaseAtBatchOnce && stmts.some(st=>st.sql?.includes('INSERT INTO orders ('))){
   stealCreateLeaseAtBatchOnce=false
   const changed=sql.prepare("UPDATE critical_operations SET lease_token='other-owner', lease_until_ms=? WHERE request_id=? AND step='validated'").run(Date.now()+45000,'create-stolen-lease')
   assert.equal(Number(changed.changes),1,'Create lease fault must actually run')
  }
  sql.exec('BEGIN IMMEDIATE')
  let committed=false
  try{
   const out=[];for(const st of stmts)out.push(await st.run())
   sql.exec('COMMIT');committed=true
   if(loseReservationBatchResponseOnce && stmts.some(st=>st.sql?.includes('INSERT INTO inventory_reservations'))){
     loseReservationBatchResponseOnce=false
     throw new Error('INJECTED: committed reservation but client lost the response')
   }
   return out
  }catch(error){if(!committed)sql.exec('ROLLBACK');throw error}
 }
}
const token='test-local-http-create-token'
const tokenHash=createHash('sha256').update(token).digest('base64url')
const staffToken='test-local-http-staff-token'
const staffTokenHash=createHash('sha256').update(staffToken).digest('base64url')
sql.prepare("INSERT INTO managers (id,name,is_active) VALUES(9001,'HTTP Manager',1)").run()
sql.prepare("INSERT INTO app_users (id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9001,'httpmanager','local@invalid','fixture-inert-hash','admin',9001,'HTTP Admin',1,0)").run()
sql.prepare("INSERT INTO app_users (id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9002,'httpstaff','staff@invalid','fixture-inert-hash','manager',NULL,'HTTP Staff',1,0)").run()
sql.prepare("INSERT INTO app_sessions (user_id,token_hash,expires_at) VALUES(9001,?,'2099-01-01')").run(tokenHash)
sql.prepare("INSERT INTO app_sessions (user_id,token_hash,expires_at) VALUES(9002,?,'2099-01-01')").run(staffTokenHash)
sql.prepare("INSERT INTO catalog_products (id,name,category,is_active) VALUES(9021,'P0 HTTP ТОВАР','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants (id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9031,9021,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50','adult',1)").run()
sql.prepare("INSERT INTO catalog_stock_positions (product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at) VALUES(9021,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1,0,'2026-10-30T00:00:00Z','2026-10-30T00:00:00Z')").run()
const executionId=sql.prepare("SELECT id FROM catalog_stock_positions WHERE product_id=9021 AND is_active=1 AND material='СТАНДАРТ' AND length='СТАНДАРТ'").get()?.id
assert(executionId,'The fixture SKU needs a V3 execution identity')
sql.prepare('UPDATE catalog_variants SET stock_position_id=? WHERE id=9031').run(executionId)
for(const [id,source] of [[9041,'warehouse'],[9042,'boutique']]){
 sql.prepare("INSERT INTO inventory_stock (id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(?,?,9021,9031,'P0 HTTP ТОВАР','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',2,0)").run(id,source)
}
sql.prepare("INSERT INTO inventory_model_meta (key,value,updated_at) VALUES('human_inventory_v2','active','2026-10-30T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active',updated_at=excluded.updated_at").run()
async function http(method,path,payload,identity='admin'){
 const headers={'Cookie':'orders_session='+(identity==='staff'?staffToken:token)}
 if(payload)headers['Content-Type']='application/json'
 const request=new Request('https://test.invalid'+path,{method,headers,...(payload?{body:JSON.stringify(payload)}:{})})
 const response=await worker.fetch(request,{DB:db})
 let data;try{data=await response.json()}catch{data={}}
 return {status:response.status,data}
}
const item=(source='warehouse')=>({
 productName:'P0 HTTP ТОВАР',audienceType:'ВЗРОСЛЫЙ',gender:'МУЖ',color:'БЕЖ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'50',
 quantity:1,unitPrice:1000,catalogPriceSnapshot:null,sourceType:source,
 shortageAcknowledged:false,shortageDecision:null,
})
const payload=(requestId,items=[item()])=>({
 requestId,externalId:'P0-'+requestId,orderDate:'2026-10-30',managerId:9001,
 managerName:'HTTP Manager',customerPhone:'',customerName:'HTTP Test',
 city:'',deliveryType:'',orderPaymentMethod:'',sourceType:'warehouse',
 workshopStatus:'in_workshop',orderStatus:'active',pricingMode:'itemized_v1',
 items,payments:[],
})

const count=(table,where,params=[])=>Number(sql.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`).get(...params)?.n)
const oldStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()
const otherStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9042').get()
const reserve=id=>sql.prepare('SELECT id,quantity,status,variant_id,inventory_source FROM inventory_reservations WHERE order_item_id=? ORDER BY id DESC LIMIT 1').get(id)




const old=await http('POST','/api/orders',{
 ...payload('ledger-legacy',[{...item('boutique'),quantity:2,unitPrice:15000}]),
 payments:[{paymentDate:'2026-10-30',method:'KASPI',amount:30000,paymentKind:'primary'}],
})
assert.equal(old.status,201)
const oldId=Number(old.data.orderId)
let legacy=await readVersionedReturnMoney(db,oldId)
assert.equal(legacy.kind,'legacy')
assert.equal(legacy.totalAmount,30000)
assert.equal(legacy.debtAmount,0)
assert.equal(legacy.customerOverpay,null)
await assert.rejects(syncVersionedReturnMoneyPrototype(db,oldId),/Исторические заказы/)
const oldRefund=await http('POST','/api/returns',{
 requestId:'ledger-legacy-money-only',orderId:oldId,returnDate:'2026-11-14',
 amount:2000,paymentMethod:'KASPI',items:[]
})
assert.equal(oldRefund.status,201,'Legacy money-only Return should still work: '+JSON.stringify(oldRefund))
legacy=await readVersionedReturnMoney(db,oldId)
assert.equal(legacy.kind,'legacy')
assert.equal(legacy.returnAmount,2000)
assert.equal(legacy.debtAmount,0,'Historical debt is intentionally not reinterpreted by V2 ledger')

const created=await http('POST','/api/orders',{
 ...payload('ledger-v2',[{...item('warehouse'),quantity:2,unitPrice:15000}]),
 payments:[{paymentDate:'2026-10-30',method:'KASPI',amount:30000,paymentKind:'primary'}],
})
assert.equal(created.status,201)
const orderId=Number(created.data.orderId)
const itemId=sql.prepare('SELECT id FROM order_items WHERE order_id=?').get(orderId).id
const shipped=await http('PATCH','/api/orders/'+orderId+'/shipping',{
 requestId:'ledger-v2-ship',shippingStatus:'sent',shippingDate:'2026-10-31'
})
assert.equal(shipped.status,200,'Issued shipment should pass: '+JSON.stringify(shipped))
const prepared=await prepareReturnV2(db,{
 requestId:'ledger-v2-prepare',orderId,expectedTotalAmount:30000,
 items:[{orderItemId:itemId,quantity:1}],refundAmount:20000,refundMethod:'KASPI'
})
const post=await postPreparedReturnV2Prototype(db,prepared.preparationId)
assert.equal(post.posted,true)
let calculated=await readVersionedReturnMoney(db,orderId)
assert.equal(calculated.kind,'return_v2')
assert.equal(calculated.currentSale,15000)
assert.equal(calculated.paidIn,30000)
assert.equal(calculated.paidOut,20000)
assert.equal(calculated.netHeld,10000)
assert.equal(calculated.customerDebt,5000)
assert.equal(calculated.customerOverpay,0)
assert.equal(calculated.signedBalance,5000)
const oldFormula=await readOrderFinancialLedger(db,orderId)
assert.equal(oldFormula.debtAmount,0,'Old debt math proven to diverge for V2')
await syncOrderFinancialLedger(db,orderId)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=?').get(orderId).debt_amount,0,
 'Old sync creates incorrect debt after V2, proving explicit transition requirement')
const corrected=await syncVersionedReturnMoneyPrototype(db,orderId)
assert.equal(corrected.customerDebt,5000)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=?').get(orderId).debt_amount,5000,
 'Dedicated V2 CAS sync restores true net-held debt')
const paymentsBefore=sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=?').get(orderId).n
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES (?,'2026-11-14','CASH',3000,'debt_close')").run(orderId)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=?').get(orderId).n,paymentsBefore+1)
calculated=await readVersionedReturnMoney(db,orderId)
assert.equal(calculated.customerDebt,2000)
assert.equal(calculated.paidIn,33000)
await syncVersionedReturnMoneyPrototype(db,orderId)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=?').get(orderId).debt_amount,2000)
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES (?,'2026-11-14','CASH',10000,'extra')").run(orderId)
calculated=await readVersionedReturnMoney(db,orderId)
assert.equal(calculated.customerDebt,0)
assert.equal(calculated.customerOverpay,8000)
assert.equal(calculated.netHeld,23000)
await syncVersionedReturnMoneyPrototype(db,orderId)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=?').get(orderId).debt_amount,0)
const eventKey='return-v2:posted:'+prepared.preparationId
const event=sql.prepare('SELECT amount_delta FROM financial_events WHERE event_key=?').get(eventKey)
assert.equal(event.amount_delta,-20000)
sql.prepare('UPDATE financial_events SET amount_delta=-19500 WHERE event_key=?').run(eventKey)
await assert.rejects(readVersionedReturnMoney(db,orderId),/Требуется разбор/)
sql.prepare('UPDATE financial_events SET amount_delta=-20000 WHERE event_key=?').run(eventKey)
assert.equal((await readVersionedReturnMoney(db,orderId)).kind,'return_v2')
const v2R=sql.prepare('SELECT id FROM returns WHERE order_id=?').get(orderId).id
sql.prepare('UPDATE returns SET status=? WHERE id=?').run('cancelled',v2R)
await assert.rejects(readVersionedReturnMoney(db,orderId),/Требуется разбор/)
sql.prepare('UPDATE returns SET status=? WHERE id=?').run('completed',v2R)
assert.equal((await readVersionedReturnMoney(db,orderId)).kind,'return_v2')
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE id=9041').get().quantity,0,'Money projections never receive stock')
sql.close()
console.log('RETURN_V2_VERSIONED_LEDGER_PASS: legacy left unchanged, V2 correct net-held debt, old sync divergence detected, V2 CAS sync repair, late debt-close/overpay, missing event and forbidden cancellation reject; no route enabled')
