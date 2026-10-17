import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createRealAdminDeleteCancellationDriver } from '../worker/domains/admin-delete-real-driver.ts'

// Runs the ACTUAL V2 Exchange cancellation handler, critical-operation
// recovery, pending inventory lifecycle cancellation, reservation release and
// reactivation, and order-price restoration against isolated SQLite.
// No mocked business writes, remote D1 binding or production records.
function fixture(failurePoint) {
  const sql=new DatabaseSync(':memory:')
  sql.exec([
    "CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,shipping_status TEXT,pricing_mode TEXT,total_amount INTEGER,received_amount INTEGER,return_amount INTEGER,debt_amount INTEGER,updated_at TEXT)",
    "CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_id INTEGER,variant_id INTEGER,product_name_snapshot TEXT,audience_type TEXT,gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT,quantity INTEGER,unit_price INTEGER,line_total INTEGER,is_workshop INTEGER,source_type TEXT,stock_writeoff_status TEXT,stock_quantity_before INTEGER,stock_quantity_after INTEGER)",
    "CREATE TABLE exchanges(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,financial_action TEXT,financial_amount INTEGER,payment_id INTEGER,refund_return_id INTEGER,payment_method TEXT,cancelled_at TEXT,cancellation_comment TEXT,old_item_replacement_reversed_at TEXT)",
    "CREATE TABLE exchange_items(id INTEGER PRIMARY KEY,exchange_id INTEGER,order_item_id INTEGER,role TEXT)",
    "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER)",
    "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER)",
    "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
    "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,released_at TEXT,updated_at TEXT)",
    "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT)",
    "CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,operation_type TEXT,operation_id INTEGER,operation_item_id INTEGER,order_item_id INTEGER,event_type TEXT,direction TEXT,inventory_source TEXT,quantity INTEGER,variant_id INTEGER,status TEXT,cancelled_at TEXT,updated_at TEXT,resolution_comment TEXT)",
    "CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,is_active INTEGER)",
    "CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER)",
    "CREATE TABLE critical_operations(request_id TEXT PRIMARY KEY,operation_type TEXT,request_fingerprint TEXT,status TEXT,step TEXT,context_json TEXT,lease_token TEXT,lease_until_ms INTEGER,created_at TEXT,updated_at TEXT,response_json TEXT,completed_at TEXT,last_error TEXT,target_type TEXT,target_id INTEGER,target_ref TEXT)"
  ].join(';')+';')
  sql.exec(readFileSync('migrations/0110_v72_exchange_order_item_price_correction_audit.sql','utf8'))
  const executionPlan={
    orderId:42,externalOrderId:'ISOLATED_EXCHANGE_42',
    exchangeDate:'2026-10-17',comment:'Isolated test',
    baselineTotalAmount:20000,baselineNetPaid:0,
    removedValue:20000,addedValue:23000,finalTotalAmount:23000,
    dueBeforeSettlement:23000,paymentAmount:0,paymentMethod:'',
    refundAmount:0,refundMethod:'',finalNetPaid:0,
    financialAction:'none',financialAmount:0,financialMethod:'',
    oldItems:[{
      inputIndex:0,orderItemId:1,quantity:1,physicalState:'not_issued',
      returnSource:'none',initialQuantity:1,targetQuantity:0,
      unitPrice:20000,lineTotal:20000,catalogPriceSnapshot:null,
      removedValue:20000,originalStockStatus:'reserved',
      isWorkshop:false,wasIssued:false,needsHandoverReconciliation:false,
      reservationSnapshot:{
        id:100,source:'warehouse',variantId:10,
        quantity:1,status:'active',targetQuantity:0,targetStatus:'released'
      },
      workshopSnapshot:null
    }],
    newItems:[{
      inputIndex:0,item:{quantity:1,unitPrice:23000,lineTotal:23000,catalogPriceSnapshot:null},
      productId:11,variantId:11,inventorySource:'warehouse',
      stockKey:'TEST_NEW',physicalIssueConfirmed:false
    }],
    workshopCount:0
  }
  sql.exec([
    "INSERT INTO orders(id,external_id,order_status,shipping_status,pricing_mode,total_amount,received_amount,return_amount,debt_amount) VALUES(42,'ISOLATED_EXCHANGE_42','active','not_sent','itemized_v1',23000,0,0,23000)",
    "INSERT INTO catalog_products VALUES(10,'Old SKU','adult',1)",
    "INSERT INTO catalog_products VALUES(11,'New SKU','adult',1)",
    "INSERT INTO catalog_variants(id,product_id,category,is_active) VALUES(10,10,'adult',1)",
    "INSERT INTO catalog_variants(id,product_id,category,is_active) VALUES(11,11,'adult',1)",
    "INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status) VALUES(1,42,10,10,'Old SKU',0,20000,0,0,'warehouse','exchanged')",
    "INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status) VALUES(2,42,11,11,'New SKU',1,23000,23000,0,'warehouse','reserved')",
    "INSERT INTO exchanges(id,order_id,status,financial_action,financial_amount) VALUES(200,42,'completed','none',0)",
    "INSERT INTO exchange_items VALUES(300,200,1,'old')",
    "INSERT INTO exchange_items VALUES(301,200,2,'new')",
    "INSERT INTO inventory_reservations(id,order_id,order_item_id,status,inventory_source,variant_id,quantity) VALUES(100,42,1,'released','warehouse',10,1)",
    "INSERT INTO inventory_reservations(id,order_id,order_item_id,status,inventory_source,variant_id,quantity) VALUES(101,42,2,'active','warehouse',11,1)",
    "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(10,'warehouse',10,5,0)",
    "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(11,'warehouse',11,3,1)",
    "INSERT INTO inventory_lifecycle_events(id,operation_type,operation_id,operation_item_id,order_item_id,event_type,direction,inventory_source,quantity,variant_id,status) VALUES(900,'exchange',200,301,2,'exchange_new_out','out','warehouse',1,11,'pending')"
  ].join(';')+';')
  sql.prepare(
    "INSERT INTO critical_operations(request_id,operation_type,status,step,context_json,target_type,target_id,created_at) VALUES('EX_CREATE_200','exchange_set_create','completed','completed',?,'exchange',200,'2026-10-17')"
  ).run(JSON.stringify({executionPlan}))
  let crashPending=true,stockTransitions=0,zeroedNewRows=0
  const mkStatement=(query,args=[])=>({
    query,args,
    bind(...values){return mkStatement(query,values)},
    async first(){return sql.prepare(query).get(...args)??null},
    async all(){return {results:sql.prepare(query).all(...args)}},
    _run(){
      if(crashPending && failurePoint==='critical_complete'
        && /UPDATE critical_operations\s+SET status = 'completed'/.test(query)){
        crashPending=false
        throw new Error('SIMULATED_CRASH_AFTER_BUSINESS_COMMIT')
      }
      const isNewRowZero=/UPDATE order_items\s+SET quantity = 0, line_total = 0/.test(query)
      const beforeQuantity=isNewRowZero
        ? sql.prepare('SELECT quantity FROM order_items WHERE id=?').get(args[0])?.quantity
        : null
      const result=sql.prepare(query).run(...args)
      if(/UPDATE inventory_stock\s+SET reserved_quantity = MAX\(0, COALESCE\(reserved_quantity, 0\) -/.test(query)&&result.changes)stockTransitions++
      if(isNewRowZero&&result.changes&&beforeQuantity>0)zeroedNewRows++
      if(crashPending && failurePoint==='new_row_zeroed'
        && /UPDATE order_items\s+SET quantity = 0, line_total = 0/.test(query)){
        crashPending=false
        throw new Error('SIMULATED_CRASH_AFTER_NEW_ITEM_ZEROED')
      }
      return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}}
    },
    async run(){return this._run()}
  })
  const db={
    prepare(query){return mkStatement(query)},
    async batch(statements){
      sql.exec('BEGIN IMMEDIATE')
      try {
        const results=statements.map(x=>x._run())
        sql.exec('COMMIT')
        if(crashPending&&failurePoint==='pending_event_batch'
          && statements.some(x=>/UPDATE inventory_lifecycle_events SET status = 'cancelled'/.test(x.query))){
          crashPending=false
          throw new Error('SIMULATED_CRASH_AFTER_RESERVATION_BATCH')
        }
        return results
      } catch(error) {
        if(sql.isTransaction)sql.exec('ROLLBACK')
        throw error
      }
    }
  }
  return {sql,db,counts:()=>({stockTransitions,zeroedNewRows})}
}
async function test(failurePoint){
  const {sql,db,counts}=fixture(failurePoint)
  const driver=createRealAdminDeleteCancellationDriver(db)
  const step={orderId:42,sagaRequestId:'V2_CANCEL_TEST_42',cancelRequestId:'V2_CANCEL_TEST_42:exchange:200',stepIndex:0,type:'exchange',id:200}
  assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=42').get().total_amount,23000)
  await driver.preflight(step)
  const crashMessage={
    pending_event_batch:/SIMULATED_CRASH_AFTER_RESERVATION_BATCH/,
    new_row_zeroed:/SIMULATED_CRASH_AFTER_NEW_ITEM_ZEROED/,
    critical_complete:/SIMULATED_CRASH_AFTER_BUSINESS_COMMIT/
  }[failurePoint]
  if(crashMessage){
    await assert.rejects(()=>driver.cancel(step),crashMessage)
    const partial=sql.prepare("SELECT status FROM critical_operations WHERE request_id=?").get(step.cancelRequestId)
    assert.equal(partial?.status,'started','Saga cannot mark incomplete critical operation as completed')
    await driver.preflight(step)
    // A not-yet-cancelled entity returns false; a cancelled one whose critical
    // checkpoint is still 'started' throws. Neither may authorize a saga step.
    let reconciled=false
    try { reconciled=await driver.verifyReconciled(step) } catch {}
    assert.equal(reconciled,false,'Partial cancellation must not advance the saga')
  }
  await driver.cancel(step)
  assert.equal(await driver.verifyReconciled(step),true)
  await driver.preflight(step)
  await driver.cancel(step)
  assert.equal(await driver.verifyReconciled(step),true)
  const old=sql.prepare('SELECT quantity,unit_price,line_total,stock_writeoff_status FROM order_items WHERE id=1').get()
  const newer=sql.prepare('SELECT quantity,unit_price,line_total FROM order_items WHERE id=2').get()
  assert.deepEqual([old.quantity,old.unit_price,old.line_total,old.stock_writeoff_status],[1,20000,20000,'reserved'])
  assert.deepEqual([newer.quantity,newer.unit_price,newer.line_total],[0,23000,0])
  assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=42').get().total_amount,20000)
  assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=42').get().debt_amount,20000)
  assert.deepEqual(sql.prepare('SELECT id,status FROM inventory_reservations ORDER BY id').all().map(r=>[r.id,r.status]),[[100,'active'],[101,'released']])
  assert.deepEqual(sql.prepare('SELECT variant_id,reserved_quantity FROM inventory_stock ORDER BY id').all().map(r=>[r.variant_id,r.reserved_quantity]),[[10,1],[11,0]])
  assert.equal(sql.prepare('SELECT status FROM inventory_lifecycle_events WHERE id=900').get().status,'cancelled')
  assert.equal(sql.prepare('SELECT status FROM critical_operations WHERE request_id=?').get(step.cancelRequestId).status,'completed')
  assert.equal(counts().stockTransitions,1,'New SKU must be released from stock exactly once')
  assert.equal(counts().zeroedNewRows,1,'New order line must not be zeroed twice')
  sql.close()
  console.log('ACTUAL_V2_CANCEL_RESERVATION_PRICE_REPLAY_PASSED '+failurePoint)
}
for(const scenario of [null,'pending_event_batch','new_row_zeroed','critical_complete'])
  await test(scenario)
