// Execute only from the guarded one-off GitHub workflow. --check never writes.
// This file intentionally has no generic SQL CLI or dynamic order/database IDs.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BATCH_SQL, EXPECTED_RESERVATIONS } from './repair-1563-branch2-sql-20261031.mjs'

const mode=process.argv[2]
assert(['--check','--apply'].includes(mode),'Use --check or --apply')
assert.equal(process.env.GITHUB_REF,'refs/heads/ops/branch2-return-1563-exact-reconciliation-20261031',
  'Never run production repair in another ref')

const conf=readFileSync('wrangler.jsonc','utf8')
assert(conf.includes('"name": "orders-app-branch2"')&&conf.includes('"database_name": "orders_db_branch2_mirror_20261027"')&&
  conf.includes('"database_id": "0904a573-21ff-44d8-93b0-c9200f771702"')&&
  !conf.includes('"database_name": "orders_db_prod"'),'Main configuration must bind Production')
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN
assert(account&&token,'Cloudflare secrets missing')
const dbId='0904a573-21ff-44d8-93b0-c9200f771702'
const endpoint='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+dbId
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'}
const dbMeta=await fetch(endpoint,{headers,signal:AbortSignal.timeout(25000)})
assert(dbMeta.ok,'Could not access the Branch2 D1 metadata')
assert.equal((await dbMeta.json()).result?.name,'orders_db_branch2_mirror_20261027','Wrong D1 target')

async function request(payload,label) {
  const response=await fetch(endpoint+'/query',{
    method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(30000),
  })
  const data=await response.json()
  if(!response.ok||!data.success||(data.result||[]).some(row=>row.success===false)){
    console.error('REPAIR_1563_SQL_ERROR '+label+' '+JSON.stringify({
      status:response.status,codes:(data.errors||[]).map(e=>e.code),
    }))
    throw new Error('D1 query failed at '+label)
  }
  return data.result||[]
}
async function select(sql,label){
  assert(/^\s*SELECT\b/i.test(sql) && !sql.includes(';'),'SELECT only during pre/post-check')
  const results=await request({sql},label)
  return results[0]?.results||[]
}
const stockQuery="SELECT id,inventory_source,variant_id,quantity,reserved_quantity,last_action,last_source_ref,updated_at FROM inventory_stock WHERE (inventory_source='warehouse' AND variant_id IN (853,1444)) OR (inventory_source='boutique' AND variant_id=212) ORDER BY inventory_source,variant_id"
const reservationQuery="SELECT id,order_item_id,inventory_source,variant_id,quantity,status FROM inventory_reservations WHERE order_id=1563 ORDER BY id"
const activityQuery="SELECT id,event_type FROM activity_log WHERE order_id=1563 AND event_type='return_reservations_reconciled_1563_branch2_20261031'"
const orderQuery="SELECT id,external_id,shipping_status,order_status,total_amount,received_amount,return_amount FROM orders WHERE id=1563"
const stocksBefore=await select(stockQuery,'stock before')
const reservationsBefore=await select(reservationQuery,'reservations before')
const activityBefore=await select(activityQuery,'activity before')
const ordersBefore=await select(orderQuery,'order before')
assert.equal(stocksBefore.length,3,'Expected exactly three cached SKU stock rows')
assert.equal(ordersBefore.length,1)
assert.equal(ordersBefore[0].external_id,'ORD-20260923143855-90AAA657')
assert.equal(ordersBefore[0].shipping_status,'not_sent')
assert.deepEqual([ordersBefore[0].total_amount,ordersBefore[0].received_amount,ordersBefore[0].return_amount],[100000,100000,100000])
assert.equal(reservationsBefore.length,6,'Exactly six original reservation rows expected')
const alreadyFinished=EXPECTED_RESERVATIONS.every(t=>reservationsBefore.find(x=>x.id===t.id)?.status==='released')
if(alreadyFinished) {
  assert.equal(activityBefore.length,1,'Completed repair must have exactly one history entry')
  const check=await request({sql:BATCH_SQL[5]},'already-completed guard')
  assert.equal(check[0]?.results?.[0]?.gate,'OK')
  console.log('REPAIR_1563_ALREADY_APPLIED: no writes')
  process.exit(0)
}
assert.equal(activityBefore.length,0,'Unexpected prior reconciliation activity')
for(const t of EXPECTED_RESERVATIONS){
  const record=reservationsBefore.find(r=>r.id===t.id)
  assert(record&&record.order_item_id===t.item&&record.inventory_source===t.source&&
    record.variant_id===t.variant&&record.quantity===1&&record.status===t.status,
  'Reservation #'+t.id+' differs from verified snapshot; refuse repair')
}
const guard=await request({sql:BATCH_SQL[0]},'strict preflight guard')
assert.equal(guard[0]?.results?.[0]?.gate,'OK','D1 preflight gate failed')
console.log('REPAIR_1563_PRECHECK_PASS '+JSON.stringify({
  orderId:1563,openReservations:EXPECTED_RESERVATIONS.map(x=>x.id),
  physicalStock:stocksBefore.map(s=>({source:s.inventory_source,variant:s.variant_id,quantity:s.quantity})),
  mode,
}))
if(mode==='--check'){
  console.log('REPAIR_1563_DRY_RUN_COMPLETE: zero writes')
  process.exit(0)
}
assert(process.env.GITHUB_REF==='refs/heads/ops/branch2-return-1563-exact-reconciliation-20261031'&&process.env.GITHUB_EVENT_NAME==='push',
 'Write mode is restricted to the exact isolated Branch2 repair workflow branch push')
assert(process.env.REPAIR_1563_EXPLICIT_APPROVAL==='branch2-1563-return-closure-20261031',
 'Missing fixed one-off workflow repair guard')
const response=await request({batch:BATCH_SQL.map(sql=>({sql}))},'single atomic repair batch')
assert.equal(response.length,BATCH_SQL.length,'Unexpected batch result count')
assert.equal(response[0]?.results?.[0]?.gate,'OK')
assert.equal(response[response.length-1]?.results?.[0]?.gate,'OK')
const stocksAfter=await select(stockQuery,'stock after')
const reservationsAfter=await select(reservationQuery,'reservations after')
const activityAfter=await select(activityQuery,'activity after')
const ordersAfter=await select(orderQuery,'order after')
assert.deepEqual(ordersAfter,ordersBefore,'Order finance/status changed unexpectedly')
assert.equal(activityAfter.length,1,'Missing unique audit event')
assert.deepEqual(stocksAfter.map(s=>({id:s.id,qty:s.quantity,action:s.last_action,ref:s.last_source_ref,updated:s.updated_at})),
 stocksBefore.map(s=>({id:s.id,qty:s.quantity,action:s.last_action,ref:s.last_source_ref,updated:s.updated_at})),
 'Physical stock or physical-movement stamp changed')
for(const t of EXPECTED_RESERVATIONS){
  assert.equal(reservationsAfter.find(r=>r.id===t.id)?.status,'released',
   'Failed to close '+t.id)
}
for(const stock of stocksAfter){
  const active=await select(
    "SELECT COALESCE(SUM(quantity),0) AS reserved FROM inventory_reservations WHERE status='active' AND inventory_source='"+stock.inventory_source+"' AND variant_id="+stock.variant_id,
    'sum active reserves')
  assert.equal(stock.reserved_quantity,active[0].reserved,
   'Stock reservation cache mismatch for '+stock.variant_id)
}
console.log('REPAIR_1563_BRANCH2_SUCCESS '+JSON.stringify({
  released:EXPECTED_RESERVATIONS.map(x=>x.id),
  physicalStockChanged:false,financialRowsChanged:false,historyRecorded:true,
}))
