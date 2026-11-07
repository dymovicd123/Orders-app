import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {normalizeOrderItems} from '../worker/domains/order-core.ts'
import {resolveCatalogProductAndVariantV2} from '../worker/domains/order-reservations.ts'

const code=path=>fs.readFileSync(path,'utf8')
const order=code('worker/domains/orders-write.ts')
const exchange=code('worker/domains/returns-exchanges.ts')
const background=code('worker/domains/catalog-review.ts')
const sales=[
  ['order create/retry/edit',order,4],
  ['exchange replacement',exchange,2],
  ['background queue',background,2],
]
for(const [label,source,count] of sales){
 const hits=(source.match(/createMissing: false/g)||[]).length
 assert(hits>=count,label+' must remain explicitly read-only at its runtime resolution sites; seen '+hits)
}
const catalog=code('worker/domains/catalog.ts')
assert(catalog.includes('export async function createCatalogVariant('),'Dedicated catalog creation must remain')
assert(catalog.includes('Такая комбинация товара уже существует'),'Explicit catalog creation must reject duplicate SKU')
const stocktake=code('worker/domains/inventory-stocktake.ts')
assert(stocktake.includes('createFields.has(field)'),'Stocktake creation requires explicit new-reference decision')

const sql=new DatabaseSync(':memory:')
try {
 for(const file of fs.readdirSync('migrations').filter(n=>/^\d+.*\.sql$/.test(n)).sort())
   sql.exec(fs.readFileSync('migrations/'+file,'utf8'))
 const stmt=(text,values=[])=>({
  bind(...v){return stmt(text,v)},
  async first(){return sql.prepare(text).get(...values)||null},
  async all(){return {results:sql.prepare(text).all(...values)}},
  async run(){const r=sql.prepare(text).run(...values);return {success:true,meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid||0)}}}
 })
 const db={prepare:text=>stmt(text)}
 const p=99222
 sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(99222,'QA ПОНЧО','adult',1)").run()
 const pos=99223
 sql.prepare("INSERT INTO catalog_stock_positions(id,product_id,category,gender_scope,material,length,is_default,is_active) VALUES(99223,99222,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1)").run()
 sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active) VALUES(99224,99222,99223,'adult','ЖЕН','БЕЖЕВЫЙ','СТАНДАРТ','СТАНДАРТ','46',1)").run()
 const item=(size,material='СТАНДАРТ',name='QA ПОНЧО')=>
  normalizeOrderItems([{productName:name,sourceType:'boutique',audienceType:'ВЗРОСЛЫЙ',
   gender:'ЖЕН',color:'БЕЖЕВЫЙ',material,length:'СТАНДАРТ',size,
   quantity:1,unitPrice:18000}],'boutique')[0]
 const count=()=>Number(sql.prepare('SELECT COUNT(*) AS n FROM catalog_variants').get().n)
 const start=count()
 const exact=await resolveCatalogProductAndVariantV2(db,item('46'),{createMissing:false})
 assert.equal(exact.variantId,99224,'Read-only resolver failed to re-use exact existing SKU')
 const unseen=await resolveCatalogProductAndVariantV2(db,item('48'),{createMissing:false})
 assert.equal(unseen.productId,p)
 assert.equal(unseen.variantId,null,'Unseen valid size got auto SKU')
 const newExec=await resolveCatalogProductAndVariantV2(db,item('46','ДЖИНСА'),{createMissing:false})
 assert.equal(newExec.variantId,null,'Unseen material execution got auto SKU')
 const unknown=await resolveCatalogProductAndVariantV2(db,item('46','СТАНДАРТ','НЕСУЩЕСТВУЮЩАЯ МОДЕЛЬ'),{createMissing:false})
 assert.equal(unknown.variantId,null)
 assert.equal(unknown.productId,null)
 assert.equal(count(),start,'Read-only resolver created variant')
 assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM catalog_stock_positions').get().n),1,'Read-only resolver created execution')
 assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM catalog_products').get().n),1,'Read-only resolver created model')
 console.log('NO_IMPLICIT_SKU_CREATION_PASS: normal order, edits, exchanges, queue guarded; exact active SKU reused; catalog/stocktake deliberate creators retained')
} finally {sql.close()}
