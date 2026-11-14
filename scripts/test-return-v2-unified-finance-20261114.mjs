import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {createHash} from 'node:crypto'
import worker from '../worker/index.ts'
import { previewUnifiedReturnV2LineEvidence } from '../worker/domains/return-v2-unified-line-evidence.ts'
import { postUnifiedReturnV2Prototype } from '../worker/domains/return-v2-unified-posting-prototype.ts'
import { submitUnifiedReturnV2WithReceiptPrototype, completeUnifiedReturnV2ReceiptPrototype } from '../worker/domains/return-v2-unified-immediate-intake-prototype.ts'
import { readVersionedReturnMoney, syncVersionedReturnMoneyPrototype } from '../worker/domains/return-v2-financial-projection.ts'
import { createVersionedReturnV2DebtPaymentPrototype } from '../worker/domains/return-v2-debt-payment-prototype.ts'
import { cancelUnifiedReturnV2Prototype } from '../worker/domains/return-v2-unified-cancel-prototype.ts'
import { readOrderFinancialLedger, syncOrderFinancialLedger } from '../worker/domains/money.ts'

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
await syncOrderFinancialLedger(DB,9853)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,0)
await syncVersionedReturnMoneyPrototype(DB,9853)
assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=9853').get().debt_amount,5000,
 'V2 financial CAS repairs cache based on actual cash after verified mixed Return')
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
sql.prepare('UPDATE inventory_stock SET quantity=40 WHERE id=9541').run()
addOrder(9855,9865,'V2U-CANCEL-MIXED',2000,2)
sql.prepare("INSERT INTO payments(order_id,payment_date,method,amount,payment_kind) VALUES(9855,'2026-11-01','KASPI',4000,'primary')").run()
const mixedSend=await api('POST','/api/orders/9855/shipping/dispatches',{
 requestId:'v2u-cancellation-dispatch-01',items:[{orderItemId:9865,quantity:1}]
})
assert.equal(mixedSend.shippedQuantity,1)
const mixedPreview=await previewUnifiedReturnV2LineEvidence(DB,9855)
assert.equal(mixedPreview.summary.selectedQuantity,2)
assert.equal(mixedPreview.summary.pendingPhysicalQuantity,1)
assert.equal(mixedPreview.summary.reservedCancellationQuantity,1)
const mixedPost=await postUnifiedReturnV2Prototype(DB,{
 requestId:'v2u-cancel-proven-posting-0001',orderId:9855,
 expectedOrderVersion:mixedPreview.orderVersion,
 items:mixedPreview.lines.map(l=>({orderItemId:l.orderItemId,quantity:l.selectedQuantity,receiptIntent:'pending'})),
 refundAmount:1000,refundMethod:'KASPI'
})
assert.equal(mixedPost.remainingSale,0)
assert.equal((await readVersionedReturnMoney(DB,9855)).customerOverpay,3000)
const beforeCancelStock=stock('warehouse')
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
sql.prepare('UPDATE inventory_stock SET quantity=reserved_quantity WHERE id=9541').run()
await assert.rejects(cancelUnifiedReturnV2Prototype(DB,mixedCancelInput),/Резерв|зарезервирован|пересчитан/)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(mixedPost.returnId).status,'completed')
assert.equal(sql.prepare("SELECT COUNT(*) n FROM financial_events WHERE event_key='return-v2:unified:cancelled:'||?").get(mixedPost.postingId).n,0)
sql.prepare('UPDATE inventory_stock SET quantity=? WHERE id=9541').run(beforeCancelStock.quantity)
const mixedCancelled=await cancelUnifiedReturnV2Prototype(DB,mixedCancelInput)
assert.equal(mixedCancelled.cancelled,true)
assert.equal(mixedCancelled.replayed,false)
assert.equal(mixedCancelled.cashRecovered,1000)
assert.equal(mixedCancelled.physicalStockDelta,0)
assert.equal(sql.prepare('SELECT total_amount,received_amount,return_amount,debt_amount FROM orders WHERE id=9855').get().total_amount,4000)
assert.equal(sql.prepare('SELECT status FROM returns WHERE id=?').get(mixedPost.returnId).status,'cancelled')
assert.deepEqual(stock('warehouse'),{quantity:beforeCancelStock.quantity,reserved_quantity:beforeCancelStock.reserved_quantity+1},
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
assert.equal(sql.prepare("SELECT amount_delta FROM financial_events WHERE event_key='return-v2:unified:cancelled:'||?").get(mixedPost.postingId).amount_delta,1000)
const repeatedCancel=await cancelUnifiedReturnV2Prototype(DB,mixedCancelInput)
assert.equal(repeatedCancel.replayed,true)
assert.deepEqual(stock('warehouse'),{quantity:beforeCancelStock.quantity,reserved_quantity:beforeCancelStock.reserved_quantity+1})
await assert.rejects(cancelUnifiedReturnV2Prototype(DB,{...mixedCancelInput,reason:'Другая причина'}),/другими/)

sql.close()
console.log('RETURN_V2_UNIFIED_FINANCE_SQLITE_PASS: original 75 intake tests plus V2 and legacy net-held ledger;  original UI stock-now choice retained as explicit V2 intent; shipped-only immediate warehouse +2 once, unsent reserve no +stock, no_stock acceptance, old shipment and receipt idempotence, freshness checkpoint blocks +1 until already_counted; all initial posting isolated')
