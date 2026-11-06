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
 const result=await listOrderSourcePicker(db)
 assert.equal(result.ok,true)
 const row=result.variants.find(x=>x.variantId===99101)
 assert(row,'Active catalog variant must be offered')
 assert.deepEqual(row.warehouse,{physical:30,reserved:10,cachedReserved:9,free:20})
 assert.deepEqual(row.boutique,{physical:0,reserved:0,cachedReserved:0,free:0})
 const original=normalizeOrderItems([{productName:'ТЕСТОВЫЙ ШАПАН',color:'СИНИЙ',size:'44',
   gender:'ЖЕН',material:'АТЛАС',length:'КОРОТКИЙ',quantity:1,sourceType:'warehouse',catalogVariantId:99101}], 'warehouse')
 const pinned=await hydratePickedOrderItems(db,original)
 assert.equal(pinned[0].catalogVariantId,99101)
 assert.equal(pinned[0].catalogProductId,99100)
 assert.equal(pinned[0].color,'СИНИЙ')
 const workshop=normalizeOrderItems([{productName:'ТЕСТОВЫЙ ШАПАН',color:'СИНИЙ',size:'44',
   quantity:1,sourceType:'workshop',catalogVariantId:99101,workshopComment:'Укоротить рукав'}],'warehouse')
 await hydratePickedOrderItems(db,workshop)
 assert.equal(workshop[0].sourceType,'workshop')
 assert.equal(workshop[0].catalogProductId,99100)
 assert.equal(workshop[0].workshopComment,'Укоротить рукав')
 const wrong=normalizeOrderItems([{productName:'ДРУГОЙ ТОВАР',color:'СИНИЙ',size:'44',quantity:1,
   sourceType:'warehouse',catalogVariantId:99101}],'warehouse')
 await assert.rejects(hydratePickedOrderItems(db,wrong),/Характеристики выбранного товара изменились/)
 sql.prepare("UPDATE catalog_variants SET is_active=0 WHERE id=99101").run()
 await assert.rejects(hydratePickedOrderItems(db,original),/больше не активен/)

 const source=fs.readFileSync('src/features/sections/CreateOrderSection.tsx','utf8')
 const app=fs.readFileSync('src/App.tsx','utf8')
 const worker=fs.readFileSync('worker/domains/orders-write.ts','utf8')
 assert(source.includes('MainOrderSourcePicker')&&source.includes('MainPickedOrderLine'))
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
  for(const term of ['Склад','Бутик','Свободные','Весь каталог','Индивидуальный заказ в цех','ТЕСТОВЫЙ ШАПАН']){
   assert(html.includes(term),'Missing picker UI '+term)
  }
 }finally{await server.close()}
 console.log('MAIN_SOURCE_FIRST_PICKER_PASS: catalog SKU pin, active reserves, shortage/workshop, drift, read-only')
}finally{sql.close()}
