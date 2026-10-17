import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createRealAdminDeleteCancellationDriver } from '../worker/domains/admin-delete-real-driver.ts'
import { advanceAdminDeleteSagaOneStep, getAdminDeleteSagaProgress } from '../worker/domains/admin-delete-saga.ts'

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
    "CREATE TABLE returns(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,amount INTEGER,cancelled_at TEXT,cancellation_comment TEXT)",
    "CREATE TABLE return_items(id INTEGER PRIMARY KEY,return_id INTEGER,order_item_id INTEGER,quantity INTEGER,restocked INTEGER,inventory_source TEXT,product_name_snapshot TEXT)",
    "CREATE TABLE return_workshop_task_reversals(id INTEGER PRIMARY KEY,return_id INTEGER,workshop_task_id INTEGER,previous_status TEXT,previous_quantity INTEGER)",
    "CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,quantity INTEGER)",
    "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER)",
    "CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,status TEXT,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,released_at TEXT,updated_at TEXT)",
    "CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER,last_action TEXT,last_source_ref TEXT,updated_at TEXT)",
    "CREATE TABLE inventory_lifecycle_events(id INTEGER PRIMARY KEY,operation_type TEXT,operation_id INTEGER,order_id INTEGER,operation_item_id INTEGER,order_item_id INTEGER,event_type TEXT,direction TEXT,inventory_source TEXT,quantity INTEGER,variant_id INTEGER,status TEXT,cancelled_at TEXT,updated_at TEXT,resolution_comment TEXT)",
    "CREATE TABLE catalog_products(id INTEGER PRIMARY KEY,name TEXT,category TEXT,is_active INTEGER)",
    "CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,category TEXT,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER)",
    "CREATE TABLE critical_operations(request_id TEXT PRIMARY KEY,operation_type TEXT,request_fingerprint TEXT,status TEXT,step TEXT,context_json TEXT,lease_token TEXT,lease_until_ms INTEGER,created_at TEXT,updated_at TEXT,response_json TEXT,completed_at TEXT,last_error TEXT,target_type TEXT,target_id INTEGER,target_ref TEXT)"
  ].join(';')+';')
  sql.exec(readFileSync('migrations/0110_v72_exchange_order_item_price_correction_audit.sql','utf8'))
  sql.exec(readFileSync('migrations/0111_v72_admin_order_delete_saga_journal.sql','utf8'))
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
    "INSERT INTO inventory_lifecycle_events(id,operation_type,operation_id,order_id,operation_item_id,order_item_id,event_type,direction,inventory_source,quantity,variant_id,status) VALUES(900,'exchange',200,42,301,2,'exchange_new_out','out','warehouse',1,11,'pending')"
  ].join(';')+';')
  sql.prepare(
    "INSERT INTO critical_operations(request_id,operation_type,status,step,context_json,target_type,target_id,created_at) VALUES('EX_CREATE_200','exchange_set_create','completed','completed',?,'exchange',200,'2026-10-17')"
  ).run(JSON.stringify({executionPlan}))
  // The later V2 swap replaces item #2 with item #3. A standalone Return on
  // #3 must cancel first, followed by the later and then the earlier Exchange.
  const secondPlan=JSON.parse(JSON.stringify(executionPlan))
  secondPlan.baselineTotalAmount=23000
  secondPlan.removedValue=23000
  secondPlan.addedValue=25000
  secondPlan.finalTotalAmount=25000
  secondPlan.dueBeforeSettlement=25000
  secondPlan.oldItems[0]={
    ...secondPlan.oldItems[0],
    orderItemId:2,unitPrice:23000,lineTotal:23000,removedValue:23000,
    reservationSnapshot:{
      id:101,source:'warehouse',variantId:11,
      quantity:1,status:'active',targetQuantity:0,targetStatus:'released'
    }
  }
  secondPlan.newItems[0]={
    ...secondPlan.newItems[0],item:{quantity:1,unitPrice:25000,lineTotal:25000,catalogPriceSnapshot:null},
    productId:12,variantId:12,stockKey:'SECOND_SWAP'
  }
  sql.exec([
    "INSERT INTO catalog_products VALUES(12,'Third SKU','adult',1)",
    "INSERT INTO catalog_variants(id,product_id,category,is_active) VALUES(12,12,'adult',1)",
    "INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status) VALUES(3,42,12,12,'Third SKU',1,25000,25000,0,'warehouse','reserved')",
    "UPDATE order_items SET quantity=0,line_total=0,stock_writeoff_status='exchanged' WHERE id=2",
    "UPDATE orders SET total_amount=25000,debt_amount=25000 WHERE id=42",
    "INSERT INTO exchanges(id,order_id,status,financial_action,financial_amount) VALUES(201,42,'completed','none',0)",
    "INSERT INTO exchange_items VALUES(302,201,2,'old')",
    "INSERT INTO exchange_items VALUES(303,201,3,'new')",
    "UPDATE inventory_reservations SET status='released' WHERE id=101",
    "UPDATE inventory_stock SET reserved_quantity=0 WHERE id=11",
    "INSERT INTO inventory_reservations(id,order_id,order_item_id,status,inventory_source,variant_id,quantity) VALUES(102,42,3,'active','warehouse',12,1)",
    "INSERT INTO inventory_stock(id,inventory_source,variant_id,quantity,reserved_quantity) VALUES(12,'warehouse',12,4,1)",
    "INSERT INTO inventory_lifecycle_events(id,operation_type,operation_id,order_id,operation_item_id,order_item_id,event_type,direction,inventory_source,quantity,variant_id,status) VALUES(901,'exchange',201,42,303,3,'exchange_new_out','out','warehouse',1,12,'pending')",
    "INSERT INTO returns(id,order_id,status,amount) VALUES(400,42,'completed',0)",
    "INSERT INTO return_items VALUES(600,400,3,1,0,'no_stock','Third SKU')",
  ].join(';')+';')
  sql.prepare(
    "INSERT INTO critical_operations(request_id,operation_type,status,step,context_json,target_type,target_id,created_at) VALUES('EX_CREATE_201','exchange_set_create','completed','completed',?,'exchange',201,'2026-10-17')"
  ).run(JSON.stringify({executionPlan:secondPlan}))
  const sagaKey='REAL_CHAIN_42'
  const steps=[['return',400],['exchange',201],['exchange',200]]
  sql.prepare(
    "INSERT INTO admin_order_delete_sagas(request_id,order_id,status,preview_fingerprint,plan_json,next_step,created_at,updated_at) VALUES(?,42,'planned',?, ?,0,'2026-10-17','2026-10-17')"
  ).run(sagaKey,'a'.repeat(64),JSON.stringify(steps))
  steps.forEach(([type,id],i)=>sql.prepare(
    'INSERT INTO admin_order_delete_saga_steps(saga_request_id,step_index,operation_type,operation_id,cancel_request_id) VALUES(?,?,?,?,?)'
  ).run(sagaKey,i,type,id,sagaKey+':'+type+':'+id))
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
      const result=/^\s*SELECT\s/i.test(query)
        ? (sql.prepare(query).all(...args),{changes:0,lastInsertRowid:0})
        : sql.prepare(query).run(...args)
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
        if(crashPending && failurePoint==='saga_checkpoint'
          && statements.some(x=>x.query.includes('ADMIN_DELETE_SAGA_STALE'))){
          crashPending=false
          throw Error('INJECTED_CRASH_AFTER_REAL_RETURN_BEFORE_SAGA_CURSOR')
        }
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

async function scenario(failurePoint){
  const {sql,db,counts}=fixture(failurePoint)
  const key='REAL_CHAIN_42'
  const driver=createRealAdminDeleteCancellationDriver(db)
  let progress=await getAdminDeleteSagaProgress(db,key)
  assert.equal(progress.status,'planned')
  assert.equal(progress.totalSteps,3)
  assert.deepEqual(progress.remaining.map(s=>s.type+':'+s.id),
    ['return:400','exchange:201','exchange:200'])
  if(failurePoint==='saga_checkpoint'){
    await assert.rejects(
      ()=>advanceAdminDeleteSagaOneStep(db,key,driver),
      /INJECTED_CRASH_AFTER_REAL_RETURN_BEFORE_SAGA_CURSOR/
    )
    progress=await getAdminDeleteSagaProgress(db,key)
    assert.equal(progress.nextStep,0)
    assert.equal(sql.prepare("SELECT status FROM returns WHERE id=400").get().status,'cancelled')
    assert.equal(sql.prepare("SELECT status FROM critical_operations WHERE request_id=?")
      .get(key+':return:400').status,'completed')
    assert.equal(sql.prepare("SELECT status FROM admin_order_delete_saga_steps WHERE step_index=0").get().status,'started')
    // Same deterministic Return request ID must be used when saga retries.
  }
  const visited=[]
  while(progress.status!=='ready_for_final_delete'){
    const before=progress.nextStep
    progress=await advanceAdminDeleteSagaOneStep(db,key,driver)
    visited.push(before)
    assert.equal(progress.nextStep,before+1,'Each call advances only one verified step')
  }
  assert.deepEqual(visited,[0,1,2])
  assert.equal(progress.nextStep,3)
  assert.equal(progress.remaining.length,0)
  assert.deepEqual(sql.prepare(
    'SELECT operation_type,operation_id,status FROM admin_order_delete_saga_steps ORDER BY step_index'
  ).all().map(r=>[r.operation_type,r.operation_id,r.status]),[
    ['return',400,'completed'],['exchange',201,'completed'],['exchange',200,'completed']
  ])
  assert.deepEqual(sql.prepare('SELECT id,status FROM exchanges ORDER BY id').all()
    .map(r=>[r.id,r.status]),[[200,'cancelled'],[201,'cancelled']])
  assert.equal(sql.prepare('SELECT status FROM returns WHERE id=400').get().status,'cancelled')
  assert.deepEqual(sql.prepare('SELECT id,quantity,line_total FROM order_items ORDER BY id').all()
    .map(r=>[r.id,r.quantity,r.line_total]),[[1,1,20000],[2,0,0],[3,0,0]])
  assert.deepEqual(sql.prepare('SELECT id,status FROM inventory_reservations ORDER BY id').all()
    .map(r=>[r.id,r.status]),[[100,'active'],[101,'released'],[102,'released']])
  assert.deepEqual(sql.prepare('SELECT variant_id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all()
    .map(r=>[r.variant_id,r.quantity,r.reserved_quantity]),[[10,5,1],[11,3,0],[12,4,0]])
  assert.deepEqual(sql.prepare('SELECT operation_id,status FROM inventory_lifecycle_events ORDER BY id').all()
    .map(r=>[r.operation_id,r.status]),[[200,'cancelled'],[201,'cancelled']])
  assert.equal(sql.prepare('SELECT total_amount FROM orders WHERE id=42').get().total_amount,20000)
  assert.equal(sql.prepare('SELECT debt_amount FROM orders WHERE id=42').get().debt_amount,20000)
  assert.equal(counts().stockTransitions,2,'Each pending new SKU reserve released exactly once')
  assert.equal(counts().zeroedNewRows,2,'Each replacement order line zeroed exactly once')
  for(const [type,id] of [['return',400],['exchange',201],['exchange',200]]){
    const row=sql.prepare('SELECT status,target_type,target_id FROM critical_operations WHERE request_id=?')
      .get(key+':'+type+':'+id)
    assert.deepEqual([row.status,row.target_type,row.target_id],['completed',type,id])
  }
  const again=await advanceAdminDeleteSagaOneStep(db,key,driver)
  assert.equal(again.nextStep,3)
  assert.equal(again.status,'ready_for_final_delete')
  assert.equal(sql.prepare('SELECT order_status FROM orders WHERE id=42').get().order_status,'active',
    'Engine must NEVER delete the final order')
  sql.close()
  console.log('REAL_HANDLER_THREE_STEP_SAGA_ORDER_STOCK_IDEMPOTENCY_PASSED',failurePoint)
}
for(const kind of [null,'saga_checkpoint']) await scenario(kind)
