import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import fs from 'node:fs'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import {listOrderSourcePicker,hydratePickedOrderItems} from '../worker/domains/order-source-picker.ts'
import {normalizeOrderItems} from '../worker/domains/order-core.ts'

const sql=new DatabaseSync(':memory:')
for(const migration of fs.readdirSync('migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())
 sql.exec(fs.readFileSync('migrations/'+migration,'utf8'))
const stmt=(query,values=[])=>({
 bind(...args){return stmt(query,args)},
 async first(){return sql.prepare(query).get(...values)||null},
 async all(){return {results:sql.prepare(query).all(...values)}},
 async run(){const meta=sql.prepare(query).run(...values);return {meta:{changes:Number(meta.changes)}}},
})
const db={prepare:query=>stmt(query)}
try{
 sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(99100,'ТЕСТОВЫЙ ШАПАН','adult',1)").run()
 sql.prepare("INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label,is_active) VALUES(99101,99100,'adult','ЖЕН','СИНИЙ','АТЛАС','КОРОТКИЙ','44',1)").run()
 sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity) VALUES('warehouse',99100,99101,'ТЕСТОВЫЙ ШАПАН',30,9)").run()
 sql.prepare("INSERT INTO managers(id,name) VALUES(99199,'Source picker QA')").run()
 for(const id of [99110,99111]){
  sql.prepare("INSERT INTO orders(id,external_id,order_date,manager_id,source_type,order_status,created_at,updated_at) VALUES(?,?,'2026-11-06',99199,'warehouse','active','2026-11-06T00:00:00Z','2026-11-06T00:00:00Z')").run(id,'QA-PICK-'+id)
 }
 for(const [id,orderId] of [[99120,99110],[99121,99111]]){
  sql.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status) VALUES(?,?,'ТЕСТОВЫЙ ШАПАН',10,0,0,0,'warehouse','reserved')").run(id,orderId)
 }
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(99110,99120,'warehouse',99100,99101,10,'active','2026-11-06T00:00:00Z','2026-11-06T00:00:00Z')").run()
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(99111,99121,'warehouse',99100,99101,5,'fulfilled','2026-11-06T00:00:00Z','2026-11-06T00:00:00Z')").run()
 sql.prepare("INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label,is_active) VALUES(99102,99100,'adult','ЖЕН','КРАСНЫЙ','АТЛАС','КОРОТКИЙ','48',1)").run()
 sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity) VALUES('warehouse',99100,99102,'ТЕСТОВЫЙ ШАПАН',-2,1)").run()
 sql.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status) VALUES(99122,99110,'ТЕСТОВЫЙ ШАПАН',1,0,0,0,'warehouse','reserved')").run()
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(99110,99122,'warehouse',99100,99102,1,'active','2026-11-06T00:00:00Z','2026-11-06T00:00:00Z')").run()
 const result=await listOrderSourcePicker(db)
 assert.equal(result.ok,true)
 const row=result.variants.find(x=>x.variantId===99101)
 assert(row,'Active catalog variant must be offered')
 assert.deepEqual(row.warehouse,{physical:30,reserved:10,cachedReserved:9,listed:true,free:20})
 assert.deepEqual(row.boutique,{physical:0,reserved:0,cachedReserved:0,listed:false,free:0})
 assert.deepEqual(result.variants.find(x=>x.variantId===99102)?.warehouse,{physical:-2,reserved:1,cachedReserved:1,listed:true,free:0},'Do not conceal negative physical stock or overbooked active reservations')
 const original=normalizeOrderItems([{productName:'ТЕСТОВЫЙ ШАПАН',color:'СИНИЙ',size:'44',
   gender:'ЖЕН',material:'АТЛАС',length:'КОРОТКИЙ',quantity:1,sourceType:'warehouse',catalogVariantId:99101}], 'warehouse')
 const pinned=await hydratePickedOrderItems(db,original)
 assert.equal(pinned[0].catalogVariantId,99101)
 assert.equal(pinned[0].catalogProductId,99100)
 assert.equal(pinned[0].color,'СИНИЙ')
 const workshop=normalizeOrderItems([{productName:'ТЕСТОВЫЙ ШАПАН',color:'СИНИЙ',size:'44',
   gender:'ЖЕН',material:'АТЛАС',length:'КОРОТКИЙ',quantity:1,sourceType:'workshop',
   catalogVariantId:99101,workshopComment:'Укоротить рукав'}],'warehouse')
 await hydratePickedOrderItems(db,workshop)
 assert.equal(workshop[0].sourceType,'workshop')
 assert.equal(workshop[0].catalogProductId,99100)
 assert.equal(workshop[0].workshopComment,'Укоротить рукав')
 const wrong=normalizeOrderItems([{productName:'ДРУГОЙ ТОВАР',color:'СИНИЙ',size:'44',quantity:1,
   sourceType:'warehouse',catalogVariantId:99101}],'warehouse')
 await assert.rejects(hydratePickedOrderItems(db,wrong),/Характеристики выбранного товара изменились/)
 // A mistaken SKU must never rewrite another execution or sex silently.
 for(const [field,value] of [['gender','МУЖ'],['material','ЗАМША ВЕЛЮР'],['length','ДЛИННЫЙ'],['size','46']]){
  const changed=normalizeOrderItems([{
   productName:'ТЕСТОВЫЙ ШАПАН',gender:'ЖЕН',material:'АТЛАС',length:'КОРОТКИЙ',
   color:'СИНИЙ',size:'44',quantity:1,sourceType:'warehouse',catalogVariantId:99101,
   [field]:value,
  }],'warehouse')
  await assert.rejects(hydratePickedOrderItems(db,changed),
   /Характеристики выбранного товара изменились/,'SKU mismatch must reject '+field)
 }
 // Live Main equivalent: collar SKU stores literal size "0" and the boutique reservation is on that same ID.
 sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(99150,'QA ВОРОТНИК','adult',1)").run()
 sql.prepare("INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label,is_active) VALUES(99151,99150,'adult','ЖЕН','ГОЛУБОЙ','ДЖИНСА','СТАНДАРТ','0',1)").run()
 sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity) VALUES('boutique',99150,99151,'QA ВОРОТНИК',1,1)").run()
 sql.prepare("INSERT INTO order_items(id,order_id,product_name_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status) VALUES(99123,99110,'QA ВОРОТНИК',1,0,0,0,'boutique','reserved')").run()
 sql.prepare("INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at) VALUES(99110,99123,'boutique',99150,99151,1,'active','2026-11-06T00:00:00Z','2026-11-06T00:00:00Z')").run()
 const collar=(await listOrderSourcePicker(db)).variants.find(value=>value.variantId===99151)
 assert.equal(collar.size,'0')
 assert.deepEqual(collar.boutique,{physical:1,reserved:1,cachedReserved:1,listed:true,free:0})
 const collarDraft=normalizeOrderItems([{productName:'QA ВОРОТНИК',audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',
   color:'ГОЛУБОЙ',material:'ДЖИНСА',length:'СТАНДАРТ',size:'0',
   quantity:1,sourceType:'boutique',catalogVariantId:99151}],'warehouse')
 const collarPinned=await hydratePickedOrderItems(db,collarDraft)
 assert.equal(collarPinned[0].catalogVariantId,99151)
 assert.equal(collarPinned[0].inventorySource,'boutique')
 assert.equal(collarPinned[0].size,'0')
 const wrongNoSize=normalizeOrderItems([{productName:'QA ВОРОТНИК',audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',
   color:'ГОЛУБОЙ',material:'ДЖИНСА',length:'СТАНДАРТ',size:'БЕЗ РАЗМЕРА',
   quantity:1,sourceType:'boutique',catalogVariantId:99151}],'warehouse')
 await assert.rejects(hydratePickedOrderItems(db,wrongNoSize),/Характеристики выбранного товара изменились/)

 // Existing catalog's literal size STANDARD is an actual size, not a
 // fallback for absent sizes, zero size, material or standard length.
 sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(99160,'QA ЭТНО ПОНЧО','adult',1)").run()
 sql.prepare("INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label,is_active) VALUES(99161,99160,'adult','ЖЕН','ЧЕРНЫЙ','КАШЕМИР','СТАНДАРТ','СТАНДАРТ',1)").run()
 sql.prepare("INSERT INTO catalog_variants(id,product_id,category,gender,color,material,length,size_label,is_active) VALUES(99162,99160,'adult','ЖЕН','ЧЕРНЫЙ','КАШЕМИР','СТАНДАРТ','',1)").run()
 sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity) VALUES('boutique',99160,99161,'QA ЭТНО ПОНЧО',4,0)").run()
 sql.prepare("INSERT INTO inventory_stock(inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity) VALUES('boutique',99160,99162,'QA ЭТНО ПОНЧО',1,0)").run()
 const options=(await listOrderSourcePicker(db)).variants
 const standardOption=options.find(x=>x.variantId===99161)
 const noSizeOption=options.find(x=>x.variantId===99162)
 assert.equal(standardOption.size,'СТАНДАРТ')
 assert.equal(noSizeOption.size,'')
 assert.equal(standardOption.boutique.free,4)
 assert.equal(noSizeOption.boutique.free,1)
 const exactStandard=normalizeOrderItems([{productName:'QA ЭТНО ПОНЧО',audienceType:'ВЗРОСЛЫЙ',
  gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'КАШЕМИР',length:'СТАНДАРТ',size:'СТАНДАРТ',
  sourceType:'boutique',quantity:2,catalogVariantId:99161}],'warehouse')
 const pinnedStandard=await hydratePickedOrderItems(db,exactStandard)
 assert.equal(pinnedStandard[0].catalogVariantId,99161)
 assert.equal(pinnedStandard[0].size,'СТАНДАРТ')
 assert.equal(pinnedStandard[0].inventorySource,'boutique')
 const exactEmpty=normalizeOrderItems([{productName:'QA ЭТНО ПОНЧО',audienceType:'ВЗРОСЛЫЙ',
  gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'КАШЕМИР',length:'СТАНДАРТ',size:'',
  sourceType:'boutique',quantity:1,catalogVariantId:99162}],'warehouse')
 const pinnedEmpty=await hydratePickedOrderItems(db,exactEmpty)
 assert.equal(pinnedEmpty[0].catalogVariantId,99162)
 assert.equal(pinnedEmpty[0].size,'')
 const swappedStandard=normalizeOrderItems([{productName:'QA ЭТНО ПОНЧО',audienceType:'ВЗРОСЛЫЙ',
  gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'КАШЕМИР',length:'СТАНДАРТ',size:'БЕЗ РАЗМЕРА',
  sourceType:'boutique',quantity:1,catalogVariantId:99161}],'warehouse')
 await assert.rejects(hydratePickedOrderItems(db,swappedStandard),
  /Характеристики выбранного товара изменились/,
  'Never let no-size text use STANDARD SKU')
 const swappedEmpty=normalizeOrderItems([{productName:'QA ЭТНО ПОНЧО',audienceType:'ВЗРОСЛЫЙ',
  gender:'ЖЕН',color:'ЧЕРНЫЙ',material:'КАШЕМИР',length:'СТАНДАРТ',size:'СТАНДАРТ',
  sourceType:'boutique',quantity:1,catalogVariantId:99162}],'warehouse')
 await assert.rejects(hydratePickedOrderItems(db,swappedEmpty),
  /Характеристики выбранного товара изменились/,
  'Never silently use empty-size SKU for STANDARD item')
 sql.prepare("UPDATE catalog_variants SET is_active=0 WHERE id=99101").run()
 await assert.rejects(hydratePickedOrderItems(db,original),/больше не активен/)

 const source=fs.readFileSync('src/features/sections/CreateOrderSection.tsx','utf8')
 const app=fs.readFileSync('src/App.tsx','utf8')
 const worker=fs.readFileSync('worker/domains/orders-write.ts','utf8')
 assert(source.includes('MainClothingSourcePicker')&&source.includes('MainPickedOrderLine'))
 assert(!source.includes('type="button" onClick={startManual}'),'Manual workshop button must occur once in picker only')
 assert(app.includes('catalogVariantId: item.catalogVariantId || undefined'))
 assert(worker.includes('await hydratePickedOrderItems'))
 assert(worker.includes('item.catalogVariantId>0'))

 // Render the Client3-style source picker in isolation with a live quantity model.
 const server=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true},logLevel:'error'})
 try{
  const {MainOrderSourcePicker,freeAfterDraft,pickerKey}=await server.ssrLoadModule('/src/features/orders/MainOrderSourcePicker.tsx')
  assert.equal(freeAfterDraft(row,'warehouse',new Map()),20)
  assert.equal(freeAfterDraft(row,'warehouse',new Map([[pickerKey('warehouse',row.variantId),5]])),15)
  assert.equal(freeAfterDraft(row,'boutique',new Map()),0)
  const html=renderToStaticMarkup(React.createElement(MainOrderSourcePicker,
    {initialVariants:[row],allocated:new Map(),onPick:()=>{},onManual:()=>{}}))
  for(const term of ['Склад','Бутик','Свободные','Весь каталог','Индивидуальный заказ в цех','ТЕСТОВЫЙ ШАПАН','Поиск по названию товара']){
   assert(html.includes(term),'Missing picker UI '+term)
  }
 }finally{await server.close()}
 console.log('MAIN_SOURCE_FIRST_PICKER_PASS: catalog SKU pin, active reserves, shortage/workshop, drift, read-only')
}finally{sql.close()}
