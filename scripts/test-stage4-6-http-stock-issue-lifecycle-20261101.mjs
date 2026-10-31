// Stage 4.6 combined end-to-end acceptance against the REAL HTTP Worker router,
// with ALL versioned migrations and a disposable SQLite implementation of D1.
// NO remote D1, Cloudflare API, production URL, real session or Worker deploy.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,readdirSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import worker from '../worker/index.ts'
import {planOrderManagerSchemaReconciliation} from './order-manager-schema-reconciliation-20261030.mjs'

const sql = new DatabaseSync(':memory:')
const migrations = readdirSync('migrations').filter(x=>/^\d{4}.*\.sql$/.test(x)).sort()
assert(migrations.includes('0117_v72_inventory_manual_operation_receipts.sql'))
assert(migrations.includes('0118_v72_inventory_operation_attempts.sql'))
for(const name of migrations) {
  try {sql.exec(readFileSync('migrations/'+name,'utf8'))}
  catch(err) {throw Error('Stage4 full migration chain failed at '+name+': '+String(err))}
}
const table = (name)=>Boolean(sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name))
assert(table('inventory_manual_operation_receipts') && table('inventory_operation_attempts'))
const auditTableExists=table('order_manager_audit')
const plan=planOrderManagerSchemaReconciliation({
 ordersColumns:sql.prepare('PRAGMA table_info(orders)').all(),
 auditTableExists,
 auditColumns:auditTableExists?sql.prepare('PRAGMA table_info(order_manager_audit)').all():[],
})
for(const step of plan.steps)sql.exec(step.sql) // historical fixture gap #648, local test ONLY

function stmt(query,args=[]) {
 return {
  sql:query,
  bind(...values){return stmt(query,values)},
  async all(){return {results:sql.prepare(query).all(...args)}},
  async first(){return sql.prepare(query).get(...args)??null},
  async run(){const r=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
 }
}
const db={
 prepare:query=>stmt(query),
 async batch(statements){
  sql.exec('BEGIN IMMEDIATE')
  try {
    const results=[]
    for(const st of statements)results.push(await st.run())
    sql.exec('COMMIT')
    return results
  } catch(err){sql.exec('ROLLBACK');throw err}
 }
}
const identities=[
 {id:9601,login:'stage4-admin',role:'admin',managerId:9601,name:'Stage4 Admin',managerRole:'Директор'},
 {id:9602,login:'stage4-warehouse',role:'manager',managerId:9602,name:'Stage4 Завсклад',managerRole:'Завсклад'},
 {id:9603,login:'stage4-manager',role:'manager',managerId:9603,name:'Stage4 Manager',managerRole:'Менеджер'},
 {id:9604,login:'stage4-packer',role:'manager',managerId:9604,name:'Stage4 Packer',managerRole:'Упаковщик'},
]
const tokens=new Map()
for(const item of identities){
 sql.prepare('INSERT INTO managers(id,name,role,is_active) VALUES(?,?,?,1)').run(item.managerId,item.name,item.managerRole)
 sql.prepare("INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(?,?,?,'test-only',?,?,?,1,0)")
  .run(item.id,item.login,item.login+'@invalid',item.role,item.managerId,item.name)
 const token='isolated-stage4-'+item.login
 tokens.set(item.login,token)
 sql.prepare('INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(?,?,?)')
  .run(item.id,createHash('sha256').update(token).digest('base64url'),'2099-01-01T00:00:00.000Z')
}
async function http(method,path,body,identity='stage4-admin'){
 const headers={}
 if(identity!=='anonymous')headers.Cookie='orders_session='+tokens.get(identity)
 if(body!==undefined)headers['Content-Type']='application/json'
 const response=await worker.fetch(new Request('https://stage4.invalid'+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{DB:db})
 const text=await response.text()
 let data;try{data=JSON.parse(text)}catch{data={raw:text.slice(0,400)}}
 return {status:response.status,data}
}
const count=(tableName,where,bindings=[])=>Number(sql.prepare('SELECT COUNT(*) AS n FROM '+tableName+' WHERE '+where).get(...bindings)?.n)
const stock=(source='warehouse')=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=9731 AND inventory_source=?').get(source)
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(9721,'STAGE4 ИСПЫТАТЕЛЬНЫЙ ТОВАР','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9731,9721,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50','adult',1)").run()
sql.prepare("INSERT INTO catalog_stock_positions(product_id,category,gender_scope,material,length,is_default,is_active,sort_order,created_at,updated_at) VALUES(9721,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1,0,'2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
const position=sql.prepare("SELECT id FROM catalog_stock_positions WHERE product_id=9721").get()?.id
assert(position)
sql.prepare('UPDATE catalog_variants SET stock_position_id=? WHERE id=9731').run(position)
for(const [id,source,quantity]of [[9741,'warehouse',3],[9742,'boutique',4]]){
 sql.prepare(`INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,
   product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
   quantity,reserved_quantity)
   VALUES(?,?,9721,9731,'STAGE4 ИСПЫТАТЕЛЬНЫЙ ТОВАР','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',?,0)`).run(id,source,quantity)
}
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active'").run()
const orderItem=()=>({
 productName:'STAGE4 ИСПЫТАТЕЛЬНЫЙ ТОВАР',audienceType:'ВЗРОСЛЫЙ',gender:'МУЖ',
 color:'БЕЖ',material:'СТАНДАРТ',length:'СТАНДАРТ',size:'50',
 quantity:2,unitPrice:1000,catalogPriceSnapshot:null,sourceType:'warehouse',
 shortageAcknowledged:false,shortageDecision:null
})
const create=await http('POST','/api/orders',{
 requestId:'stage4-e2e-order',externalId:'STAGE4-20261101-TEST',orderDate:'2026-11-01',
 managerId:9601,managerName:'Stage4 Admin',customerPhone:'',customerName:'Test Order',
 city:'',deliveryType:'',orderPaymentMethod:'',sourceType:'warehouse',
 workshopStatus:'in_workshop',orderStatus:'active',pricingMode:'itemized_v1',
 items:[orderItem()],payments:[]
})
assert.equal(create.status,201,'Seed canonical order through REAL Worker router: '+JSON.stringify(create))
const orderId=Number(create.data.orderId)
assert(orderId>0)
const line=sql.prepare('SELECT id,variant_id,source_type FROM order_items WHERE order_id=? AND quantity>0').get(orderId)
assert.equal(Number(line.variant_id),9731)
assert.equal(count('inventory_reservations',"order_id=? AND status='active'",[orderId]),1)
assert.equal(stock('boutique').quantity,4)
const beforeQuantity=stock().quantity
assert.equal(beforeQuantity,3)
// Isolated synthetic discrepancy: a reserved order requires two units but only
// one remains in recorded stock. No fake employee action or physical movement is generated.
sql.prepare("UPDATE inventory_stock SET quantity=1 WHERE inventory_source='warehouse' AND variant_id=9731").run()
const attentionPath='/api/inventory/attention?details=1&limit=30'
assert.equal((await http('GET',attentionPath,undefined,'anonymous')).status,401,'Anonymous reads are denied')
const shortage=await http('GET',attentionPath,undefined,'stage4-warehouse')
assert.equal(shortage.status,200,'Warehouse worker must read real live issues: '+JSON.stringify(shortage))
const issue=(shortage.data.items?.shortages||[]).find(x=>Number(x.variantId)===9731&&x.source==='warehouse')
assert(issue,'Active shortage must be a human action: '+JSON.stringify(shortage.data))
assert.equal(issue.orderId,orderId,'Problem links to exact active order')
assert.equal(Number(issue.countRelevantReserved),2)
assert.equal(Number(issue.physical),1)
const exactHistory='/api/inventory/history?source=warehouse&variantId=9731&limit=50'
const attempts='/api/inventory/operation-attempts?source=warehouse&variantId=9731'
const firstHistory=await http('GET',exactHistory,undefined,'stage4-warehouse')
assert.equal(firstHistory.status,200)
assert.equal((await http('GET',attempts,undefined,'stage4-warehouse')).status,200)
const movementItem={
 productId:9721,variantId:9731,productName:'STAGE4 ИСПЫТАТЕЛЬНЫЙ ТОВАР',
 category:'adult',gender:'МУЖ',color:'БЕЖ',material:'СТАНДАРТ',length:'СТАНДАРТ',
 size:'50',quantity:1,expectedQuantity:1
}
const invalid=await http('POST','/api/inventory/movements?returnInventory=0',{
 requestId:'stage4-e2e-invalid',inventorySource:'warehouse',movementType:'arrival',
 items:[{...movementItem,color:'ДРУГОЙ ЦВЕТ'}]
},'stage4-warehouse')
assert(invalid.status>=400,'Bad canonical SKU must not be written: '+JSON.stringify(invalid))
assert.equal(stock().quantity,1)
assert.equal(stock('boutique').quantity,4)
assert.equal(count('inventory_movements',"reference_id='stage4-e2e-invalid'"),0)
const rejected=await http('GET',attempts,undefined,'stage4-warehouse')
assert.equal(rejected.status,200)
assert(rejected.data.attempts.some(x=>x.requestId==='stage4-e2e-invalid'&&x.variantId===9731&&x.outcome!=='replayed'),
 'Rejected or uncertain attempt must be visible, never invent a successful movement: '+JSON.stringify(rejected))
const moveBody={requestId:'stage4-e2e-arrival',inventorySource:'warehouse',movementType:'arrival',comment:'Поступил по накладной E2E',
 items:[movementItem]}
const committed=await http('POST','/api/inventory/movements?returnInventory=0',moveBody,'stage4-warehouse')
assert.equal(committed.status,201,'Actual warehouse arrival: '+JSON.stringify(committed))
assert.equal(committed.data.operationId,'stage4-e2e-arrival')
assert.equal(stock().quantity,2,'Physical stock must increase only by confirmed amount')
assert.equal(stock('boutique').quantity,4,'No cross-source stock change')
const receipt=sql.prepare("SELECT actor_user_id,actor_label FROM inventory_manual_operation_receipts WHERE operation_id='stage4-e2e-arrival'").get()
assert.equal(Number(receipt?.actor_user_id),9602,'Authenticated warehouse employee is immutable')
assert.equal(receipt?.actor_label,'Stage4 Завсклад')
let refreshed=await http('GET',attentionPath,undefined,'stage4-manager')
assert.equal(refreshed.status,200)
assert(!(refreshed.data.items?.shortages||[]).some(x=>Number(x.variantId)===9731&&x.source==='warehouse'),
 'Resolved issue must disappear from LIVE task list')
assert.equal(count('inventory_reservations',"order_id=? AND status='active'",[orderId]),1,
 'Resolution through physical arrival must not auto-release a reserved order')
const movementCount=()=>count('inventory_movements',"reference_type='manual' AND reference_id='stage4-e2e-arrival'")
assert.equal(movementCount(),1)
const history=await http('GET',exactHistory,undefined,'stage4-warehouse')
assert.equal(history.status,200)
assert(history.data.movements.some(m=>m.referenceId==='stage4-e2e-arrival'
  && Number(m.quantityDelta)===1 && m.performedBy==='Stage4 Завсклад'
  && Number(m.variantId)===9731 && m.inventorySource==='warehouse'),
 'Completed movement and performer must remain in historical evidence: '+JSON.stringify(history))
const crossHistory=await http('GET','/api/inventory/history?source=boutique&variantId=9731')
assert.equal(crossHistory.status,200)
assert(!(crossHistory.data.movements||[]).some(m=>m.referenceId==='stage4-e2e-arrival'),
 'A warehouse arrival cannot leak into boutique history')
const replay=await http('POST','/api/inventory/movements?returnInventory=0',moveBody,'stage4-admin')
assert.equal(replay.status,200,'Replay should return original commitment')
assert.equal(replay.data.duplicate,true)
assert.equal(stock().quantity,2)
assert.equal(movementCount(),1)
assert.equal(Number(sql.prepare("SELECT actor_user_id FROM inventory_manual_operation_receipts WHERE operation_id='stage4-e2e-arrival'").get().actor_user_id),9602,
 'Retry from another authorized employee cannot replace original performer')
const afterReplay=await http('GET',attempts,undefined,'stage4-warehouse')
assert.equal(afterReplay.status,200)
assert(afterReplay.data.attempts.some(a=>a.requestId==='stage4-e2e-arrival' && a.outcome==='replayed'),
 'Exactly-once replay stays explicitly visible as nonphysical event')
assert.equal(count('inventory_operation_attempts',"request_id='stage4-e2e-arrival' AND outcome='replayed' AND inventory_source='warehouse' AND variant_id=9731"),1)
assert.equal((await http('GET','/api/inventory/operation-attempts?source=boutique&variantId=9731')).data.attempts.length,0,
 'Warehouse attempt does not leak to another inventory source')
assert.equal((await http('GET','/api/inventory/operation-attempts?source=warehouse&variantId=0')).status,400,
 'Attempt journal requires exact source and SKU')
console.log('STAGE4_6_REAL_WORKER_HTTP_SQLITE_ACCEPTANCE_PASS: issue → exact history → rejected attempt → actor-signed arrival → issue gone, history/reservation retained → replay, source and role isolation')
sql.close()
