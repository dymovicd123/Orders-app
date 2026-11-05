import assert from 'node:assert/strict'
import React from 'react'
import fs from 'node:fs'
import {renderToStaticMarkup} from 'react-dom/server'
import {createServer} from 'vite'
import react from '@vitejs/plugin-react'
import {DatabaseSync} from 'node:sqlite'
import {findUnavailableWatchStockSelections} from '../../worker/domains/client3-watch-order-availability.ts'

const formSource=fs.readFileSync('src/features/client3/WatchOrderForm.tsx','utf8')
const pickerSource=fs.readFileSync('src/features/client3/WatchOrderSourcePicker.tsx','utf8')
const editorSource=fs.readFileSync('src/features/client3/WatchOrderLineEditor.tsx','utf8')
const pickerCSS=fs.readFileSync('src/styles/client3-watch-source-picker-refine.css','utf8')
const modalCSS=fs.readFileSync('src/styles/client3-watch-line-editor.css','utf8')
const serverSource=fs.readFileSync('worker/domains/client3-watch-create.ts','utf8')
const modelSource=fs.readFileSync('worker/domains/client3-watches.ts','utf8')
assert(editorSource.includes('role="dialog"')&&editorSource.includes('aria-modal="true"'))
assert(editorSource.includes('rows={6}')&&editorSource.includes('maxLength={500}'))
assert(editorSource.includes('SmartPickerInput')&&editorSource.includes('Название модели *'))
assert(!formSource.includes('<select value={line.source}'),'No duplicate source selection in cart')
assert(pickerSource.includes('aria-label="Поиск модели или характеристик"'))
assert(!pickerSource.includes('>Под заказ<'))
assert(pickerCSS.includes('max-width:380px'),'Search input stays reasonably compact')
assert(modalCSS.includes('width:min(880px,100%)'),'Editor must use a wide separate dialog')
assert(formSource.includes('watchVariantId:line.kind==='))
assert(formSource.includes('orderMode:line.kind'))
assert(formSource.includes('catalogVariantId:line.catalogVariantId'))
assert(formSource.includes('line.kind===\'manual\'?{manual:'))
assert(formSource.includes('kind:\'preorder\''))
assert(formSource.includes('onManual={addManual}')&&formSource.includes('setEditingId(item.id)'))
assert(formSource.includes('sourceAvailable(x,line.source)>=(allocated'))
assert(formSource.includes('Цена продажи, ₸')&&formSource.includes('Указать цену'))
assert(formSource.includes('WatchOrderLineEditor')&&formSource.includes('Гравировка и детали'))
assert(formSource.includes('setBrand(e.target.value as WatchBrand);setSource(\'office\');setLines([])'))
assert(serverSource.includes("findUnavailableWatchStockSelections(db,checked"))
assert(serverSource.includes("if(!inFlight)"))
assert(serverSource.includes("WATCH_STOCK_CHANGED"))
assert(serverSource.includes("WATCH_SKU_STALE"))
assert(serverSource.includes("ensureManualWatchOrderSku"))
assert(modelSource.includes("r.status='active'"))
assert(modelSource.includes('sp.is_active=1'))
assert(pickerSource.includes("intent==='all'||sourceAvailable(x,source)>0"))
assert(pickerSource.includes("catalogVariantId>0&&x.watchVariantId>0"))

const catalog=[
 {brand:'TAUWACH',watchProductId:101,watchVariantId:1001,catalogVariantId:3001,
  modelName:'ORYS',gender:'male',movement:'quartz',braceletMaterial:'steel',
  dialColor:'black',braceletColor:'',officePhysical:4,officeReserved:1,
  showcasePhysical:0,showcaseReserved:0,catalogPriceSnapshot:60000},
 {brand:'TAUWACH',watchProductId:101,watchVariantId:1002,catalogVariantId:3002,
  modelName:'ORYS',gender:'male',movement:'quartz',braceletMaterial:'leather',
  dialColor:'white',braceletColor:'ЧЁРНЫЙ',officePhysical:0,officeReserved:0,
  showcasePhysical:3,showcaseReserved:2,catalogPriceSnapshot:62000},
 {brand:'WACHIZEN',watchProductId:102,watchVariantId:2001,catalogVariantId:4001,
  modelName:'ARYSTAN',gender:'female',movement:'mechanical',braceletMaterial:'rubber',
  dialColor:'silver',braceletColor:'',officePhysical:5,officeReserved:0,
  showcasePhysical:0,showcaseReserved:0,catalogPriceSnapshot:65000},
]
const server=await createServer({configFile:false,plugins:[react()],appType:'custom',server:{middlewareMode:true},logLevel:'error'})
try{
 const {WatchOrderSourcePicker,sourceAvailable,stockKey}=await server.ssrLoadModule('/src/features/client3/WatchOrderSourcePicker.tsx')
 assert.equal(sourceAvailable(catalog[0],'office'),3)
 assert.equal(sourceAvailable(catalog[0],'showcase'),0)
 assert.equal(sourceAvailable(catalog[1],'office'),0)
 assert.equal(sourceAvailable(catalog[1],'showcase'),1)
 assert.equal(stockKey('office',1001),'office:1001')
 const html=renderToStaticMarkup(React.createElement(WatchOrderSourcePicker,{
   brand:'TAUWACH',source:'office',catalog,allocated:new Map(),onSourceChange:()=>{},
   onAdd:()=>{},onManual:()=>{},
 }))
 assert(html.includes('ORYS'),'In-stock model is shown')
 assert(!html.includes('ARYSTAN'),'Brand isolation')
 assert(html.includes('3 свободно'),'Available stock subtracts existing reservations')
 assert(!html.includes('62 000'),'Zero-stock variants hidden from ordinary stock selection')
 assert(html.includes('Весь каталог')&&html.includes('Свои характеристики')&&html.includes('Создать позицию вручную'))
 const empty=renderToStaticMarkup(React.createElement(WatchOrderSourcePicker,{
   brand:'TAUWACH',source:'showcase',catalog:[catalog[0]],allocated:new Map(),
   onSourceChange:()=>{},onAdd:()=>{},onManual:()=>{},
 }))
 assert(empty.includes('свободных часов нет'),'Empty source has clear next action')
 const {WatchOrderForm}=await server.ssrLoadModule('/src/features/client3/WatchOrderForm.tsx')
 const frm=renderToStaticMarkup(React.createElement(WatchOrderForm,{
   allowedBrands:['TAUWACH','WACHIZEN'],catalog,deliveryMethods:['Казпочта','Курьер'],
   onSave:async()=>{},references:{movements:[],bracelets:[],dials:[],leatherColors:[],cities:[]}
 }))
 for(const s of ['Выберите бренд','Клиент и условия заказа','Товары заказа','Менеджер и оплаты','Проверка заказа',
  'Адрес','Индекс','Отправить до','Дата заказа','Срочный заказ']){
   assert(frm.includes(s),'Missing create flow '+s)
 }
 assert(!frm.includes('watch-pick-model-head'),'Unscoped catalog must not leak before brand')
 assert(frm.includes('disabled'),'No empty order submission')
}finally{await server.close()}

const sql=new DatabaseSync(':memory:')
sql.exec("CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER)")
sql.exec("CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,status TEXT)")
sql.exec("INSERT INTO inventory_stock(inventory_source,variant_id,quantity,reserved_quantity) VALUES('warehouse',3001,4,1),('boutique',3001,2,1),('warehouse',3002,0,0)")
sql.exec("INSERT INTO inventory_reservations(inventory_source,variant_id,quantity,status) VALUES('warehouse',3001,2,'active'),('warehouse',3001,9,'fulfilled'),('boutique',3001,1,'active')")
const prepare=(statement,args=[])=>({
 bind(...values){return prepare(statement,values)},
 async first(){return sql.prepare(statement).get(...args)||null},
})
const db={prepare}
try{
 assert.deepEqual(await findUnavailableWatchStockSelections(db,[{source:'office',variantId:3001,quantity:2}]),[])
 const short=await findUnavailableWatchStockSelections(db,[
   {source:'office',variantId:3001,quantity:1},
   {source:'office',variantId:3001,quantity:2},
 ])
 assert.equal(short.length,1)
 assert.equal(short[0].available,2,'Active reservations override stale inventory reserved field')
 assert.equal(short[0].requested,3,'Two cart lines on same SKU must aggregate')
 assert.deepEqual(await findUnavailableWatchStockSelections(db,[{source:'showcase',variantId:3001,quantity:1}]),[])
 assert.equal((await findUnavailableWatchStockSelections(db,[{source:'office',variantId:3002,quantity:1}]))[0].available,0)
 assert.deepEqual(await findUnavailableWatchStockSelections(db,[]),[])
}finally{sql.close()}
console.log('CLIENT3_SOURCE_FIRST_ORDER_PICKER_PASS: brand, office/showcase, free stock, zero stock, manual, idempotence, group preflight')
