import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {dispatchSelectedCompleteOrderLines} from '../worker/domains/order-dispatch.ts'
import {cancelExactOrderDispatchItem} from '../worker/domains/order-dispatch-cancel.ts'

const sql=new DatabaseSync(':memory:')
const migrations=fs.readdirSync('migrations').filter(s=>/^\d+.*\.sql$/.test(s)).sort()
for(const m of migrations) sql.exec(fs.readFileSync('migrations/'+m,'utf8'))
// Historical seed gap is repaired in DISPOSABLE test DB only.
if(!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get()){
 sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
}
const stmt=(query,bindings=[])=>({
 bind(...v){return stmt(query,v)},
 async first(){return sql.prepare(query).get(...bindings)||null},
 async all(){return {results:sql.prepare(query).all(...bindings)}},
 async run(){const d=sql.prepare(query).run(...bindings);return{meta:{changes:Number(d.changes),last_row_id:Number(d.lastInsertRowid)}}},
})
const db={
 prepare:q=>stmt(q),
 async batch(statements){
  sql.exec('SAVEPOINT dispatch_atomic')
  try {const out=[];for(const s of statements)out.push(await s.run());sql.exec('RELEASE dispatch_atomic');return out}
  catch(e){sql.exec('ROLLBACK TO SAVEPOINT dispatch_atomic');sql.exec('RELEASE dispatch_atomic');throw e}
 },
}
sql.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Stage5 tester')").run()
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(9021,'DISPATCH EXACT SKU','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,is_active) VALUES(9031,9021,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity) VALUES(9041,'warehouse',9021,9031,'DISPATCH EXACT SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',10,2)").run()
sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES(9051,'ORD-TEST-STAGE5B','2026-11-01',1,'active','warehouse','ready','not_sent','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run()
for(const id of [9061,9062]) {
 sql.prepare("INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES(?,9051,9021,9031,'DISPATCH EXACT SKU','МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',1,1000,1000,0,'warehouse','reserved','2026-11-01T00:00:00Z')").run(id)
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(9051,?,'warehouse',9021,9031,1,'active','2026-11-01T00:00:00Z','2026-11-01T00:00:00Z')").run(id)
}
sql.prepare("INSERT INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value='active'").run()

const stock=()=>sql.prepare("SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041").get()
const refs=()=>sql.prepare("SELECT reference_id,quantity_delta FROM inventory_movements WHERE reference_type='order_dispatch' ORDER BY id").all()
const state=()=>sql.prepare("SELECT shipping_status FROM orders WHERE id=9051").get().shipping_status
const dispatch=(key,items)=>dispatchSelectedCompleteOrderLines(db,9051,{requestId:key,items,actor:'QA manager',dispatchDate:'2026-11-01'})
const before=stock()
assert.deepEqual({ ...before },{quantity:10,reserved_quantity:2})
const first=await dispatch('stage5b-test-dispatch-0001',[{orderItemId:9061,quantity:1}])
assert.equal(first.ok,true)
assert.equal(first.shippedLines,1)
assert.deepEqual({...stock()},{quantity:9,reserved_quantity:1})
assert.equal(state(),'not_sent')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9061").get().status,'fulfilled')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9062").get().status,'active')
assert.equal(refs().length,1)
const replay=await dispatch('stage5b-test-dispatch-0001',[{orderItemId:9061,quantity:1}])
assert.equal(replay.alreadyCommitted,true)
assert.equal(refs().length,1)
await assert.rejects(dispatch('stage5b-test-dispatch-0001',[{orderItemId:9062,quantity:1}]),/другим набором/)
await assert.rejects(dispatch('stage5b-test-dispatch-0002',[{orderItemId:9061,quantity:1}]),/ещё не готов|Товар изменился|выдан/)
assert.equal(refs().length,1)
const second=await dispatch('stage5b-test-dispatch-0003',[{orderItemId:9062,quantity:1}])
assert.equal(second.ok,true)
assert.deepEqual({...stock()},{quantity:8,reserved_quantity:0})
assert.equal(state(),'sent')
assert.equal(refs().length,2)
const cancelItem=sql.prepare("SELECT id FROM order_dispatch_items WHERE order_item_id=9061").get().id
const canceled=await cancelExactOrderDispatchItem(db,9051,{dispatchItemId:cancelItem,requestId:'stage5b-test-undo-0001',actor:'QA manager',reason:'Marked shipped in error'})
assert.equal(canceled.ok,true)
assert.equal(canceled.cancelledQuantity,1)
assert.equal(canceled.physicalRestoredQuantity,1)
assert.equal(state(),'not_sent')
assert.deepEqual({...stock()},{quantity:9,reserved_quantity:1})
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9061").get().status,'active')
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9062").get().status,'fulfilled')
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM order_dispatch_corrections").get().n,1)
const cancelReplay=await cancelExactOrderDispatchItem(db,9051,{dispatchItemId:cancelItem,requestId:'stage5b-test-undo-0001',actor:'QA manager',reason:'retry'})
assert.equal(cancelReplay.alreadyCorrected,true)
assert.deepEqual({...stock()},{quantity:9,reserved_quantity:1})
await assert.rejects(cancelExactOrderDispatchItem(db,9051,{dispatchItemId:cancelItem,requestId:'stage5b-test-undo-0002',actor:'QA manager',reason:'new key'}),/уже исправили/)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_type='order_dispatch_correction'").get().n,1)
sql.close()
console.log('STAGE5B_ATOMIC_FULL_LINE_DISPATCH_AND_EXACT_ITEM_UNDO_PASS')
