import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {registerWatchModel,registerWatchVariant,listWatchCatalogDrafts} from '../../worker/domains/client3-watch-catalog.ts'
import {provisionClient3WatchSku} from '../../worker/domains/client3-watch-provision.ts'
import {receiveClient3WatchArrival} from '../../worker/domains/client3-watch-inventory.ts'
import {createClient3WatchOrder} from '../../worker/domains/client3-watch-create.ts'
import {listClient3WatchDemandReport} from '../../worker/domains/client3-watch-demand-report.ts'
import {previewClient3WatchDelete,deleteClient3WatchCatalog,listClient3WatchRetiredCatalog} from '../../worker/domains/client3-watch-catalog-delete.ts'

const app=fs.readFileSync('src/WatchClient3App.tsx','utf8')
const nav=app.match(/<div className="warehouse-w2-primary"[\\s\\S]*?\]\.map\(item/g)?.[0]||app
assert(nav.indexOf("section:'statistics'")>nav.indexOf("section:'revision'")&&
 nav.indexOf("section:'statistics'")<nav.indexOf("section:'history'"),
 'Statistics must immediately precede History in the warehouse navigation')
const catalogUI=fs.readFileSync('src/features/client3/WatchCatalogEditor.tsx','utf8')
assert(catalogUI.includes('<WatchCatalogRetiredHistory brand={brand}/>'),
 'Main-style archived watch catalog must be reachable from Products')
const deleteUI=fs.readFileSync('src/features/client3/WatchCatalogDeleteAction.tsx','utf8')
assert(deleteUI.includes('inventoryWillBeRemoved')&&
 deleteUI.includes('reservationsWillBeReleased')&&
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
 receivedAmount:0,payments:[],engravingText:'',
 requestId:'watch-retire-order-history-20261104-0001',
 recipientName:'Тест истории товара',recipientPhone:'+77015550101',
 address:'Улица истории, 1',postalCode:'050001',city:'Алматы',
 deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T14:00',
 urgent:false,paymentMethod:'KASPI GOLD'
}))
assert.equal(historyOrder.status,201,JSON.stringify(historyOrder))
const orderLine=sqlite.prepare('SELECT id,variant_id FROM order_items WHERE order_id=?')
 .get(historyOrder.orderId)
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
assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[])
sqlite.close()
console.log('CLIENT3_MAIN_CATALOG_RETIREMENT_PASS: exact SKU, physical product retirement, movement ledger, brand isolation, archive and no resurrection')
