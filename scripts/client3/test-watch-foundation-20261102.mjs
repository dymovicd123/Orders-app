import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  normalizeWatchBrand, normalizeWatchVariant, watchSkuKey,
  watchSourceToLegacy, legacySourceToWatch, watchDeadlineToUTC,
  validateWatchOrderInput, requireWatchBrandAccess, WATCH_BRANDS, WATCH_PAYMENTS,
} from '../../shared/client3/watch-domain.ts'

const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'))
assert.equal(config.name,'orders-app-client3-old-client')
assert.equal(config.d1_databases.length,1)
assert.equal(config.d1_databases[0].database_name,'orders_db_client3_old_client')
assert.equal(config.d1_databases[0].database_id,'0717f239-6d81-4837-8586-777d94e22c53')
assert.equal(config.d1_databases[0].migrations_dir,'migrations/client3-watch')
assert.equal(config.vars.CLIENT3_INSTALLATION,'1')
assert.equal(config.vars.CLIENT3_WATCHES,'1')
assert(/^[0-9a-f]{64}$/.test(config.vars.CLIENT3_BOOTSTRAP_SHA256))
const auth=fs.readFileSync('worker/domains/auth.ts','utf8')
const idx=fs.readFileSync('worker/index.ts','utf8')
assert(auth.includes('client3InviteConfigured(env)') && auth.includes('verifyClient3Invite(env,bootstrapPassword)'),
  'Client3 one-time first-admin invite must be carried forward from original isolated installation')
assert(auth.includes("if (cleanText(env.CLIENT3_INSTALLATION) === '1' && !client3SecretConfigured(env)) return false;"),
  'Generic admin/admin fallback must never activate on Client3')
assert(idx.includes('handleAuthStatus(env.DB, env, request)'), 'Server-side setup readiness must use tenant config')
assert.deepEqual(WATCH_BRANDS,['TAUWACH','WACHIZEN'])
assert.deepEqual(WATCH_PAYMENTS,['KASPI RED','KASPI GOLD','Рассрочка'])
const base={gender:'male',movement:'quartz',braceletMaterial:'leather',dialColor:'black',braceletColor:'Чёрный'}
assert.equal(normalizeWatchVariant(base).braceletColor,'ЧЁРНЫЙ')
assert.notEqual(watchSkuKey('TAUWACH','CLASSIC',base),watchSkuKey('TAUWACH','CLASSIC',{...base,braceletColor:'Коричневый'}))
assert.notEqual(watchSkuKey('TAUWACH','CLASSIC',base),watchSkuKey('WACHIZEN','CLASSIC',base))
assert.notEqual(watchSkuKey('TAUWACH','CLASSIC',base),watchSkuKey('TAUWACH','CLASSIC',{...base,dialColor:'white'}))
assert.throws(()=>normalizeWatchVariant({...base,braceletColor:''}),/кожаного/)
assert.throws(()=>normalizeWatchVariant({...base,braceletMaterial:'steel'}),/только для кожи/)
assert.equal(normalizeWatchVariant({...base,braceletMaterial:'rubber',braceletColor:''}).braceletColor,'')
assert.equal(watchSourceToLegacy('office'),'warehouse')
assert.equal(watchSourceToLegacy('showcase'),'boutique')
assert.equal(legacySourceToWatch('boutique'),'showcase')
assert.throws(()=>legacySourceToWatch('workshop'),/Неизвестное/)
assert.equal(watchDeadlineToUTC('2026-11-15T17:00'),'2026-11-15T12:00:00.000Z')
assert.throws(()=>watchDeadlineToUTC('2026-02-30T17:00'),/Несуществующая/)
assert.throws(()=>watchDeadlineToUTC('2026-11-15'),/дату и время/)
assert.equal(requireWatchBrandAccess({role:'admin',allowedBrands:[]},'WACHIZEN'),'WACHIZEN')
assert.equal(requireWatchBrandAccess({role:'manager',allowedBrands:['TAUWACH']},'TAUWACH'),'TAUWACH')
assert.throws(()=>requireWatchBrandAccess({role:'manager',allowedBrands:['TAUWACH']},'WACHIZEN'),/Нет доступа/)
assert.throws(()=>normalizeWatchBrand('OTHER'),/бренд/)
const order={
  brand:'TAUWACH',source:'office',recipientName:'Алия К.',recipientPhone:'+7 777 000 00 00',
  address:'Алматы, улица Пример 1, квартира 10',postalCode:'050000',city:'Алматы',
  deliveryMethod:'Казпочта',shippingDeadlineLocal:'2026-11-15T17:00',urgent:true,paymentMethod:'KASPI GOLD',
}
assert.equal(validateWatchOrderInput(order).shippingDeadlineAt,'2026-11-15T12:00:00.000Z')
assert.equal(validateWatchOrderInput(order).legacySource,'warehouse')
for(const field of ['recipientName','recipientPhone','address','postalCode','city','deliveryMethod']){
  assert.throws(()=>validateWatchOrderInput({...order,[field]:''}),/Заполните/)
}
assert.equal(validateWatchOrderInput({...order,paymentMethod:'НАЛИЧНЫЕ'}).paymentMethod,'НАЛИЧНЫЕ',
 'Client3 accepts shared custom payment references; final validation occurs in the server reference registry')
assert.throws(()=>validateWatchOrderInput({...order,paymentMethod:''}),/способ оплаты/)

// Run exactly the isolated ADDITIVE watch SQL on a synthetic Core schema.
// No real D1 binding, customer data or previous client's account needed.
const db=new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON;')
db.exec(`
  CREATE TABLE managers (id INTEGER PRIMARY KEY);
  CREATE TABLE catalog_products (id INTEGER PRIMARY KEY);
  CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES catalog_products(id));
  CREATE TABLE orders (id INTEGER PRIMARY KEY);
  CREATE TABLE order_items (id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id));
  CREATE TABLE app_users (id INTEGER PRIMARY KEY);
  CREATE TABLE inventory_stock (id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
  CREATE TABLE payments (id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),amount INTEGER);
  INSERT INTO managers VALUES (1),(2);
  INSERT INTO app_users VALUES (1);
  INSERT INTO orders VALUES (1),(2);
  INSERT INTO catalog_products VALUES (10),(11);
  INSERT INTO catalog_variants VALUES (100,10),(101,10),(102,11);
  INSERT INTO order_items VALUES (200,1),(201,2);
`)
const migration=fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8')
assert(!/\b(?:DROP\s+TABLE|DELETE\s+FROM|UPDATE\s+orders|UPDATE\s+inventory_stock)\b/i.test(migration))
db.exec(migration)
db.exec(migration)
assert.deepEqual(db.prepare('SELECT code FROM watch_brands ORDER BY id').all().map(x=>x.code),['TAUWACH','WACHIZEN'])
const taw=db.prepare("SELECT id FROM watch_brands WHERE code='TAUWACH'").get().id
const wiz=db.prepare("SELECT id FROM watch_brands WHERE code='WACHIZEN'").get().id
db.prepare('INSERT INTO watch_manager_brands(manager_id,brand_id) VALUES (?,?)').run(1,taw)
db.prepare('INSERT INTO watch_manager_brands(manager_id,brand_id) VALUES (?,?)').run(2,wiz)
db.prepare('INSERT INTO watch_products(brand_id,model_name,catalog_product_id) VALUES (?,?,?)').run(taw,'CLASSIC',10)
db.prepare('INSERT INTO watch_products(brand_id,model_name,catalog_product_id) VALUES (?,?,?)').run(wiz,'CLASSIC',11)
const p1=db.prepare('SELECT id FROM watch_products WHERE brand_id=?').get(taw).id
const p2=db.prepare('SELECT id FROM watch_products WHERE brand_id=?').get(wiz).id
assert.notEqual(p1,p2)
const variantSql='INSERT INTO watch_variants(watch_product_id,catalog_variant_id,gender,movement,bracelet_material,dial_color,bracelet_color) VALUES (?,?,?,?,?,?,?)'
db.prepare(variantSql).run(p1,100,'male','quartz','leather','black','ЧЁРНЫЙ')
db.prepare(variantSql).run(p1,101,'male','quartz','leather','black','КОРИЧНЕВЫЙ')
db.prepare(variantSql).run(p2,102,'male','quartz','steel','black','')
assert.throws(()=>db.prepare(variantSql).run(p1,null,'male','quartz','leather','black',''),/CHECK constraint failed/)
assert.throws(()=>db.prepare(variantSql).run(p1,null,'male','quartz','steel','black','ЧЁРНЫЙ'),/CHECK constraint failed/)
assert.throws(()=>db.prepare(variantSql).run(p1,null,'male','quartz','leather','black','ЧЁРНЫЙ'),/UNIQUE constraint failed/)
db.prepare('INSERT INTO watch_order_details(order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
  1,taw,'Алия К.','+77770000000','Алматы, пример 1','050000','Алматы','Казпочта',1,'2026-11-15T12:00:00.000Z')
db.prepare('INSERT INTO watch_order_details(order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at) VALUES (?,?,?,?,?,?,?,?,?,?)').run(
  2,wiz,'М. К.','+77770000001','Астана, пример 2','010000','Астана','Казпочта',0,'2026-11-16T13:00:00.000Z')
assert.throws(()=>db.exec('UPDATE watch_order_details SET brand_id=2 WHERE order_id=1'),/watch_order_brand_immutable/)
db.prepare('INSERT INTO watch_order_item_details(order_item_id,watch_variant_id,engraving_text) VALUES (?,?,?)').run(200,1,'A+M')
db.prepare('INSERT INTO watch_logistics_jobs(order_id) VALUES (?)').run(1)
assert.equal(db.prepare('SELECT status FROM watch_logistics_jobs WHERE order_id=1').get().status,'pending')
db.prepare("UPDATE watch_logistics_jobs SET status='ready',ready_at='2026-11-15T09:00:00.000Z',ready_by_user_id=1 WHERE order_id=1").run()
assert.equal(db.prepare('SELECT status FROM watch_logistics_jobs WHERE order_id=1').get().status,'ready')
db.prepare("INSERT INTO watch_logistics_events(order_id,actor_user_id,previous_status,next_status,request_id) VALUES (1,1,'pending','ready','r1')").run()
assert.throws(()=>db.prepare("UPDATE watch_logistics_events SET note='changed' WHERE id=1").run(),/immutable_watch_logistics_audit/)
assert.throws(()=>db.prepare("DELETE FROM watch_logistics_events WHERE id=1").run(),/immutable_watch_logistics_audit/)
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[])
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM watch_order_details WHERE brand_id=?").get(taw).c,1)
assert.equal(db.prepare("SELECT COUNT(*) AS c FROM watch_order_details WHERE brand_id=?").get(wiz).c,1)
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM orders').get().c,2)
assert.equal(db.prepare('SELECT COUNT(*) AS c FROM inventory_stock').get().c,0)
db.close()
console.log('CLIENT3_WATCH_FOUNDATION_PASS: tenant binding, 2 brands, leather color SKU, exact cutoff, per-brand access, additive SQLite, logistics≠shipping, audit immutability')
