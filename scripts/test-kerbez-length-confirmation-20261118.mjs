import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getCatalogReviewContext, resolveCatalogReviewFacts, resolveOrderCatalogReviewExistingVariant, listCatalogReviewQueue } from '../worker/domains/catalog-review.ts'
import { getOrder } from '../worker/domains/orders-write.ts'
import { buildOrderShipmentPlan } from '../worker/domains/order-shipment-plan.ts'
import { nextQuestion, initialDraft } from '../src/features/orders/catalogResolutionFlow.ts'
import { publicApiError } from '../worker/core/http.ts'

const sql = new DatabaseSync(':memory:')
for (const file of fs.readdirSync('migrations').filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
  sql.exec(fs.readFileSync('migrations/' + file, 'utf8'))
}
if (!sql.prepare("SELECT 1 FROM pragma_table_info('orders') WHERE name='manager_snapshot_name'").get())
  sql.exec('ALTER TABLE orders ADD COLUMN manager_snapshot_name TEXT')
const stmt = (query, binds = []) => ({
  bind(...params) { return stmt(query, params) },
  async first() { return sql.prepare(query).get(...binds) || null },
  async all() { return { results: sql.prepare(query).all(...binds) } },
  async run() {
    const result = sql.prepare(query).run(...binds)
    return { meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } }
  },
})
const db = {
  prepare: query => stmt(query),
  async batch(statements) {
    sql.exec('SAVEPOINT catalog_resolution_regression')
    try {
      const result = []
      for (const statement of statements) result.push(await statement.run())
      sql.exec('RELEASE catalog_resolution_regression')
      return result
    } catch (error) {
      sql.exec('ROLLBACK TO catalog_resolution_regression')
      sql.exec('RELEASE catalog_resolution_regression')
      throw error
    }
  },
}
sql.exec(`
INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Kerbez QA');
INSERT INTO catalog_products(id,name,category,gender_scope,is_active) VALUES
 (60,'КЕРБЕЗ АБАЙКА','adult','female',1),
 (70,'АМИР БОМБЕР','adult','male',1),
 (120,'НОВАЯ АБАЙКА','adult','female',1);
INSERT OR IGNORE INTO reference_values(kind,value,is_active) VALUES
 ('material','ДАК',1),('color','ОРАНЖЕВЫЙ',1);
INSERT INTO catalog_stock_positions(id,product_id,category,gender_scope,material,length,is_active)
 VALUES (121,60,'adult','female','ДАК','ДЛИННЫЙ',1);
INSERT INTO catalog_variants(id,product_id,stock_position_id,category,gender,color,material,length,size_label,is_active)
 VALUES (1761,60,121,'adult','ЖЕН','ОРАНЖЕВЫЙ','ДАК','ДЛИННЫЙ','СТАНДАРТ',1);
INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,reserved_quantity)
 VALUES (8001,'boutique',60,1761,'КЕРБЕЗ АБАЙКА','ЖЕН','ОРАНЖЕВЫЙ','ДАК','ДЛИННЫЙ','СТАНДАРТ',1,0);
INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES
 (2428,'ORD-20261115101428-19D3A8C8','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z'),
 (2430,'ORD-KERBEZ-SHORTAGE-TEST','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z'),
 (2431,'ORD-NEW-STANDARD-SIZE-TEST','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z');
INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,audience_type,gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at) VALUES
 (5690,2428,70,NULL,'АМИР БОМБЕР','ВЗРОСЛЫЙ','МУЖ','СИНИЙ','СТАНДАРТ','СТАНДАРТ','56',1,20000,20000,0,'boutique','fulfilled','2026-11-15T00:00:00Z'),
 (5691,2428,60,NULL,'АБАЙКА','ВЗРОСЛЫЙ','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','БЕЗ РАЗМЕРА',0,10000,0,0,'boutique','replaced_edit','2026-11-15T00:00:00Z'),
 (5742,2428,60,NULL,'КЕРБЕЗ АБАЙКА','ВЗРОСЛЫЙ','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',1,20000,20000,0,'boutique','catalog_unresolved','2026-11-15T00:00:00Z'),
 (5743,2430,60,NULL,'КЕРБЕЗ АБАЙКА','ВЗРОСЛЫЙ','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','',1,20000,20000,0,'boutique','catalog_unresolved','2026-11-15T00:00:00Z'),
 (5744,2431,120,NULL,'НОВАЯ АБАЙКА','ВЗРОСЛЫЙ','ЖЕН','ОРАНЖЕВЫЙ','ДАК','СТАНДАРТ','СТАНДАРТ',1,20000,20000,0,'boutique','catalog_unresolved','2026-11-15T00:00:00Z');
INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,unresolved_reason,created_at,updated_at) VALUES
 (2428,5742,'boutique',60,NULL,1,'unresolved','variant','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z'),
 (2430,5743,'boutique',60,NULL,1,'unresolved','variant','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z'),
 (2431,5744,'boutique',120,NULL,1,'unresolved','variant','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z');
`)
const before=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=8001').get()
const context=await getCatalogReviewContext(db,5742)
assert.equal(context.exactVariant,null)
assert(context.lengthAlternatives?.includes('ДЛИННЫЙ'),'Known catalog SKU with alternate length must be offered')
const draft=initialDraft({productName:'КЕРБЕЗ АБАЙКА',variantId:null,color:'ОРАНЖЕВЫЙ',size:'СТАНДАРТ'},context)
assert.equal(nextQuestion(context,draft,{remainder:'',classified:true,confirmed:{},legacy:false}).field,'length')
assert.equal(nextQuestion(context,draft,{remainder:'',classified:true,confirmed:{length:true},legacy:false}).field,'length','A duplicate confirmation cannot bypass length mismatch')
const prevCount=sql.prepare('SELECT COUNT(*) n FROM catalog_stock_positions WHERE product_id=60').get().n
await assert.rejects(
  resolveCatalogReviewFacts(db,5742,{...draft,createProduct:false}, {singleItem:true}),
  error=>error.status===409 && error.code==='catalog_length_confirmation_required' && error.message.includes('ДЛИННЫЙ')
)
assert.equal(sql.prepare('SELECT COUNT(*) n FROM catalog_stock_positions WHERE product_id=60').get().n,prevCount,'No phantom execution on mismatch')
assert.equal(sql.prepare('SELECT variant_id FROM order_items WHERE id=5742').get().variant_id,null)
assert.equal(sql.prepare('SELECT unresolved_reason FROM inventory_reservations WHERE order_item_id=5742').get().unresolved_reason,'variant')
assert.equal(sql.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=5690').get().stock_writeoff_status,'fulfilled')
const specific=await getCatalogReviewContext(db,5742,{...draft,length:'ДЛИННЫЙ'})
assert.equal(specific.exactVariant?.id,1761)
assert.equal(specific.lengthAlternatives?.length,0)
assert.equal(nextQuestion(specific,{...draft,length:'ДЛИННЫЙ'},{remainder:'',classified:true,confirmed:{length:true},legacy:false}).kind,'ready')
const result=await resolveOrderCatalogReviewExistingVariant(db,2428,5742,1761)
assert.equal(result.ok,true)
assert.equal(sql.prepare('SELECT variant_id,stock_writeoff_status FROM order_items WHERE id=5742').get().variant_id,1761)
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=5742').get().status,'active')
const stock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=8001').get()
assert.equal(stock.quantity,before.quantity,'Resolver cannot deduct physical stock')
assert.equal(stock.reserved_quantity,1)
assert.equal(sql.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=5690').get().stock_writeoff_status,'fulfilled')
assert.equal(sql.prepare('SELECT quantity FROM order_items WHERE id=5691').get().quantity,0)
const shortage=await resolveOrderCatalogReviewExistingVariant(db,2430,5743,1761)
assert.equal(shortage.ok,true)
assert.equal(sql.prepare('SELECT stock_writeoff_status FROM order_items WHERE id=5743').get().stock_writeoff_status,'pending_reservation')
assert.equal(sql.prepare('SELECT unresolved_reason FROM inventory_reservations WHERE order_item_id=5743').get().unresolved_reason,'concurrent_shortage')
assert.equal(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=8001').get().quantity,1)
assert.equal(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=8001').get().reserved_quantity,1)
const refsBefore=sql.prepare("SELECT COUNT(*) n FROM reference_values WHERE kind='size' AND value='СТАНДАРТ'").get().n
const newItem=await resolveCatalogReviewFacts(db,5744,{
  productId:120,productName:'НОВАЯ АБАЙКА',createProduct:false,
  category:'adult',gender:'ЖЕН',color:'ОРАНЖЕВЫЙ',material:'ДАК',length:'СТАНДАРТ',size:'СТАНДАРТ'
},{singleItem:true})
assert.equal(newItem.ok,true,'Existing catalog STANDARD size must be recognized despite missing reference_values row')
assert.equal(sql.prepare("SELECT COUNT(*) n FROM reference_values WHERE kind='size' AND value='СТАНДАРТ'").get().n,refsBefore)
const invalid=publicApiError(new Error('Значение «СТАНДАРТ» ещё не существует. Выберите существующее.'))
assert.equal(invalid.status,400,'Cyrillic boundary must not hide actionable error')
assert(invalid.message.includes('СТАНДАРТ'))
console.log('KERBEZ_LENGTH_AND_REAL_D1_SHAPE_PASS: production-shaped legacy edit, explicit length confirmation, exact SKU, 1 boutique unit, no inventory mutation, safe shortage, no phantom reference, Russian error visible')
sql.close()
