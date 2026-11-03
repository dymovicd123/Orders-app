import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import {
  listWatchBrands,listWatchModels,listWatchManagers,listWatchLogistics,markWatchLogisticsReady,
  listWatchStaff,assignWatchManagerBrands,
} from '../../worker/domains/client3-watches.ts'

// D1.prepare/batch compatible adapter. Every test uses a disposable in-memory DB;
// nothing connects to Cloudflare or reads a real customer's information.
const sql=new DatabaseSync(':memory:')
sql.exec('PRAGMA foreign_keys=ON')
sql.exec(`
 CREATE TABLE managers (id INTEGER PRIMARY KEY,name TEXT,role TEXT DEFAULT 'Менеджер',is_active INTEGER DEFAULT 1);
 CREATE TABLE app_users (id INTEGER PRIMARY KEY);
 CREATE TABLE catalog_products (id INTEGER PRIMARY KEY);
 CREATE TABLE catalog_variants (id INTEGER PRIMARY KEY,product_id INTEGER REFERENCES catalog_products(id),stock_position_id INTEGER,category TEXT DEFAULT 'adult',is_active INTEGER DEFAULT 1);
 CREATE TABLE catalog_execution_prices (stock_position_id INTEGER,category TEXT,sale_price INTEGER,PRIMARY KEY(stock_position_id,category));
 CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,order_status TEXT,total_amount INTEGER,received_amount INTEGER,debt_amount INTEGER,source_type TEXT DEFAULT 'warehouse',shipping_status TEXT DEFAULT 'not_sent');
 CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id),quantity INTEGER);
 CREATE TABLE inventory_stock(id INTEGER PRIMARY KEY,inventory_source TEXT,variant_id INTEGER,quantity INTEGER,reserved_quantity INTEGER);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,amount INTEGER);
 CREATE TABLE inventory_reservations(order_item_id INTEGER PRIMARY KEY,status TEXT);
 CREATE TABLE order_dispatches(id INTEGER PRIMARY KEY,order_id INTEGER REFERENCES orders(id));
 CREATE TABLE order_dispatch_items(id INTEGER PRIMARY KEY,dispatch_id INTEGER REFERENCES order_dispatches(id),
   order_item_id INTEGER REFERENCES order_items(id),quantity INTEGER, cancelled_quantity INTEGER DEFAULT 0);
 CREATE TABLE watch_variant_attributes_v5(watch_variant_id INTEGER PRIMARY KEY,
   movement TEXT,bracelet_material TEXT,dial_color TEXT,bracelet_color TEXT);
 INSERT INTO managers(id,name) VALUES (1,'Alice'),(2,'Bob');
 INSERT INTO app_users VALUES (9);
 INSERT INTO catalog_products VALUES(10),(11);
 INSERT INTO catalog_variants(id,product_id,stock_position_id) VALUES(100,10,1000),(101,11,1001);
 INSERT INTO catalog_execution_prices VALUES(1000,'adult',60000),(1001,'adult',45000);
 INSERT INTO orders(id,external_id,order_status,total_amount,received_amount,debt_amount) VALUES (1,'TEST-1','active',90000,90000,0),(2,'TEST-2','active',120000,60000,60000);
 INSERT INTO order_items VALUES(200,1,1),(201,2,1);
 INSERT INTO inventory_stock VALUES(1,'warehouse',100,4,1),(2,'boutique',100,2,0),(3,'warehouse',101,9,0);
 INSERT INTO payments VALUES(1,1,90000),(2,2,60000);
 INSERT INTO inventory_reservations VALUES(200,'active'),(201,'active');
`)
sql.exec(fs.readFileSync('migrations/client3-watch/0002_client3_watch_foundation.sql','utf8'))
sql.exec(fs.readFileSync('migrations/client3-watch/0003_watch_manager_brand_audit.sql','utf8'))
sql.exec(fs.readFileSync('migrations/client3-watch/1004_watch_item_engraving_readiness.sql','utf8'))
sql.exec(`
 INSERT INTO watch_manager_brands(manager_id,brand_id) VALUES(1,1),(2,2);
 INSERT INTO watch_products(brand_id,model_name,catalog_product_id) VALUES(1,'CLASSIC',10),(2,'CLASSIC',11);
 INSERT INTO watch_variants(watch_product_id,catalog_variant_id,gender,movement,bracelet_material,dial_color,bracelet_color)
  VALUES(1,100,'male','quartz','leather','black','ЧЁРНЫЙ'),(2,101,'female','mechanical','steel','silver','');
 INSERT INTO watch_order_details(order_id,brand_id,recipient_name,recipient_phone,delivery_full_address,postal_code,city,delivery_method,urgent,shipping_deadline_at)
  VALUES(1,1,'Test One','111','Almaty test address','050000','Almaty','Kazpost',1,'2026-11-15T12:00:00Z'),
        (2,2,'Test Two','222','Astana test address','010000','Astana','Kazpost',0,'2026-11-16T12:00:00Z');
 INSERT INTO watch_order_item_details(order_item_id,watch_variant_id,engraving_text) VALUES(200,1,'A + M'),(201,2,'N');
 INSERT INTO watch_logistics_jobs(order_id) VALUES(1),(2);
`)
function makeDb() {
  function statement(query) {
    let binding=[]
    return {
      bind(...a){binding=a;return this},
      async first(){return sql.prepare(query).get(...binding)||null},
      async all(){return {results:sql.prepare(query).all(...binding)}},
      async run(){const r=sql.prepare(query).run(...binding);return {meta:{changes:r.changes,last_row_id:r.lastInsertRowid}}},
    }
  }
  return {
    prepare:statement,
    async batch(stmts) {
      sql.exec('BEGIN IMMEDIATE')
      try {
        const r=[]
        for(const st of stmts)r.push(await st.run())
        sql.exec('COMMIT')
        return r
      } catch(e) {sql.exec('ROLLBACK');throw e}
    },
  }
}
const db=makeDb()
const alice={id:1,role:'manager',managerId:1,employeeRole:'Менеджер'}
const bob={id:2,role:'manager',managerId:2,employeeRole:'Менеджер'}
const logistics={id:9,role:'manager',managerId:null,employeeRole:'Логист'}
const admin={id:9,role:'admin',managerId:null,employeeRole:'Администратор'}
const j=async response=>({status:response.status,...await response.json()})
let x=await j(await listWatchBrands(db,alice));assert.deepEqual(x.brands.map(x=>x.code),['TAUWACH'])
x=await j(await listWatchBrands(db,bob));assert.deepEqual(x.brands.map(x=>x.code),['WACHIZEN'])
x=await j(await listWatchBrands(db,logistics));assert.deepEqual(x.brands.map(x=>x.code),['TAUWACH','WACHIZEN'])
const logisticsSale=await j(await listWatchModels(db,logistics,new URL('https://test.invalid/api/client3/watches/models?brand=TAUWACH')))
assert.equal(logisticsSale.status,403,'Logist role cannot view sale catalogue')
x=await j(await listWatchModels(db,alice,new URL('https://test.invalid/api/client3/watches/models?brand=TAUWACH')))
assert.equal(x.models.length,1);assert.equal(x.models[0].modelName,'CLASSIC')
assert.equal(x.models[0].officePhysical,4);assert.equal(x.models[0].showcasePhysical,2)
assert.equal(x.models[0].catalogPriceSnapshot,60000)
let managers=await j(await listWatchManagers(db,admin,new URL('https://test.invalid/api/client3/watches/managers?brand=TAUWACH')))
assert.deepEqual(managers.managers.map(m=>m.name),['Alice'])
managers=await j(await listWatchManagers(db,alice,new URL('https://test.invalid/api/client3/watches/managers?brand=WACHIZEN')))
assert.equal(managers.status,403)
x=await j(await listWatchModels(db,alice,new URL('https://test.invalid/api/client3/watches/models?brand=WACHIZEN')))
assert.equal(x.status,403);assert.equal(x.models,undefined)
x=await j(await listWatchModels(db,bob,new URL('https://test.invalid/api/client3/watches/models?brand=WACHIZEN')))
assert.equal(x.models.length,1);assert.equal(x.models[0].officePhysical,9)
const allUrl=new URL('https://test.invalid/api/client3/watches/logistics')
x=await j(await listWatchLogistics(db,alice,allUrl))
assert.equal(x.rows.length,1);assert.equal(x.rows[0].brand,'TAUWACH')
assert.equal(x.rows[0].engravingText,'A + M')
assert.equal(x.rows[0].reservationStatus,'active')
assert.equal(x.rows[0].postalCode,'050000')
assert.equal(x.rows[0].legacySource,'warehouse')
assert.equal(x.rows[0].shippingStatus,'not_sent')
assert.equal(x.rows[0].urgent,1)
assert.equal(x.rows[0].shippingDeadlineAt,'2026-11-15T12:00:00Z')
assert(!Object.prototype.hasOwnProperty.call(x.rows[0],'total_amount'),'Logistic DTO must not contain money')
x=await j(await listWatchLogistics(db,alice,new URL('https://test.invalid/api/client3/watches/logistics?brand=WACHIZEN')))
assert.equal(x.status,403)
x=await j(await listWatchLogistics(db,logistics,allUrl))
assert.equal(x.rows.length,2)
x=await j(await listWatchLogistics(db,admin,allUrl))
assert.equal(x.rows.length,2)
const staff=await j(await listWatchStaff(db,admin))
assert.equal(staff.staff.length,2)
assert.deepEqual(staff.staff.find(x=>x.id===1).brands,['TAUWACH'])
const managerDenied=await j(await listWatchStaff(db,alice))
assert.equal(managerDenied.status,403)
let assignment=await j(await assignWatchManagerBrands(db,alice,1,{brands:['TAUWACH','WACHIZEN'],expectedBrands:['TAUWACH'],requestId:'assign-one-1'}))
assert.equal(assignment.status,403)
assignment=await j(await assignWatchManagerBrands(db,admin,1,{brands:['TAUWACH','WACHIZEN'],expectedBrands:['TAUWACH'],requestId:'assign-one-1'}))
assert.equal(assignment.status,200)
assignment=await j(await assignWatchManagerBrands(db,admin,1,{brands:['TAUWACH','WACHIZEN'],expectedBrands:['TAUWACH'],requestId:'assign-one-1'}))
assert.equal(assignment.alreadyCommitted,true)
assignment=await j(await assignWatchManagerBrands(db,admin,1,{brands:['TAUWACH'],expectedBrands:['TAUWACH'],requestId:'assign-two-1'}))
assert.equal(assignment.status,409)
assert.equal(sql.prepare('SELECT COUNT(*) AS c FROM watch_manager_brand_events').get().c,1)
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])
const unchanged=()=>({
  stocks:sql.prepare('SELECT id,quantity,reserved_quantity FROM inventory_stock ORDER BY id').all(),
  payments:sql.prepare('SELECT order_id,amount FROM payments ORDER BY id').all(),
  orders:sql.prepare('SELECT id,total_amount,received_amount,debt_amount FROM orders ORDER BY id').all(),
})
const before=unchanged()
let r=await j(await markWatchLogisticsReady(db,alice,1,200,'watch-req-1'));assert.equal(r.status,403)
r=await j(await markWatchLogisticsReady(db,logistics,1,200,'watch-req-1'))
assert.equal(r.status,200);assert.equal(r.engravingReady,true)
assert.equal(r.shippingUnchanged,true)
assert.deepEqual(unchanged(),before)
assert.equal(sql.prepare("SELECT count(*) AS c FROM watch_logistics_events").get().c,1)
assert.equal(sql.prepare("SELECT order_item_id FROM watch_logistics_events LIMIT 1").get().order_item_id,200)
assert.equal(sql.prepare("SELECT engraving_text FROM watch_engraving_item_readiness WHERE order_item_id=200").get().engraving_text,'A + M')
r=await j(await markWatchLogisticsReady(db,logistics,1,200,'watch-req-1'))
assert.equal(r.alreadyReady,true)
r=await j(await markWatchLogisticsReady(db,logistics,2,201,'watch-req-1'))
assert.equal(r.status,409,'Request IDs must not be reusable across orders')
r=await j(await markWatchLogisticsReady(db,logistics,1,200,'watch-req-2'))
assert.equal(r.alreadyReady,true)
assert.equal(sql.prepare("SELECT count(*) AS c FROM watch_logistics_events").get().c,1)
assert.deepEqual(unchanged(),before)
// Brand access cannot survive manager deactivation.
sql.prepare('UPDATE managers SET is_active=0 WHERE id=2').run()
const revoked=await j(await listWatchBrands(db,bob))
assert.deepEqual(revoked.brands,[])
const deniedModel=await j(await listWatchModels(db,bob,new URL('https://test.invalid/api/client3/watches/models?brand=WACHIZEN')))
assert.equal(deniedModel.status,403)
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[])
sql.close()
console.log('CLIENT3_WATCH_BRAND_API_AND_LOGISTICS_PASS: brand access on DB identities, Office/Showcase, delivery/engraving, idempotent ready, money/stock unchanged')
