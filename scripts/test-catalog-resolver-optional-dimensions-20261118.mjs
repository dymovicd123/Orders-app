import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { getCatalogReviewContext, resolveCatalogReviewFacts, resolveOrderCatalogReviewExistingVariant, listCatalogReviewQueue } from '../worker/domains/catalog-review.ts'
import { getOrder } from '../worker/domains/orders-write.ts'
import { buildOrderShipmentPlan } from '../worker/domains/order-shipment-plan.ts'
import { needsReference, nextQuestion } from '../src/features/orders/catalogResolutionFlow.ts'

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
INSERT OR IGNORE INTO managers(id,name) VALUES(1,'Resolver QA');
INSERT INTO catalog_products(id,name,category,is_active) VALUES
 (98101,'КОСМЕТИЧКА','adult',1),
 (98201,'ЭТНО БОМБЕР','adult',1);
INSERT OR IGNORE INTO reference_values(kind,value,is_active) VALUES
 ('material','ЗАМША ВЕЛЮР',1),('color','ВЕРБЛЮЖКА',1),('size','56',1);
INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at) VALUES
 (98110,'ORD-20261113133917-E84920D3','2026-11-13',1,'active','boutique','ready','not_sent','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z'),
 (98210,'ORD-20261115101739-561B30D5','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z'),
 (98220,'ORD-TEST-SECOND-BOMBER','2026-11-15',1,'active','boutique','ready','not_sent','2026-11-15T00:00:00Z','2026-11-15T00:00:00Z');
INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,gender_snapshot,
color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,is_workshop,
source_type,stock_writeoff_status,created_at) VALUES
 (98111,98110,NULL,NULL,'КОСМЕТИЧКА','ЖЕН','БЕЗ ЦВЕТА','СТАНДАРТ','СТАНДАРТ','БЕЗ РАЗМЕРА',1,12000,12000,0,'boutique','catalog_unresolved','2026-11-13T00:00:00Z'),
 (98211,98210,NULL,NULL,'ЭТНО БОМБЕР','МУЖ','ВЕРБЛЮЖКА','ЗАМША ВЕЛЮР','СТАНДАРТ','56',1,65000,65000,0,'boutique','catalog_unresolved','2026-11-15T00:00:00Z'),
 (98221,98220,NULL,NULL,'ЭТНО БОМБЕР','МУЖ','ВЕРБЛЮЖКА','ЗАМША ВЕЛЮР','СТАНДАРТ','56',1,65000,65000,0,'boutique','catalog_unresolved','2026-11-15T00:00:00Z');
`)
const noDimContext = await getCatalogReviewContext(db, 98111, {
  productId: 98101, category: 'adult', gender: 'ЖЕН', material: 'СТАНДАРТ',
  length: 'СТАНДАРТ', color: 'БЕЗ ЦВЕТА', size: 'БЕЗ РАЗМЕРА',
})
assert(!noDimContext.unknownFields.includes('color'))
assert(!noDimContext.unknownFields.includes('size'))
const noDimDraft = { productId: 98101, productName:'КОСМЕТИЧКА', createProduct:false,
  category:'adult',genderScope:'unisex', gender:'ЖЕН', material:'СТАНДАРТ',length:'СТАНДАРТ',
  color:'БЕЗ ЦВЕТА',size:'БЕЗ РАЗМЕРА' }
assert.equal(needsReference(noDimContext, noDimDraft, 'color'),false)
assert.equal(needsReference(noDimContext, noDimDraft, 'size'),false)
assert.equal(nextQuestion(noDimContext,noDimDraft,{remainder:'',classified:true,confirmed:{},legacy:false}).kind,'ready')
const cosmetic = await resolveCatalogReviewFacts(db, 98111, noDimDraft, {singleItem:true})
assert.equal(cosmetic.ok,true)
const cosmeticItem = sql.prepare('SELECT product_id,variant_id,stock_writeoff_status FROM order_items WHERE id=98111').get()
assert.equal(cosmeticItem.product_id,98101)
assert(cosmeticItem.variant_id > 0)
assert.equal(cosmeticItem.stock_writeoff_status,'pending_reservation')
const cosmeticReservation = sql.prepare('SELECT status,unresolved_reason,variant_id,quantity FROM inventory_reservations WHERE order_item_id=98111').get()
assert.equal(cosmeticReservation.status,'unresolved')
assert.equal(cosmeticReservation.unresolved_reason,'concurrent_shortage')
assert.equal(cosmeticReservation.variant_id,cosmeticItem.variant_id)
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM reference_values WHERE kind='color' AND value='БЕЗ ЦВЕТА'").get().n,0)
const cosmeticStock=sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE variant_id=?').get(cosmeticItem.variant_id)
assert.deepEqual(cosmeticStock,{quantity:0,reserved_quantity:0})
const scopedReview = await listCatalogReviewQueue(db,new URL('https://qa.local/api/catalog/review?orderId=98110'))
assert.equal(scopedReview.count,0,'Known SKU with shortage is not a catalog identity problem')
const order=await getOrder(db,98110)
const plan=buildOrderShipmentPlan(order,[{order_item_id:98111,status:'unresolved',variant_id:cosmeticItem.variant_id,quantity:1,inventory_source:'boutique'}])
assert.equal(plan.lines[0].needsStockConfirmation,true)
assert.equal(plan.lines[0].selectable,true)
const bomberContext = await getCatalogReviewContext(db,98211,{
  productId:98201,category:'adult',gender:'МУЖ',material:'ЗАМША ВЕЛЮР',
  length:'СТАНДАРТ',color:'ВЕРБЛЮЖКА',size:'56',
})
assert.equal(bomberContext.unknownFields.includes('color'),false)
assert.equal(bomberContext.unknownFields.includes('size'),false)
const bomber = await resolveCatalogReviewFacts(db, 98211, {
  productId:98201,productName:'ЭТНО БОМБЕР',createProduct:false, category:'adult',
  genderScope:'unisex',gender:'МУЖ',material:'ЗАМША ВЕЛЮР',length:'СТАНДАРТ',
  color:'ВЕРБЛЮЖКА',size:'56',
},{singleItem:true})
assert.equal(bomber.ok,true)
const bomberItem=sql.prepare('SELECT variant_id,stock_writeoff_status FROM order_items WHERE id=98211').get()
assert(bomberItem.variant_id > 0)
assert.equal(bomberItem.stock_writeoff_status,'pending_reservation')
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=98211').get().status,'unresolved')
// Existing exact SKU also resolves without stock, without another SKU or a second reserve.
const fromExisting=await resolveOrderCatalogReviewExistingVariant(db,98220,98221,bomberItem.variant_id)
assert.equal(fromExisting.ok,true)
assert.equal(sql.prepare('SELECT variant_id FROM order_items WHERE id=98221').get().variant_id,bomberItem.variant_id)
assert.equal(sql.prepare('SELECT status FROM inventory_reservations WHERE order_item_id=98221').get().status,'unresolved')
assert.equal(sql.prepare('SELECT quantity FROM inventory_stock WHERE variant_id=?').get(bomberItem.variant_id).quantity,0)
assert.equal(sql.prepare('SELECT reserved_quantity FROM inventory_stock WHERE variant_id=?').get(bomberItem.variant_id).reserved_quantity,0)
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_item_id=98221').get().n,1)
console.log('RESOLVER_OPTIONAL_DIMENSIONS_AND_SHORTAGE_PASS: both shown examples, no-color/no-size without phantom reference, exact SKU and zero-stock pending reservation safe, existing SKU path, no double stock effects')
sql.close()
