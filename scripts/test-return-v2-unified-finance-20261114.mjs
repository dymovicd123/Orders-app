import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import {spawnSync} from 'node:child_process'
import worker from '../worker/index.ts'
import { previewUnifiedReturnV2LineEvidence } from '../worker/domains/return-v2-unified-line-evidence.ts'
import {listWorkshopTasks,updateWorkshopTask} from '../worker/domains/workshop.ts'
import {listReturnHistory} from '../worker/domains/activity.ts'
import { postUnifiedReturnV2Prototype } from '../worker/domains/return-v2-unified-posting-prototype.ts'
import { submitUnifiedReturnV2WithReceiptPrototype, completeUnifiedReturnV2ReceiptPrototype } from '../worker/domains/return-v2-unified-immediate-intake-prototype.ts'
import { readVersionedReturnMoney, syncVersionedReturnMoneyPrototype } from '../worker/domains/return-v2-financial-projection.ts'
import { createVersionedReturnV2DebtPaymentPrototype } from '../worker/domains/return-v2-debt-payment-prototype.ts'
import { cancelUnifiedReturnV2Prototype } from '../worker/domains/return-v2-unified-cancel-prototype.ts'
import { assertLegacyMutationAllowedAfterReturnV2, readReturnV2LegacyMutationGate, legacyV1WriteExclusionSql } from '../worker/domains/return-v2-legacy-mutation-guard.ts'
import { readOrderFinancialLedger, syncOrderFinancialLedger } from '../worker/domains/money.ts'
import { updateOrderCritical } from '../worker/domains/orders-write.ts'
import { deleteOrderSafely } from '../worker/domains/order-delete.ts'
import { fulfillOrderReservationsV2, confirmItemStillHere, reconcileIssuedBeforeCheckpoint } from '../worker/domains/order-reservations.ts'
import { confirmRetiredOrderItemDelivered } from '../worker/domains/retired-item-handover.ts'
import { dispatchRestoredReturnV2ReservationPrototype } from '../worker/domains/return-v2-resumed-shipment-prototype.ts'
import {handleOrderReturnV2Route,returnV2SchemaReadiness,RETURN_V2_REQUIRED_TABLES,RETURN_V2_REQUIRED_COLUMNS} from '../worker/routes/order-return-v2.ts'
import {returnV2PreviewMode,allowLegacyReturnEditor} from '../src/features/sections/returnV2UiMode.ts'

// Prevent recurrence of a serious employee-facing integration bug: enabled
// Return V2 with an ineligible order/error must NEVER show legacy V1 editing.
assert.equal(returnV2PreviewMode({ok:true,enabled:true,eligible:true},true),'v2')
assert.equal(returnV2PreviewMode({ok:true,enabled:true,eligible:false,reason:'stock history'},true),'v2')
assert.equal(returnV2PreviewMode({ok:true,enabled:true,exclusive:true,eligible:false},true),'v2')
assert.equal(returnV2PreviewMode({ok:true,enabled:false,eligible:false},true),'legacy')
assert.equal(returnV2PreviewMode({ok:false,enabled:false},true),'error')
assert.equal(returnV2PreviewMode({ok:true,eligible:false},true),'error')
assert.equal(returnV2PreviewMode({ok:true,enabled:false},false),'error')
assert.equal(returnV2PreviewMode(null,true),'error')
for(const mode of ['checking','v2','error']){
 assert.equal(allowLegacyReturnEditor(9551,9551,mode),false)
}
assert.equal(allowLegacyReturnEditor(9551,9551,'legacy'),true)
assert.equal(allowLegacyReturnEditor(9551,9552,'legacy'),false)
assert.equal(allowLegacyReturnEditor(0,0,'checking'),true)


// Validate the runnable, no-network Branch2 preflight against the COMPLETE
// migration chain in CI, not just individual Worker SQL statements.
const stagePreflight=spawnSync(process.execPath,['scripts/return-v2-branch2-readiness.mjs'],{
 encoding:'utf8',timeout:90000
})
assert.equal(stagePreflight.status,0,
 'Read-only Branch2 local preflight failed:\n'+stagePreflight.stdout+'\n'+stagePreflight.stderr)
const stageReport=JSON.parse(stagePreflight.stdout)
assert.equal(stageReport.mode,'local-in-memory')
assert.equal(stageReport.target,'orders-app-branch2')
assert.equal(stageReport.schema.ready,true)
assert.equal(stageReport.schema.expectedTables,RETURN_V2_REQUIRED_TABLES.length)
assert.equal(stageReport.schema.expectedColumns,10)
assert.equal(stageReport.remoteMigrationPerformed,false)
assert.equal(stageReport.remoteDeploymentPerformed,false)
const sql=new DatabaseSync(':memory:')
for(const m of fs.readdirSync('migrations').filter(x=>/^\d{4}.*\.sql$/.test(x)).sort()){
  sql.exec(fs.readFileSync('migrations/'+m,'utf8'))
}
if(!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const stmt=(q,a=[])=>({
  bind(...args){return stmt(q,args)},
  async first(){return sql.prepare(q).get(...a)??null},
  async all(){return{results:sql.prepare(q).all(...a)}},
  async run(){const r=sql.prepare(q).run(...a);return{meta:{changes:r.changes,last_row_id:Number(r.lastInsertRowid)}}},
})
const DB={
  prepare:q=>stmt(q),
  async batch(statements){
    sql.exec('SAVEPOINT stage5_http')
    try{const out=[];for(const s of statements)out.push(await s.run());sql.exec('RELEASE stage5_http');return out}
    catch(e){sql.exec('ROLLBACK TO SAVEPOINT stage5_http');sql.exec('RELEASE stage5_http');throw e}
  },
}
const token='stage5-http-session',tokenHash=createHash('sha256').update(token).digest('base64url')
sql.prepare("INSERT OR IGNORE INTO managers(id,name,is_active) VALUES(9501,'Test manager',1)").run()
sql.prepare("INSERT INTO app_users(id,login,email,password_hash,role,manager_id,display_name,is_active,must_change_password) VALUES(9501,'stage5person','test-stage5@invalid','not-used','manager',9501,'Test manager',1,0)").run()
sql.prepare("INSERT INTO app_sessions(user_id,token_hash,expires_at) VALUES(9501,?,'2099-01-01')").run(tokenHash)
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(9521,'STAGE 5 TEST WAREHOUSE','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9531,9521,'МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46','adult',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9541,'warehouse',9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',5,3)").run()
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9551,'ORD-TEST-STAGE5-HTTP','2026-11-01',9501,'active','warehouse','ready','not_sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(9561,9551,9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',3,2000,6000,0,'warehouse','reserved','2026-11-01T00:00:00Z','stage5-http-original','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9551,9561,'warehouse',9521,9531,3,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active'").run()
async function api(method,path,body,expected=200,authenticated=true){
 const headers={...(authenticated?{Cookie:'orders_session='+token}:{}),...(body?{'Content-Type':'application/json'}:{})}
 const response=await worker.fetch(new Request('https://test-only.invalid'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})}),{DB})
 const data=await response.json()
 assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(data))
 return data
}

sql.prepare("UPDATE orders SET total_amount=8000,pricing_mode='itemized_v1' WHERE id=9551").run()
sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES (9562,9551,9521,9531,'BOUTIQUE UNISSUED',1,2000,2000,0,'boutique','reserved','2026-11-01T00:00:00Z','v2-unified-boutique','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES (9542,'boutique',9521,9531,'STAGE 5 TEST WAREHOUSE','МУЖ','ЧЕРНЫЙ','СТАНДАРТ','СТАНДАРТ','46',2,1)").run()
sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES (9551,9562,'boutique',9521,9531,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(9551,'2026-11-01','KASPI',8000,'primary')").run()
const beforeShip=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(beforeShip.summary.selectedQuantity,4)
assert.equal(beforeShip.summary.reservedCancellationQuantity,4)
const ship=await api('POST','/api/orders/9551/shipping/dispatches',{
  requestId:'v2-unified-dispatch-partial-001',items:[{orderItemId:9561,quantity:2}]
})
assert.equal(ship.shippedQuantity,2)
const split=sql.prepare('SELECT id,quantity FROM order_items WHERE order_id=9551 AND id NOT IN(9561,9562)').get()
assert.equal(split.quantity,1)

const stock=source=>({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE inventory_source=? AND variant_id=9531').get(source)})
const eventCount=()=>Number(sql.prepare("SELECT COUNT(*) n FROM inventory_lifecycle_events WHERE operation_type='return'").get().n)
const movementCount=()=>Number(sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE movement_type='return'").get().n)
const offered=await previewUnifiedReturnV2LineEvidence(DB,9551)
assert.equal(offered.summary.selectedQuantity,4)
const items=offered.lines.map(x=>({
 orderItemId:x.orderItemId,quantity:x.selectedQuantity,
 receiptIntent:x.proposedAction==='physical_return_pending'?'warehouse':'pending'
}))
const badChoices=items.map(i=>i.orderItemId===split.id?{...i,receiptIntent:'boutique'}:i)
const beforeReject={warehouse:stock('warehouse'),boutique:stock('boutique')}
await assert.rejects(postUnifiedReturnV2Prototype(DB,{
 requestId:'v2u-receipt-wrong-unsent-001',orderId:9551,
 expectedOrderVersion:offered.orderVersion,items:badChoices,refundAmount:0
}),/Неотправленную позицию/)
assert.deepEqual({warehouse:stock('warehouse'),boutique:stock('boutique')},beforeReject)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9551').get().n,0)
const postInput={
 requestId:'v2u-receipt-now-warehouse-001',orderId:9551,
 expectedOrderVersion:offered.orderVersion,items,
 refundAmount:5000,refundMethod:'Kaspi'
}
const returned=await submitUnifiedReturnV2WithReceiptPrototype(DB,postInput)
assert.equal(returned.ok,true,'Immediate receipt should complete: '+JSON.stringify(returned))
assert.equal(returned.contractPosted,true)
assert.equal(returned.receipt.immediateIntakesComplete,true)
assert.equal(returned.receipt.physicalPendingQuantity,0,'Two immediate received units must not remain pending')
assert.equal(returned.receipt.receiptResults.length,1,'Only dispatched good is physically received')
assert.equal(returned.receipt.receiptResults[0].state,'received')
assert.equal(returned.receipt.receiptResults[0].stockApplied,true)
assert.deepEqual(stock('warehouse'),{quantity:5,reserved_quantity:0},'Two physically returned items increase physical once')
assert.deepEqual(stock('boutique'),{quantity:2,reserved_quantity:0},'Unshipped boutique remains in physical, only reservation is released')
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=9551').get().total_amount,0)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9551').get().debt_amount,0)
const physical=sql.prepare('SELECT id,return_id,order_item_id,quantity,physical_received_at,inventory_source,restocked FROM return_items WHERE return_id=?').all(returned.returnId)
assert.equal(physical.length,1)
assert.equal(physical[0].quantity,2)
assert(physical[0].physical_received_at,'Immediate receipt must have actual acceptance timestamp')
assert.equal(physical[0].inventory_source,'warehouse')
assert.equal(physical[0].restocked,1)
const choices=sql.prepare('SELECT order_item_id,action,receipt_intent FROM return_v2_unified_lines WHERE posting_id=? ORDER BY id').all(returned.postingId)
assert.equal(choices.filter(x=>x.receipt_intent==='warehouse').length,1)
assert(choices.filter(x=>x.action!=='physical_return_pending').every(x=>x.receipt_intent==='not_applicable'))
const cash=sql.prepare("SELECT amount_delta,payment_method FROM financial_events WHERE order_id=9551 AND event_type='order_refund'").get()
assert.deepEqual({...cash},{amount_delta:-5000,payment_method:'KASPI'})
assert.equal(eventCount(),1)
assert.equal(movementCount(),1)
const afterFirst={warehouse:stock('warehouse'),boutique:stock('boutique'),events:eventCount(),movements:movementCount()}
const replay=await submitUnifiedReturnV2WithReceiptPrototype(DB,postInput)
assert.equal(replay.replayed,true)
assert.equal(replay.receipt.immediateIntakesComplete,true)
assert.deepEqual({warehouse:stock('warehouse'),boutique:stock('boutique'),events:eventCount(),movements:movementCount()},afterFirst,
 'Repeated sale/receipt cannot add a second stock movement')
await assert.rejects(postUnifiedReturnV2Prototype(DB,{
 ...postInput,items:postInput.items.map(x=>x.receiptIntent==='warehouse'?{...x,receiptIntent:'no_stock'}:x)
}),/Идентификатор/)
assert.deepEqual({warehouse:stock('warehouse'),boutique:stock('boutique'),events:eventCount(),movements:movementCount()},afterFirst)
assert.equal((await api('GET','/api/orders/9551/shipping/plan')).selectedQuantity,0)

// Create another real selective shipment and opt to RECEIVE WITHOUT RESTOCKING.
function addOrder(orderId,itemId,external,price,quantity=1){
 const now='2026-11-01T00:00:00Z'
 sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,pricing_mode,total_amount,created_at,updated_at) VALUES(?,?, '2026-11-01',9501,'active','warehouse','ready','not_sent','itemized_v1',?,?,?)").run(orderId,external,price*quantity,now,now)
 sql.prepare("INSERT INTO order_items (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at) VALUES(?,?,?,?,?,?,?,?,0,'warehouse','reserved',?,?,?)").run(itemId,orderId,9521,9531,external,quantity,price,price*quantity,now,'v2u-immediate:'+orderId,now)
 sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity+? WHERE id=9541').run(quantity)
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(?,?,'warehouse',9521,9531,?,'active',?,?)").run(orderId,itemId,quantity,now,now)
}
addOrder(9851,9861,'V2U-NO-STOCK',1200)
const noStockSend=await api('POST','/api/orders/9851/shipping/dispatches',{
 requestId:'v2u-no-stock-shipment-001',items:[{orderItemId:9861,quantity:1}]
})
assert.equal(noStockSend.shippedQuantity,1)
const noStockPreview=await previewUnifiedReturnV2LineEvidence(DB,9851)
const beforeNoStock=stock('warehouse')
const noStock=await submitUnifiedReturnV2WithReceiptPrototype(DB,{
 requestId:'v2u-receipt-but-no-stock-001',orderId:9851,
 expectedOrderVersion:noStockPreview.orderVersion,
 items:[{orderItemId:9861,quantity:1,receiptIntent:'no_stock'}],
 refundAmount:0
})
assert.equal(noStock.ok,true)
assert.equal(noStock.receipt.receiptResults[0].state,'received')
assert.equal(noStock.receipt.receiptResults[0].stockApplied,false)
assert.deepEqual(stock('warehouse'),beforeNoStock,'Already received but no-stock must NOT add +1')
const noStockReplay=await completeUnifiedReturnV2ReceiptPrototype(DB,noStock.postingId)
assert.equal(noStockReplay.ok,true)
assert.equal(noStockReplay.physicalPendingQuantity,0)
assert.equal(noStockReplay.receiptResults[0].stockApplied,false)
assert.deepEqual(stock('warehouse'),beforeNoStock)
const noStockItem=sql.prepare('SELECT physical_received_at,inventory_source,restocked FROM return_items WHERE return_id=?').get(noStock.returnId)
assert(noStockItem.physical_received_at)
assert.equal(noStockItem.inventory_source,null)
assert.equal(noStockItem.restocked,0)

// A physical check AFTER Return creation must stop blind immediate +1,
// and an explicit 'already counted' confirmation must never create an extra unit.
addOrder(9852,9862,'V2U-FRESH-STOCKTAKE',1400)
const sent2=await api('POST','/api/orders/9852/shipping/dispatches',{
 requestId:'v2u-stocktake-shipment-001',items:[{orderItemId:9862,quantity:1}]
})
assert.equal(sent2.shippedQuantity,1)
const freshPreview=await previewUnifiedReturnV2LineEvidence(DB,9852)
const postBeforeCheck=await postUnifiedReturnV2Prototype(DB,{
 requestId:'v2u-freshness-pending-001',orderId:9852,expectedOrderVersion:freshPreview.orderVersion,
 items:[{orderItemId:9862,quantity:1,receiptIntent:'warehouse'}],refundAmount:0
})
const stockBeforeCheck=stock('warehouse')
sql.prepare("INSERT INTO inventory_stock_checks(check_key,inventory_source,product_id,variant_id,expected_quantity,counted_quantity,difference_quantity,reserved_quantity,check_type,reference_type,reference_id,checked_at,created_at) VALUES('v2u-after-return-check','warehouse',9521,9531,?,?,0,0,'quick_stocktake','quick_stocktake','v2u-fixture','2090-01-01T00:00:00Z','2090-01-01T00:00:00Z')").run(stockBeforeCheck.quantity,stockBeforeCheck.quantity)
const needProof=await completeUnifiedReturnV2ReceiptPrototype(DB,postBeforeCheck.postingId)
assert.equal(needProof.ok,false)
assert.equal(needProof.receiptPending,true)
assert.equal(needProof.physicalPendingQuantity,1)
assert.equal(needProof.receiptResults[0].state,'confirmation_required')
assert.match(needProof.receiptResults[0].message,/пересчитывали|сверку/)
assert.deepEqual(stock('warehouse'),stockBeforeCheck,'After new physical count, no automatic stock increase')
const outstanding=sql.prepare('SELECT physical_received_at FROM return_items WHERE return_id=?').get(postBeforeCheck.returnId)
assert.equal(outstanding.physical_received_at,null)
const alreadyCounted=await completeUnifiedReturnV2ReceiptPrototype(DB,postBeforeCheck.postingId,{'9862':'already_counted'})
assert.equal(alreadyCounted.ok,true)
assert.equal(alreadyCounted.physicalPendingQuantity,0)
assert.equal(alreadyCounted.receiptResults[0].freshnessProtected,true)
assert.equal(alreadyCounted.receiptResults[0].stockApplied,false)
assert.deepEqual(stock('warehouse'),stockBeforeCheck,'Explicit already_counted must not +1')
const alreadyCountedAgain=await completeUnifiedReturnV2ReceiptPrototype(DB,postBeforeCheck.postingId)
assert.equal(alreadyCountedAgain.ok,true)
assert.deepEqual(stock('warehouse'),stockBeforeCheck)
const freshEvent=sql.prepare('SELECT status FROM inventory_lifecycle_events WHERE operation_type=? AND order_item_id=?').get('return',9862)
assert.equal(freshEvent.status,'cancelled')

const fullFinance=await readVersionedReturnMoney(DB,9551)
assert.equal(fullFinance.kind,'return_v2')
assert.deepEqual({
 sale:fullFinance.currentSale,in:fullFinance.paidIn,out:fullFinance.paidOut,
 net:fullFinance.netHeld,debt:fullFinance.customerDebt,storeOwes:fullFinance.customerOverpay
},{sale:0,in:8000,out:5000,net:3000,debt:0,storeOwes:3000},
 'After full cancellation the money retained by store remains a liability to customer')
assert.equal((await readVersionedReturnMoney(DB,9851)).kind,'return_v2','Received-but-not-stocked return keeps consistent ledger')
assert.equal((await readVersionedReturnMoney(DB,9852)).kind,'return_v2','Already counted return keeps consistent ledger')

// Contract 20k, cancel one unsent unit worth 10k, refund actual 15k.
// Actual retained 5k < remaining sale 10k, hence customer owes 5k.
// Old ledger incorrectly sees 20k original payments and reports no debt.
addOrder(9853,9863,'V2U-FINANCE-PARTIAL',10000,2)
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(9853,'2026-11-01','KASPI',20000,'primary')").run()
const financePreview=await previewUnifiedReturnV2LineEvidence(DB,9853)
assert.equal(financePreview.lines[0].proposedAction,'cancel_unshipped_reservation')
assert.equal(financePreview.lines[0].selectedQuantity,2)
const financePost=await postUnifiedReturnV2Prototype(DB,{
 requestId:'v2u-versioned-money-partial-001',orderId:9853,
 expectedOrderVersion:financePreview.orderVersion,
 items:[{orderItemId:9863,quantity:1,receiptIntent:'pending'}],
 refundAmount:15000,refundMethod:'CASH'
})
assert.equal(financePost.remainingSale,10000)
assert.equal(financePost.fullTermination,false)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,5000)
const v2Ledger=await readVersionedReturnMoney(DB,9853)
assert.equal(v2Ledger.kind,'return_v2')
assert.deepEqual({
 sale:v2Ledger.currentSale,in:v2Ledger.paidIn,out:v2Ledger.paidOut,
 net:v2Ledger.netHeld,debt:v2Ledger.customerDebt,storeOwes:v2Ledger.customerOverpay
},{sale:10000,in:20000,out:15000,net:5000,debt:5000,storeOwes:0})
assert.equal((await readOrderFinancialLedger(DB,9853)).debtAmount,0,
 'V1 sync still would erase real V2 debt')
await assert.rejects(syncOrderFinancialLedger(DB,9853),/старую обработку запрещено|Return V2/)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,5000,
 'Old V1 sync is blocked, not permitted to erase the Return V2 debt')
await syncVersionedReturnMoneyPrototype(DB,9853)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,5000,
 'V2 financial CAS repairs cache based on actual cash after verified mixed Return')
// Existing active HTTP payment must REFUSE to use old debt math on a V2 order.
// Real employee V1 routes must refuse any follow-up Return/Cancellation
// on an already versioned order, including zero-money attempts.
const priorReturns=sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9853').get().n
const blockedReturn=await api('POST','/api/returns',{
 requestId:'v2u-legacy-return-zero-0001',
 orderId:9853,returnDate:'2026-11-14',amount:0,items:[]
},409)
assert.equal(blockedReturn.code,'return_v2_legacy_mutation_blocked')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9853').get().n,priorReturns)
const blockedCancel=await api('PATCH','/api/returns/'+financePost.returnId+'/cancel',{
 requestId:'v2u-legacy-return-cancel-01',comment:'No legacy reversal'
},409)
assert.equal(blockedCancel.code,'return_v2_legacy_mutation_blocked')
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(financePost.returnId).status,'completed')
// All three historical Exchange entrypoints must refuse a versioned order
// BEFORE an old Return/physical receipt or financial correction can start.
for(const [path,requestId] of [
 ['/api/exchanges','v2u-old-single-exchange-refuse-0001'],
 ['/api/exchanges/set','v2u-old-set-exchange-refuse-000001'],
 ['/api/exchanges/batch','v2u-old-batch-exchange-refuse-01'],
]){
 const denied=await api('POST',path,{requestId,orderId:9853},409)
 assert.equal(denied.code,'return_v2_legacy_mutation_blocked',path)
}
assert.equal(sql.prepare('SELECT COUNT(*) n FROM exchanges WHERE order_id=9853').get().n,0)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,5000)
const rejectedV1Payment=await api('POST','/api/payments',{
 requestId:'v2u-old-money-writer-refuse-00001',
 orderId:9853,paymentDate:'2026-11-14',method:'KASPI',amount:3000,paymentKind:'debt_close'
},409)
assert.equal(rejectedV1Payment.code,'return_v2_legacy_mutation_blocked')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9853').get().n,1)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,5000)
// Simulate a concurrent change after preflight, before the atomic batch.
const raceBefore=sql.prepare('SELECT updated_at FROM orders WHERE id=9853').get().updated_at
const raceDb={...DB,async batch(statements){
 sql.prepare("UPDATE orders SET updated_at='2090-01-01T00:00:00Z' WHERE id=9853").run()
 return DB.batch(statements)
}}
const debtInput={
 orderId:9853,requestId:'v2u-manual-debt-close-unique-001',
 paymentDate:'2026-11-14',method:'kaspi',amount:3000
}
const beforeRacePayments=sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9853').get().n
await assert.rejects(createVersionedReturnV2DebtPaymentPrototype(raceDb,debtInput),/измени|изменились/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9853').get().n,beforeRacePayments)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM financial_events WHERE event_key='return-v2:debt-close:v2u-manual-debt-close-unique-001'").get().n,0)
sql.prepare('UPDATE orders SET updated_at=? WHERE id=9853').run(raceBefore)
const paidV2=await createVersionedReturnV2DebtPaymentPrototype(DB,debtInput)
assert.equal(paidV2.replayed,false)
assert.equal(paidV2.amount,3000)
assert.equal(paidV2.debt,2000)
assert.equal(paidV2.overpay,0)
const paidAgain=await createVersionedReturnV2DebtPaymentPrototype(DB,debtInput)
assert.equal(paidAgain.replayed,true)
assert.equal(paidAgain.paymentId,paidV2.paymentId)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9853').get().n,beforeRacePayments+1)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM financial_events WHERE event_key='return-v2:debt-close:v2u-manual-debt-close-unique-001'").get().n,1)
await assert.rejects(createVersionedReturnV2DebtPaymentPrototype(DB,{...debtInput,amount:2000}),/идентификатор/)
await assert.rejects(createVersionedReturnV2DebtPaymentPrototype(DB,{...debtInput,requestId:'v2u-manual-debt-close-too-large',amount:5000}),/превышает/)
const later=await readVersionedReturnMoney(DB,9853)
assert.equal(later.customerDebt,2000)
assert.equal(later.netHeld,8000)
await syncVersionedReturnMoneyPrototype(DB,9853)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,2000)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE id=9541').get().reserved_quantity,1,
 'Cancel 1 of 2 unshipped leaves one active reserved, no phantom stock')
const moneyKey='return-v2:unified:v2u-versioned-money-partial-001'
sql.prepare("UPDATE financial_events SET amount_delta=-14000 WHERE event_key=?").run(moneyKey)
await assert.rejects(readVersionedReturnMoney(DB,9853),/разбор|поддерживаемые/)
sql.prepare("UPDATE financial_events SET amount_delta=-15000 WHERE event_key=?").run(moneyKey)
sql.prepare('UPDATE return_v2_unified_lines SET contract_reduction=0 WHERE posting_id=?').run(financePost.postingId)
await assert.rejects(readVersionedReturnMoney(DB,9853),/разбор|поддерживаемые/)
sql.prepare('UPDATE return_v2_unified_lines SET contract_reduction=10000 WHERE posting_id=?').run(financePost.postingId)
sql.prepare("UPDATE returns SET status='cancelled' WHERE id=?").run(financePost.returnId)
await assert.rejects(readVersionedReturnMoney(DB,9853),/разбор|поддерживаемые/)
sql.prepare("UPDATE returns SET status='completed' WHERE id=?").run(financePost.returnId)
const physicalId=sql.prepare('SELECT id FROM return_items WHERE return_id=?').get(returned.returnId).id
sql.prepare('UPDATE return_items SET contract_quantity_applied=0 WHERE id=?').run(physicalId)
await assert.rejects(readVersionedReturnMoney(DB,9551),/разбор|поддерживаемые/,
 'Physically received goods still need correct contract marker for audit')
sql.prepare('UPDATE return_items SET contract_quantity_applied=1 WHERE id=?').run(physicalId)
sql.prepare("INSERT INTO returns(order_id,return_date,amount,status,created_at) VALUES(9853,'2026-11-14',0,'completed','2026-11-14T00:00:00Z')").run()
const orphanReturn=Number(sql.prepare('SELECT last_insert_rowid() id').get().id)
await assert.rejects(readVersionedReturnMoney(DB,9853),/разбор|поддерживаемые/,
 'An unlinked legacy Return cannot silently join V2 money model')
sql.prepare('DELETE FROM returns WHERE id=?').run(orphanReturn)
assert.equal((await readVersionedReturnMoney(DB,9853)).customerDebt,2000)
addOrder(9854,9864,'V2U-LEGACY-NO-POST',1500)
const oldFinancial=await readVersionedReturnMoney(DB,9854)
assert.equal(oldFinancial.kind,'legacy')
assert.equal(oldFinancial.customerOverpay,null)
await assert.rejects(syncVersionedReturnMoneyPrototype(DB,9854),/Исторические/)
await assert.rejects(createVersionedReturnV2DebtPaymentPrototype(DB,{
 orderId:9854,requestId:'v2u-old-order-cannot-pay-0001',
 paymentDate:'2026-11-14',method:'KASPI',amount:1
}),/исторического/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9854').get().n,0)

// Unified Return V2 cancellation is a NEW, independently guarded prototype.
const cancelledReceiptRequest={
 postingId:returned.postingId,requestId:'v2u-cannot-undo-received-00001',
 reason:'Проверка уже принятого товара',
 shippedGoodsUnreceivedConfirmed:true,reservationsRestoreConfirmed:true,
 refundRecoveredConfirmed:true,recoveryMethod:'CASH'
}
await assert.rejects(cancelUnifiedReturnV2Prototype(DB,cancelledReceiptRequest),
 /изменились|поступил|операц|приём|истори/)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(returned.returnId).status,'completed')
await assert.rejects(cancelUnifiedReturnV2Prototype(DB,{
 postingId:financePost.postingId,requestId:'v2u-cannot-undo-after-payment-01',
 reason:'Проверка последующего платежа',
 shippedGoodsUnreceivedConfirmed:false,reservationsRestoreConfirmed:true,
 refundRecoveredConfirmed:true,recoveryMethod:'CASH'
}),/изменились|операц|деньги/)

// A fresh mixed order with 1 shipped + 1 still reserved is cancellable
// before actual physical intake; reserving again changes RESERVED, not PHYSICAL.
// Use a NEW SKU: earlier fixture intentionally has a later physical stocktake.
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(9535,9521,'МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','48','adult',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9545,'warehouse',9521,9535,'V2U CANCEL SKU','МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','48',20,2)").run()
addOrder(9855,9865,'V2U-CANCEL-MIXED',2000,2)
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity-2 WHERE id=9541').run()
sql.prepare("UPDATE order_items SET variant_id=9535,color_snapshot='СИНИЙ',size_snapshot='48' WHERE id=9865").run()
sql.prepare('UPDATE inventory_reservations SET variant_id=9535 WHERE order_item_id=9865').run()
const mixedStock=()=>({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9545').get()})
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(9855,'2026-11-01','KASPI',4000,'primary')").run()
const mixedSend=await api('POST','/api/orders/9855/shipping/dispatches',{
 requestId:'v2u-cancellation-dispatch-01',items:[{orderItemId:9865,quantity:1}]
})
assert.equal(mixedSend.shippedQuantity,1)
const mixedPreview=await previewUnifiedReturnV2LineEvidence(DB,9855)
assert.equal(mixedPreview.summary.selectedQuantity,2)
assert.equal(mixedPreview.summary.pendingPhysicalQuantity,1)
assert.equal(mixedPreview.summary.reservedCancellationQuantity,1)
const mixedPostingInput={
 requestId:'v2u-cancel-proven-posting-0001',orderId:9855,
 expectedOrderVersion:mixedPreview.orderVersion,
 items:mixedPreview.lines.map(l=>({orderItemId:l.orderItemId,quantity:l.selectedQuantity,receiptIntent:'pending'})),
 refundAmount:1000,refundMethod:'KASPI'
}
// A payment that has been physically inserted but not fully completed is an
// incompatible outstanding V1 saga, not permission to post a V2 Return.
sql.prepare(`INSERT INTO critical_operations(
 request_id,operation_type,request_fingerprint,status,step,context_json,
 lease_token,lease_until_ms,created_at,updated_at)
 VALUES('v2u-inflight-old-payment','order_payment_create','test-only-fingerprint',
 'started','payment_written',?,'test-lease',9999999999999,
 '2026-11-14T00:00:00Z','2026-11-14T00:00:00Z')`)
 .run(JSON.stringify({orderId:9855,plan:{orderId:9855}}))
const pendingBefore=sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9855').get().n
// A staged legacy editor must not be overtaken by a versioned Return.
sql.prepare(`INSERT INTO critical_operations(
 request_id,operation_type,request_fingerprint,status,step,context_json,
 lease_token,lease_until_ms,created_at,updated_at)
 VALUES('v2u-inflight-order-edit','order_edit','test-edit-fingerprint',
 'started','validated',?,'edit-lease',9999999999999,
 '2026-11-14T00:00:00Z','2026-11-14T00:00:00Z')`)
 .run(JSON.stringify({orderId:9855}))
await assert.rejects(postUnifiedReturnV2Prototype(DB,mixedPostingInput),
 /изменились|проверка|резерв|оплата/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9855').get().n,pendingBefore)
sql.prepare("DELETE FROM critical_operations WHERE request_id='v2u-inflight-order-edit'").run()
await assert.rejects(postUnifiedReturnV2Prototype(DB,mixedPostingInput),/изменились|проверка|резерв|оплата/)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9855').get().n,pendingBefore,
 'An in-flight V1 payment cannot be outpaced by Return V2 contract posting')
sql.prepare("DELETE FROM critical_operations WHERE request_id='v2u-inflight-old-payment'").run()
const mixedPost=await postUnifiedReturnV2Prototype(DB,mixedPostingInput)
assert.equal(mixedPost.remainingSale,0)
assert.equal((await readVersionedReturnMoney(DB,9855)).customerOverpay,3000)
const beforeCancelStock=mixedStock()
const mixedCancelInput={
 postingId:mixedPost.postingId,requestId:'v2u-mixed-cancellation-unique-01',
 reason:'Клиент возобновил покупку',
 shippedGoodsUnreceivedConfirmed:true,reservationsRestoreConfirmed:true,
 refundRecoveredConfirmed:true,recoveryMethod:'CASH'
}
await assert.rejects(cancelUnifiedReturnV2Prototype(DB,{
 ...mixedCancelInput,refundRecoveredConfirmed:false
}),/деньги|выплачен|фактическ/)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(mixedPost.returnId).status,'completed')
// Demand proof of free physical capacity before re-establishing the reservation.
sql.prepare('UPDATE inventory_stock SET quantity=reserved_quantity WHERE id=9545').run()
await assert.rejects(cancelUnifiedReturnV2Prototype(DB,mixedCancelInput),/Резерв|зарезервирован|пересчитан/)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(mixedPost.returnId).status,'completed')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE event_key=?').get('return-v2:unified:cancelled:'+mixedPost.postingId).n,0)
sql.prepare('UPDATE inventory_stock SET quantity=? WHERE id=9545').run(beforeCancelStock.quantity)
const mixedCancelled=await cancelUnifiedReturnV2Prototype(DB,mixedCancelInput)
assert.equal(mixedCancelled.cancelled,true)
assert.equal(mixedCancelled.replayed,false)
assert.equal(mixedCancelled.cashRecovered,1000)
assert.equal(mixedCancelled.physicalStockDelta,0)
assert.equal(sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=9855').get().total_amount,4000)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(mixedPost.returnId).status,'cancelled')
assert.deepEqual(mixedStock(),{quantity:beforeCancelStock.quantity,reserved_quantity:beforeCancelStock.reserved_quantity+1},
 'Undoing unshipped cancellation re-reserves 1 without physical stock receipt')
const restoredLines=sql.prepare('SELECT quantity,line_total,stock_writeoff_status FROM order_items WHERE order_id=9855 ORDER BY id').all()
assert.equal(restoredLines.reduce((n,l)=>n+l.quantity,0),2)
assert.equal(restoredLines.reduce((n,l)=>n+l.line_total,0),4000)
const restorableReservation=sql.prepare("SELECT quantity,status FROM inventory_reservations WHERE order_id=9855 AND status='active'").get()
assert.equal(restorableReservation.quantity,1)
assert.equal((await api('GET','/api/orders/9855/shipping/plan')).selectedQuantity,1,
 'Only previously unsent restored reservation can ship again')
const restoredMoney=await readVersionedReturnMoney(DB,9855)
assert.equal(restoredMoney.customerDebt,0)
assert.equal(restoredMoney.customerOverpay,0)
assert.equal(restoredMoney.paidOut,0)
assert.equal(restoredMoney.paidIn,4000)
assert.equal(sql.prepare('SELECT amount_delta FROM financial_events WHERE event_key=?').get('return-v2:unified:cancelled:'+mixedPost.postingId).amount_delta,1000)
const repeatedCancel=await cancelUnifiedReturnV2Prototype(DB,mixedCancelInput)
assert.equal(repeatedCancel.replayed,true)
assert.deepEqual(mixedStock(),{quantity:beforeCancelStock.quantity,reserved_quantity:beforeCancelStock.reserved_quantity+1})
await assert.rejects(cancelUnifiedReturnV2Prototype(DB,{...mixedCancelInput,reason:'Другая причина'}),/другими/)

// Real legacy editor and Delete entrypoints MUST reject even an admin request
// before touching stock, payments, old cached debt or audit history.
const editSnapshot=sql.prepare('SELECT total_amount,received_amount,debt_amount,updated_at FROM orders WHERE id=9853').get()
const editStockBefore=sql.prepare('SELECT SUM(quantity) AS qty,SUM(reserved_quantity) AS reserved FROM inventory_stock').get()
await assert.rejects(updateOrderCritical(DB,9853,{
 requestId:'v2u-old-admin-editor-block-0001',comment:'Old edit must not write'
},{role:'admin'},'Admin'),/старую обработку запрещено/)
await assert.rejects(deleteOrderSafely(DB,9853,{
 requestId:'v2u-old-admin-delete-block-0001',comment:'No delete'
}),/старую обработку запрещено/)
assert.deepEqual(sql.prepare('SELECT total_amount,received_amount,debt_amount,updated_at FROM orders WHERE id=9853').get(),editSnapshot)
assert.deepEqual(sql.prepare('SELECT SUM(quantity) AS qty,SUM(reserved_quantity) AS reserved FROM inventory_stock').get(),editStockBefore)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM critical_operations WHERE request_id IN ('v2u-old-admin-editor-block-0001','v2u-old-admin-delete-block-0001')").get().n,0)
const cancelledEditState=sql.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=9855').get()
await assert.rejects(updateOrderCritical(DB,9855,{requestId:'v2u-old-admin-editor-block-after-cancel',comment:'No'}, {role:'admin'},'Admin'),/старую обработку запрещено/)
assert.deepEqual(sql.prepare('SELECT total_amount,received_amount,debt_amount FROM orders WHERE id=9855').get(),cancelledEditState)
// A normal employee may still correct order-only metadata after Return V2.
// The existing HTTP PATCH requires precisely metadataCorrection (no product,
// price, payment method, reserve or cash update is mixed into this operation).
const snapshotMetadata=(orderId)=>{
 const o=sql.prepare(`SELECT o.order_date,o.total_amount,o.received_amount,o.return_amount,
  o.debt_amount,o.shipping_status,o.order_status,o.updated_at,
  COALESCE(c.phone_normalized,'') AS phone,
  COALESCE(o.customer_name_override,c.display_name,'') AS name,
  COALESCE(o.city,'') AS city,COALESCE(o.delivery_type,'') AS delivery,
  COALESCE(o.comment,'') AS comment
  FROM orders o LEFT JOIN customers c ON c.id=o.customer_id WHERE o.id=?`).get(orderId)
 return {order:o,expected:{
  orderDate:o.order_date,customerPhone:o.phone,customerName:o.name,
  city:o.city,deliveryType:o.delivery,comment:o.comment
 },expectedState:{
  totalAmount:o.total_amount,receivedAmount:o.received_amount,
  debtAmount:o.debt_amount,returnAmount:o.return_amount,
  shippingStatus:o.shipping_status,orderStatus:o.order_status
 }}
}
const beforeMetadata=snapshotMetadata(9853)
const beforeMetadataStock=sql.prepare('SELECT id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all()
const beforeMetadataPayments=sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9853').get().n
const beforeMetadataReturns=sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9853').get().n
const beforeMetadataEvents=sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE order_id=9853').get().n
const metadataPayload={
 requestId:'v2u-order-metadata-only-0001',
 metadataCorrection:{
  expected:beforeMetadata.expected,
  next:{...beforeMetadata.expected,city:'Алматы',comment:'Адрес доставки уточнён'},
  expectedState:beforeMetadata.expectedState
 }
}
const metadataSaved=await api('PATCH','/api/orders/9853',metadataPayload)
assert.equal(metadataSaved.ok,true)
assert.equal(metadataSaved.alreadySaved,false)
assert.equal(metadataSaved.customerDebt,2000)
assert.equal((await readVersionedReturnMoney(DB,9853)).customerDebt,2000)
assert.equal(sql.prepare('SELECT city,comment FROM orders WHERE id=9853').get().city,'Алматы')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_metadata_edits WHERE order_id=9853').get().n,1)
const metadataRepeated=await api('PATCH','/api/orders/9853',metadataPayload)
assert.equal(metadataRepeated.alreadySaved,true)
assert.equal(metadataRepeated.updatedAt,metadataSaved.updatedAt)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_metadata_edits WHERE order_id=9853').get().n,1)
const wrongReplay=await api('PATCH','/api/orders/9853',{
 ...metadataPayload,metadataCorrection:{
  ...metadataPayload.metadataCorrection,
  next:{...metadataPayload.metadataCorrection.next,city:'Астана'}
 }
},409)
assert.equal(wrongReplay.code,'return_v2_metadata_conflict')
const staleMetadata=await api('PATCH','/api/orders/9853',{
 ...metadataPayload,requestId:'v2u-order-metadata-stale-00001',
 metadataCorrection:{...metadataPayload.metadataCorrection,
  next:{...metadataPayload.metadataCorrection.next,comment:'Старые реквизиты'}}
},409)
assert.equal(staleMetadata.code,'return_v2_metadata_conflict')
const craftedEdit=await api('PATCH','/api/orders/9853',{
 ...metadataPayload,requestId:'v2u-order-metadata-crafted-0001',
 orderTotal:1
},409)
assert.equal(craftedEdit.code,'critical_operation_conflict',
 'Manager role gate rejects forged price fields even before the V2 history gate')
const managerDate=await api('PATCH','/api/orders/9853',{
 ...metadataPayload,requestId:'v2u-manager-date-denied-00001',
 metadataCorrection:{expected:snapshotMetadata(9853).expected,
  next:{...snapshotMetadata(9853).expected,orderDate:'2026-11-02'},
  expectedState:snapshotMetadata(9853).expectedState}
},409)
assert.equal(managerDate.code,'return_v2_metadata_conflict')
assert.deepEqual(sql.prepare('SELECT id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all(),beforeMetadataStock)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9853').get().n,beforeMetadataPayments)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9853').get().n,beforeMetadataReturns)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE order_id=9853').get().n,beforeMetadataEvents)
assert.equal((await readVersionedReturnMoney(DB,9853)).customerDebt,2000)
// A cancelled V2 must remain in the V2 ledger but should not lock metadata.
const cancelledMetadata=snapshotMetadata(9855)
const correctedCancelled=await api('PATCH','/api/orders/9855',{
 requestId:'v2u-cancelled-metadata-00001',
 metadataCorrection:{
  expected:cancelledMetadata.expected,
  next:{...cancelledMetadata.expected,deliveryType:'Самовывоз'},
  expectedState:cancelledMetadata.expectedState
 }
})
assert.equal(correctedCancelled.ok,true)
assert.equal(sql.prepare('SELECT delivery_type FROM orders WHERE id=9855').get().delivery_type,'Самовывоз')
assert.equal((await readVersionedReturnMoney(DB,9855)).customerDebt,0)

// A verified (even cancelled) V2 history must not be mutated by legacy
// dispatch, dispatch undo, full-shipping, retired issue or old handover.
const shipV2Order=9855
const v2StockSnapshot=sql.prepare('SELECT id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all()
const v2OrderSnapshot=sql.prepare('SELECT total_amount,received_amount,debt_amount,shipping_status FROM orders WHERE id=?').get(shipV2Order)
const v2DispatchCount=sql.prepare('SELECT COUNT(*) n FROM order_dispatches WHERE order_id=?').get(shipV2Order).n
const v2DispatchCorrections=sql.prepare('SELECT COUNT(*) n FROM order_dispatch_corrections').get().n
const v2ShipPlan=await api('GET','/api/orders/9855/shipping/plan')
const v2Ready=v2ShipPlan.lines.find(x=>x.selectable)
assert(v2Ready,'Cancelled V2 has a remaining active reservation; ordinary shipment must not be permitted')
const v1SelectiveBlocked=await api('POST','/api/orders/9855/shipping/dispatches',{
 requestId:'v2u-block-old-shipment-0000001',
 items:[{orderItemId:v2Ready.orderItemId,quantity:1}]
},409)
assert.equal(v1SelectiveBlocked.code,'return_v2_legacy_mutation_blocked')
const v2DispatchItem=sql.prepare('SELECT di.id FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id WHERE d.order_id=9855 LIMIT 1').get()
assert(v2DispatchItem?.id)
const v1DispatchUndoBlocked=await api('POST',`/api/orders/9855/shipping/dispatch-items/${v2DispatchItem.id}/correct`,{
 requestId:'v2u-block-old-dispatch-undo-0001',reason:'No legacy undo'
},409)
assert.equal(v1DispatchUndoBlocked.code,'return_v2_legacy_mutation_blocked')
const v1WholeShippingBlocked=await api('PATCH','/api/orders/9855/shipping',{
 shippingStatus:'sent',shippingDate:'2026-11-15'
},409)
assert.equal(v1WholeShippingBlocked.code,'return_v2_legacy_mutation_blocked')
const v1ShippingUndoBlocked=await api('POST','/api/orders/9855/shipping/correct',{
 physicalOutcome:'not_issued'
},409)
assert.equal(v1ShippingUndoBlocked.code,'return_v2_legacy_mutation_blocked')
await assert.rejects(fulfillOrderReservationsV2(DB,9855,'V2U-CANCEL-MIXED',new Date().toISOString(),{
 orderItemIds:[v2Ready.orderItemId],stockConfirmationOperation:'handover'
}),/старую обработку запрещено/)
await assert.rejects(confirmItemStillHere(DB,9855,'V2U-CANCEL-MIXED',{},0,'','tester'),/старую обработку запрещено/)
await assert.rejects(reconcileIssuedBeforeCheckpoint(DB,9855,'V2U-CANCEL-MIXED',{},0,'','tester'),/старую обработку запрещено/)
await assert.rejects(confirmRetiredOrderItemDelivered(DB,{
 orderId:9855,orderItemId:v2Ready.orderItemId,expectedVariantId:9535,
 expectedQuantity:1,confirmedPhysicallyDelivered:true,actor:'tester'
}),/старую обработку запрещено/)
assert.deepEqual(sql.prepare('SELECT id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all(),v2StockSnapshot)
assert.deepEqual(sql.prepare('SELECT total_amount,received_amount,debt_amount,shipping_status FROM orders WHERE id=?').get(shipV2Order),v2OrderSnapshot)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM order_dispatches WHERE order_id=?').get(shipV2Order).n,v2DispatchCount)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM order_dispatch_corrections').get().n,v2DispatchCorrections)

// A real second shipment after a *cancelled* mixed Return V2 is permitted
// only for the EXACT unshipped reservation restored by the cancellation.
// It must use the normal dispatch stock/movement journal without V1 money.
const resumeBeforeStock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9545').get()
const resumeMoneyBefore=await readVersionedReturnMoney(DB,9855)
const resumeBeforePayments=sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9855').get().n
const resumeBeforeEvents=sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE order_id=9855').get().n
const resumeBeforeMovement=sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reference_type='order_dispatch'").get().n
const readyItem=sql.prepare(`SELECT ul.order_item_id AS id,ul.original_line_quantity AS qty
 FROM return_v2_unified_lines ul WHERE ul.posting_id=?
 AND ul.action='cancel_unshipped_reservation' LIMIT 1`).get(mixedPost.postingId)
assert.equal(readyItem.id,v2Ready.orderItemId)
assert.equal(readyItem.qty,1)
const resumedInput={
 requestId:'v2u-resume-restored-shipment-00001',
 postingId:mixedPost.postingId,orderId:9855,
 orderItemId:readyItem.id,quantity:readyItem.qty,
 expectedOrderVersion:resumeMoneyBefore.orderVersion,
 actor:'Verified warehouse operator',dispatchDate:'2026-11-15'
}
const fakeSelection={...resumedInput,requestId:'v2u-resume-shipped-line-forged-001',
 orderItemId:9865}
await assert.rejects(dispatchRestoredReturnV2ReservationPrototype(DB,fakeSelection),
 /не является восстановленным|восстановленным|отправленн/)
await assert.rejects(dispatchRestoredReturnV2ReservationPrototype(DB,{
 ...resumedInput,requestId:'v2u-resume-stale-order-version-01',
 expectedOrderVersion:'1990-01-01T00:00:00Z'
}),/версия|изменились/)
await assert.rejects(dispatchRestoredReturnV2ReservationPrototype(DB,{
 ...resumedInput,requestId:'v2u-resume-wrong-posting-0001',
 postingId:mixedPost.postingId+5000
}),/не является восстановленным/)
const resumeVersion=sql.prepare('SELECT updated_at FROM orders WHERE id=9855').get().updated_at
// Model a competing metadata/finance update right before D1 commit.
const resumeRaceDb={...DB,async batch(statements){
 sql.prepare("UPDATE orders SET updated_at='2090-01-01T00:00:00Z' WHERE id=9855").run()
 return DB.batch(statements)
}}
await assert.rejects(dispatchRestoredReturnV2ReservationPrototype(resumeRaceDb,{
 ...resumedInput,requestId:'v2u-resume-injected-race-0001'
}),/изменилась|изменилось|конфликт|версия/)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM return_v2_resumed_dispatches WHERE order_id=9855").get().n,0)
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9545').get(),resumeBeforeStock)
sql.prepare('UPDATE orders SET updated_at=? WHERE id=9855').run(resumeVersion)
const resumed=await dispatchRestoredReturnV2ReservationPrototype(DB,resumedInput)
assert.equal(resumed.ok,true)
assert.equal(resumed.alreadyCommitted,false)
assert.equal(resumed.physicalStockDelta,-1)
assert.equal(resumed.financialAmountDelta,0)
const resumeAfterStock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9545').get()
assert.deepEqual({...resumeAfterStock},{
 quantity:resumeBeforeStock.quantity-1,
 reserved_quantity:resumeBeforeStock.reserved_quantity-1
})
assert.equal(sql.prepare("SELECT COUNT(*) n FROM return_v2_resumed_dispatches WHERE order_id=9855").get().n,1)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM order_dispatch_items WHERE dispatch_id=?').get(resumed.dispatchId).n,1)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM inventory_movements WHERE reference_type='order_dispatch'").get().n,resumeBeforeMovement+1)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM payments WHERE order_id=9855').get().n,resumeBeforePayments)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM financial_events WHERE order_id=9855').get().n,resumeBeforeEvents)
assert.equal(sql.prepare("SELECT status FROM returns WHERE id=?").get(mixedPost.returnId).status,'cancelled')
const resumeMoneyAfter=await readVersionedReturnMoney(DB,9855)
assert.equal(resumeMoneyAfter.customerDebt,resumeMoneyBefore.customerDebt)
assert.equal(resumeMoneyAfter.currentSale,resumeMoneyBefore.currentSale)
assert.equal(resumeMoneyAfter.paidIn,resumeMoneyBefore.paidIn)
assert.equal(resumeMoneyAfter.paidOut,resumeMoneyBefore.paidOut)
const resumedAgain=await dispatchRestoredReturnV2ReservationPrototype(DB,resumedInput)
assert.equal(resumedAgain.alreadyCommitted,true)
assert.equal(resumedAgain.dispatchId,resumed.dispatchId)
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9545').get(),resumeAfterStock)
await assert.rejects(dispatchRestoredReturnV2ReservationPrototype(DB,{
 ...resumedInput,quantity:2
}),/не совпадает/)
await assert.rejects(dispatchRestoredReturnV2ReservationPrototype(DB,{
 ...resumedInput,requestId:'v2u-resume-already-shipped-0001',
 expectedOrderVersion:resumeMoneyAfter.orderVersion
}),/восстановленным|отправленн/)

// Multiple subsequent Return V2 postings must reduce only remaining,
// *different* verified order lines. Refunds are cumulative, never paid twice.
// Separate SKU: earlier receipt test deliberately records a 2090
// warehouse checkpoint for variant 9531. Never fake its release.
sql.prepare(`INSERT INTO catalog_variants(
 id,product_id,gender,color,material,length,size_label,category,is_active)
 VALUES(9539,9521,'МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','48','adult',1)`).run()
addOrder(9951,9961,'V2U-REPEAT-FIRST',1000)
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity-1 WHERE id=9541').run()
sql.prepare("UPDATE order_items SET variant_id=9539 WHERE order_id=9951").run()
sql.prepare("UPDATE inventory_reservations SET variant_id=9539 WHERE order_id=9951").run()
sql.prepare(`INSERT INTO inventory_stock(
 id,inventory_source,product_id,variant_id,product_name_snapshot,
 gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
 quantity,reserved_quantity)
 VALUES(9590,'warehouse',9521,9539,'V2U-REPEAT',
 'МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','48',5,2)`).run()
// This is a newly placed test order. Its physical issue must NOT be
// interpreted as preceding the older stocktake/checkpoint test fixtures.
const repeatNow=new Date().toISOString()
sql.prepare("UPDATE orders SET total_amount=3000,order_date=?,created_at=?,updated_at=? WHERE id=9951")
 .run(repeatNow.slice(0,10),repeatNow,repeatNow)
sql.prepare("UPDATE order_items SET created_at=?,inventory_obligation_origin_at=? WHERE order_id=9951")
 .run(repeatNow,repeatNow)
sql.prepare("UPDATE inventory_reservations SET created_at=?,updated_at=? WHERE order_id=9951")
 .run(repeatNow,repeatNow)
sql.prepare(`INSERT INTO order_items(
 id,order_id,product_id,variant_id,product_name_snapshot,
 quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,
 created_at,inventory_obligation_key,inventory_obligation_origin_at)
 VALUES(9962,9951,9521,9539,'V2U-REPEAT-SHIPPED',
 1,2000,2000,0,'warehouse','reserved',?,?,?)`)
 .run(repeatNow,'v2u-repeat-9951-second',repeatNow)
sql.prepare(`INSERT INTO inventory_reservations(
 order_id,order_item_id,inventory_source,product_id,variant_id,quantity,
 status,created_at,updated_at)
 VALUES(9951,9962,'warehouse',9521,9539,1,'active',?,?)`).run(repeatNow,repeatNow)
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(9951,'2026-11-01','KASPI',3000,'primary')").run()
const repeatedShipping=await api('POST','/api/orders/9951/shipping/dispatches',{
 requestId:'v2u-repeat-shipping-00001',
 items:[{orderItemId:9962,quantity:1}]
})
assert.equal(repeatedShipping.shippedQuantity,1)
const repeatFirstPreview=await previewUnifiedReturnV2LineEvidence(DB,9951)
assert.equal(repeatFirstPreview.lines.find(x=>x.orderItemId===9961).proposedAction,'cancel_unshipped_reservation')
assert.equal(repeatFirstPreview.lines.find(x=>x.orderItemId===9962).proposedAction,'physical_return_pending')
const firstRepeatInput={
 requestId:'v2u-repeat-contract-first-001',
 orderId:9951,expectedOrderVersion:repeatFirstPreview.orderVersion,
 items:[{orderItemId:9961,quantity:1,receiptIntent:'pending'}],
 refundAmount:1000,refundMethod:'KASPI'
}
const firstRepeatPost=await postUnifiedReturnV2Prototype(DB,firstRepeatInput)
assert.equal(firstRepeatPost.remainingSale,2000)
const firstRepeatLedger=await readVersionedReturnMoney(DB,9951)
assert.equal(firstRepeatLedger.currentSale,2000)
assert.equal(firstRepeatLedger.paidOut,1000)
assert.equal(firstRepeatLedger.customerDebt,0)
const repeatSecondPreview=await previewUnifiedReturnV2LineEvidence(DB,9951)
assert.equal(repeatSecondPreview.lines.length,1)
assert.equal(repeatSecondPreview.lines[0].orderItemId,9962)
assert.equal(repeatSecondPreview.lines[0].proposedAction,'physical_return_pending')
const repeatStock=()=>({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9590').get()})
const repeatBeforeSecondStock=repeatStock()
await assert.rejects(postUnifiedReturnV2Prototype(DB,{
 requestId:'v2u-repeat-overrefund-denied-01',
 orderId:9951,expectedOrderVersion:repeatSecondPreview.orderVersion,
 items:[{orderItemId:9962,quantity:1,receiptIntent:'no_stock'}],
 refundAmount:2001,refundMethod:'KASPI'
}),/оставшиеся|превышает/)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM returns WHERE order_id=9951').get().n,1)
const repeatSecondInput={
 requestId:'v2u-repeat-contract-second-001',
 orderId:9951,expectedOrderVersion:repeatSecondPreview.orderVersion,
 items:[{orderItemId:9962,quantity:1,receiptIntent:'no_stock'}],
 refundAmount:2000,refundMethod:'KASPI'
}
const repeatSecondPost=await submitUnifiedReturnV2WithReceiptPrototype(DB,repeatSecondInput)
assert.equal(repeatSecondPost.contractPosted,true)
assert.equal(repeatSecondPost.ok,true)
assert.equal(repeatSecondPost.remainingSale,0)
assert.equal(repeatSecondPost.receipt.receiptResults[0].state,'received')
assert.equal(repeatSecondPost.receipt.receiptResults[0].stockApplied,false)
assert.deepEqual(repeatStock(),repeatBeforeSecondStock,'A repeated physical Return accepted to no_stock must not +1 tracked inventory')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_unified_postings WHERE order_id=9951').get().n,2)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9951').get().n,2)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM financial_events WHERE order_id=9951 AND event_type='order_refund'").get().n,2)
const repeatAfterLedger=await readVersionedReturnMoney(DB,9951)
assert.equal(repeatAfterLedger.currentSale,0)
assert.equal(repeatAfterLedger.paidIn,3000)
assert.equal(repeatAfterLedger.paidOut,3000)
assert.equal(repeatAfterLedger.netHeld,0)
assert.equal(repeatAfterLedger.customerDebt,0)
assert.equal(repeatAfterLedger.customerOverpay,0)
assert.equal(sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=9951').get().return_amount,3000)
const replayRepeat=await submitUnifiedReturnV2WithReceiptPrototype(DB,repeatSecondInput)
assert.equal(replayRepeat.replayed,true)
assert.equal(replayRepeat.receipt.receiptResults[0].state,'received')
assert.deepEqual(repeatStock(),repeatBeforeSecondStock)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM financial_events WHERE order_id=9951 AND event_type='order_refund'").get().n,2)
const formerTotal=sql.prepare('SELECT final_total FROM return_v2_unified_postings WHERE id=?').get(firstRepeatPost.postingId).final_total
sql.prepare('UPDATE return_v2_unified_postings SET final_total=final_total+100 WHERE id=?').run(firstRepeatPost.postingId)
await assert.rejects(readVersionedReturnMoney(DB,9951),/разбор|поддерживаемые/,
 'Changing a previous contract total must invalidate the full Return V2 chain')
sql.prepare('UPDATE return_v2_unified_postings SET final_total=? WHERE id=?').run(formerTotal,firstRepeatPost.postingId)
assert.equal((await readVersionedReturnMoney(DB,9951)).paidOut,3000)

// V2 history test gate is also read-only by itself.
// Both active and cancelled V2 histories must prevent old V1 cache / product writes.
const allLegacyActions=[
 'order_edit','order_delete','manual_payment','return_create','return_cancel',
 'exchange_create','exchange_cancel','shipping','stock_handover','order_money_sync'
]
const oldGate=await readReturnV2LegacyMutationGate(DB,9854)
assert.equal(oldGate.v2History,'none')
assert.equal(oldGate.legacyWritesAllowed,true)
for(const action of allLegacyActions){
 const allowed=await assertLegacyMutationAllowedAfterReturnV2(DB,9854,action)
 assert.equal(allowed.legacyWritesAllowed,true)
 for(const v2Order of [9551,9853,9855]){
  await assert.rejects(assertLegacyMutationAllowedAfterReturnV2(DB,v2Order,action),/старую обработку запрещено/)
 }
}
assert.equal((await readReturnV2LegacyMutationGate(DB,9551)).v2History,'unified')
assert.equal((await readReturnV2LegacyMutationGate(DB,9855)).v2History,'unified')
assert.equal((await readReturnV2LegacyMutationGate(DB,9855)).legacyWritesAllowed,false,
 'Cancellation does not remove the historical V2 contract, so old V1 writers stay guarded')
await assert.rejects(readReturnV2LegacyMutationGate(DB,999999),/не найден/)
await assert.rejects(assertLegacyMutationAllowedAfterReturnV2(DB,9854,'unsupported'),/Неизвестная/)
assert.throws(()=>legacyV1WriteExclusionSql('o.id OR 1=1'),/Unsafe/)
const sqlExclusion=legacyV1WriteExclusionSql('o.id')
assert.equal(sql.prepare('SELECT COUNT(*) n FROM orders o WHERE o.id=9854 AND '+sqlExclusion).get().n,1)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM orders o WHERE o.id=9855 AND '+sqlExclusion).get().n,0)

// Backward-compatible schema-first barrier: no V2 tables means no posted V2
// is possible. A half-applied schema is NOT a reason to proceed.
const oldSql=new DatabaseSync(':memory:')
oldSql.exec('CREATE TABLE orders(id INTEGER PRIMARY KEY)')
oldSql.exec('INSERT INTO orders(id) VALUES(11)')
const oldDb={prepare:q=>({
 bind(...a){return {first:async()=>oldSql.prepare(q).get(...a)??null}},
 first:async()=>oldSql.prepare(q).get()??null,
})}
const preMigrations=await readReturnV2LegacyMutationGate(oldDb,11)
assert.equal(preMigrations.legacyWritesAllowed,true)
assert.equal(preMigrations.v2SchemaReady,false)
oldSql.exec('CREATE TABLE return_v2_postings(order_id INTEGER)')
await assert.rejects(readReturnV2LegacyMutationGate(oldDb,11),/не полностью/)
oldSql.close()
// The feature flag is not sufficient to make a partially migrated D1 safe.
// Check a clean local DB AND a synthetic nearly-complete schema missing
// exactly one mandatory receipt field. The rejection is read-only.
const completeReadiness=await returnV2SchemaReadiness(DB)
assert.equal(completeReadiness.ready,true)
assert.equal(completeReadiness.foundTables,completeReadiness.expectedTables)
assert.equal(completeReadiness.foundColumns,completeReadiness.expectedColumns)
const unfinishedSql=new DatabaseSync(':memory:')
for(const table of RETURN_V2_REQUIRED_TABLES){
 const columns=RETURN_V2_REQUIRED_COLUMNS.filter(([t,column])=>
  t===table && !(t==='return_v2_unified_lines'&&column==='receipt_intent'))
  .map(([,column])=>column+' TEXT')
 unfinishedSql.exec('CREATE TABLE '+table+'(id INTEGER PRIMARY KEY'+
  (columns.length?', '+columns.join(', '):'')+')')
}
unfinishedSql.exec('CREATE TABLE return_items(contract_quantity_applied INTEGER)')
const unfinishedDb={prepare:q=>({
 async first(){return unfinishedSql.prepare(q).get()??null}
})}
const missingReceipt=await returnV2SchemaReadiness(unfinishedDb)
assert.equal(missingReceipt.foundTables,missingReceipt.expectedTables)
assert.equal(missingReceipt.foundColumns,missingReceipt.expectedColumns-1)
assert.equal(missingReceipt.ready,false)
const beforeIncomplete=unfinishedSql.prepare('SELECT COUNT(*) AS n FROM return_v2_unified_postings').get().n
const notAvailable=await handleOrderReturnV2Route(unfinishedDb,
 new Request('https://test-only.invalid/api/orders/9953/returns/v2/preview'),
 '/api/orders/9953/returns/v2/preview',true,'admin')
assert.equal(notAvailable?.status,503)
assert.equal((await notAvailable.json()).code,'return_v2_schema_unavailable')
const noWriteOnPartial=await handleOrderReturnV2Route(unfinishedDb,
 new Request('https://test-only.invalid/api/orders/9953/returns/v2',{
  method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
 }),'/api/orders/9953/returns/v2',true,'manager')
assert.equal(noWriteOnPartial?.status,503)
assert.equal((await noWriteOnPartial.json()).code,'return_v2_schema_unavailable')
assert.equal(unfinishedSql.prepare('SELECT COUNT(*) AS n FROM return_v2_unified_postings').get().n,beforeIncomplete)
unfinishedSql.close()
// Integrated, authenticated HTTP Return V2 must remain OFF by default;
// it is callable only on a fully migrated schema and with explicit rollout.
const v2Endpoint='/api/orders/9953/returns/v2'
async function callV2Http(method,path,body,expected=200,authenticated=true){
 const response=await worker.fetch(new Request('https://test-only.invalid'+path,{
  method,headers:{
   ...(authenticated?{Cookie:'orders_session='+token}:{}),
   ...(body?{'Content-Type':'application/json'}:{})
  },...(body?{body:JSON.stringify(body)}:{})
 }),{DB,RETURN_V2_ENABLED:'true'})
 const data=await response.json()
 assert.equal(response.status,expected,method+' '+path+' '+JSON.stringify(data))
 return data
}
addOrder(9953,9963,'V2U-API-ONE-UNSENT',1300)
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(9953,'2026-11-15','KASPI',1300,'primary')").run()
const featureOff=await api('GET',v2Endpoint+'/preview')
assert.equal(featureOff.enabled,false)
const postWhileOff=await api('POST',v2Endpoint,{
 requestId:'v2u-disabled-new-operation-01'
},409)
assert.equal(postWhileOff.code,'return_v2_disabled')
const featureUnauth=await callV2Http('GET',v2Endpoint+'/preview',undefined,401,false)
assert.equal(featureUnauth.ok,false)
const apiPreview=await callV2Http('GET',v2Endpoint+'/preview')
assert.equal(apiPreview.enabled,true)
assert.equal(apiPreview.eligible,true)
assert.deepEqual(apiPreview.defaultLineIds,[9963])
assert.equal(apiPreview.evidence.lines[0].proposedAction,'cancel_unshipped_reservation')
assert.equal(apiPreview.evidence.lines[0].selectedQuantity,1)
assert.equal(apiPreview.finance.currentSale,1300)
assert.equal(apiPreview.finance.netHeld,1300)
const apiPhysicalBefore={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()}
const apiReturnRequest={
 requestId:'v2u-authenticated-real-api-0001',
 expectedOrderVersion:apiPreview.evidence.orderVersion,
 items:[{orderItemId:9963,quantity:1,receiptIntent:'pending'}],
 refundAmount:1300,refundMethod:'KASPI'
}
const apiCommitted=await callV2Http('POST',v2Endpoint,apiReturnRequest,201)
assert.equal(apiCommitted.contractPosted,true)
assert.equal(apiCommitted.receipt.immediateIntakesComplete,true)
assert.equal(apiCommitted.remainingSale,0)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9953').get().n,1)
assert.equal(sql.prepare('SELECT total_amount,return_amount FROM orders WHERE id=9953').get().total_amount,0)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},{
 quantity:apiPhysicalBefore.quantity,
 reserved_quantity:apiPhysicalBefore.reserved_quantity-1
})
const apiPreviewAfter=await callV2Http('GET',v2Endpoint+'/preview')
assert.equal(apiPreviewAfter.eligible,false)
assert.equal(apiPreviewAfter.exclusive,true)
const apiIdempotent=await callV2Http('POST',v2Endpoint,apiReturnRequest,200)
assert.equal(apiIdempotent.replayed,true)
assert.equal(apiIdempotent.returnId,apiCommitted.returnId)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9953').get().n,1)
const badReuse=await callV2Http('POST',v2Endpoint,{...apiReturnRequest,refundAmount:0,refundMethod:''},409)
assert.equal(badReuse.code,'return_v2_unified_posting_conflict')
const afterApiFinance=await readVersionedReturnMoney(DB,9953)
assert.equal(afterApiFinance.currentSale,0)
assert.equal(afterApiFinance.paidOut,1300)
assert.equal(afterApiFinance.netHeld,0)
const receiptReplay=await callV2Http('POST',v2Endpoint+'/'+apiCommitted.postingId+'/receipt',{})
assert.equal(receiptReplay.immediateIntakesComplete,true)
const foreignReceipt=await callV2Http('POST','/api/orders/9951/returns/v2/'+apiCommitted.postingId+'/receipt',{},404)
assert.equal(foreignReceipt.code,'return_v2_wrong_receipt')

// A previously PHYSICALLY received Return MUST NOT be undone using the
// simple cancellation route, even with all client-side confirmations.
const impossibleCancel=await callV2Http('POST',
 `/api/orders/9551/returns/v2/${returned.postingId}/cancel`,{
 requestId:'v2u-http-forbid-received-cancel-001',
 reason:'Склад уже принимал товар',
 shippedGoodsUnreceivedConfirmed:true,reservationsRestoreConfirmed:true,
 refundRecoveredConfirmed:true,recoveryMethod:'KASPI'
},409)
assert.equal(impossibleCancel.code,'return_v2_unified_cancel_conflict')
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(returned.returnId).status,'completed')

// Before actual physical intake, a single full Return may be cancelled
// with explicit proof of inventory availability and cash received back.
const apiCancelablePreview=await callV2Http('GET',v2Endpoint+'/preview')
assert.equal(apiCancelablePreview.cancellation.postingId,apiCommitted.postingId)
assert.equal(apiCancelablePreview.cancellation.available,true)
assert.equal(apiCancelablePreview.cancellation.hasUnsent,true)
assert.equal(apiCancelablePreview.cancellation.hasSent,false)
const cancelEndpoint=v2Endpoint+'/'+apiCommitted.postingId+'/cancel'
const cancelInput={
 requestId:'v2u-http-cancel-unreceived-00001',
 reason:'Клиент отменил возврат и решил купить вновь',
 shippedGoodsUnreceivedConfirmed:false,
 reservationsRestoreConfirmed:true,
 refundRecoveredConfirmed:true,
 recoveryMethod:'KASPI'
}
const noProof=await callV2Http('POST',cancelEndpoint,{
 ...cancelInput,refundRecoveredConfirmed:false
},409)
assert.equal(noProof.code,'return_v2_unified_cancel_conflict')
const preUndo={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()}
const cancelResult=await callV2Http('POST',cancelEndpoint,cancelInput)
assert.equal(cancelResult.ok,true)
assert.equal(cancelResult.cancelled,true)
assert.equal(cancelResult.replayed,false)
assert.equal(cancelResult.cashRecovered,1300)
assert.equal(cancelResult.physicalStockDelta,0)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},{
 quantity:preUndo.quantity,reserved_quantity:preUndo.reserved_quantity+1
})
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(apiCommitted.returnId).status,'cancelled')
assert.equal((await readVersionedReturnMoney(DB,9953)).paidOut,0)
assert.equal((await readVersionedReturnMoney(DB,9953)).currentSale,1300)
const cancelledAgain=await callV2Http('POST',cancelEndpoint,cancelInput)
assert.equal(cancelledAgain.replayed,true)
const changedCancel=await callV2Http('POST',cancelEndpoint,{
 ...cancelInput,reason:'Подменили причину'
},409)
assert.equal(changedCancel.code,'return_v2_unified_cancel_conflict')
const wrongCancelOrder=await callV2Http('POST',
 '/api/orders/9954/returns/v2/'+apiCommitted.postingId+'/cancel',cancelInput,404)
assert.equal(wrongCancelOrder.code,'return_v2_wrong_cancel')
const afterUndoPreview=await callV2Http('GET',v2Endpoint+'/preview')
assert.equal(afterUndoPreview.exclusive,true)
assert.equal(afterUndoPreview.cancellation,null)
assert.equal(afterUndoPreview.eligible,true)
// A different order can now use the same SKU. Do not run it before the
// cancellation above: that would intentionally invalidate its exact stock
// source-ref proof and correctly cause a 409.
// Exactly the same cancelled-unshipped line may now be reduced twice, but
// only while its original active reservation and price prove each reduction.
addOrder(9954,9964,'V2U-API-SAME-ITEM',1250,2)
const sameItemHttpPreview=await callV2Http('GET','/api/orders/9954/returns/v2/preview')
assert.equal(sameItemHttpPreview.evidence.lines[0].availableQuantity,2)
const sameItemStockStart={...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()}
const sameItemFirst=await callV2Http('POST','/api/orders/9954/returns/v2',{
 requestId:'v2u-api-same-reserve-first-0001',
 expectedOrderVersion:sameItemHttpPreview.evidence.orderVersion,
 items:[{orderItemId:9964,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(sameItemFirst.remainingSale,1250)
assert.equal(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get().reserved_quantity,
 sameItemStockStart.reserved_quantity-1)
const sameItemRemaining=await callV2Http('GET','/api/orders/9954/returns/v2/preview')
assert.equal(sameItemRemaining.eligible,true)
assert.equal(sameItemRemaining.evidence.lines[0].availableQuantity,1)
assert.equal(sameItemRemaining.evidence.lines[0].proposedAction,'cancel_unshipped_reservation')
const sameItemSecondRequest={
 requestId:'v2u-api-same-reserve-second-0001',
 expectedOrderVersion:sameItemRemaining.evidence.orderVersion,
 items:[{orderItemId:9964,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
}
const sameItemSecond=await callV2Http('POST','/api/orders/9954/returns/v2',sameItemSecondRequest,201)
assert.equal(sameItemSecond.remainingSale,0)
assert.equal(sameItemSecond.fullTermination,true)
assert.deepEqual({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9541').get()},{
 quantity:sameItemStockStart.quantity,
 reserved_quantity:sameItemStockStart.reserved_quantity-2
})
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9954').get().n,2)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_items WHERE order_item_id=9964').get().n,0)
assert.equal((await readVersionedReturnMoney(DB,9954)).paidOut,0)
const sameItemReplay=await callV2Http('POST','/api/orders/9954/returns/v2',sameItemSecondRequest,200)
assert.equal(sameItemReplay.replayed,true)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM returns WHERE order_id=9954').get().n,2)


// Workshop customer refusal is NOT a production-task cancellation or a return
// to physical inventory. Finished and unfinished tasks remain payable.
const workshopNow='2026-11-01T00:00:00Z'
sql.prepare(`INSERT INTO orders
 (id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,
  pricing_mode,total_amount,created_at,updated_at)
 VALUES (9991,'V2U-WORKSHOP-REFUSAL','2026-11-01',9501,'active','warehouse','ready',
  'not_sent','itemized_v1',6000,?,?)`).run(workshopNow,workshopNow)
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
  source_type,stock_writeoff_status,created_at)
 VALUES (9992,9991,'READY WORKSHOP CUSTOMER REFUSAL',1,6000,6000,1,
  'warehouse','workshop',?)`).run(workshopNow)
sql.prepare(`INSERT INTO workshop_tasks
 (id,order_id,order_item_id,external_order_id,product_name_snapshot,quantity,status,created_at,updated_at)
 VALUES (9993,9991,9992,'V2U-WORKSHOP-REFUSAL','READY WORKSHOP CUSTOMER REFUSAL',
  1,'ready',?,?)`).run(workshopNow,workshopNow)
const workshopTaskBefore=sql.prepare(
 'SELECT id,status,quantity,order_item_id FROM workshop_tasks WHERE id=9993').get()
const workshopStockBefore=sql.prepare(
 'SELECT COALESCE(SUM(quantity),0) AS q,COALESCE(SUM(reserved_quantity),0) AS r FROM inventory_stock').get()
const workshopPreview=await callV2Http('GET','/api/orders/9991/returns/v2/preview')
assert.equal(workshopPreview.eligible,true)
assert.equal(workshopPreview.evidence.lines.length,1)
assert.equal(workshopPreview.evidence.lines[0].proposedAction,'cancel_workshop_obligation')
const workshopPosted=await callV2Http('POST','/api/orders/9991/returns/v2',{
 requestId:'workshop-refusal-contract-0001',
 expectedOrderVersion:workshopPreview.evidence.orderVersion,
 items:[{orderItemId:9992,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(workshopPosted.remainingSale,0)
assert.equal(sql.prepare("SELECT action FROM return_v2_unified_lines WHERE order_item_id=9992").get().action,
 'cancel_unresolved_reservation','Base journal action remains valid on historical D1')
assert.equal(sql.prepare("SELECT semantic_action FROM return_v2_unified_action_overrides WHERE order_item_id=9992").get().semantic_action,
 'cancel_workshop_obligation','Additive journal preserves the true business action')
sql.prepare("UPDATE return_v2_unified_action_overrides SET semantic_action='cancel_unreserved_obligation' WHERE order_item_id=9992").run()
await assert.rejects(readVersionedReturnMoney(DB,9991),/разбор|поддерживаемые/)
sql.prepare("UPDATE return_v2_unified_action_overrides SET semantic_action='cancel_workshop_obligation' WHERE order_item_id=9992").run()
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=9992').get().quantity,0)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9991').get().debt_amount,0)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_items WHERE order_item_id=9992').get().n,0)
assert.deepEqual(sql.prepare('SELECT id,status,quantity,order_item_id FROM workshop_tasks WHERE id=9993').get(),workshopTaskBefore)
assert.deepEqual(sql.prepare('SELECT COALESCE(SUM(quantity),0) AS q,COALESCE(SUM(reserved_quantity),0) AS r FROM inventory_stock').get(),workshopStockBefore)
const refusedWorkshopList=await listWorkshopTasks(DB,
 new URL('https://test-only.invalid/api/workshop/tasks?view=done&period=all&includeCounts=0'))
assert.equal(refusedWorkshopList.tasks.find(t=>t.id===9993)?.customerRefused,true,
 'Client refusal is visible while ready production remains in the workshop')
const workshopCancel=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:workshopPosted.postingId,
 requestId:'workshop-refusal-cancel-0001',
 reason:'Клиент возобновил покупку',
 shippedGoodsUnreceivedConfirmed:false,
 reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:false
})
assert.equal(workshopCancel.cancelled,true)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=9992').get().quantity,1)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=9991').get().total_amount,6000)
const restoredWorkshopList=await listWorkshopTasks(DB,
 new URL('https://test-only.invalid/api/workshop/tasks?view=done&period=all&includeCounts=0'))
assert.equal(restoredWorkshopList.tasks.find(t=>t.id===9993)?.customerRefused,false,
 'Cancelling Return V2 removes customer refusal flag without changing the task')
assert.deepEqual(sql.prepare('SELECT id,status,quantity,order_item_id FROM workshop_tasks WHERE id=9993').get(),workshopTaskBefore)
assert.deepEqual(sql.prepare('SELECT COALESCE(SUM(quantity),0) AS q,COALESCE(SUM(reserved_quantity),0) AS r FROM inventory_stock').get(),workshopStockBefore)



// No reservation and no dispatch must not force a manager into a warehouse
// investigation when the item was never issued and its sale price is exact.
sql.prepare(`INSERT INTO orders
 (id,external_id,order_date,manager_id,order_status,source_type,workshop_status,
  shipping_status,pricing_mode,total_amount,created_at,updated_at)
 VALUES (9994,'V2U-UNRESERVED-NOTSENT','2026-11-01',9501,'active','warehouse',
  'ready','not_sent','itemized_v1',3000,?,?)`).run(workshopNow,workshopNow)
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
  source_type,stock_writeoff_status,created_at)
 VALUES (9995,9994,'NOT RESERVED, NOT DISPATCHED',1,3000,3000,0,
  'warehouse','pending_reservation',?)`).run(workshopNow)
const noReserveStock=sql.prepare(
 'SELECT COALESCE(SUM(quantity),0) q,COALESCE(SUM(reserved_quantity),0) r FROM inventory_stock').get()
const unreservedPreview=await callV2Http('GET','/api/orders/9994/returns/v2/preview')
assert.equal(unreservedPreview.eligible,true)
assert.equal(unreservedPreview.evidence.lines[0].proposedAction,'cancel_unreserved_obligation')
const unreservedPosted=await callV2Http('POST','/api/orders/9994/returns/v2',{
 requestId:'never-reserved-customer-cancel-0001',
 expectedOrderVersion:unreservedPreview.evidence.orderVersion,
 items:[{orderItemId:9995,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(unreservedPosted.remainingSale,0)
assert.equal(sql.prepare("SELECT action FROM return_v2_unified_lines WHERE order_item_id=9995").get().action,'cancel_unresolved_reservation')
assert.equal(sql.prepare("SELECT semantic_action FROM return_v2_unified_action_overrides WHERE order_item_id=9995").get().semantic_action,'cancel_unreserved_obligation')
assert.equal(sql.prepare('SELECT total_amount,debt_amount FROM orders WHERE id=9994').get().total_amount,0)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM inventory_reservations WHERE order_item_id=9995').get().n,0)
assert.deepEqual(sql.prepare(
 'SELECT COALESCE(SUM(quantity),0) q,COALESCE(SUM(reserved_quantity),0) r FROM inventory_stock').get(),noReserveStock)
const unreservedCancelled=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:unreservedPosted.postingId,
 requestId:'never-reserved-customer-undo-0001',
 reason:'Клиент передумал',
 shippedGoodsUnreceivedConfirmed:false,reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:false
})
assert.equal(unreservedCancelled.cancelled,true)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=9995').get().quantity,1)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=9994').get().total_amount,3000)
assert.deepEqual(sql.prepare(
 'SELECT COALESCE(SUM(quantity),0) q,COALESCE(SUM(reserved_quantity),0) r FROM inventory_stock').get(),noReserveStock)



// A fully cancelled historical exchange must not lock an unrelated remaining
// item. Active exchanges remain excluded by all three safety gates.
sql.prepare(`INSERT INTO orders
 (id,external_id,order_date,manager_id,order_status,source_type,workshop_status,
  shipping_status,pricing_mode,total_amount,created_at,updated_at)
 VALUES (9996,'V2U-CANCELLED-EXCHANGE','2026-11-01',9501,'active','warehouse',
 'ready','not_sent','itemized_v1',2500,?,?)`).run(workshopNow,workshopNow)
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
  source_type,stock_writeoff_status,created_at)
 VALUES (9997,9996,'UNISSUED AFTER CANCELLED EXCHANGE',1,2500,2500,0,
  'warehouse','pending_reservation',?)`).run(workshopNow)
sql.prepare(`INSERT INTO exchanges
 (order_id,exchange_date,old_order_item_id,old_quantity,new_source_type,status,created_at)
 VALUES (9996,'2026-11-01',9997,1,'warehouse','cancelled',?)`).run(workshopNow)
const afterCancelled=await callV2Http('GET','/api/orders/9996/returns/v2/preview')
assert.equal(afterCancelled.eligible,true)
assert.equal(afterCancelled.evidence.lines[0].proposedAction,'cancel_unreserved_obligation')
const cancelledExchangePosted=await callV2Http('POST','/api/orders/9996/returns/v2',{
 requestId:'cancelled-exchange-safe-return-0001',
 expectedOrderVersion:afterCancelled.evidence.orderVersion,
 items:[{orderItemId:9997,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(cancelledExchangePosted.remainingSale,0)
assert.equal((await readVersionedReturnMoney(DB,9996)).customerDebt,0)
const cancelledExchangeUndo=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:cancelledExchangePosted.postingId,
 requestId:'cancelled-exchange-safe-undo-0001',
 reason:'Отмена ошибочного возврата',
 shippedGoodsUnreceivedConfirmed:false,reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:false
})
assert.equal(cancelledExchangeUndo.cancelled,true)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=9996').get().total_amount,2500)



// A completed exchange with no payment or refund must not block returning
// the new current purchase. The retired old item stays at quantity 0.
sql.prepare(`INSERT INTO orders
 (id,external_id,order_date,manager_id,order_status,source_type,workshop_status,
  shipping_status,pricing_mode,total_amount,created_at,updated_at)
 VALUES (10010,'V2U-ZERO-MONEY-EXCHANGE','2026-11-01',9501,'active','warehouse',
  'ready','not_sent','itemized_v1',2000,?,?)`).run(workshopNow,workshopNow)
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
  source_type,stock_writeoff_status,created_at)
 VALUES (10011,10010,'RETIRED EXCHANGE ORIGINAL',0,0,0,0,
  'warehouse','replaced_edit',?)`).run(workshopNow)
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
  source_type,stock_writeoff_status,created_at)
 VALUES (10012,10010,'ACTIVE REPLACEMENT',1,2000,2000,0,
  'warehouse','pending_reservation',?)`).run(workshopNow)
sql.prepare(`INSERT INTO exchanges
 (order_id,exchange_date,old_order_item_id,old_quantity,new_order_item_id,
  new_source_type,status,financial_action,financial_amount,created_at)
 VALUES (10010,'2026-11-01',10011,1,10012,'warehouse','completed','none',0,?)`).run(workshopNow)
const zeroMoneyPreview=await callV2Http('GET','/api/orders/10010/returns/v2/preview')
assert.equal(zeroMoneyPreview.eligible,true)
assert.equal(zeroMoneyPreview.evidence.lines.length,1)
assert.equal(zeroMoneyPreview.evidence.lines[0].proposedAction,'cancel_unreserved_obligation')
const beforeZeroExchange=sql.prepare(
 'SELECT COALESCE(SUM(quantity),0) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock'
).get()
const zeroExchangeReturned=await callV2Http('POST','/api/orders/10010/returns/v2',{
 requestId:'v2u-zero-money-exchange-return-0001',
 expectedOrderVersion:zeroMoneyPreview.evidence.orderVersion,
 items:[{orderItemId:10012,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(zeroExchangeReturned.remainingSale,0)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10011').get().quantity,0)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10012').get().quantity,0)
assert.deepEqual(sql.prepare(
 'SELECT COALESCE(SUM(quantity),0) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock'
).get(),beforeZeroExchange)
assert.equal((await readVersionedReturnMoney(DB,10010)).customerDebt,0)
const zeroExchangeCancelled=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:zeroExchangeReturned.postingId,requestId:'v2u-zero-money-exchange-undo-0001',
 reason:'Проверка отмены',shippedGoodsUnreceivedConfirmed:false,
 reservationsRestoreConfirmed:false,refundRecoveredConfirmed:false
})
assert.equal(zeroExchangeCancelled.cancelled,true)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10012').get().quantity,1)
assert.deepEqual(sql.prepare(
 'SELECT COALESCE(SUM(quantity),0) AS physical,COALESCE(SUM(reserved_quantity),0) AS reserved FROM inventory_stock'
).get(),beforeZeroExchange)

// A financially consequential exchange is still rejected, even if it has
// matching itemized prices and a current line without a stock reservation.
sql.prepare(`INSERT INTO orders
 (id,external_id,order_date,manager_id,order_status,source_type,workshop_status,
  shipping_status,pricing_mode,total_amount,created_at,updated_at)
 VALUES (10020,'V2U-MONEY-EXCHANGE-BLOCK','2026-11-01',9501,'active','warehouse',
  'ready','not_sent','itemized_v1',2000,?,?)`).run(workshopNow,workshopNow)
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
  source_type,stock_writeoff_status,created_at)
 VALUES (10021,10020,'OLD PAID EXCHANGE ITEM',0,0,0,0,
  'warehouse','replaced_edit',?)`).run(workshopNow)
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
  source_type,stock_writeoff_status,created_at)
 VALUES (10022,10020,'NEW PAID EXCHANGE ITEM',1,2000,2000,0,
  'warehouse','pending_reservation',?)`).run(workshopNow)
sql.prepare(`INSERT INTO exchanges
 (order_id,exchange_date,old_order_item_id,old_quantity,new_order_item_id,
  new_source_type,status,financial_action,financial_amount,created_at)
 VALUES (10020,'2026-11-01',10021,1,10022,'warehouse','completed','refund',500,?)`).run(workshopNow)
const moneyExchangePreview=await callV2Http('GET','/api/orders/10020/returns/v2/preview')
assert.equal(moneyExchangePreview.eligible,false)
assert.equal(moneyExchangePreview.evidence.lines[0].reasonCode,'exchange_history_requires_migration')
await assert.rejects(postUnifiedReturnV2Prototype(DB,{
 requestId:'v2u-financial-exchange-forbidden-0001',
 orderId:10020,expectedOrderVersion:moneyExchangePreview.evidence.orderVersion,
 items:[{orderItemId:10022,quantity:1,receiptIntent:'pending'}],
 refundAmount:0
}),/изменились|выбранная позиция|Товар требует|проверки|сверк|позиция/i)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=10020').get().total_amount,2000)


// Verified reversal of a real dispatched warehouse item must let the manager
// cancel its remaining customer obligation without repeating physical +1.
// A missing correction proof leaves the same position blocked.
// Do not reuse the shared 9531 SKU: earlier regression fixtures intentionally
// place a future-dated stocktake on it to prove freshness blocking.
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(10050,9521,'МУЖ','ТЕМНО-КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','50','adult',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(10051,'warehouse',9521,10050,'V2U-CORRECTED-TEST','МУЖ','ТЕМНО-КРАСНЫЙ','СТАНДАРТ','СТАНДАРТ','50',5,0)").run()
function addCorrectedFixture(orderId,itemId,label,price){
 addOrder(orderId,itemId,label,price)
 sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity-1 WHERE id=9541').run()
 sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity+1 WHERE id=10051').run()
 sql.prepare('UPDATE order_items SET variant_id=10050 WHERE id=?').run(itemId)
 sql.prepare('UPDATE inventory_reservations SET variant_id=10050 WHERE order_item_id=?').run(itemId)
}
const correctedStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10051').get()
addCorrectedFixture(10030,10031,'V2U-RESTORED-DISPATCH',1200)
const restoredBefore=correctedStock()
await api('POST','/api/orders/10030/shipping/dispatches',{
 requestId:'v2u-restored-dispatch-original-0001',
 items:[{orderItemId:10031,quantity:1}]
})
const restoredDi=sql.prepare(
 'SELECT di.id FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id WHERE d.order_id=10030').get()
assert(restoredDi?.id)
const restoredFix=await api('POST',
 `/api/orders/10030/shipping/dispatch-items/${restoredDi.id}/correct`,{
 requestId:'v2u-restored-dispatch-correction-0001',
 reason:'Исправление ошибочной отправки для теста'
})
assert.equal(restoredFix.ok,true)
const correctedRow=sql.prepare(
 'SELECT di.quantity,di.cancelled_quantity,dc.quantity AS fix_qty,dc.stock_restored FROM order_dispatch_items di JOIN order_dispatch_corrections dc ON dc.dispatch_item_id=di.id WHERE di.id=?'
).get(restoredDi.id)
assert.equal(correctedRow.cancelled_quantity,correctedRow.quantity)
assert.equal(correctedRow.stock_restored,1)
assert.equal(correctedRow.fix_qty,correctedRow.quantity)
assert.deepEqual(correctedStock(),restoredBefore,
 'The correction restored the original physical and reserved stock')
const restoredPreview=await callV2Http('GET','/api/orders/10030/returns/v2/preview')
assert.equal(restoredPreview.eligible,true)
assert.equal(restoredPreview.evidence.lines[0].proposedAction,'cancel_unshipped_reservation')
assert.equal(restoredPreview.evidence.lines[0].reasonCode,'corrected_dispatch_restored_reservation')
const restoredPost=await callV2Http('POST','/api/orders/10030/returns/v2',{
 requestId:'v2u-restored-dispatch-return-0001',
 expectedOrderVersion:restoredPreview.evidence.orderVersion,
 items:[{orderItemId:10031,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(restoredPost.remainingSale,0)
assert.equal(correctedStock().quantity,restoredBefore.quantity,
 'Return after a corrected shipment must not create stock +1')
assert.equal(correctedStock().reserved_quantity,restoredBefore.reserved_quantity-1)
const restoredUndo=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:restoredPost.postingId,requestId:'v2u-restored-dispatch-undo-0001',
 reason:'Проверка обратной операции',
 shippedGoodsUnreceivedConfirmed:false,reservationsRestoreConfirmed:true,
 refundRecoveredConfirmed:false
})
assert.equal(restoredUndo.cancelled,true)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10031').get().quantity,1)
assert.deepEqual(correctedStock(),restoredBefore)

addCorrectedFixture(10040,10041,'V2U-MISSING-CORRECTION',1300)
await api('POST','/api/orders/10040/shipping/dispatches',{
 requestId:'v2u-invalid-correction-original-0001',
 items:[{orderItemId:10041,quantity:1}]
})
const fakeDi=sql.prepare(
 'SELECT di.id FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id WHERE d.order_id=10040').get()
assert(fakeDi?.id)
await api('POST',`/api/orders/10040/shipping/dispatch-items/${fakeDi.id}/correct`,{
 requestId:'v2u-invalid-correction-passed-0001',
 reason:'Проверка блокировки при отсутствии доказательства'
})
sql.prepare('DELETE FROM order_dispatch_corrections WHERE dispatch_item_id=?').run(fakeDi.id)
const cannotProve=await callV2Http('GET','/api/orders/10040/returns/v2/preview')
assert.equal(cannotProve.evidence.lines[0].requiresReview,true)
assert.equal(cannotProve.evidence.lines[0].reasonCode,'corrected_dispatch_requires_review')
assert.equal(cannotProve.eligible,false)



// Exchange Set headers intentionally carry NULL old/new item ids: those are
// journalled per-item in exchange_items. The sale remains itemized and cashless.
sql.prepare(`INSERT INTO orders
 (id,external_id,order_date,manager_id,order_status,source_type,workshop_status,
  shipping_status,pricing_mode,total_amount,created_at,updated_at)
 VALUES (10110,'V2U-EXCHANGE-SET-OK','2026-11-01',9501,'active','warehouse',
  'ready','not_sent','itemized_v1',2500,?,?)`).run(workshopNow,workshopNow)
for(const [id,name,qty,price,status] of [
 [10111,'REPLACED BY SET',0,0,'exchanged'],
 [10112,'NEW SET ITEM A',1,1000,'pending_reservation'],
 [10113,'NEW SET ITEM B',1,1500,'pending_reservation']
]){
 sql.prepare(`INSERT INTO order_items
  (id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,
   source_type,stock_writeoff_status,created_at)
  VALUES (?,10110,?,?,?,?,0,'warehouse',?,?)`)
  .run(id,name,qty,price,qty*price,status,workshopNow)
}
sql.prepare(`INSERT INTO exchanges
 (id,order_id,exchange_date,old_order_item_id,old_quantity,new_order_item_id,
  new_source_type,status,financial_action,financial_amount,created_at)
 VALUES (10114,10110,'2026-11-01',NULL,0,NULL,'warehouse','completed','none',0,?)`)
 .run(workshopNow)
for(const [role,itemId,qty] of [['old',10111,2],['new',10112,1],['new',10113,1]]){
 sql.prepare(`INSERT INTO exchange_items
 (exchange_id,role,order_item_id,product_name_snapshot,quantity,created_at)
 VALUES (10114,?,?,'EXCHANGE SET PROOF',?,?)`).run(role,itemId,qty,workshopNow)
}
const setPreview=await callV2Http('GET','/api/orders/10110/returns/v2/preview')
assert.equal(setPreview.eligible,true)
assert.equal(setPreview.evidence.lines.length,2)
assert(setPreview.evidence.lines.every(l=>l.proposedAction==='cancel_unreserved_obligation'))
const setPosted=await callV2Http('POST','/api/orders/10110/returns/v2',{
 requestId:'v2u-exchange-set-customer-return-0001',
 expectedOrderVersion:setPreview.evidence.orderVersion,
 items:setPreview.evidence.lines.map(l=>({orderItemId:l.orderItemId,quantity:1,receiptIntent:'pending'})),
 refundAmount:0,refundMethod:''
},201)
assert.equal(setPosted.remainingSale,0)
assert.equal((await readVersionedReturnMoney(DB,10110)).customerDebt,0)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10111').get().quantity,0)
const setCancelled=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:setPosted.postingId,requestId:'v2u-exchange-set-return-cancel-0001',
 reason:'Проверка обратной операции',shippedGoodsUnreceivedConfirmed:false,
 reservationsRestoreConfirmed:false,refundRecoveredConfirmed:false
})
assert.equal(setCancelled.cancelled,true)
assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=10110').get().total_amount,2500)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10111').get().quantity,0)

// If a supposedly retired old item remains live, Exchange Set has not been
// fully reconciled. Never allow Return V2 to guess its current inventory.
sql.prepare('UPDATE order_items SET quantity=1,line_total=0 WHERE id=10111').run()
const setUnsafe=await previewUnifiedReturnV2LineEvidence(DB,10110)
assert.equal(setUnsafe.lines[0].reasonCode,'exchange_history_requires_migration')
assert(setUnsafe.lines.every(l=>l.requiresReview))
sql.prepare('UPDATE order_items SET quantity=0 WHERE id=10111').run()



// A correctly restored first dispatch does not poison an independently
// documented second dispatch. Only the CURRENT issue is physically returned.
addCorrectedFixture(10130,10131,'V2U-RESENT-AFTER-RESTORED',1400)
const resendBaseline=correctedStock()
await api('POST','/api/orders/10130/shipping/dispatches',{
 requestId:'v2u-resent-first-shipping-0001',
 items:[{orderItemId:10131,quantity:1}]
})
const resendOld=sql.prepare(
 'SELECT di.id FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id WHERE d.order_id=10130 ORDER BY di.id LIMIT 1').get()
assert(resendOld?.id)
const resendCorrection=await api('POST',
 `/api/orders/10130/shipping/dispatch-items/${resendOld.id}/correct`,{
 requestId:'v2u-resent-first-correction-0001',
 reason:'Первую отправку отменили с восстановлением на складе'
})
assert.equal(resendCorrection.ok,true)
assert.deepEqual(correctedStock(),resendBaseline)
await api('POST','/api/orders/10130/shipping/dispatches',{
 requestId:'v2u-resent-second-shipping-0001',
 items:[{orderItemId:10131,quantity:1}]
})
const resendDispatchRows=sql.prepare(
 'SELECT quantity,cancelled_quantity FROM order_dispatch_items WHERE order_item_id=10131 ORDER BY id').all()
assert.deepEqual(resendDispatchRows.map(r=>r.cancelled_quantity),[1,0])
const resendStockAfter=correctedStock()
assert.equal(resendStockAfter.quantity,resendBaseline.quantity-1)
assert.equal(resendStockAfter.reserved_quantity,resendBaseline.reserved_quantity-1)
const resendPreview=await callV2Http('GET','/api/orders/10130/returns/v2/preview')
assert.equal(resendPreview.eligible,true)
assert.equal(resendPreview.evidence.lines.length,1)
assert.equal(resendPreview.evidence.lines[0].proposedAction,'physical_return_pending')
const resendPost=await callV2Http('POST','/api/orders/10130/returns/v2',{
 requestId:'v2u-resent-return-0001',
 expectedOrderVersion:resendPreview.evidence.orderVersion,
 items:[{orderItemId:10131,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(resendPost.remainingSale,0)
assert.deepEqual(correctedStock(),resendStockAfter,
 'A return awaiting physical delivery must not change physical inventory')
const resendUndo=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:resendPost.postingId,requestId:'v2u-resent-return-undo-0001',
 reason:'Отмена возврата до физического получения',
 shippedGoodsUnreceivedConfirmed:true,reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:false
})
assert.equal(resendUndo.cancelled,true)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10131').get().quantity,1)
assert.deepEqual(correctedStock(),resendStockAfter)

// A documented earlier correction may intentionally have no stock restoration
// (for example it crossed a newer stocktake). That warehouse history remains
// open; return of the separately proven second shipment adds no physical stock.
addCorrectedFixture(10140,10141,'V2U-RESENT-UNSAFE-CORRECTION',1600)
await api('POST','/api/orders/10140/shipping/dispatches',{
 requestId:'v2u-resent-invalid-first-0001',
 items:[{orderItemId:10141,quantity:1}]
})
const priorUnsafe=sql.prepare(
 'SELECT di.id FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id WHERE d.order_id=10140').get()
await api('POST',`/api/orders/10140/shipping/dispatch-items/${priorUnsafe.id}/correct`,{
 requestId:'v2u-resent-invalid-correct-0001',
 reason:'Тест старой отменённой отправки'
})
await api('POST','/api/orders/10140/shipping/dispatches',{
 requestId:'v2u-resent-invalid-second-0001',
 items:[{orderItemId:10141,quantity:1}]
})
sql.prepare('UPDATE order_dispatch_corrections SET stock_restored=0 WHERE dispatch_item_id=?').run(priorUnsafe.id)
sql.prepare('UPDATE order_dispatch_corrections SET quantity=2 WHERE dispatch_item_id=?').run(priorUnsafe.id)
const missingCorrectionProof=await callV2Http('GET','/api/orders/10140/returns/v2/preview')
assert.equal(missingCorrectionProof.eligible,false)
assert.equal(missingCorrectionProof.evidence.lines[0].reasonCode,'corrected_dispatch_requires_review')
sql.prepare('UPDATE order_dispatch_corrections SET quantity=1 WHERE dispatch_item_id=?').run(priorUnsafe.id)
const nonrestoredStock=correctedStock()
const recordedNoRestock=await callV2Http('GET','/api/orders/10140/returns/v2/preview')
assert.equal(recordedNoRestock.eligible,true)
assert.equal(recordedNoRestock.evidence.lines[0].reasonCode,'reshipped_after_unrestored_correction')
assert.equal(recordedNoRestock.evidence.lines[0].proposedAction,'physical_return_pending')
const retainedCorrection=sql.prepare(
 'SELECT quantity,stock_restored FROM order_dispatch_corrections WHERE dispatch_item_id=?'
).get(priorUnsafe.id)
const nonrestoredPost=await callV2Http('POST','/api/orders/10140/returns/v2',{
 requestId:'v2u-resent-no-restock-pending-return-0001',
 expectedOrderVersion:recordedNoRestock.evidence.orderVersion,
 items:[{orderItemId:10141,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(nonrestoredPost.remainingSale,0)
assert.deepEqual(correctedStock(),nonrestoredStock)
assert.deepEqual(sql.prepare('SELECT quantity,stock_restored FROM order_dispatch_corrections WHERE dispatch_item_id=?').get(priorUnsafe.id),retainedCorrection)
const nonrestoredUndo=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:nonrestoredPost.postingId,requestId:'v2u-resent-no-restock-undo-0001',
 reason:'Клиент возобновил покупку после ошибочной отправки',
 shippedGoodsUnreceivedConfirmed:true,reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:false
})
assert.equal(nonrestoredUndo.cancelled,true)
assert.deepEqual(correctedStock(),nonrestoredStock)
assert.deepEqual(sql.prepare('SELECT quantity,stock_restored FROM order_dispatch_corrections WHERE dispatch_item_id=?').get(priorUnsafe.id),retainedCorrection)


// Completed old Returns may have removed physical goods and paid cash without
// reducing the customer's contract. The first new Return V2 reconciles that
// historic obligation once, atomically, but NEVER books stock or cash twice.
// Keep this legacy reconciliation completely independent from the previous
// shipment/correction stock fixtures (which deliberately exhaust SKU 10050).
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(10250,9521,'МУЖ','БОРДОВЫЙ','СТАНДАРТ','СТАНДАРТ','50','adult',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(10251,'warehouse',9521,10250,'V2U-LEGACY-BASELINE-TEST','МУЖ','БОРДОВЫЙ','СТАНДАРТ','СТАНДАРТ','50',10,0)").run()
addCorrectedFixture(10200,10201,'LEGACY-RETURNED-BEFORE-V2',1000)
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity-1 WHERE id=10051').run()
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity+1 WHERE id=10251').run()
sql.prepare('UPDATE order_items SET variant_id=10250 WHERE id=10201').run()
sql.prepare('UPDATE inventory_reservations SET variant_id=10250 WHERE order_item_id=10201').run()
const legacyStock=()=>sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10251').get()
await api('POST','/api/orders/10200/shipping/dispatches',{
 requestId:'v2u-legacy-before-actual-shipment-0001',
 items:[{orderItemId:10201,quantity:1}]
})
const legacyNow='2026-11-01T00:00:00Z'
sql.prepare(`INSERT INTO order_items
 (id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,
  is_workshop,source_type,stock_writeoff_status,created_at,inventory_obligation_key,inventory_obligation_origin_at)
 VALUES (10202,10200,9521,10250,'CURRENT UNSHIPPED AFTER V1 RETURN',1,1050,1050,
  0,'warehouse','reserved',?,'v2u-legacy-current-10202',?)`).run(legacyNow,legacyNow)
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity+1 WHERE id=10251').run()
sql.prepare(`INSERT INTO inventory_reservations
 (order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at)
 VALUES (10200,10202,'warehouse',9521,10250,1,'active',?,?)`).run(legacyNow,legacyNow)
sql.prepare("UPDATE orders SET total_amount=2050,shipping_status='not_sent' WHERE id=10200").run()
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(10200,'2026-11-01','KASPI',300,'primary')").run()
sql.prepare(`INSERT INTO returns
 (id,order_id,return_date,amount,payment_method,status,created_at)
 VALUES (10300,10200,'2026-11-02',100,'KASPI','completed',?)`).run(legacyNow)
sql.prepare(`INSERT INTO return_items
 (id,return_id,order_item_id,product_name_snapshot,quantity,amount,inventory_source,
  restocked,physical_tracking,contract_quantity_applied,created_at)
 VALUES (10301,10300,10201,'LEGACY-RETURNED-BEFORE-V2',1,0,NULL,0,1,0,?)`).run(legacyNow)
sql.prepare(`INSERT INTO returns
 (id,order_id,return_date,amount,payment_method,status,created_at)
 VALUES (10302,10200,'2026-11-03',50,'KASPI','completed',?)`).run(legacyNow)
const legacyStockBeforeV2=legacyStock()
const legacyPreview=await callV2Http('GET','/api/orders/10200/returns/v2/preview')
assert.equal(legacyPreview.eligible,true)
assert.equal(legacyPreview.finance.currentSale,1050)
assert.equal(legacyPreview.finance.paidIn,300)
assert.equal(legacyPreview.finance.paidOut,150)
assert.equal(legacyPreview.finance.netHeld,150)
assert.equal(legacyPreview.finance.customerDebt,900)
assert.equal(legacyPreview.evidence.lines.find(x=>x.orderItemId===10202).proposedAction,'cancel_unshipped_reservation')
assert.equal(legacyPreview.evidence.lines.find(x=>x.orderItemId===10201).requiresReview,true)
const legacyPayload={
 requestId:'v2u-legacy-baseline-merged-0001',
 expectedOrderVersion:legacyPreview.evidence.orderVersion,
 items:[{orderItemId:10202,quantity:1,receiptIntent:'pending'}],
 refundAmount:150,refundMethod:'KASPI'
}
const legacyMerged=await callV2Http('POST','/api/orders/10200/returns/v2',legacyPayload,201)
assert.equal(legacyMerged.remainingSale,0)
assert.equal(legacyMerged.cashRefund,150)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10201').get().quantity,0)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10202').get().quantity,0)
assert.equal(sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=10200').get().total_amount,0)
assert.equal(sql.prepare('SELECT return_amount FROM orders WHERE id=10200').get().return_amount,300)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=10200').get().debt_amount,0)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_legacy_baseline_returns WHERE order_id=10200').get().n,2)
assert.equal(sql.prepare('SELECT COALESCE(SUM(reduction),0) n FROM return_v2_legacy_baseline_items WHERE order_item_id=10201').get().n,1000)
assert.equal(sql.prepare('SELECT amount FROM returns WHERE id=10300').get().amount,100)
assert.equal(sql.prepare('SELECT amount FROM returns WHERE id=10302').get().amount,50)
assert.deepEqual({physical:legacyStock().quantity,reserved:legacyStock().reserved_quantity},
 {physical:legacyStockBeforeV2.quantity,reserved:legacyStockBeforeV2.reserved_quantity-1},
 'Migrating legacy purchase obligations must not add old returned goods to stock')
assert.equal((await readVersionedReturnMoney(DB,10200)).paidOut,300)
const replayOld=await callV2Http('POST','/api/orders/10200/returns/v2',legacyPayload,200)
assert.equal(replayOld.replayed,true)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_v2_legacy_baseline_items WHERE order_item_id=10201').get().n,1)
const undoLegacyNew=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:legacyMerged.postingId,requestId:'v2u-legacy-baseline-cancel-new-0001',
 reason:'Клиент оставил новый товар; старый возврат не отменяется',
 shippedGoodsUnreceivedConfirmed:false,reservationsRestoreConfirmed:true,
 refundRecoveredConfirmed:true,recoveryMethod:'KASPI'
})
assert.equal(undoLegacyNew.cancelled,true)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10201').get().quantity,0)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10202').get().quantity,1)
assert.equal(sql.prepare('SELECT total_amount,return_amount,debt_amount FROM orders WHERE id=10200').get().total_amount,1050)
assert.equal(sql.prepare('SELECT return_amount FROM orders WHERE id=10200').get().return_amount,150)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=10200').get().debt_amount,900)
assert.deepEqual(legacyStock(),legacyStockBeforeV2)
assert.equal((await readVersionedReturnMoney(DB,10200)).customerDebt,900)


// Historical sent order: legacy warehouse issue was recorded as fulfilled
// before dispatch rows existed. One of two units was already returned by V1.
// Return V2 must normalize the first unit and cancel ONLY the remaining unit.
addOrder(10330,10331,'V2U-LEGACY-SENT-PARTIAL-RETURN',1000,2)
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity-2 WHERE id=9541').run()
sql.prepare('UPDATE inventory_stock SET reserved_quantity=reserved_quantity+2 WHERE id=10251').run()
sql.prepare('UPDATE order_items SET variant_id=10250,stock_writeoff_status=? WHERE id=10331').run('fulfilled')
sql.prepare('UPDATE inventory_reservations SET variant_id=10250,status=?,fulfilled_at=? WHERE order_item_id=10331')
 .run('fulfilled',legacyNow)
sql.prepare("UPDATE inventory_stock SET quantity=quantity-2,reserved_quantity=reserved_quantity-2 WHERE id=10251").run()
sql.prepare("UPDATE orders SET shipping_status='sent' WHERE id=10330").run()
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(10330,'2026-11-01','KASPI',2000,'primary')").run()
sql.prepare(`INSERT INTO returns(id,order_id,return_date,amount,payment_method,status,created_at)
 VALUES (10332,10330,'2026-11-02',1000,'KASPI','completed',?)`).run(legacyNow)
sql.prepare(`INSERT INTO return_items(id,return_id,order_item_id,product_name_snapshot,
 quantity,amount,inventory_source,restocked,physical_tracking,contract_quantity_applied,created_at)
 VALUES (10333,10332,10331,'V2U-LEGACY-SENT-PARTIAL-RETURN',1,0,NULL,0,1,0,?)`).run(legacyNow)
const oldLegacyPhysical=legacyStock()
const partiallyReturned=await callV2Http('GET','/api/orders/10330/returns/v2/preview')
assert.equal(partiallyReturned.eligible,true)
assert.equal(partiallyReturned.finance.currentSale,1000)
assert.equal(partiallyReturned.finance.paidOut,1000)
assert.equal(partiallyReturned.evidence.lines[0].availableQuantity,1)
assert.equal(partiallyReturned.evidence.lines[0].proposedAction,'physical_return_pending')
assert.equal(partiallyReturned.evidence.lines[0].reasonCode,'legacy_sent_fulfilled_without_dispatch')
const partialPosted=await callV2Http('POST','/api/orders/10330/returns/v2',{
 requestId:'v2u-legacy-sent-partial-new-return-0001',
 expectedOrderVersion:partiallyReturned.evidence.orderVersion,
 items:[{orderItemId:10331,quantity:1,receiptIntent:'pending'}],
 refundAmount:1000,refundMethod:'KASPI'
},201)
assert.equal(partialPosted.remainingSale,0)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10331').get().quantity,0)
assert.equal(sql.prepare('SELECT quantity FROM return_items WHERE return_id=?').get(partialPosted.returnId).quantity,1)
assert.equal(sql.prepare('SELECT COUNT(*) AS count FROM return_v2_legacy_baseline_items WHERE order_item_id=10331').get().count,1)
assert.equal(sql.prepare('SELECT return_amount,debt_amount FROM orders WHERE id=10330').get().return_amount,2000)
assert.deepEqual(legacyStock(),oldLegacyPhysical,
 'No phantom physical +1 for either old or new return')
const undoOldSent=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:partialPosted.postingId,
 requestId:'v2u-legacy-sent-partial-undo-0001',
 reason:'Отмена нового возврата при сохранении старого',
 shippedGoodsUnreceivedConfirmed:true,reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:true,recoveryMethod:'KASPI'
})
assert.equal(undoOldSent.cancelled,true)
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10331').get().quantity,1)
assert.equal(sql.prepare('SELECT total_amount,return_amount,debt_amount FROM orders WHERE id=10330').get().total_amount,1000)
assert.equal(sql.prepare('SELECT return_amount FROM orders WHERE id=10330').get().return_amount,1000)
assert.deepEqual(legacyStock(),oldLegacyPhysical)
assert.equal((await readVersionedReturnMoney(DB,10330)).customerDebt,0)

// The same fulfilled reserve without the sent-order proof is NOT enough.
addOrder(10340,10341,'V2U-ISSUED-BUT-UNSENT-BLOCKED',1000)
sql.prepare("UPDATE order_items SET stock_writeoff_status='fulfilled' WHERE id=10341").run()
sql.prepare("UPDATE inventory_reservations SET status='fulfilled',fulfilled_at=? WHERE order_item_id=10341").run(legacyNow)
const noHeaderSend=await callV2Http('GET','/api/orders/10340/returns/v2/preview')
assert.equal(noHeaderSend.eligible,false)
assert.equal(noHeaderSend.evidence.lines[0].reasonCode,'issued_before_shipping_unconfirmed')


// Historical Exchange Set replaced ONE of TWO fulfilled units; the other
// original unit remains a valid customer purchase. Old V1 uses order-level
// shipping_status='sent' without modern dispatch lines.
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,category,is_active) VALUES(10450,9521,'МУЖ','ПУРПУРНЫЙ','СТАНДАРТ','СТАНДАРТ','50','adult',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(10451,'warehouse',9521,10450,'V2U-PARTIAL-OLD-EXCHANGE','МУЖ','ПУРПУРНЫЙ','СТАНДАРТ','СТАНДАРТ','50',7,0)").run()
sql.prepare(`INSERT INTO orders (id,external_id,order_date,manager_id,order_status,source_type,
  workshop_status,shipping_status,pricing_mode,total_amount,created_at,updated_at)
 VALUES (10430,'V2U-OLD-PARTIAL-EXCHANGE','2026-11-01',9501,'active','warehouse',
  'ready','sent','itemized_v1',2000,?,?)`).run(legacyNow,legacyNow)
for(const [id,label] of [[10431,'ONE OF TWO ORIGINAL STILL SOLD'],[10432,'EXCHANGE REPLACEMENT STILL SOLD']]){
 sql.prepare(`INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,
   quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at)
   VALUES (?,10430,9521,10450,?,1,1000,1000,0,'warehouse','fulfilled',?)`)
   .run(id,label,legacyNow)
}
for(const [id,qty] of [[10431,2],[10432,1]]){
 sql.prepare(`INSERT INTO inventory_reservations
  (order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,
   fulfilled_at,created_at,updated_at)
  VALUES (10430,?,'warehouse',9521,10450,?,'fulfilled',?,?,?)`)
 .run(id,qty,legacyNow,legacyNow,legacyNow)
}
sql.prepare(`INSERT INTO exchanges
 (id,order_id,exchange_date,old_order_item_id,old_quantity,new_order_item_id,
  new_source_type,status,financial_action,financial_amount,created_at)
 VALUES (10433,10430,'2026-11-01',NULL,0,NULL,'warehouse','completed','none',0,?)`)
 .run(legacyNow)
for(const [role,itemId] of [['old',10431],['new',10432]]){
 sql.prepare(`INSERT INTO exchange_items
  (exchange_id,role,order_item_id,product_name_snapshot,quantity,created_at)
  VALUES (10433,?,?,'HISTORICAL PARTIAL EXCHANGE SET',1,?)`)
 .run(role,itemId,legacyNow)
}
const exchangeStockBefore=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10451').get()
const oldPartialExchange=await callV2Http('GET','/api/orders/10430/returns/v2/preview')
assert.equal(oldPartialExchange.eligible,true)
assert.equal(oldPartialExchange.evidence.summary.requiresReviewQuantity,0)
assert.equal(oldPartialExchange.evidence.lines.length,2)
assert.deepEqual(oldPartialExchange.evidence.lines.map(x=>x.proposedAction),
 ['physical_return_pending','physical_return_pending'])
const oldExchangePost=await callV2Http('POST','/api/orders/10430/returns/v2',{
 requestId:'v2u-partial-exchange-old-and-new-0001',
 expectedOrderVersion:oldPartialExchange.evidence.orderVersion,
 items:[{orderItemId:10431,quantity:1,receiptIntent:'pending'},
   {orderItemId:10432,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
assert.equal(oldExchangePost.remainingSale,0)
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10451').get(),
 exchangeStockBefore,'Physical stock untouched when cancelling a proven old partial exchange sale')
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM return_items WHERE return_id=?').get(oldExchangePost.returnId).n,2)
assert.equal((await readVersionedReturnMoney(DB,10430)).currentSale,0)
const undoOldPartialExchange=await cancelUnifiedReturnV2Prototype(DB,{
 postingId:oldExchangePost.postingId,requestId:'v2u-partial-exchange-undo-0001',
 reason:'Отмена возврата старой частичной замены',
 shippedGoodsUnreceivedConfirmed:true,reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:false
})
assert.equal(undoOldPartialExchange.cancelled,true)
assert.deepEqual(sql.prepare('SELECT id,quantity FROM order_items WHERE order_id=10430 ORDER BY id')
 .all().map(x=>[x.id,x.quantity]),[[10431,1],[10432,1]])
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=10451').get(),exchangeStockBefore)


// The exact Exchange Set proof also runs alone in Cloudflare D1, with an
// identical fail-closed guard inside the atomic posting/cancellation batch.
const {hasUnsafeActiveExchange,guardExchangeHistoryInBatch}=
  await import('../worker/domains/return-v2-safe-exchange-history.ts')
assert.equal(await hasUnsafeActiveExchange(DB,10010),false)
assert.equal(await hasUnsafeActiveExchange(DB,10020),true)
const unsafeExchangeOrderBefore=sql.prepare(
 'SELECT total_amount,updated_at FROM orders WHERE id=10020').get()
await assert.rejects(DB.batch([
 guardExchangeHistoryInBatch(DB,10020),
 DB.prepare('UPDATE orders SET total_amount=0 WHERE id=10020')
]),/malformed JSON|RETURN_V2_UNSAFE_EXCHANGE|SQLITE_ERROR/i)
assert.deepEqual(sql.prepare(
 'SELECT total_amount,updated_at FROM orders WHERE id=10020').get(),
 unsafeExchangeOrderBefore)
await DB.batch([guardExchangeHistoryInBatch(DB,10010)])



const qaFresh=(orderId,itemId)=>{
 const at=new Date().toISOString()
 sql.prepare('UPDATE orders SET order_date=?,created_at=?,updated_at=? WHERE id=?')
   .run(at.slice(0,10),at,at,orderId)
 sql.prepare('UPDATE order_items SET created_at=?,inventory_obligation_origin_at=? WHERE id=?')
   .run(at,at,itemId)
 sql.prepare('UPDATE inventory_reservations SET created_at=?,updated_at=? WHERE order_item_id=?')
   .run(at,at,itemId)
}
sql.prepare('UPDATE inventory_stock SET quantity=quantity+40 WHERE id=9541').run()
addOrder(10510,10511,'QA-V2-TWO-SHIPPED',500,2)
qaFresh(10510,10511)
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(10510,'2026-11-15','CASH',1000,'primary')").run()
const qaShipA=await api('POST','/api/orders/10510/shipping/dispatches',{
 requestId:'qa-v2-two-shipped-dispatch-00001',items:[{orderItemId:10511,quantity:2}]
})
assert.equal(qaShipA.shippedQuantity,2)
const qaBeforeA=await callV2Http('GET','/api/orders/10510/returns/v2/preview')
assert.equal(qaBeforeA.eligible,true)
assert.equal(qaBeforeA.evidence.lines.find(l=>l.orderItemId===10511).availableQuantity,2)
const qaPostA=await callV2Http('POST','/api/orders/10510/returns/v2',{
 requestId:'qa-v2-two-shipped-return-00001',
 expectedOrderVersion:qaBeforeA.evidence.orderVersion,
 items:[{orderItemId:10511,quantity:1,receiptIntent:'pending'}],
 refundAmount:300,refundMethod:'CASH'
},201)
assert.equal(qaPostA.remainingSale,500)
const qaBetweenA=await callV2Http('GET','/api/orders/10510/returns/v2/preview')
const qaRemaining=qaBetweenA.evidence.lines.find(l=>l.orderItemId===10511)
assert.equal(qaBetweenA.eligible,true)
assert.equal(qaRemaining.availableQuantity,1)
assert.equal(qaRemaining.proposedAction,'physical_return_pending')
assert.equal(qaRemaining.postedV2PhysicalQuantity,1)
assert.equal(qaRemaining.dispatchedQuantity,2)
assert.equal(qaRemaining.fulfilledQuantity,2)
const qaPostA2=await callV2Http('POST','/api/orders/10510/returns/v2',{
 requestId:'qa-v2-two-shipped-return-00002',
 expectedOrderVersion:qaBetweenA.evidence.orderVersion,
 items:[{orderItemId:10511,quantity:1,receiptIntent:'pending'}],
 refundAmount:500,refundMethod:'CASH'
},201)
assert.equal(qaPostA2.remainingSale,0)
assert.equal((await readVersionedReturnMoney(DB,10510)).paidOut,800)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM returns WHERE order_id=10510 AND status='completed'").get().n,2)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM return_items WHERE order_item_id=10511').get().n,2)

addOrder(10520,10521,'QA-V2-RETRY-AFTER-CANCEL',500,2)
qaFresh(10520,10521)
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(10520,'2026-11-15','CASH',1000,'primary')").run()
assert.equal((await api('POST','/api/orders/10520/shipping/dispatches',{
 requestId:'qa-v2-cancel-shipped-dispatch-001',
 items:[{orderItemId:10521,quantity:2}]
})).shippedQuantity,2)
const qaBeforeCancel=await callV2Http('GET','/api/orders/10520/returns/v2/preview')
const qaFirstCanceled=await callV2Http('POST','/api/orders/10520/returns/v2',{
 requestId:'qa-v2-cancel-test-first-00001',
 expectedOrderVersion:qaBeforeCancel.evidence.orderVersion,
 items:[{orderItemId:10521,quantity:1,receiptIntent:'pending'}],
 refundAmount:300,refundMethod:'CASH'
},201)
const qaCancel=await callV2Http('POST',
 `/api/orders/10520/returns/v2/${qaFirstCanceled.postingId}/cancel`,{
 requestId:'qa-v2-cancel-test-undo-00001',
 reason:'Проверка возврата после отмены',
 shippedGoodsUnreceivedConfirmed:true,
 reservationsRestoreConfirmed:false,
 refundRecoveredConfirmed:true,recoveryMethod:'CASH'
})
assert.equal(qaCancel.cancelled,true)
assert.equal((await readVersionedReturnMoney(DB,10520)).paidOut,0)
const qaAfterCancel=await callV2Http('GET','/api/orders/10520/returns/v2/preview')
assert.equal(qaAfterCancel.eligible,true)
assert.equal(qaAfterCancel.cancellation,null)
assert.equal(qaAfterCancel.evidence.lines[0].availableQuantity,2)
const qaAfterCancelPost=await callV2Http('POST','/api/orders/10520/returns/v2',{
 requestId:'qa-v2-cancel-test-new-post-0001',
 expectedOrderVersion:qaAfterCancel.evidence.orderVersion,
 items:[{orderItemId:10521,quantity:1,receiptIntent:'pending'}],
 refundAmount:300,refundMethod:'CASH'
},201)
assert.equal(qaAfterCancelPost.remainingSale,500)
assert.equal((await readVersionedReturnMoney(DB,10520)).paidOut,300)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM returns WHERE order_id=10520 AND status='cancelled'").get().n,1)
assert.equal(sql.prepare("SELECT COUNT(*) n FROM returns WHERE order_id=10520 AND status='completed'").get().n,1)

const qaTaskAt=new Date().toISOString()
sql.prepare(`INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,
 workshop_status,shipping_status,pricing_mode,total_amount,created_at,updated_at)
 VALUES(10530,'QA-V2-WORKSHOP-COMPLETE','2026-11-15',9501,'active','warehouse',
 'in_workshop','not_sent','itemized_v1',600,?,?)`).run(qaTaskAt,qaTaskAt)
sql.prepare(`INSERT INTO order_items(id,order_id,product_name_snapshot,quantity,unit_price,
 line_total,is_workshop,source_type,stock_writeoff_status,created_at)
 VALUES(10531,10530,'QA WORKSHOP TASK',1,600,600,1,'warehouse','workshop',?)`).run(qaTaskAt)
sql.prepare(`INSERT INTO workshop_tasks(id,order_id,order_item_id,external_order_id,
 product_name_snapshot,quantity,status,created_at,updated_at)
 VALUES(10532,10530,10531,'QA-V2-WORKSHOP-COMPLETE','QA WORKSHOP TASK',1,'active',?,?)`).run(qaTaskAt,qaTaskAt)
const qaTaskPreview=await callV2Http('GET','/api/orders/10530/returns/v2/preview')
assert.equal(qaTaskPreview.eligible,true)
assert.equal(qaTaskPreview.evidence.lines[0].proposedAction,'cancel_workshop_obligation')
await callV2Http('POST','/api/orders/10530/returns/v2',{
 requestId:'qa-v2-workshop-refusal-000001',expectedOrderVersion:qaTaskPreview.evidence.orderVersion,
 items:[{orderItemId:10531,quantity:1,receiptIntent:'pending'}],
 refundAmount:0,refundMethod:''
},201)
const qaTaskStockBefore=sql.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory_stock').get().q
const qaCompleted=await updateWorkshopTask(DB,10532,{status:'done',orderItemId:10531})
assert.equal(qaCompleted.ok,true)
assert.equal(sql.prepare('SELECT status FROM workshop_tasks WHERE id=10532').get().status,'done')
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=10531').get().quantity,0)
assert.equal(sql.prepare('SELECT COALESCE(SUM(quantity),0) q FROM inventory_stock').get().q,qaTaskStockBefore)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_items WHERE order_item_id=10531').get().n,0)

addOrder(10540,10541,'QA-V2-HISTORY-UNSHIPPED',450)
qaFresh(10540,10541)
const qaHistoryPreview=await callV2Http('GET','/api/orders/10540/returns/v2/preview')
assert.equal(qaHistoryPreview.eligible,true)
const qaHistoryPost=await callV2Http('POST','/api/orders/10540/returns/v2',{
 requestId:'qa-v2-unshipped-history-0001',expectedOrderVersion:qaHistoryPreview.evidence.orderVersion,
 items:[{orderItemId:10541,quantity:1,receiptIntent:'pending'}],refundAmount:0,refundMethod:''
},201)
const qaHistory=await listReturnHistory(DB,new URL('https://test-only.invalid/api/returns?q=QA-V2-HISTORY-UNSHIPPED'))
const qaHistoryEntry=qaHistory.returns.find(r=>r.id===qaHistoryPost.returnId)
assert(qaHistoryEntry)
assert.equal(qaHistoryEntry.items.length,1)
assert.equal(qaHistoryEntry.items[0].quantity,1)
assert.equal(qaHistoryEntry.items[0].orderItemId,10541)
assert.equal(qaHistoryEntry.items[0].contractAction,'cancel_unshipped_reservation')
assert.equal(qaHistoryEntry.items[0].contractOnly,true)
assert.equal(qaHistoryEntry.items[0].physicalTracking,false)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM return_items WHERE order_item_id=10541').get().n,0)
const qaFlowUi=fs.readFileSync('src/features/sections/OrderReturnV2Flow.tsx','utf8')
assert(qaFlowUi.includes("rejected?.code==='return_v2_not_eligible'"))
assert(qaFlowUi.includes("setUnknownResult(false)"))
assert(qaFlowUi.includes("setEligible(false)"))
console.log('RETURN_V2_WORK_QA_P1_PASS: second shipped unit, post-cancellation return, preserved Workshop completion, full history and stale-form reset')

sql.close()
console.log('RETURN_V2_UNIFIED_FINANCE_SQLITE_PASS: original 75 intake tests plus V2 and legacy net-held ledger;  original UI stock-now choice retained as explicit V2 intent; shipped-only immediate warehouse +2 once, unsent reserve no +stock, no_stock acceptance, old shipment and receipt idempotence, freshness checkpoint blocks +1 until already_counted; all initial posting isolated')
