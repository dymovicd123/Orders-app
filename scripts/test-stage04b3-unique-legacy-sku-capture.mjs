import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const migration=fs.readFileSync('migrations/0108_v72_workshop_unique_legacy_sku_pricing.sql','utf8')
assert.match(migration,/COUNT\(\*\)=1/)
assert.match(migration,/v2.is_active=1/)
assert.doesNotMatch(migration,/\bUPDATE\s+workshop_settlement_capture_control\b/i)
assert.doesNotMatch(migration,/\b(?:UPDATE|DELETE\s+FROM)\s+(?:orders|order_items|workshop_tasks|workshop_settlement_events)\b/i)
const config=fs.readFileSync('wrangler.jsonc','utf8')
assert.match(config,/"database_name"\s*:\s*"orders_db_branch2"/)
assert.doesNotMatch(config,/orders_db_prod|17e68a41-1d58-4a36-8a63-47c3e32443c4/)

const d=new DatabaseSync(':memory:')
d.exec('PRAGMA foreign_keys=ON')
d.exec(`
CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,product_id INTEGER,variant_id INTEGER);
CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,product_id INTEGER,stock_position_id INTEGER,category TEXT,
 gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);
CREATE TABLE catalog_execution_prices(stock_position_id INTEGER,category TEXT,cost_price INTEGER,PRIMARY KEY(stock_position_id,category));
CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,variant_id INTEGER,
 product_id INTEGER,external_order_id TEXT,product_name_snapshot TEXT,quantity INTEGER,status TEXT,
 gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT);
`)
d.exec(fs.readFileSync('migrations/0083_v72_workshop_settlement_foundation.sql','utf8'))
d.exec(fs.readFileSync('migrations/0084_v72_workshop_settlement_status_capture.sql','utf8'))
d.exec(fs.readFileSync('migrations/0106_v72_workshop_completion_catalog_cost_snapshot.sql','utf8'))
d.exec(`
INSERT INTO catalog_variants VALUES(301,101,401,'adult','М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48',1);
INSERT INTO catalog_execution_prices VALUES(401,'adult',7000);
INSERT INTO order_items VALUES(21,1,101,NULL);
INSERT INTO workshop_tasks VALUES(11,1,21,NULL,101,'L-1','ШАПАН',2,'active','М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48');
UPDATE workshop_settlement_capture_control SET enabled=1,activated_at='2026-10-11T09:00:00Z' WHERE id=1;
UPDATE workshop_tasks SET status='done' WHERE id=11;
`)
const all=()=>d.prepare('SELECT id,event_type,workshop_task_id,unit_cost,amount_delta,related_event_id FROM workshop_settlement_events ORDER BY id').all()
assert.equal(all().length,1)
assert.equal(all()[0].amount_delta,null,'Old capture has no variant even though exact SKU exists')
// Changing trigger cannot reprice completed work or backfill history.
d.exec(migration)
assert.equal(all().length,1)
assert.equal(all()[0].amount_delta,null)
assert.equal(d.prepare("SELECT enabled FROM workshop_settlement_capture_control WHERE id=1").get().enabled,1)
const add=d.prepare(`INSERT INTO workshop_tasks
 (id,order_id,order_item_id,variant_id,product_id,external_order_id,product_name_snapshot,quantity,status,
  gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot)
 VALUES(?,1,21,NULL,101,?,'ШАПАН',2,'active','М',?,'ХЛОПОК','КОРОТКИЙ','48')`)
const done=d.prepare("UPDATE workshop_tasks SET status='done' WHERE id=?")
add.run(12,'L-2','СИНИЙ')
done.run(12)
let current=all().at(-1)
assert.equal(current.unit_cost,7000)
assert.equal(current.amount_delta,14000,'Unique frozen legacy SKU must charge')
done.run(12)
assert.equal(all().length,2)
d.exec('UPDATE catalog_execution_prices SET cost_price=8000 WHERE stock_position_id=401')
assert.equal(all()[1].amount_delta,14000,'Earlier charge is frozen')
d.exec("UPDATE workshop_tasks SET status='active' WHERE id=12")
assert.equal(all().at(-1).amount_delta,-14000)
add.run(13,'L-3','СИНИЙ')
done.run(13)
assert.equal(all().at(-1).amount_delta,16000,'New completed work uses updated cost')
d.exec(`INSERT INTO catalog_variants VALUES(302,101,402,'adult','М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48',1);
INSERT INTO catalog_execution_prices VALUES(402,'adult',9000);`)
add.run(14,'L-4','СИНИЙ')
done.run(14)
assert.equal(all().at(-1).amount_delta,null,'Two active matching SKUs must not guess a cost')
add.run(15,'L-5','КРАСНЫЙ')
done.run(15)
assert.equal(all().at(-1).amount_delta,null,'Wrong color must not borrow price')
d.exec('UPDATE catalog_variants SET is_active=0 WHERE id=302')
add.run(16,'L-6','СИНИЙ')
done.run(16)
assert.equal(all().at(-1).amount_delta,16000,'Disabled duplicate does not block the unique active SKU')
d.exec("INSERT INTO order_items VALUES(22,999,101,NULL)")
d.exec("INSERT INTO workshop_tasks VALUES(17,1,22,NULL,101,'L-7','ШАПАН',2,'active','М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48')")
done.run(17)
assert.equal(all().at(-1).amount_delta,null,'Never price from an order item belonging to another order')
d.close()
console.log('STAGE04-B3 EXACT LEGACY SKU CAPTURE PASSED — no backfill, one match, duplicate guard, stale price, reversal, wrong order')
