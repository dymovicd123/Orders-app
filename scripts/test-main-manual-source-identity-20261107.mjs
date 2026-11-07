import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {normalizeOrderItems} from '../worker/domains/order-core.ts'
import {resolveWorkshopCatalogProductOnly,resolveCatalogProductAndVariant} from '../worker/domains/order-reservations.ts'

const sql=new DatabaseSync(':memory:')
for(const file of fs.readdirSync('migrations').filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
 sql.exec(fs.readFileSync('migrations/'+file,'utf8'))
}
const stmt=(query,values=[])=>({
 bind(...args){return stmt(query,args)},
 async first(){return sql.prepare(query).get(...values)||null},
 async all(){return {results:sql.prepare(query).all(...values)}},
 async run(){const meta=sql.prepare(query).run(...values);return {meta:{changes:Number(meta.changes),last_row_id:Number(meta.lastInsertRowid||0)}}}
})
const db={prepare:query=>stmt(query)}
try{
 sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(99400,'БАЯН СУЛУ ШАПАН','adult',1)").run()
 sql.prepare("INSERT INTO catalog_stock_positions(id,product_id,category,gender_scope,material,length,is_default,is_active) VALUES(99401,99400,'adult','unisex','ЗАМША ВЕЛЮР','СТАНДАРТ',0,1)").run()
 sql.prepare("INSERT INTO catalog_stock_positions(id,product_id,category,gender_scope,material,length,is_default,is_active) VALUES(99402,99400,'adult','unisex','ЗАМША ВЕЛЮР','ДЛИННЫЙ',0,1)").run()
 const add=(id,position,length)=>sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active) VALUES(?,99400,?,'adult','ЖЕН','БЕЖЕВЫЙ','ЗАМША ВЕЛЮР',?,'46',1)").run(id,position,length)
 add(99403,99401,'СТАНДАРТ')
 add(99404,99402,'ДЛИННЫЙ')
 const toItem=(source,attrs={})=>normalizeOrderItems([{
  productName:'БАЯН СУЛУ ШАПАН',sourceType:source,quantity:1,unitPrice:30000,
  audienceType:'ВЗРОСЛЫЙ',gender:'ЖЕН',color:'БЕЖЕВЫЙ',
  material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',size:'46',...attrs
 }],'warehouse')[0]
 const count=()=>Number(sql.prepare('SELECT COUNT(*) AS n FROM catalog_variants').get().n)
 const before=count()
 const stockBefore=Number(sql.prepare('SELECT COUNT(*) AS n FROM inventory_stock').get().n)
 const matched=await resolveWorkshopCatalogProductOnly(db,toItem('workshop'))
 assert.equal(matched.productId,99400)
 assert.equal(matched.variantId,99403,'Workshop must link to exact existing SKU')
 assert.equal((await resolveWorkshopCatalogProductOnly(db,toItem('workshop',{length:'ДЛИННЫЙ'}))).variantId,99404,
  'Same color and size but longer item must never resolve to standard')
 assert.equal((await resolveWorkshopCatalogProductOnly(db,toItem('workshop',{color:''}))).variantId,null,
  'Missing color is not enough to identify one of several variants')
 assert.equal((await resolveWorkshopCatalogProductOnly(db,toItem('workshop',{material:'НЕИЗВЕСТНО'}))).variantId,null,
  'Unknown material cannot be silently replaced')
 assert.equal(count(),before,'Workshop matching must never create a variant')
 assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM inventory_stock').get().n),stockBefore,
  'Workshop matching must never change stock')
 const stockManual=toItem('warehouse'),boutiqueManual=toItem('boutique')
 assert.equal(stockManual.isWorkshop,false)
 assert.equal(boutiqueManual.isWorkshop,false)
 assert.equal(boutiqueManual.inventorySource,'boutique')
 const stockMatch=await resolveCatalogProductAndVariant(db,boutiqueManual,'2026-11-07T00:00:00Z')
 assert.equal(stockMatch.variantId,99403,'Manual boutique item must keep exact variant identity even if absent from boutique stock')
 assert.equal(Number(sql.prepare('SELECT COUNT(*) AS n FROM inventory_stock').get().n),stockBefore,
  'Variant identification alone cannot invent physical inventory')
 const unknown=await resolveCatalogProductAndVariant(db,toItem('warehouse',{productName:'НЕИЗВЕСТНОЕ ИЗДЕЛИЕ'}),'2026-11-07T00:00:00Z')
 assert.equal(unknown.productId,null,'Unrecognized product remains pending resolution')
 assert.equal(unknown.variantId,null)
 assert.equal(count(),before,'Unrecognized free-form item cannot silently create guessed SKU')
 const missingSize=await resolveWorkshopCatalogProductOnly(db,toItem('workshop',{size:'48'}))
 assert.equal(missingSize.variantId,null,'Workshop must not force a nearby size when exact variant does not exist')
 console.log('MAIN_MANUAL_SOURCE_IDENTITY_PASS: workshop exact read-only SKU, ambiguity, unrelated stock sources, unknown catalog safety')
}finally{sql.close()}
