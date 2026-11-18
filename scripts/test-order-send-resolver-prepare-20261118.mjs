import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { prepareOrderShippingReservations } from '../worker/domains/order-shipping-prepare.ts'
import { buildOrderShipmentPlan } from '../worker/domains/order-shipment-plan.ts'
import { getOrder } from '../worker/domains/orders-write.ts'
import { dispatchSelectedCompleteOrderLines } from '../worker/domains/order-dispatch.ts'

const sql=new DatabaseSync(':memory:')
for(const path of fs.readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
  sql.exec(fs.readFileSync('migrations/'+path,'utf8'))
if (!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const stmt=(query,binds=[])=>({
  bind(...params){return stmt(query,params)},
  async first(){return sql.prepare(query).get(...binds)||null},
  async all(){return {results:sql.prepare(query).all(...binds)}},
  async run(){const r=sql.prepare(query).run(...binds);return{meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}}},
})
const db={
  prepare:(query)=>stmt(query),
  async batch(statements){
    sql.exec('SAVEPOINT safe_order_send')
    try{const res=[];for(const s of statements)res.push(await s.run());sql.exec('RELEASE safe_order_send');return res}
    catch(error){sql.exec('ROLLBACK TO safe_order_send');sql.exec('RELEASE safe_order_send');throw error}
  },
}
sql.exec(`
  INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Shipping manager');
  INSERT INTO catalog_products(id,name,category,is_active) VALUES(9401,'КЕРБЕЗ АБАЙКА','adult',1);
  INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,is_active)
    VALUES(9402,9401,'ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',1);
  INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,
    gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity)
    VALUES(9403,'boutique',9401,9402,'КЕРБЕЗ АБАЙКА','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',4,0);
  INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at)
    VALUES(9410,'ORD-TEST-SAFE-SHIPPING','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z');
  INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,
    gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,
    unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at)
    VALUES(9411,9410,9401,9402,'КЕРБЕЗ АБАЙКА','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',1,20000,20000,0,'boutique','pending_reservation','2026-11-15T00:00:00Z');
  INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,
    gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,
    unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at)
    VALUES(9412,9410,9401,9402,'АМИР БОМБЕР','МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','56',1,20000,20000,0,'boutique','fulfilled','2026-11-15T00:00:00Z');
  INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at)
    VALUES(9410,9412,'boutique',9401,9402,1,'fulfilled','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z');
  INSERT INTO order_dispatches(id,order_id,request_id,dispatch_date,created_at,actor,status)
    VALUES(9420,9410,'prior-shipment-existing','2026-11-15','2026-11-15T00:00:00Z','manager','sent');
  INSERT INTO order_dispatch_items(dispatch_id,order_item_id,quantity,cancelled_quantity,source_type,variant_id,created_at)
    VALUES(9420,9412,1,0,'boutique',9402,'2026-11-15T00:00:00Z');
`)
const stock=()=>({...sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9403').get()})
const current=()=>sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=9411').get()
const readPlan=async()=>{
  const o=await getOrder(db,9410)
  const r=sql.prepare("SELECT order_item_id,quantity,status,variant_id,inventory_source FROM inventory_reservations WHERE order_id=9410").all()
  return buildOrderShipmentPlan(o,r)
}
const before=stock()
const initial=await readPlan()
assert.equal(initial.lines.find(x=>x.orderItemId===9411).readyQuantity,0,
  'Previously a valid known SKU with no reserve was falsely not selectable')
const prepared=await prepareOrderShippingReservations(db,9410)
assert.deepEqual(prepared,{ok:true,recovered:1,pending:0,skipped:0})
assert.equal(current().status,'active')
assert.deepEqual(stock(),{quantity:before.quantity,reserved_quantity:before.reserved_quantity+1},
  'Recovery only reserves known stock; never invents physical quantity')
const retry=await prepareOrderShippingReservations(db,9410)
assert.equal(retry.recovered,0)
assert.deepEqual(stock(),{quantity:before.quantity,reserved_quantity:before.reserved_quantity+1},
  'Repeated clicking send must not double reserve the same item')
const plan=await readPlan()
const normal=plan.lines.find(x=>x.orderItemId===9411)
const issued=plan.lines.find(x=>x.orderItemId===9412)
assert.equal(normal.readyQuantity,1,'Recoverable stock now has a selectable send path')
assert.equal(normal.selectable,true)
assert.equal(issued.readyQuantity,0,'An already shipped line must never become selectable again')
assert.equal(issued.selectable,false)
const dispatch=await dispatchSelectedCompleteOrderLines(db,9410,{
  requestId:'explicit-shipment-safe-0001',items:[{orderItemId:9411,quantity:1}],
  actor:'QA manager',dispatchDate:'2026-11-18',
})
assert.equal(dispatch.ok,true)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_dispatch_items WHERE order_item_id=9411').get().n,1)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM order_dispatch_items WHERE order_item_id=9412').get().n,1,
  'Earlier shipment history must remain immutable')
assert.equal(stock().quantity,before.quantity-1,'Only real dispatch reduces physical count, once')
const duplicate=await dispatchSelectedCompleteOrderLines(db,9410,{
  requestId:'explicit-shipment-safe-0001',items:[{orderItemId:9411,quantity:1}],
  actor:'QA manager',dispatchDate:'2026-11-18',
})
assert.equal(duplicate.alreadyCommitted,true)
assert.equal(stock().quantity,before.quantity-1)

// A previously flagged reserved SKU is equally recoverable when its entire
// reservation vanished, without guessing another SKU or sending anything.
sql.exec(`
  INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at)
  VALUES (9450,'ORD-TEST-MISSING-RESERVED','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z');
  INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,
  gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,
  unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at)
  VALUES (9451,9450,9401,9402,'КЕРБЕЗ АБАЙКА','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',1,20000,20000,0,'boutique','reserved','2026-11-15T00:00:00Z');
`)
const beforeReserved=stock()
assert.equal((await prepareOrderShippingReservations(db,9450)).recovered,1)
assert.equal(sql.prepare("SELECT status FROM inventory_reservations WHERE order_item_id=9451").get().status,'active')
assert.equal(stock().quantity,beforeReserved.quantity,'Recovering a reserved marker cannot mint physical stock')
assert.equal((await prepareOrderShippingReservations(db,9450)).recovered,0)
assert.equal(stock().reserved_quantity,beforeReserved.reserved_quantity+1)

// A proven SKU with insufficient free stock is not a catalog error. Preserve
// a genuine unresolved reservation so the dispatch engine can request a
// one-operation physical possession confirmation, never change total counts.
sql.exec(`
  INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at)
  VALUES (9460,'ORD-TEST-SHORTAGE','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z');
  INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,
  gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,
  unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at)
  VALUES (9461,9460,9401,9402,'КЕРБЕЗ АБАЙКА','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',10,20000,200000,0,'boutique','pending_reservation','2026-11-15T00:00:00Z');
`)
const beforeShortage=stock()
const shortagePrepared=await prepareOrderShippingReservations(db,9460)
assert.equal(shortagePrepared.pending,1,'Known SKU short stock becomes explicit unresolved, not invisible')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=9461').get().status,'unresolved')
assert.deepEqual(stock(),beforeShortage,'Shortage preflight never invents physical or reserved units')
const shortOrder=await getOrder(db,9460)
const shortReservation=sql.prepare('SELECT order_item_id,quantity,status,variant_id,inventory_source FROM inventory_reservations WHERE order_id=9460').all()
const shortPlan=buildOrderShipmentPlan(shortOrder,shortReservation)
assert.equal(shortPlan.lines[0].needsStockConfirmation,true)
assert.equal(shortPlan.lines[0].selectable,true,'Known shortage must reach safe confirm-specific-items route')
assert.equal((await prepareOrderShippingReservations(db,9460)).pending,0,'Retry cannot duplicate unresolved reservation')

const actions=fs.readFileSync('src/features/orders/orderTableDispatchActions.ts','utf8')
const modal=fs.readFileSync('src/features/orders/OrderTableDispatchModal.tsx','utf8')
const route=fs.readFileSync('worker/routes/order-selective-shipping.ts','utf8')
const section=fs.readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const planFile=fs.readFileSync('worker/domains/order-shipment-plan.ts','utf8')
const domain=fs.readFileSync('worker/domains/order-shipping-prepare.ts','utf8')
assert(actions.includes('/shipping/prepare')&&actions.includes('/catalog-review'))
assert(actions.includes('if(needsCatalogResolution&&!ready)')&&actions.includes('onOpenCatalogResolution(order)'),
  'Unknown catalog identities must open existing Resolver instead of useless shipping dialog')
assert(modal.includes('Уточнить проблемные товары')&&
  modal.includes('Оставшиеся товары ещё не готовы к отправке'))
assert(route.includes("role!=='admin' && role!=='manager'")&&
  route.includes('prepareOrderShippingReservations(db,toInt(shippingPrepareMatch[1],0))'))
assert(domain.includes('assertLegacyMutationAllowedAfterReturnV2')&&
  domain.includes("stock_writeoff_status IN ('pending_reservation','reserved')")&&
  domain.includes('NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.order_item_id=oi.id)')&&
  domain.includes('order_dispatch_items')&&domain.includes('return_items')&&domain.includes('exchanges'),
  'No shipping preflight may revive a previously issued/returned/exchanged item')
assert(planFile.includes('Нет действующего резерва для известного SKU.'))
assert(section.includes('setOrderCatalogResolutionOrder(current)'))
console.log('ORDER_SEND_PREPARE_PASS: mixed sent+unreserved known SKU recovered once, real physical write only on dispatch, resolver route restored, manager access, no duplicate send')
sql.close()
