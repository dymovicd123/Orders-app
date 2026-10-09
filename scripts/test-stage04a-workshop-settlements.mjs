import fs from 'node:fs'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'

const migrationPath = 'migrations/0083_v72_workshop_settlement_foundation.sql'
const sql = fs.readFileSync(migrationPath, 'utf8')
const wrangler = fs.readFileSync('wrangler.jsonc', 'utf8')
assert.match(wrangler, /"name"\s*:\s*"orders-app-branch2"/)
assert.match(wrangler, /"database_name"\s*:\s*"orders_db_branch2"/)
assert.match(wrangler, /"database_id"\s*:\s*"40065052-854e-44b8-bcd5-251bdd488301"/)
assert.doesNotMatch(wrangler, /orders_db_prod|17e68a41-1d58-4a36-8a63-47c3e32443c4/)
assert.doesNotMatch(sql, /(?:ALTER|DROP)\s+TABLE\s+(?:orders|order_items|payments|workshop_tasks)\b/i)
assert.doesNotMatch(sql, /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:orders|order_items|payments|workshop_tasks)\b/i)

const db = new DatabaseSync(':memory:')
db.exec('PRAGMA foreign_keys = ON;')
db.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY, total_amount INTEGER NOT NULL); INSERT INTO orders VALUES (1,12345)')
db.exec(sql)
db.exec(sql) // Migration must be schema-idempotent.
assert.equal(db.prepare('SELECT total_amount FROM orders WHERE id=1').get().total_amount, 12345)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM workshop_settlement_events').get().n, 0)

const insert = db.prepare(`INSERT INTO workshop_settlement_events
  (event_key,event_type,business_date,occurred_at,workshop_task_id,order_id,quantity,unit_cost,amount_delta,related_event_id)
  VALUES (?,?,?,?,?,?,?,?,?,?)`)
const at = '2026-10-09T09:00:00.000Z', day = '2026-10-09'
insert.run('task:7:done:1','completion',day,at,7,1,3,4500,13500,null)
assert.throws(() => insert.run('task:7:done:1','completion',day,at,7,1,3,4500,13500,null), /UNIQUE/) // Lost-response replay.
assert.throws(() => insert.run('bad:math','completion',day,at,8,1,3,4500,12000,null), /CHECK/)
assert.throws(() => insert.run('bad:quantity','completion',day,at,8,1,0,4500,0,null), /CHECK/)
assert.throws(() => insert.run('bad:negative','completion',day,at,8,1,1,-1,-1,null), /CHECK/)

insert.run('task:8:done:1','completion',day,at,8,1,2,null,null,null) // Missing price is not zero.
assert.equal(db.prepare('SELECT amount_delta FROM workshop_settlement_events WHERE event_key=?').get('task:8:done:1').amount_delta,null)

insert.run('payment:demo:1','payment',day,at,null,null,null,null,-9000,null)
assert.equal(db.prepare('SELECT SUM(amount_delta) AS n FROM workshop_settlement_events').get().n,4500)
assert.throws(()=> insert.run('bad:payment','payment',day,at,null,null,null,null,1000,null), /CHECK/)

const charge = db.prepare("SELECT id FROM workshop_settlement_events WHERE event_key='task:7:done:1'").get().id
insert.run('task:7:reversal:1','completion_reversal',day,at,7,1,null,null,-13500,charge)
assert.throws(()=> insert.run('task:7:reversal:duplicate','completion_reversal',day,at,7,1,null,null,-13500,charge), /UNIQUE/)
assert.equal(db.prepare('SELECT SUM(amount_delta) AS n FROM workshop_settlement_events').get().n,-9000) // An advance, not negative fabricated work.
assert.throws(()=> db.exec("UPDATE workshop_settlement_events SET amount_delta=0 WHERE event_key='payment:demo:1'"), /immutable/)
assert.throws(()=> db.exec("DELETE FROM workshop_settlement_events WHERE event_key='payment:demo:1'"), /immutable/)
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM workshop_settlement_events WHERE event_type='completion' AND amount_delta IS NULL").get().n,1)

db.close()
console.log('STAGE04-A SETTLEMENT FOUNDATION PASSED — additive empty migration, priced/pending work, partial payment, compensating reversal, uniqueness, and immutable history')
