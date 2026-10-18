import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migration = fs.readFileSync('migrations/0106_v72_workshop_completion_catalog_cost_snapshot.sql', 'utf8')
const base = fs.readFileSync('migrations/0083_v72_workshop_settlement_foundation.sql', 'utf8')
const original = fs.readFileSync('migrations/0084_v72_workshop_settlement_status_capture.sql', 'utf8')
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8')
assert.match(wrangler, /"name"\s*:\s*"orders-app-branch2"/)
assert.match(wrangler, /"database_name"\s*:\s*"orders_db_branch2"/)
assert.match(wrangler, /"database_id"\s*:\s*"40065052-854e-44b8-bcd5-251bdd488301"/)
assert.doesNotMatch(wrangler, /orders_db_prod|17e68a41-1d58-4a36-8a63-47c3e32443c4/)
assert.match(migration, /DROP TRIGGER IF EXISTS trg_workshop_settlement_completion/)
assert.doesNotMatch(migration, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:orders|order_items|payments|catalog_execution_prices|workshop_tasks)\b/i)
assert.doesNotMatch(migration, /(?:ALTER|DROP)\s+TABLE\s+/i)
assert.doesNotMatch(migration, /UPDATE\s+workshop_settlement_capture_control/i)

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys=ON')
db.exec(`
  CREATE TABLE orders (id INTEGER PRIMARY KEY);
  CREATE TABLE order_items (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, product_id INTEGER,
    variant_id INTEGER, is_workshop INTEGER DEFAULT 1
  );
  CREATE TABLE catalog_variants (
    id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL,
    stock_position_id INTEGER, category TEXT NOT NULL
  );
  CREATE TABLE catalog_execution_prices (
    stock_position_id INTEGER NOT NULL, category TEXT NOT NULL,
    cost_price INTEGER, sale_price INTEGER,
    PRIMARY KEY (stock_position_id, category)
  );
  CREATE TABLE workshop_tasks (
    id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL, order_item_id INTEGER,
    product_id INTEGER, variant_id INTEGER, external_order_id TEXT,
    product_name_snapshot TEXT, quantity INTEGER NOT NULL, status TEXT NOT NULL,
    gender_snapshot TEXT, color_snapshot TEXT, material_snapshot TEXT,
    length_snapshot TEXT, size_snapshot TEXT
  );
`)
db.exec(base)
db.exec(original)
db.exec(migration)
db.exec(migration)
assert.equal(db.prepare('SELECT enabled FROM workshop_settlement_capture_control WHERE id=1').get().enabled, 0)

db.exec(`
  INSERT INTO orders(id) VALUES (1),(2);
  INSERT INTO catalog_variants(id,product_id,stock_position_id,category) VALUES
    (11,101,501,'adult'),(12,101,501,'child'),(13,102,502,'adult'),
    (14,101,503,'adult'),(15,103,504,'adult');
  INSERT INTO catalog_execution_prices(stock_position_id,category,cost_price,sale_price) VALUES
    (501,'adult',4500,12000),(501,'child',2400,7500),
    (502,'adult',NULL,9000),(503,'adult',0,1000),
    (504,'adult',9000,21000);
  INSERT INTO order_items(id,order_id,product_id,variant_id) VALUES
    (101,1,101,11),(102,1,101,12),(103,1,102,13),
    (104,1,101,14),(105,1,103,15),(106,2,101,11);
  INSERT INTO workshop_tasks(id,order_id,order_item_id,product_id,variant_id,external_order_id,product_name_snapshot,quantity,status) VALUES
    (1,1,101,101,11,'A-1','Шапан',2,'active'),
    (2,1,102,101,12,'A-2','Шапан детский',3,'active'),
    (3,1,103,102,13,'A-3','Без цены',1,'active'),
    (4,1,104,101,14,'A-4','Нулевая цена',2,'active'),
    (5,1,105,103,11,'A-5','Конфликт SKU',1,'active'),
    (6,1,106,101,11,'A-6','Чужая позиция',1,'active'),
    (7,1,NULL,101,11,'A-7','Старый цех',2,'active'),
    (8,1,NULL,NULL,NULL,'A-8','Нет SKU',1,'active');
`)
const change = db.prepare('UPDATE workshop_tasks SET status=? WHERE id=?')
const read = () => db.prepare(`SELECT id,event_type,workshop_task_id,order_item_id,quantity,unit_cost,amount_delta,
  related_event_id FROM workshop_settlement_events ORDER BY id`).all()

change.run('done',1)
assert.equal(read().length,0,'price snapshot must remain completely dormant before cutover')
change.run('active',1)
assert.equal(read().length,0)
db.exec("UPDATE workshop_settlement_capture_control SET enabled=1,activated_at='2026-10-11T00:00:00Z' WHERE id=1")
change.run('done',1)
assert.deepEqual([read()[0].unit_cost,read()[0].amount_delta,read()[0].order_item_id],[4500,9000,101])
change.run('done',1)
change.run('ready',1)
assert.equal(read().length,1,'repeated ready/done writes are not new work')
db.exec("UPDATE catalog_execution_prices SET cost_price=6500 WHERE stock_position_id=501 AND category='adult'")
assert.equal(read()[0].unit_cost,4500)
assert.equal(read()[0].amount_delta,9000)
change.run('active',1)
assert.deepEqual([read()[1].event_type,read()[1].related_event_id,read()[1].amount_delta],
  ['completion_reversal',read()[0].id,-9000])
change.run('done',1)
assert.deepEqual([read()[2].unit_cost,read()[2].amount_delta],[6500,13000],
  'repeated work after reversal uses new current cost without repricing old journal')

db.exec("UPDATE workshop_tasks SET status='done' WHERE id IN (2,3,4,5,6,7,8)")
const byTask = new Map(read().filter(x=>x.event_type==='completion').map(x=>[x.workshop_task_id,x]))
assert.deepEqual([byTask.get(2).unit_cost,byTask.get(2).amount_delta],[2400,7200],
  'child price is separate from adult price of the same execution')
assert.equal(byTask.get(3).unit_cost,null,'missing catalog cost stays pending')
assert.equal(byTask.get(3).amount_delta,null)
assert.deepEqual([byTask.get(4).unit_cost,byTask.get(4).amount_delta],[0,0],
  'explicit catalog zero differs from missing cost')
assert.equal(byTask.get(5).amount_delta,null,'conflicting direct task/item SKU must not guess')
assert.equal(byTask.get(6).amount_delta,null,'cross-order item link must not borrow a cost')
assert.equal(byTask.get(7).amount_delta,13000,'known task SKU can resolve without an item link')
assert.equal(byTask.get(8).amount_delta,null,'missing SKU stays pending')

db.exec('UPDATE workshop_settlement_capture_control SET enabled=0 WHERE id=1')
const n=read().length
change.run('done',8)
assert.equal(read().length,n)
change.run('active',1)
assert.equal(read().at(-1).amount_delta,-13000)
assert.throws(()=>db.exec('UPDATE workshop_settlement_events SET unit_cost=1 WHERE id=1'),/immutable/)
db.close()
console.log('STAGE04-B2 CATALOG COST SNAPSHOT PASSED — adult/child, bulk, missing/zero, identity guards, freeze, reversal, inert cutover')
