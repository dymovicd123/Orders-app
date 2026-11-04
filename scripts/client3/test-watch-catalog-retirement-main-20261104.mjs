import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {registerWatchModel,registerWatchVariant,listWatchCatalogDrafts} from '../../worker/domains/client3-watch-catalog.ts'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival} from '../../worker/domains/client3-watch-inventory.ts'
import {createClient3WatchOrder} from '../../worker/domains/client3-watch-create.ts'
import {listClient3WatchDemandReport} from '../../worker/domains/client3-watch-demand-report.ts'
import {dispatchClient3WatchOrder} from '../../worker/domains/client3-watch-dispatch.ts'
import {markWatchLogisticsReady} from '../../worker/domains/client3-watches.ts'
import {correctClient3WatchDispatch} from '../../worker/domains/client3-watch-dispatch-correction.ts'
import {createClient3WatchReturn,receiveClient3WatchReturn} from '../../worker/domains/client3-watch-returns.ts'
import {cancelClient3WatchReturn} from '../../worker/domains/client3-watch-return-history.ts'
import {cancelClient3WatchExchange} from '../../worker/domains/client3-watch-exchange-history.ts'
import {exchangeClient3WatchSet} from '../../worker/domains/client3-watch-exchange-set.ts'
import {previewClient3WatchDelete,deleteClient3WatchCatalog,listClient3WatchRetiredCatalog} from '../../worker/domains/client3-watch-catalog-delete.ts'
import {retireCatalogEntity} from '../../worker/domains/catalog-retirement.ts'

const app=fs.readFileSync('src/WatchClient3App.tsx','utf8')
const nav=app.match(/<div className="warehouse-w2-primary"[\\s\\S]*?\]\.map\(item/g)?.[0]||app
assert(nav.indexOf("section:'statistics'")>nav.indexOf("section:'revision'")&&
 nav.indexOf("section:'statistics'")<nav.indexOf("section:'history'"),
 'Statistics must immediately precede History in the warehouse navigation')
const catalogUI=fs.readFileSync('src/features/client3/WatchCatalogEditor.tsx','utf8')
assert(catalogUI.includes('<WatchCatalogRetiredHistory brand={brand}/>'),
 'Main-style archived watch catalog must be reachable from Products')
const returnHistoryUI=fs.readFileSync('src/features/client3/WatchReturnHistoryPanel.tsx','utf8')
const exchangeHistoryUI=fs.readFileSync('src/features/client3/WatchExchangeHistoryPanel.tsx','utf8')
for(const ui of [returnHistoryUI,exchangeHistoryUI]){
 assert(ui.includes('archivedAppliedCount')&&ui.includes('physicalLocation')&&
   ui.includes('Пока неизвестно')&&ui.includes('У клиента'),
   'Archived Return/Exchange cancellation must offer custody clarification without forcing a guessed location')
}
const deleteUI=fs.readFileSync('src/features/client3/WatchCatalogDeleteAction.tsx','utf8')
assert(deleteUI.includes('inventoryWillBeRemoved')&&
 deleteUI.includes('reservationsWillBeReleased')&&
 deleteUI.includes('preview.openOrders')&&
 deleteUI.includes('без повторного складского списания')&&
 deleteUI.includes('historicalOrderItems'),
 'Deletion preview must disclose concrete Main stock, reservation and historical effects')
const deleteDomain=fs.readFileSync('worker/domains/client3-watch-catalog-delete.ts','utf8')
assert(deleteDomain.includes("retireCatalogEntity(db,'product'")&&
 deleteDomain.includes('WITH checked AS MATERIALIZED')&&
 !/DELETE FROM (watch_products|watch_variants|order_items|inventory_movements)/i.test(deleteDomain),
 'Catalog retirement must use Main audit, exact-SKU all-or-none guard and never destroy history')
const sqlite=new DatabaseSync(':memory:')
sqlite.exec('PRAGMA foreign_keys=ON')
for(const name of fs.readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
 sqlite.exec(fs.readFileSync('migrations/'+name,'utf8'))
if(!sqlite.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
 sqlite.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
for(const name of fs.readdirSync('migrations/client3-watch').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
 sqlite.exec(fs.readFileSync('migrations/client3-watch/'+name,'utf8'))
const stmt=(sql,args=[])=>({
 bind(...x){return stmt(sql,x)},
 async first(){return sqlite.prepare(sql).get(...args)||null},
 async all(){return {results:sqlite.prepare(sql).all(...args)}},
 async run(){const a=sqlite.prepare(sql).run(...args)
   return {success:true,meta:{changes:Number(a.changes),last_row_id:Number(a.lastInsertRowid)}}},
})
const db={prepare:stmt,async batch(statements){
 sqlite.exec('SAVEPOINT catalog_archive_test')
 try{
   const all=[]
   for(const st of statements)all.push(await st.run())
   sqlite.exec('RELEASE catalog_archive_test')
   return all
 }catch(e){sqlite.exec('ROLLBACK TO SAVEPOINT catalog_archive_test')
   sqlite.exec('RELEASE catalog_archive_test');throw e}
}}
const parse=async p=>{const r=await p;return {status:r.status,...await r.json()}}
const admin={id:1,role:'admin',managerId:null,employeeRole:'Администратор',displayName:'QA'}
const manager={id:2,role:'manager',managerId:2,employeeRole:'Менеджер'}
sqlite.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(1,'QA Admin')").run()
sqlite.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES(2,'QA Manager')").run()
sqlite.prepare("INSERT OR IGNORE INTO app_users(id,email,password_hash,role,manager_id,display_name,is_active) VALUES(1,'retirement-qa@example.test','fixture-only','admin',1,'QA Admin',1)").run()
sqlite.prepare("INSERT OR IGNORE INTO watch_manager_brands(manager_id,brand_id) VALUES(2,1)").run()
sqlite.prepare("INSERT OR REPLACE INTO inventory_model_meta(key,value,updated_at) VALUES('human_inventory_v2','active','2026-11-04')").run()
const model=async name=>{
 const r=await parse(registerWatchModel(db,admin,1,{modelName:name}))
 assert(r.watchProductId>0,JSON.stringify(r));return r.watchProductId
}
const variant=async product=>{
 const r=await parse(registerWatchVariant(db,admin,1,{
   watchProductId:product,gender:'male',movement:'quartz',
   braceletMaterial:'steel',dialColor:'black',braceletColor:'',
 }))
 assert(r.watchVariantId>0,JSON.stringify(r))
 const ready=await parse(provisionClient3WatchSku(db,admin,1,r.watchVariantId))
 assert.equal(ready.status,200,JSON.stringify(ready))
 return {id:r.watchVariantId,canonical:ready.canonicalVariantId}
}
const archive=async()=>parse(listClient3WatchRetiredCatalog(db,admin,1,
 new URL('https://test.invalid/api/client3/watches/catalog/retired?offset=0')))
const active=async()=>parse(listWatchCatalogDrafts(db,admin,1))
const operationsBefore=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
const paymentsBefore=sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get().n

// Exact SKU retires like Main's granular SKU: zero stock, history event,
// no hard DELETE and no hidden resurrection in future catalog choices.
const itemModel=await model('ИСТОРИЯ ТОЧНОГО SKU')
const item=await variant(itemModel)
const exact={kind:'variant',watchProductId:itemModel,watchVariantId:item.id}
const exactPreview=await parse(previewClient3WatchDelete(db,admin,1,exact))
assert.equal(exactPreview.status,200,JSON.stringify(exactPreview))
assert.equal(exactPreview.canDelete,true,JSON.stringify(exactPreview))
const exactApplied=await parse(deleteClient3WatchCatalog(db,admin,1,{
 ...exact,expectedCount:exactPreview.count,
}))
assert.equal(exactApplied.status,200,JSON.stringify(exactApplied))
assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(item.id).is_active,0)
assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(item.canonical).is_active,0)
assert(sqlite.prepare("SELECT id FROM catalog_retirement_history_events WHERE event_type='variant' AND variant_id=?").get(item.canonical))
const availableAfterExact=await active()
assert(availableAfterExact.rows.some(x=>x.watchVariantId===item.id&&x.variantActive===0))
assert(!availableAfterExact.rows.some(x=>x.watchVariantId===item.id&&x.variantActive===1))
const historyExact=await archive()
assert(historyExact.rows.some(x=>x.watchVariantId===item.id&&x.variantActive===0))

// Main complete product retirement is materially different: active physical
// quantity is removed from *working* stock with an audited inventory movement.
// Client3 watch IDs / Main canonical SKU identity remain historical.
const productId=await model('ИСТОРИЯ ТОВАРА С ОСТАТКОМ')
const productVariant=await variant(productId)
const arrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:productVariant.id,quantity:3,
 comment:'Retirement stock test',requestId:'watch-retire-fixture-arrival-20261104-0001'
}))
assert.equal(arrival.status,200,JSON.stringify(arrival))
assert.equal(sqlite.prepare('SELECT SUM(quantity) AS q FROM inventory_stock WHERE variant_id=?').get(productVariant.canonical).q,3)
const beforeRetire=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
const historyOrder=await parse(createClient3WatchOrder(db,manager,1,{
 brand:'TAUWACH',source:'office',watchVariantId:productVariant.id,
 catalogVariantId:productVariant.canonical,quantity:1,unitPrice:9000,
 receivedAmount:0,payments:[],engravingText:'ГРАВИРОВКА QA',
 requestId:'watch-retire-order-history-20261104-0001',
 recipientName:'Тест истории товара',recipientPhone:'+77015550101',
 address:'Улица истории, 1',postalCode:'050001',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T14:00',
 urgent:false,paymentMethod:'KASPI GOLD'
}))
assert.equal(historyOrder.status,201,JSON.stringify(historyOrder))
const orderLine=sqlite.prepare('SELECT id,variant_id FROM order_items WHERE order_id=?')
 .get(historyOrder.orderId)
const partialOrder=await parse(createClient3WatchOrder(db,manager,1,{
 brand:'TAUWACH',source:'office',watchVariantId:productVariant.id,
 catalogVariantId:productVariant.canonical,quantity:2,unitPrice:9000,
 receivedAmount:0,payments:[],engravingText:'',
 requestId:'watch-retire-second-order-20261104-0001',
 recipientName:'Тест частичной выдачи',recipientPhone:'+77015550102',
 address:'Улица частичной отправки, 2',postalCode:'050002',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T14:00',
 urgent:false,paymentMethod:'KASPI GOLD'
}))
assert.equal(partialOrder.status,201,JSON.stringify(partialOrder))
const partialLine=sqlite.prepare('SELECT id,variant_id,quantity FROM order_items WHERE order_id=?')
 .get(partialOrder.orderId)
assert.equal(partialLine.quantity,2)
assert.equal(orderLine.variant_id,productVariant.canonical)
const activeReserve=sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id=? AND status='active'")
 .get(historyOrder.orderId).n
assert(activeReserve>=1,'Stocked watch must reserve exact SKU for order')
const exactWithStock=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'variant',watchProductId:productId,watchVariantId:productVariant.id
}))
assert.equal(exactWithStock.status,200,JSON.stringify(exactWithStock))
assert.equal(exactWithStock.canDelete,false,
 'An exact SKU cannot be retired with physical quantity or reservation')
assert.equal(exactWithStock.physicalQuantity,3,'P2-02: exact SKU preview must show actual stock')
assert.equal(exactWithStock.activeReservations,3,'P2-02: exact SKU preview must show actual reservations')
const blockedExact=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'variant',watchProductId:productId,watchVariantId:productVariant.id,
 expectedCount:1,
}))
assert.equal(blockedExact.status,409,'Exact SKU must not silently write off stock')
assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(productVariant.id).is_active,1)
const productPreview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'product',watchProductId:productId
}))
assert.equal(productPreview.status,200,JSON.stringify(productPreview))
assert.equal(productPreview.canDelete,true,JSON.stringify(productPreview))
assert.equal(productPreview.physicalQuantity,3)
assert(productPreview.activeReservations>=1)
assert(productPreview.openOrders>=2, 'Deletion preview must count outstanding customer orders')
assert.equal(productPreview.inventoryWillBeRemoved,true)
const productApplied=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'product',watchProductId:productId,expectedCount:productPreview.count,
 requestId:'watch-retire-product-safe-20261104-0001',
}))
assert.equal(productApplied.status,200,JSON.stringify(productApplied))
assert.equal(productApplied.mainRetirement,true)
assert.equal(sqlite.prepare('SELECT is_active FROM watch_products WHERE id=?').get(productId).is_active,0)
assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(productVariant.id).is_active,0)
assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(productVariant.canonical).is_active,0)
assert.equal(sqlite.prepare('SELECT SUM(quantity) AS q FROM inventory_stock WHERE variant_id=?').get(productVariant.canonical).q,0)
assert(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id=? AND status='active'").get(historyOrder.orderId).n===0)
assert.equal(sqlite.prepare('SELECT variant_id FROM order_items WHERE id=?').get(orderLine.id).variant_id,productVariant.canonical,'Historical order line must retain canonical identity')
assert(sqlite.prepare('SELECT id FROM orders WHERE id=?').get(historyOrder.orderId),'Historical order cannot be removed')
assert(sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE variant_id=? AND movement_type='delete'").get(productVariant.canonical).n>=1)
assert(sqlite.prepare("SELECT COUNT(*) AS n FROM catalog_retirement_operations WHERE entity_type='product' AND status='completed'").get().n>=1)
assert(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n>beforeRetire)
// Real archival dispatch: engraving ready; explicit physical confirmation is
// mandatory. Retirement already consumed all tracked inventory and reserve.
const readyAfterArchive=await parse(markWatchLogisticsReady(db,admin,
 historyOrder.orderId,orderLine.id,'watch-ready-retired-20261104-0001'))
assert.equal(readyAfterArchive.status,200,JSON.stringify(readyAfterArchive))
assert.equal(readyAfterArchive.stockUnchanged,true)
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?')
 .get(orderLine.id).stock_writeoff_status,'catalog_retired')
// Corrupt post-retirement stock must fail closed; the special no-stock
// dispatch must never ignore positive physical units under a deleted SKU.
sqlite.prepare('UPDATE inventory_stock SET quantity=2 WHERE variant_id=?')
 .run(productVariant.canonical)
const divergentRetiredSend=await parse(dispatchClient3WatchOrder(db,admin,1,historyOrder.orderId,{
 requestId:'watch-retired-unsafe-stock-20261104-0001',
 items:[{orderItemId:orderLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(divergentRetiredSend.status,409,'Unexpected physical stock under archived SKU must block')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatch_items WHERE order_item_id=?')
 .get(orderLine.id).n,0)
sqlite.prepare('UPDATE inventory_stock SET quantity=0 WHERE variant_id=?')
 .run(productVariant.canonical)
const noDoubleStock=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
const noConfirmation=await parse(dispatchClient3WatchOrder(db,admin,1,historyOrder.orderId,{
 requestId:'watch-send-retired-20261104-0001',
 items:[{orderItemId:orderLine.id,quantity:1}],confirmPhysicalStock:false,
}))
assert.equal(noConfirmation.status,409,'Archived watches require explicit physical handover')
const archivedSend=await parse(dispatchClient3WatchOrder(db,admin,1,historyOrder.orderId,{
 requestId:'watch-send-retired-20261104-0001',
 items:[{orderItemId:orderLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(archivedSend.status,200,JSON.stringify(archivedSend))
assert.equal(archivedSend.retiredWithoutStockChange,true)
assert.equal(archivedSend.stockDispatched,false)
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?')
 .get(orderLine.id).stock_writeoff_status,'retired_physically_issued')
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?')
 .get(historyOrder.orderId).shipping_status,'sent')
const ledger=sqlite.prepare('SELECT id,movement_id,reservation_id,quantity FROM order_dispatch_items WHERE order_item_id=?').get(orderLine.id)
assert.equal(ledger.quantity,1);assert.equal(ledger.movement_id,null);assert.equal(ledger.reservation_id,null)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM retired_order_item_issues WHERE order_item_id=?')
 .get(orderLine.id).n,1)
const retrySend=await parse(dispatchClient3WatchOrder(db,admin,1,historyOrder.orderId,{
 requestId:'watch-send-retired-20261104-0001',
 items:[{orderItemId:orderLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(retrySend.status,200,JSON.stringify(retrySend))
assert.equal(retrySend.alreadyCommitted,true)
const archivedCorrection=await parse(correctClient3WatchDispatch(db,admin,1,historyOrder.orderId,{
 dispatchItemId:ledger.id,requestId:'watch-correct-retired-20261104-0001',
 reason:'Ошибочно отмеченная отправка архивных часов',
}))
assert.equal(archivedCorrection.status,200,JSON.stringify(archivedCorrection))
assert.equal(archivedCorrection.physicalRestoredQuantity,0)
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?')
 .get(orderLine.id).stock_writeoff_status,'catalog_retired')
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?')
 .get(historyOrder.orderId).shipping_status,'not_sent')
const secondCorrection=await parse(correctClient3WatchDispatch(db,admin,1,historyOrder.orderId,{
 dispatchItemId:ledger.id,requestId:'watch-correct-retired-20261104-0001',
 reason:'Ошибочно отмеченная отправка архивных часов',
}))
assert.equal(secondCorrection.status,200);assert.equal(secondCorrection.alreadyCorrected,true)
const cancelledReplay=await parse(dispatchClient3WatchOrder(db,admin,1,historyOrder.orderId,{
 requestId:'watch-send-retired-20261104-0001',
 items:[{orderItemId:orderLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(cancelledReplay.status,409,
 'A canceled dispatch cannot replay as a successful shipment')
const reissued=await parse(dispatchClient3WatchOrder(db,admin,1,historyOrder.orderId,{
 requestId:'watch-send-retired-again-20261104-0001',
 items:[{orderItemId:orderLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(reissued.status,200,JSON.stringify(reissued))
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,noDoubleStock)
assert.equal(sqlite.prepare('SELECT SUM(quantity) AS q FROM inventory_stock WHERE variant_id=?')
 .get(productVariant.canonical).q,0)

// Partial archival dispatch: split product identity, price, engraving and
// released reservation; no extra inventory_stock or inventory_movements.
const partialBefore=sqlite.prepare('SELECT SUM(line_total) AS total FROM order_items WHERE order_id=?')
 .get(partialOrder.orderId).total
const partialSent=await parse(dispatchClient3WatchOrder(db,admin,1,partialOrder.orderId,{
 requestId:'watch-send-retired-part-20261104-0001',
 items:[{orderItemId:partialLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(partialSent.status,200,JSON.stringify(partialSent))
const pieces=sqlite.prepare(`SELECT oi.id,oi.quantity,oi.line_total,oi.stock_writeoff_status,
 wi.watch_variant_id,ir.status AS reservation_status
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 LEFT JOIN inventory_reservations ir ON ir.order_item_id=oi.id
 WHERE oi.order_id=? ORDER BY oi.id`).all(partialOrder.orderId)
assert.equal(pieces.length,2,JSON.stringify(pieces))
assert.deepEqual(pieces.map(x=>x.quantity),[1,1])
assert.equal(pieces[0].stock_writeoff_status,'retired_physically_issued')
assert.equal(pieces[1].stock_writeoff_status,'catalog_retired')
assert(pieces.every(x=>x.watch_variant_id===productVariant.id&&x.reservation_status==='released'))
assert.equal(pieces.reduce((n,x)=>n+x.line_total,0),partialBefore)
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?')
 .get(partialOrder.orderId).shipping_status,'not_sent')
const lastSent=await parse(dispatchClient3WatchOrder(db,admin,1,partialOrder.orderId,{
 requestId:'watch-send-retired-rest-20261104-0001',
 items:[{orderItemId:pieces[1].id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(lastSent.status,200,JSON.stringify(lastSent))
assert.equal(sqlite.prepare('SELECT shipping_status FROM orders WHERE id=?')
 .get(partialOrder.orderId).shipping_status,'sent')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,noDoubleStock)
// A physical Return after archived delivery must respect the ordinary
// dispatch ledger but NEVER resurrect removed inventory/SKU identities.
const forbiddenReturn=await parse(createClient3WatchReturn(db,manager,1,historyOrder.orderId,{
 requestId:'watch-retired-return-stock-forbidden-20261104-0001',
 kind:'items_only',quantity:1,amount:0,reason:'Проверка запрета восстановления архивного SKU',
 items:[{orderItemId:orderLine.id,quantity:1,physicalState:'warehouse'}]
}))
assert.equal(forbiddenReturn.status,409,'Returning into deleted SKU is unsafe')
assert.equal(forbiddenReturn.code,'WATCH_RETIRED_RETURN_STOCK_BLOCKED')
const validReturn=await parse(createClient3WatchReturn(db,manager,1,historyOrder.orderId,{
 requestId:'watch-retired-return-pending-20261104-0001',
 kind:'items_only',quantity:1,amount:0,reason:'Часы возвращаются после отправки',
 items:[{orderItemId:orderLine.id,quantity:1,physicalState:'pending'}],
}))
assert.equal(validReturn.status,200,JSON.stringify(validReturn))
const physicalReturn=sqlite.prepare(`SELECT ri.id,ri.return_id FROM return_items ri
 JOIN returns r ON r.id=ri.return_id WHERE r.order_id=? ORDER BY ri.id DESC LIMIT 1`)
 .get(historyOrder.orderId)
assert(physicalReturn?.id,'Archive return must retain exact historic order line')
const forbiddenReceipt=await parse(receiveClient3WatchReturn(db,manager,1,historyOrder.orderId,{
 requestId:'watch-retired-receipt-stock-forbidden-20261104-0001',
 returnId:physicalReturn.return_id,returnItemId:physicalReturn.id,destination:'warehouse'
}))
assert.equal(forbiddenReceipt.status,409,'Intake must not restock removed SKU')
assert.equal(forbiddenReceipt.code,'WATCH_RETIRED_RECEIPT_STOCK_BLOCKED')
const receivedWithoutStock=await parse(receiveClient3WatchReturn(db,manager,1,historyOrder.orderId,{
 requestId:'watch-retired-receipt-no-stock-20261104-0001',
 returnId:physicalReturn.return_id,returnItemId:physicalReturn.id,destination:'no_stock'
}))
assert.equal(receivedWithoutStock.status,200,JSON.stringify(receivedWithoutStock))
const lateCorrection=await parse(correctClient3WatchDispatch(db,admin,1,historyOrder.orderId,{
 dispatchItemId:sqlite.prepare('SELECT id FROM order_dispatch_items WHERE order_item_id=? ORDER BY id DESC LIMIT 1')
   .get(orderLine.id).id,
 requestId:'watch-retired-correction-after-return-20261104',
 reason:'Не должно отменяться после возврата часов',
}))
assert.equal(lateCorrection.status,409,'Return of shipped item must block later shipment correction')
const cancelHistoricReturn=await parse(cancelClient3WatchReturn(db,manager,1,historyOrder.orderId,
 physicalReturn.return_id,{
 requestId:'watch-retired-return-cancel-20261104-0001',
 reason:'Отмена возврата часов после архивной отправки'
}))
assert.equal(cancelHistoricReturn.status,200,JSON.stringify(cancelHistoricReturn))
assert.equal(sqlite.prepare('SELECT status FROM returns WHERE id=?')
 .get(physicalReturn.return_id).status,'cancelled')
assert.equal(sqlite.prepare('SELECT SUM(quantity) AS qty FROM inventory_stock WHERE variant_id=?')
 .get(productVariant.canonical).qty,0)
const correctAfterReturnCancelled=await parse(correctClient3WatchDispatch(db,admin,1,historyOrder.orderId,{
 dispatchItemId:sqlite.prepare('SELECT id FROM order_dispatch_items WHERE order_item_id=? ORDER BY id DESC LIMIT 1')
   .get(orderLine.id).id,
 requestId:'watch-retired-correct-after-return-cancel-20261104-0001',
 reason:'Исправление разрешено только после отмены зависимого возврата'
}))
assert.equal(correctAfterReturnCancelled.status,200,JSON.stringify(correctAfterReturnCancelled))
assert.equal(correctAfterReturnCancelled.physicalRestoredQuantity,0)
const sendAfterReturnCancelled=await parse(dispatchClient3WatchOrder(db,admin,1,historyOrder.orderId,{
 requestId:'watch-retired-after-return-cancel-20261104-0001',
 items:[{orderItemId:orderLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(sendAfterReturnCancelled.status,200,JSON.stringify(sendAfterReturnCancelled))

// Exchange can replace one already delivered archived watch, but the old
// retired SKU cannot be restocked as a side effect of that exchange.
const old=sqlite.prepare(`SELECT id,quantity,unit_price,line_total,catalog_price_snapshot
 FROM order_items WHERE id=?`).get(pieces[0].id)
const expectedTotal=sqlite.prepare('SELECT total_amount FROM orders WHERE id=?')
 .get(partialOrder.orderId).total_amount
const oldItem={
 orderItemId:old.id,quantity:1,physicalState:'no_stock',
 expectedActiveQuantity:old.quantity,expectedUnitPrice:old.unit_price,
 expectedLineTotal:old.line_total,expectedCatalogPriceSnapshot:old.catalog_price_snapshot
}
const replacement={modelName:'АРХИВ ОБМЕН ЧАСЫ QA',gender:'male',movement:'quartz',
 braceletMaterial:'steel',dialColor:'silver',braceletColor:''}
const forbiddenExchange=await parse(exchangeClient3WatchSet(db,manager,1,partialOrder.orderId,{
 requestId:'watch-retired-exchange-restock-forbidden-20261104',
 expectedOrderTotal:expectedTotal,oldItems:[{...oldItem,physicalState:'warehouse'}],
 newItems:[{manual:replacement,source:'office',quantity:1,unitPrice:9000,
   engravingText:'',shipmentState:'pending',issuePossessionConfirmed:false}],
 paymentParts:[],refundParts:[],reason:'Обмен не должен создавать остаток архивных часов'
}))
assert.equal(forbiddenExchange.status,409)
assert.equal(forbiddenExchange.code,'WATCH_ARCHIVED_EXCHANGE_STOCK_BLOCKED')
const validExchange=await parse(exchangeClient3WatchSet(db,manager,1,partialOrder.orderId,{
 requestId:'watch-retired-exchange-no-stock-20261104',
 expectedOrderTotal:expectedTotal,oldItems:[oldItem],
 newItems:[{manual:replacement,source:'office',quantity:1,unitPrice:9000,
   engravingText:'',shipmentState:'pending',issuePossessionConfirmed:false}],
 paymentParts:[],refundParts:[],reason:'Обмен архивных часов с новой отправкой через логистику'
}))
assert.equal(validExchange.status,200,JSON.stringify(validExchange))
assert.equal(sqlite.prepare('SELECT SUM(quantity) AS qty FROM inventory_stock WHERE variant_id=?')
 .get(productVariant.canonical).qty,0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE variant_id=? AND movement_type=\'sale\'')
 .get(productVariant.canonical).n,0)
const replacementLine=sqlite.prepare(`SELECT oi.id,oi.stock_writeoff_status,wi.watch_variant_id
 FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
 WHERE oi.order_id=? AND oi.quantity>0 AND oi.id<>?
 ORDER BY oi.id DESC LIMIT 1`).get(partialOrder.orderId,pieces[1].id)
assert(replacementLine?.watch_variant_id>0)
assert.notEqual(replacementLine.stock_writeoff_status,'fulfilled',
 'Replacement must remain unshipped until Logistics')
const exchangeForCancel=sqlite.prepare(`SELECT id FROM exchanges WHERE order_id=?
 AND COALESCE(status,'completed')<>'cancelled' ORDER BY id DESC LIMIT 1`)
 .get(partialOrder.orderId)
assert(exchangeForCancel?.id)
const reversedArchivedExchange=await parse(cancelClient3WatchExchange(db,manager,1,
 partialOrder.orderId,exchangeForCancel.id,{
 requestId:'watch-retired-exchange-cancel-20261104-0001',
 reason:'Отмена обмена архивных часов с неотправленной заменой'
}))
assert.equal(reversedArchivedExchange.status,200,JSON.stringify(reversedArchivedExchange))
assert.equal(sqlite.prepare('SELECT status FROM exchanges WHERE id=?')
 .get(exchangeForCancel.id).status,'cancelled')
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?')
 .get(productVariant.canonical).quantity,0)
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?')
 .get(pieces[0].id).stock_writeoff_status,'retired_physically_issued')
const archived=await archive()
assert(archived.rows.some(x=>x.watchProductId===productId&&x.productActive===0))
assert(archived.rows.some(x=>x.watchVariantId===item.id&&x.variantActive===0))
const afterCatalog=await active()
assert(afterCatalog.rows.some(x=>x.watchProductId===productId&&x.productActive===0))
assert(!afterCatalog.rows.some(x=>x.watchProductId===productId&&x.productActive===1))
const cannotRestore=await parse(registerWatchModel(db,admin,1,{modelName:'ИСТОРИЯ ТОВАРА С ОСТАТКОМ'}))
assert.equal(cannotRestore.status,409,'Retired Main product cannot be silently restored')
const wrongBrand=await parse(previewClient3WatchDelete(db,admin,2,{kind:'product',watchProductId:productId}))
assert.equal(wrongBrand.status,404,'Cannot retire a foreign-brand watch')
const denied=await parse(previewClient3WatchDelete(db,manager,1,{kind:'product',watchProductId:itemModel}))
assert.equal(denied.status,403,'Manager cannot delete catalog models')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get().n,paymentsBefore)
const historyDemand=await parse(listClient3WatchDemandReport(db,admin,1,
 new URL('https://test.invalid/?start=2026-01-01&end=2027-12-31&scope=orders')))
assert.equal(historyDemand.status,200,JSON.stringify(historyDemand))
assert(historyDemand.rows.some(x=>x.variantId===productVariant.id),
 'Archived watch remains visible in historical sales statistics')
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,operationsBefore+2)
// A different edge case: a watch was sent from live stock BEFORE its model
// was retired. Generic Main send cancellation would return units to archived
// stock; Client3 must fail closed rather than recreate deleted inventory.
const historicSentProduct=await model('ARCHIVED AFTER NORMAL SEND QA')
const normalVariant=await variant(historicSentProduct)
const physicalArrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:normalVariant.id,quantity:2,
 comment:'Before-deletion dispatch correction regression',
 requestId:'watch-pre-delete-arrival-20261104-0001'
}))
assert.equal(physicalArrival.status,200,JSON.stringify(physicalArrival))
const earlyOrder=await parse(createClient3WatchOrder(db,manager,1,{
 brand:'TAUWACH',source:'office',watchVariantId:normalVariant.id,
 catalogVariantId:normalVariant.canonical,quantity:1,unitPrice:10000,
 receivedAmount:0,payments:[],engravingText:'',
 requestId:'watch-before-deletion-order-20261104-0001',
 recipientName:'Тест старой отправки',recipientPhone:'+77015550103',
 address:'Улица обычной выдачи, 3',postalCode:'050003',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T14:00',
 urgent:false,paymentMethod:'KASPI GOLD'
}))
assert.equal(earlyOrder.status,201,JSON.stringify(earlyOrder))
const earlyLine=sqlite.prepare('SELECT id FROM order_items WHERE order_id=?').get(earlyOrder.orderId)
const earlyDispatch=await parse(dispatchClient3WatchOrder(db,admin,1,earlyOrder.orderId,{
 requestId:'watch-normal-before-retire-20261104-0001',
 items:[{orderItemId:earlyLine.id,quantity:1}],
}))
assert.equal(earlyDispatch.status,200,JSON.stringify(earlyDispatch))
const beforeDeletionPreview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'product',watchProductId:historicSentProduct
}))
assert.equal(beforeDeletionPreview.status,200)
const afterShipmentDeletion=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'product',watchProductId:historicSentProduct,
 expectedCount:beforeDeletionPreview.count,
 requestId:'watch-retire-after-normal-send-20261104-0001'
}))
assert.equal(afterShipmentDeletion.status,200,JSON.stringify(afterShipmentDeletion))
const historicShipment=sqlite.prepare('SELECT id FROM order_dispatch_items WHERE order_item_id=?')
 .get(earlyLine.id)
const stockProof=sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?')
 .get(normalVariant.canonical).quantity
assert.equal(stockProof,0)
const preRetireCorrection=await parse(correctClient3WatchDispatch(db,admin,1,earlyOrder.orderId,{
 dispatchItemId:historicShipment.id,
 requestId:'watch-normal-correct-after-retire-20261104-0001',
 reason:'Обычная отмена не должна восстановить архивный остаток'
}))
assert.equal(preRetireCorrection.status,200,JSON.stringify(preRetireCorrection))
assert.equal(preRetireCorrection.physicalRestoredQuantity,0)
assert.equal(preRetireCorrection.historicalMovementPreserved,true)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?')
 .get(normalVariant.canonical).quantity,0)
assert.equal(sqlite.prepare('SELECT cancelled_quantity FROM order_dispatch_items WHERE id=?')
 .get(historicShipment.id).cancelled_quantity,1)
assert.equal(sqlite.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=?')
 .get(earlyLine.id).stock_writeoff_status,'catalog_retired')
assert.equal(sqlite.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=?')
 .get(earlyLine.id).status,'released')
assert.equal(sqlite.prepare('SELECT unresolved_reason FROM inventory_reservations WHERE order_item_id=?')
 .get(earlyLine.id).unresolved_reason,'catalog_retired')
const preRetireReplay=await parse(correctClient3WatchDispatch(db,admin,1,earlyOrder.orderId,{
 dispatchItemId:historicShipment.id,
 requestId:'watch-normal-correct-after-retire-20261104-0001',
 reason:'Обычная отмена не должна восстановить архивный остаток'
}))
assert.equal(preRetireReplay.status,200)
assert.equal(preRetireReplay.alreadyCorrected,true)
const preRetireSentAgain=await parse(dispatchClient3WatchOrder(db,admin,1,earlyOrder.orderId,{
 requestId:'watch-reissue-after-retire-20261104-0001',
 items:[{orderItemId:earlyLine.id,quantity:1}],confirmPhysicalStock:true,
}))
assert.equal(preRetireSentAgain.status,200,JSON.stringify(preRetireSentAgain))
assert.equal(preRetireSentAgain.retiredWithoutStockChange,true)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?')
 .get(normalVariant.canonical).quantity,0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM order_dispatch_items WHERE order_item_id=?')
 .get(earlyLine.id).n,2)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE variant_id=? AND movement_type=\'sale\'')
 .get(normalVariant.canonical).n,1)
// A physical Return happened WHILE the SKU was active, then Main retired
// its complete product. Cancelling that Return after retirement must never
// reverse the old receipt into a permanently zeroed archived inventory row.
const returnedBeforeRetireProduct=await model('ARCHIVED AFTER PHYSICAL RETURN QA')
const returnedBeforeRetireVariant=await variant(returnedBeforeRetireProduct)
const beforeReturnArrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:returnedBeforeRetireVariant.id,quantity:2,
 comment:'Return before catalog retirement',
 requestId:'watch-return-before-retire-arrival-20261104-0001'
}))
assert.equal(beforeReturnArrival.status,200,JSON.stringify(beforeReturnArrival))
const returnedOldOrder=await parse(createClient3WatchOrder(db,manager,1,{
 brand:'TAUWACH',source:'office',watchVariantId:returnedBeforeRetireVariant.id,
 catalogVariantId:returnedBeforeRetireVariant.canonical,quantity:1,unitPrice:11000,
 receivedAmount:11000,payments:[{method:'KASPI GOLD',amount:11000}],engravingText:'',
 requestId:'watch-return-before-retire-order-20261104-0001',
 recipientName:'Тест возврата до архива',recipientPhone:'+77015550104',
 address:'Улица возвратов, 4',postalCode:'050004',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T14:00',
 urgent:false,paymentMethod:'KASPI GOLD'
}))
assert.equal(returnedOldOrder.status,201,JSON.stringify(returnedOldOrder))
const returnedOldItem=sqlite.prepare('SELECT id FROM order_items WHERE order_id=?')
 .get(returnedOldOrder.orderId)
const sentBeforeReturn=await parse(dispatchClient3WatchOrder(db,admin,1,returnedOldOrder.orderId,{
 requestId:'watch-return-before-retire-shipment-20261104-0001',
 items:[{orderItemId:returnedOldItem.id,quantity:1}]
}))
assert.equal(sentBeforeReturn.status,200,JSON.stringify(sentBeforeReturn))
const physicalReceived=await parse(createClient3WatchReturn(db,manager,1,returnedOldOrder.orderId,{
 requestId:'watch-return-before-retire-20261104-0001',
 kind:'both',amount:11000,paymentMethod:'KASPI GOLD',quantity:1,
 reason:'Физический возврат часов до удаления товара',
 items:[{orderItemId:returnedOldItem.id,quantity:1,physicalState:'warehouse'}]
}))
assert.equal(physicalReceived.status,200,JSON.stringify(physicalReceived))
assert.equal(sqlite.prepare('SELECT return_amount FROM orders WHERE id=?')
 .get(returnedOldOrder.orderId).return_amount,11000,
 'Refund amount must be recorded before retirement')
const returnBeforeDelete=sqlite.prepare('SELECT id FROM returns WHERE order_id=? ORDER BY id DESC LIMIT 1')
 .get(returnedOldOrder.orderId)
const appliedBeforeDelete=sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_lifecycle_events
 WHERE operation_type='return' AND operation_id=? AND status='applied'
 AND variant_id=?`).get(returnBeforeDelete.id,returnedBeforeRetireVariant.canonical).n
assert(appliedBeforeDelete>0,'Test must have physically applied return movement before retirement')
const physicalReturnPreview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'product',watchProductId:returnedBeforeRetireProduct
}))
assert.equal(physicalReturnPreview.status,200,JSON.stringify(physicalReturnPreview))
assert(physicalReturnPreview.appliedPhysicalReturnExchangeCount>=1)
const afterReturnDeleted=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'product',watchProductId:returnedBeforeRetireProduct,
 expectedCount:physicalReturnPreview.count,
 requestId:'watch-retire-after-physical-return-20261104-0001'
}))
assert.equal(afterReturnDeleted.status,200,JSON.stringify(afterReturnDeleted))
const movementCountAfterReturnRetired=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
sqlite.prepare('UPDATE inventory_stock SET quantity=1 WHERE variant_id=?')
 .run(returnedBeforeRetireVariant.canonical)
const blockedOnNonzeroArchive=await parse(cancelClient3WatchReturn(db,manager,1,
 returnedOldOrder.orderId,returnBeforeDelete.id,{
 requestId:'watch-return-cancel-after-delete-20261104-0001',
 reason:'Отмена денежного возврата с непроверенным архивным остатком'
}))
assert.equal(blockedOnNonzeroArchive.status,409)
assert.equal(blockedOnNonzeroArchive.code,'WATCH_RETURN_CANCEL_RETIRED_STOCK')
assert.equal(sqlite.prepare('SELECT return_amount FROM orders WHERE id=?')
 .get(returnedOldOrder.orderId).return_amount,11000,
 'Do not refund-reverse money when archived inventory is inconsistent')
assert.notEqual(sqlite.prepare('SELECT status FROM returns WHERE id=?')
 .get(returnBeforeDelete.id).status,'cancelled')
sqlite.prepare('UPDATE inventory_stock SET quantity=0 WHERE variant_id=?')
 .run(returnedBeforeRetireVariant.canonical)
const cancelPhysicalOldReturn=await parse(cancelClient3WatchReturn(db,manager,1,
 returnedOldOrder.orderId,returnBeforeDelete.id,{
 requestId:'watch-return-cancel-after-delete-20261104-0001',
 reason:'Отмена старого возврата без восстановления остатка',physicalLocation:'customer'
}))
assert.equal(cancelPhysicalOldReturn.status,200,JSON.stringify(cancelPhysicalOldReturn))
assert.equal(cancelPhysicalOldReturn.archivedStockPreserved,true)
assert(cancelPhysicalOldReturn.stockReversals.some(x=>
 x.physicalReversalSkipped===true&&x.physicalReversalReason==='retired_identity'),
 'Main must cancel return commercially without reversing retired stock')
assert.equal(sqlite.prepare('SELECT status FROM returns WHERE id=?')
 .get(returnBeforeDelete.id).status,'cancelled')
assert(sqlite.prepare('SELECT cancellation_comment FROM returns WHERE id=?')
 .get(returnBeforeDelete.id).cancellation_comment.includes('часы у клиента'),
 'Explicit customer custody must be recorded in return cancellation audit')
const afterRefundCancellation=sqlite.prepare('SELECT received_amount,return_amount,debt_amount FROM orders WHERE id=?')
 .get(returnedOldOrder.orderId)
assert.equal(afterRefundCancellation.received_amount,11000)
assert.equal(afterRefundCancellation.return_amount,0,
 'Main must restore commercial money ledger on cancellation of archived return')
assert.equal(afterRefundCancellation.debt_amount,0)
assert.equal(sqlite.prepare(`SELECT status FROM inventory_lifecycle_events
 WHERE operation_type='return' AND operation_id=?`).get(returnBeforeDelete.id).status,'cancelled')
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?')
 .get(returnedBeforeRetireVariant.canonical).quantity,0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,
 movementCountAfterReturnRetired)
// Another history boundary: an Exchange physically returned a watch while
// active, then the old product was retired. Cancelling the Exchange must not
// reverse its earlier old-in movement after that later retirement.
const exchangedBeforeRetireProduct=await model('ARCHIVED AFTER PHYSICAL EXCHANGE QA')
const exchangedBeforeRetireVariant=await variant(exchangedBeforeRetireProduct)
const oldExchangeArrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:exchangedBeforeRetireVariant.id,quantity:2,
 comment:'Exchange receipt before SKU retirement',
 requestId:'watch-exchange-before-retire-arrival-20261104-0001'
}))
assert.equal(oldExchangeArrival.status,200,JSON.stringify(oldExchangeArrival))
const oldExchangeOrder=await parse(createClient3WatchOrder(db,manager,1,{
 brand:'TAUWACH',source:'office',watchVariantId:exchangedBeforeRetireVariant.id,
 catalogVariantId:exchangedBeforeRetireVariant.canonical,quantity:1,unitPrice:12000,
 receivedAmount:0,payments:[],engravingText:'',
 requestId:'watch-exchange-before-retire-order-20261104-0001',
 recipientName:'Тест обмена до архива',recipientPhone:'+77015550105',
 address:'Улица обмена, 5',postalCode:'050005',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T14:00',
 urgent:false,paymentMethod:'KASPI GOLD'
}))
assert.equal(oldExchangeOrder.status,201,JSON.stringify(oldExchangeOrder))
const oldExchangeLine=sqlite.prepare(`SELECT id,quantity,unit_price,line_total,catalog_price_snapshot
 FROM order_items WHERE order_id=?`).get(oldExchangeOrder.orderId)
const deliveredOldExchange=await parse(dispatchClient3WatchOrder(db,admin,1,oldExchangeOrder.orderId,{
 requestId:'watch-exchange-before-retire-shipment-20261104-0001',
 items:[{orderItemId:oldExchangeLine.id,quantity:1}]
}))
assert.equal(deliveredOldExchange.status,200,JSON.stringify(deliveredOldExchange))
const newExchangeWatch={modelName:'NEW AFTER OLD EXCHANGE ARCHIVED QA',gender:'female',
 movement:'quartz',braceletMaterial:'steel',dialColor:'silver',braceletColor:''}
const oldExchangeMade=await parse(exchangeClient3WatchSet(db,manager,1,oldExchangeOrder.orderId,{
 requestId:'watch-exchange-with-physical-return-20261104-0001',
 expectedOrderTotal:12000,
 oldItems:[{orderItemId:oldExchangeLine.id,quantity:1,physicalState:'warehouse',
   expectedActiveQuantity:1,expectedUnitPrice:12000,
   expectedLineTotal:12000,expectedCatalogPriceSnapshot:oldExchangeLine.catalog_price_snapshot}],
 newItems:[{manual:newExchangeWatch,source:'office',quantity:1,unitPrice:14000,
   engravingText:'',shipmentState:'pending',issuePossessionConfirmed:false}],
 paymentParts:[{method:'KASPI GOLD',amount:2000}],refundParts:[],
 reason:'Физический обмен с доплатой и возвратом исходных часов'
}))
assert.equal(oldExchangeMade.status,200,JSON.stringify(oldExchangeMade))
const cashAfterExchange=sqlite.prepare('SELECT total_amount,received_amount FROM orders WHERE id=?')
 .get(oldExchangeOrder.orderId)
assert.equal(cashAfterExchange.total_amount,14000)
assert.equal(cashAfterExchange.received_amount,2000,
 'Extra payment before retirement must be actually recorded')
const exchangeBeforeDelete=sqlite.prepare(`SELECT id FROM exchanges
 WHERE order_id=? AND COALESCE(status,'completed')<>'cancelled'
 ORDER BY id DESC LIMIT 1`).get(oldExchangeOrder.orderId)
assert(exchangeBeforeDelete?.id)
assert(sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_lifecycle_events
 WHERE operation_type='exchange' AND operation_id=? AND status='applied'
 AND variant_id=?`).get(exchangeBeforeDelete.id,exchangedBeforeRetireVariant.canonical).n>0)
const exchangedOldPreview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'product',watchProductId:exchangedBeforeRetireProduct
}))
assert.equal(exchangedOldPreview.status,200,JSON.stringify(exchangedOldPreview))
assert(exchangedOldPreview.appliedPhysicalReturnExchangeCount>=1)
const exchangedOldDeleted=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'product',watchProductId:exchangedBeforeRetireProduct,
 expectedCount:exchangedOldPreview.count,
 requestId:'watch-retire-old-exchange-20261104-0001'
}))
assert.equal(exchangedOldDeleted.status,200,JSON.stringify(exchangedOldDeleted))
const beforeBlockedExchange=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
const approvedArchiveExchangeCancel=await parse(cancelClient3WatchExchange(db,manager,1,
 oldExchangeOrder.orderId,exchangeBeforeDelete.id,{
 requestId:'watch-cancel-old-exchange-after-delete-20261104-0001',
 reason:'Отмена старого обмена с сохранением архивного склада',physicalLocation:'office'
}))
assert.equal(approvedArchiveExchangeCancel.status,200,JSON.stringify(approvedArchiveExchangeCancel))
assert.equal(approvedArchiveExchangeCancel.archivedStockPreserved,true)
assert(approvedArchiveExchangeCancel.stockReversals.some(x=>
 x.physicalReversalSkipped===true&&x.physicalReversalReason==='retired_identity'),
 'Main must cancel Exchange commercially without resurrecting retired stock')
assert.equal(sqlite.prepare('SELECT status FROM exchanges WHERE id=?')
 .get(exchangeBeforeDelete.id).status,'cancelled')
const cashAfterExchangeCancel=sqlite.prepare('SELECT total_amount,received_amount,return_amount FROM orders WHERE id=?')
 .get(oldExchangeOrder.orderId)
assert.equal(cashAfterExchangeCancel.total_amount,12000)
assert.equal(cashAfterExchangeCancel.received_amount,0,
 'Main must reverse exchange extra payment when its older SKU was retired')
assert.equal(cashAfterExchangeCancel.return_amount,0)
assert(sqlite.prepare('SELECT cancellation_comment FROM exchanges WHERE id=?')
 .get(exchangeBeforeDelete.id).cancellation_comment.includes('часы у продавца'),
 'Explicit seller custody must be retained by exchange cancellation')
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?')
 .get(exchangedBeforeRetireVariant.canonical).quantity,0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,
 beforeBlockedExchange)

// Work P1-02: create the same watch characteristics after exact retirement.
// Historical watch/canonical IDs and recorded movements must never reactivate.
const nextGeneration=await parse(registerWatchVariant(db,admin,1,{
 watchProductId:itemModel,gender:'male',movement:'quartz',
 braceletMaterial:'steel',dialColor:'black',braceletColor:''
}))
assert.equal(nextGeneration.status,201,JSON.stringify(nextGeneration))
assert.notEqual(nextGeneration.watchVariantId,item.id)
const nextCanonical=await parse(provisionClient3WatchSku(db,admin,1,nextGeneration.watchVariantId))
assert.equal(nextCanonical.status,200,JSON.stringify(nextCanonical))
assert.notEqual(nextCanonical.canonicalVariantId,item.canonical,
 'P1-02: new sales must never link to archived canonical SKU')
assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?')
 .get(item.id).is_active,0)
assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?')
 .get(item.canonical).is_active,0)
const repeatedCreation=await parse(registerWatchVariant(db,admin,1,{
 watchProductId:itemModel,gender:'male',movement:'quartz',
 braceletMaterial:'steel',dialColor:'black',braceletColor:''
}))
assert.equal(repeatedCreation.watchVariantId,nextGeneration.watchVariantId,
 'Active newest generation must win a lookup over older retired rows')

// Work P1-01: deterministically inject a real arrival AFTER the preview and
// synchronous preflight, immediately BEFORE the guarded D1 batch.
const raceModel=await model('WORK RACE EXACT SKU QA')
const raceVariant=await variant(raceModel)
const originalBatch=db.batch
db.batch=async statements=>{
 db.batch=originalBatch
 const received=await parse(receiveClient3WatchArrival(db,admin,1,{
  source:'office',watchVariantId:raceVariant.id,quantity:1,
  comment:'Concurrent arrival during delete',
  requestId:'work-race-exact-arrival-20261104-0001'
 }))
 assert.equal(received.status,200,JSON.stringify(received))
 return originalBatch(statements)
}
const racingDelete=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'variant',watchProductId:raceModel,watchVariantId:raceVariant.id,expectedCount:1
}))
db.batch=originalBatch
assert.equal(racingDelete.status,409,JSON.stringify(racingDelete))
assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?')
 .get(raceVariant.id).is_active,1)
assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?')
 .get(raceVariant.canonical).is_active,1)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?')
 .get(raceVariant.canonical).quantity,1)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_retirement_history_events WHERE variant_id=?')
 .get(raceVariant.canonical).n,0)

// Work P1-01 for execution groups: one concurrent arrival must prevent the
// deletion of BOTH canonical SKUs, not just the newly stocked one.
const groupModel=await model('WORK RACE EXECUTION QA')
const groupOne=await variant(groupModel)
const groupTwoResponse=await parse(registerWatchVariant(db,admin,1,{
 watchProductId:groupModel,gender:'female',movement:'quartz',
 braceletMaterial:'steel',dialColor:'black',braceletColor:''
}))
assert.equal(groupTwoResponse.status,201)
const groupTwoCanonical=await parse(provisionClient3WatchSku(db,admin,1,groupTwoResponse.watchVariantId))
assert.equal(groupTwoCanonical.status,200)
const groupPreview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'execution',watchProductId:groupModel,movement:'quartz',braceletMaterial:'steel'
}))
assert.equal(groupPreview.count,2)
db.batch=async statements=>{
 db.batch=originalBatch
 const received=await parse(receiveClient3WatchArrival(db,admin,1,{
  source:'office',watchVariantId:groupOne.id,quantity:1,
  comment:'Concurrent group arrival',
  requestId:'work-race-group-arrival-20261104-0001'
 }))
 assert.equal(received.status,200,JSON.stringify(received))
 return originalBatch(statements)
}
const groupRace=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'execution',watchProductId:groupModel,movement:'quartz',
 braceletMaterial:'steel',expectedCount:groupPreview.count
}))
db.batch=originalBatch
assert.equal(groupRace.status,409,JSON.stringify(groupRace))
for(const [wid,cid] of [
 [groupOne.id,groupOne.canonical],
 [groupTwoResponse.watchVariantId,groupTwoCanonical.canonicalVariantId]
]){
 assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(wid).is_active,1)
 assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(cid).is_active,1)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM catalog_retirement_history_events WHERE variant_id=?')
   .get(cid).n,0)
}
const groupStockPreview=await parse(previewClient3WatchDelete(db,admin,1,{
 kind:'execution',watchProductId:groupModel,movement:'quartz',braceletMaterial:'steel'
}))
assert.equal(groupStockPreview.canDelete,false)
assert.equal(groupStockPreview.physicalQuantity,1,'P2-02: execution stock not zero')
assert.equal(groupStockPreview.activeReservations,0)

// Work P2-01: pending watch physical return has no Main pending lifecycle.
// All three scopes must block retirement and preserve IDs.
const pendingModel=await model('WORK PENDING PHYSICAL RETURN QA')
const pendingVariant=await variant(pendingModel)
const pendingArrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:pendingVariant.id,quantity:1,
 comment:'Fixture for pending physical return',
 requestId:'work-pending-return-arrival-20261104-0001'
}))
assert.equal(pendingArrival.status,200)
const pendingOrder=await parse(createClient3WatchOrder(db,manager,1,{
 brand:'TAUWACH',source:'office',watchVariantId:pendingVariant.id,
 catalogVariantId:pendingVariant.canonical,quantity:1,unitPrice:12000,
 receivedAmount:0,payments:[],engravingText:'',
 requestId:'work-pending-return-order-20261104-0001',
 recipientName:'Тест ожидаемой приёмки',recipientPhone:'+77015550177',
 address:'Улица ожидаемой приёмки, 77',postalCode:'050077',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T14:00',
 urgent:false,paymentMethod:'KASPI GOLD'
}))
assert.equal(pendingOrder.status,201,JSON.stringify(pendingOrder))
const pendingLine=sqlite.prepare('SELECT id FROM order_items WHERE order_id=?')
 .get(pendingOrder.orderId)
const pendingShip=await parse(dispatchClient3WatchOrder(db,admin,1,pendingOrder.orderId,{
 requestId:'work-pending-return-dispatch-20261104-0001',
 items:[{orderItemId:pendingLine.id,quantity:1}]
}))
assert.equal(pendingShip.status,200,JSON.stringify(pendingShip))
const pendingReturn=await parse(createClient3WatchReturn(db,manager,1,pendingOrder.orderId,{
 requestId:'work-pending-physical-return-20261104-0001',
 kind:'items_only',amount:0,quantity:1,reason:'Получение часов пока ожидается',
 items:[{orderItemId:pendingLine.id,quantity:1,physicalState:'pending'}]
}))
assert.equal(pendingReturn.status,200,JSON.stringify(pendingReturn))
assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM return_items ri JOIN returns r ON r.id=ri.return_id
 WHERE r.order_id=? AND ri.physical_tracking=1 AND ri.physical_received_at IS NULL`)
 .get(pendingOrder.orderId).n,1)
for(const request of [
 {kind:'variant',watchProductId:pendingModel,watchVariantId:pendingVariant.id},
 {kind:'execution',watchProductId:pendingModel,movement:'quartz',braceletMaterial:'steel'},
 {kind:'product',watchProductId:pendingModel}
]){
 const preview=await parse(previewClient3WatchDelete(db,admin,1,request))
 assert.equal(preview.canDelete,false,JSON.stringify(preview))
 assert(preview.blockers.some(x=>x.includes('физическ')))
 const response=await parse(deleteClient3WatchCatalog(db,admin,1,{
  ...request,expectedCount:preview.count,
  ...(request.kind==='product'?{requestId:'watch-retire-pending-work-20261104-0001'}:{})
 }))
 assert.equal(response.status,409,JSON.stringify(response))
 assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?')
  .get(pendingVariant.canonical).is_active,1)
 assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?')
  .get(pendingVariant.id).is_active,1)
}

// Work P2-03: a SQL failure at the END of the canonical retirement batch
// rolls back watch shell, Main SKU, removal movement, operation and reserves.
const interruptedModel=await model('WORK ATOMIC PRODUCT RETIRE QA')
const interruptedVariant=await variant(interruptedModel)
const initStock=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:interruptedVariant.id,quantity:2,
 comment:'Atomic product retirement fixture',
 requestId:'work-atomic-product-arrival-20261104-0001'
}))
assert.equal(initStock.status,200)
const movementsBeforeFailure=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
db.batch=async statements=>{
 db.batch=originalBatch
 return originalBatch([...statements,db.prepare('INSERT INTO watch_products(id) VALUES(?)').bind(interruptedModel)])
}
const interruptedRequest={kind:'product',watchProductId:interruptedModel,expectedCount:1,
 requestId:'watch-retire-atomic-work-20261104-0001'}
const interruptedResult=await parse(deleteClient3WatchCatalog(db,admin,1,interruptedRequest))
db.batch=originalBatch
assert.equal(interruptedResult.status,409,JSON.stringify(interruptedResult))
assert.equal(sqlite.prepare('SELECT is_active FROM watch_products WHERE id=?').get(interruptedModel).is_active,1)
assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(interruptedVariant.id).is_active,1)
assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(interruptedVariant.canonical).is_active,1)
assert.equal(sqlite.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?').get(interruptedVariant.canonical).quantity,2)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,movementsBeforeFailure)
const interruptedRetry=await parse(deleteClient3WatchCatalog(db,admin,1,interruptedRequest))
assert.equal(interruptedRetry.status,200,JSON.stringify(interruptedRetry))
assert.equal(sqlite.prepare('SELECT is_active FROM watch_products WHERE id=?').get(interruptedModel).is_active,0)
assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?').get(interruptedVariant.canonical).is_active,0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,movementsBeforeFailure+1)

// Legacy interrupted operations are still resumable with Main's completed
// journal proof and MUST NOT create a second deletion movement.
const legacyModel=await model('WORK LEGACY INTERRUPTED RETIRE QA')
const legacyVariant=await variant(legacyModel)
const legacyArrival=await parse(receiveClient3WatchArrival(db,admin,1,{
 source:'office',watchVariantId:legacyVariant.id,quantity:2,
 comment:'Old two-phase interruption fixture',
 requestId:'work-legacy-product-arrival-20261104-0001'
}))
assert.equal(legacyArrival.status,200)
const legacyCanonical=sqlite.prepare('SELECT catalog_product_id FROM watch_products WHERE id=?')
 .get(legacyModel).catalog_product_id
await retireCatalogEntity(db,'product',legacyCanonical,{
 requestId:'watch-retire-legacy-work-20261104-0001'
})
assert.equal(sqlite.prepare('SELECT is_active FROM watch_products WHERE id=?').get(legacyModel).is_active,1)
const legacyMovementCount=sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n
const legacyRecovered=await parse(deleteClient3WatchCatalog(db,admin,1,{
 kind:'product',watchProductId:legacyModel,expectedCount:1,
 requestId:'watch-retire-legacy-recovery-20261104-0001'
}))
assert.equal(legacyRecovered.status,200,JSON.stringify(legacyRecovered))
assert.equal(sqlite.prepare('SELECT is_active FROM watch_products WHERE id=?').get(legacyModel).is_active,0)
assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?').get(legacyVariant.id).is_active,0)
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,legacyMovementCount)
// Work retest P1-02: the exact reported failures, across arbitrary
// generations and BOTH real Client3 watch brands. v5 historical attributes
// must never be updated/deleted; v6 carries new truth without a global UNIQUE.
sqlite.prepare(`INSERT OR IGNORE INTO watch_reference_values(kind,value)
 VALUES('leatherColors','ЧЕРНЫЙ')`).run()
const generationCases=[
 {brandId:1,brand:'TAUWACH',model:'WORK GEN 5 STEEL BLACK QA',
   attrs:{gender:'male',movement:'quartz',braceletMaterial:'steel',
     dialColor:'black',braceletColor:''}},
 {brandId:2,brand:'WACHIZEN',model:'WORK GEN 5 RUBBER WHITE QA',
   attrs:{gender:'female',movement:'quartz',braceletMaterial:'rubber',
     dialColor:'white',braceletColor:''}},
 {brandId:2,brand:'WACHIZEN',model:'WORK GEN 5 LEATHER WHITE QA',
   attrs:{gender:'female',movement:'quartz',braceletMaterial:'leather',
     dialColor:'white',braceletColor:'ЧЕРНЫЙ'}},
]
for(const scenario of generationCases){
 const entry=await parse(registerWatchModel(db,admin,scenario.brandId,{
   modelName:scenario.model
 }))
 assert.equal(entry.status,201,JSON.stringify(entry))
 const productId=entry.watchProductId
 const watchIds=[],canonicalIds=[]
 for(let generation=1;generation<=5;generation++){
   const added=await parse(registerWatchVariant(db,admin,scenario.brandId,{
     watchProductId:productId,...scenario.attrs
   }))
   assert.equal(added.status,201,
     'P1-02 '+scenario.model+' generation '+generation+': '+JSON.stringify(added))
   assert(!watchIds.includes(added.watchVariantId),'Watch ID must be new generation')
   const linked=await parse(provisionClient3WatchSku(db,admin,
     scenario.brandId,added.watchVariantId))
   assert.equal(linked.status,200,JSON.stringify(linked))
   assert(!canonicalIds.includes(linked.canonicalVariantId),
     'Archived canonical SKU may never be resurrected')
   watchIds.push(added.watchVariantId)
   canonicalIds.push(linked.canonicalVariantId)
   const repeat=await parse(registerWatchVariant(db,admin,scenario.brandId,{
     watchProductId:productId,...scenario.attrs
   }))
   assert.equal(repeat.status,200,JSON.stringify(repeat))
   assert.equal(repeat.watchVariantId,added.watchVariantId)
   assert.equal(repeat.alreadyExists,true)
   const listed=await parse(listWatchCatalogDrafts(db,admin,scenario.brandId))
   const history=listed.rows.filter(x=>x.watchProductId===productId)
   assert.equal(history.length,generation)
   const expectedActive=history.filter(x=>x.variantActive===1)
   assert.equal(expectedActive.length,1)
   assert.equal(expectedActive[0].watchVariantId,added.watchVariantId)
   for(const row of history){
     assert.equal(row.movement,scenario.attrs.movement)
     assert.equal(row.braceletMaterial,scenario.attrs.braceletMaterial)
     assert.equal(row.dialColor,scenario.attrs.dialColor)
     assert.equal(row.braceletColor,scenario.attrs.braceletColor,
       'Every historical watch generation keeps the actual strap color')
   }
   if(generation<5){
     const preview=await parse(previewClient3WatchDelete(db,admin,scenario.brandId,{
       kind:'variant',watchProductId:productId,watchVariantId:added.watchVariantId
     }))
     assert.equal(preview.status,200,JSON.stringify(preview))
     assert.equal(preview.canDelete,true,JSON.stringify(preview))
     const retired=await parse(deleteClient3WatchCatalog(db,admin,scenario.brandId,{
       kind:'variant',watchProductId:productId,
       watchVariantId:added.watchVariantId,expectedCount:preview.count,
     }))
     assert.equal(retired.status,200,JSON.stringify(retired))
     assert.equal(sqlite.prepare('SELECT is_active FROM watch_variants WHERE id=?')
       .get(added.watchVariantId).is_active,0)
     assert.equal(sqlite.prepare('SELECT is_active FROM catalog_variants WHERE id=?')
       .get(linked.canonicalVariantId).is_active,0)
   }
 }
 assert.equal(new Set(watchIds).size,5)
 assert.equal(new Set(canonicalIds).size,5)
 const all=sqlite.prepare(`SELECT v.id,v.is_active,v.catalog_variant_id
   FROM watch_variants v WHERE v.watch_product_id=? ORDER BY v.id`).all(productId)
 assert.deepEqual(all.map(x=>x.is_active),[0,0,0,0,1])
 const finalId=watchIds[4],finalCanonical=canonicalIds[4]
 const arrival=await parse(receiveClient3WatchArrival(db,admin,scenario.brandId,{
   source:'office',watchVariantId:finalId,quantity:2,
   comment:'Fifth-generation physical arrival',
   requestId:'work-v6-arrival-'+scenario.brandId+'-'+productId+'-20261104',
 }))
 assert.equal(arrival.status,200,JSON.stringify(arrival))
 const order=await parse(createClient3WatchOrder(db,admin,scenario.brandId,{
   brand:scenario.brand,source:'office',
   watchVariantId:finalId,catalogVariantId:finalCanonical,
   quantity:1,unitPrice:14000,receivedAmount:0,payments:[],
   engravingText:'',
   requestId:'work-v6-order-'+scenario.brandId+'-'+productId+'-20261104',
   recipientName:'Проверка пятого поколения',recipientPhone:'+77015550188',
   address:'Улица испытания поколений, 88',postalCode:'050088',
   city:'Алматы',deliveryMethod:'Казпочта',
   shippingDeadlineLocal:'2026-11-15T14:00',urgent:false,paymentMethod:'KASPI GOLD'
 }))
 assert.equal(order.status,201,JSON.stringify(order))
 const orderRow=sqlite.prepare('SELECT variant_id FROM order_items WHERE order_id=?')
   .get(order.orderId)
 assert.equal(orderRow.variant_id,finalCanonical)
 assert(!canonicalIds.slice(0,4).includes(orderRow.variant_id))
 assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM inventory_movements
   WHERE variant_id IN (${canonicalIds.slice(0,4).map(()=>'?').join(',')})`)
   .get(...canonicalIds.slice(0,4)).n,0,
   'Old generation must not gain new movements')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE variant_id=?')
   .get(finalCanonical).n,1,'Fifth generation has exactly one arrival')
}
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_MAIN_CATALOG_RETIREMENT_PASS: full+partial archived dispatch, idempotent correction, no second stock mutation, old sales history and brand isolation')
