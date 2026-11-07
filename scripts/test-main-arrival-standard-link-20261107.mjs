import assert from 'node:assert/strict'
import fs from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {normalizeInventoryItem} from '../worker/domains/order-core.ts'
import {resolveInventoryCreatableItemsBulk,arrivalFactsMatchCanonicalSku} from '../worker/domains/inventory-movement.ts'

const sql=new DatabaseSync(':memory:')
for(const name of fs.readdirSync('migrations').filter(name=>/^\d+.*\.sql$/.test(name)).sort()){
 sql.exec(fs.readFileSync('migrations/'+name,'utf8'))
}
const stmt=(query,args=[])=>({
 bind(...values){return stmt(query,values)},
 async first(){return sql.prepare(query).get(...args)??null},
 async all(){return {results:sql.prepare(query).all(...args)}},
 async run(){const value=sql.prepare(query).run(...args);return {success:true,meta:{changes:Number(value.changes),last_row_id:Number(value.lastInsertRowid||0)}}}
})
const db={prepare:query=>stmt(query)}
const count=(table)=>Number(sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n)
const original={
 productId:98901,productName:'QA СВЯЗЬ СТАНДАРТ',category:'adult',gender:'ЖЕН',
 color:'ГОЛУБОЙ',size:'46',quantity:2,
}
const normalized=patch=>normalizeInventoryItem({...original,...patch})
try{
 sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES(98901,'QA СВЯЗЬ СТАНДАРТ','adult',1)").run()
 sql.prepare("INSERT INTO catalog_stock_positions(id,product_id,category,gender_scope,material,length,is_default,is_active) VALUES(98902,98901,'adult','unisex','СТАНДАРТ','СТАНДАРТ',0,1)").run()
 sql.prepare("INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active) VALUES(98903,98901,98902,'adult','ЖЕН','ГОЛУБОЙ','СТАНДАРТ','СТАНДАРТ','46',1)").run()
 const start={products:count('catalog_products'),executions:count('catalog_stock_positions'),variants:count('catalog_variants')}
 const emptyDisplay=normalized({material:'',length:''})
 assert.equal(emptyDisplay.material,'СТАНДАРТ')
 assert.equal(emptyDisplay.length,'СТАНДАРТ')
 const existing=(await resolveInventoryCreatableItemsBulk(db,[emptyDisplay]))[0]
 assert.equal(existing.productId,98901,'Hidden standard product must not become a new model')
 assert.equal(existing.variantId,98903,'Blank displayed standard material/length must reuse exact existing variant')
 assert(arrivalFactsMatchCanonicalSku(emptyDisplay,existing),'Canonical SKU must match hidden standard attributes')
 const explicit=(await resolveInventoryCreatableItemsBulk(db,[normalized({material:'СТАНДАРТ',length:'СТАНДАРТ'})]))[0]
 assert.equal(explicit.variantId,98903,'Explicit and implicit standard must share SKU ID')
 assert.deepEqual({products:count('catalog_products'),executions:count('catalog_stock_positions'),variants:count('catalog_variants')},start,
  'Reusing an existing standard SKU must never create catalog entities')
 const newSize=(await resolveInventoryCreatableItemsBulk(db,[normalized({size:'48',material:'',length:''})]))[0]
 assert.equal(newSize.productId,98901)
 assert.notEqual(newSize.variantId,98903,'A genuinely different size should become its own variant')
 const created=sql.prepare('SELECT stock_position_id,material,length,size_label FROM catalog_variants WHERE id=?').get(newSize.variantId)
 assert.equal(created.stock_position_id,98902,'New size must reuse standard execution, not create duplicate execution')
 assert.deepEqual([created.material,created.length,created.size_label],['СТАНДАРТ','СТАНДАРТ','48'])
 assert.equal(count('catalog_products'),start.products)
 assert.equal(count('catalog_stock_positions'),start.executions)
 assert.equal(count('catalog_variants'),start.variants+1)
 const repeated=(await resolveInventoryCreatableItemsBulk(db,[normalized({size:'48',material:'СТАНДАРТ',length:'СТАНДАРТ'})]))[0]
 assert.equal(repeated.variantId,newSize.variantId,'Repeat Arrival must reuse newly created combination')
 assert.equal(count('catalog_variants'),start.variants+1)
 const newModel=normalized({productId:0,productName:'QA НОВОЕ ИЗДЕЛИЕ ОТ ПРИХОДА',size:'40',material:'',length:''})
 const distinct=(await resolveInventoryCreatableItemsBulk(db,[newModel]))[0]
 assert(distinct.productId>0&&distinct.productId!==98901,'Arrival must still create genuinely new model')
 assert(distinct.variantId>0,'Arrival must still create new variant')
 assert.equal(count('catalog_products'),start.products+1)
 assert.equal(count('catalog_stock_positions'),start.executions+1)
 assert.equal(count('catalog_variants'),start.variants+2)
 assert.equal(distinct.material,'СТАНДАРТ')
 assert.equal(distinct.length,'СТАНДАРТ')
 console.log('ARRIVAL_HIDDEN_STANDARD_LINK_PASS: hidden standard matches catalog SKU, new size shares execution, real new product creates normally')
}finally{sql.close()}
