import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import {
  listUnpricedWorkshopCompletions, confirmUnpricedWorkshopCompletionCost,
} from '../worker/domains/workshop-settlement-prices.ts'

const dbRaw=new DatabaseSync(':memory:')
dbRaw.exec('PRAGMA foreign_keys=ON')
dbRaw.exec(String(fs.readFileSync('migrations/0083_v72_workshop_settlement_foundation.sql','utf8')))
dbRaw.exec(String(fs.readFileSync('migrations/0107_v72_workshop_settlement_payment_method.sql','utf8')))
dbRaw.exec(`
  CREATE TABLE workshop_settlement_capture_control(id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL);
  INSERT INTO workshop_settlement_capture_control VALUES(1,0);
  CREATE TABLE workshop_tasks(id INTEGER PRIMARY KEY,order_id INTEGER,order_item_id INTEGER,variant_id INTEGER,
   product_id INTEGER,product_name_snapshot TEXT,quantity INTEGER,status TEXT,
   gender_snapshot TEXT,color_snapshot TEXT,material_snapshot TEXT,length_snapshot TEXT,size_snapshot TEXT);
  CREATE TABLE order_items(id INTEGER PRIMARY KEY,order_id INTEGER,variant_id INTEGER,product_id INTEGER);
  CREATE TABLE catalog_variants(id INTEGER PRIMARY KEY,stock_position_id INTEGER,category TEXT,product_id INTEGER,gender TEXT,color TEXT,material TEXT,length TEXT,size_label TEXT,is_active INTEGER);
  CREATE TABLE catalog_execution_prices(stock_position_id INTEGER,category TEXT,cost_price INTEGER,PRIMARY KEY(stock_position_id,category));
  INSERT INTO catalog_variants VALUES(301,401,'adult',101,'М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48',1);
  INSERT INTO catalog_execution_prices VALUES(401,'adult',NULL);
  INSERT INTO order_items VALUES(21,1,301,101);
  INSERT INTO workshop_tasks VALUES(11,1,21,301,101,'ШАПАН',2,'done','М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48');
`)
const adapter={
  prepare(sql){
    let values=[]
    return {
      bind(...v){values=v;return this},
      async first(){return dbRaw.prepare(sql).get(...values)??null},
      async all(){return {results:dbRaw.prepare(sql).all(...values)}},
      async run(){return {meta:dbRaw.prepare(sql).run(...values)}},
    }
  },
}
const now='2026-10-11T10:00:00Z',day='2026-10-11'
const insert=dbRaw.prepare(`INSERT INTO workshop_settlement_events
 (event_key,event_type,business_date,occurred_at,workshop_task_id,order_id,order_item_id,
  external_order_id,product_name_snapshot,details_snapshot,quantity,unit_cost,amount_delta)
 VALUES(?, 'completion', ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`)
const details=JSON.stringify({gender:'М',color:'СИНИЙ',material:'ХЛОПОК',length:'КОРОТКИЙ',size:'48'})
insert.run('first',day,now,11,1,21,'ORDER-1','ШАПАН',details,2)
let queue=await listUnpricedWorkshopCompletions(adapter)
assert.equal(queue.items.length,1)
assert.equal(queue.items[0].availableUnitCost,null)
assert.equal(queue.total,1)
assert.equal(queue.items[0].catalogProductId,101)
assert.equal(queue.items[0].resolutionState,'missing_cost')
assert.equal(queue.items[0].productName,'ШАПАН')
await assert.rejects(confirmUnpricedWorkshopCompletionCost(adapter,1,12),e=>e.code==='settlements_not_active')
dbRaw.exec('UPDATE workshop_settlement_capture_control SET enabled=1 WHERE id=1')
await assert.rejects(confirmUnpricedWorkshopCompletionCost(adapter,1,12),e=>e.code==='unpriced_cost_still_unresolved')
dbRaw.exec("UPDATE catalog_execution_prices SET cost_price=3500 WHERE stock_position_id=401")
queue=await listUnpricedWorkshopCompletions(adapter)
assert.equal(queue.items[0].availableUnitCost,3500)
assert.equal(queue.items[0].resolutionState,'ready')
const resolved=await confirmUnpricedWorkshopCompletionCost(adapter,1,12)
assert.equal(resolved.replayed,false)
let record=dbRaw.prepare("SELECT related_event_id,quantity,unit_cost,amount_delta,event_type FROM workshop_settlement_events WHERE id=?").get(resolved.id)
assert.deepEqual([record.related_event_id,record.quantity,record.unit_cost,record.amount_delta,record.event_type],[1,2,3500,7000,'price_adjustment'])
assert.equal(dbRaw.prepare("SELECT amount_delta FROM workshop_settlement_events WHERE id=1").get().amount_delta,null)
assert.equal((await listUnpricedWorkshopCompletions(adapter)).items.length,0)
dbRaw.exec("UPDATE catalog_execution_prices SET cost_price=9000 WHERE stock_position_id=401")
const repeated=await confirmUnpricedWorkshopCompletionCost(adapter,1,12)
assert.equal(repeated.replayed,true)
assert.equal(repeated.id,resolved.id)
assert.equal(dbRaw.prepare('SELECT amount_delta FROM workshop_settlement_events WHERE id=?').get(resolved.id).amount_delta,7000)
assert.equal(dbRaw.prepare("SELECT COUNT(*) AS n FROM workshop_settlement_events WHERE event_type='price_adjustment'").get().n,1)

// A changed or mismatched item cannot borrow the Catalog price.
dbRaw.exec("INSERT INTO workshop_tasks VALUES(12,1,21,301,101,'ШАПАН',2,'done','М','КРАСНЫЙ','ХЛОПОК','КОРОТКИЙ','48')")
insert.run('mismatch',day,now,12,1,21,'ORDER-2','ШАПАН',details,2)
queue=await listUnpricedWorkshopCompletions(adapter)
assert.equal(queue.items[0].id,3)
assert.equal(queue.items[0].availableUnitCost,null)
assert.equal(queue.items[0].resolutionState,'needs_match')
assert.equal(queue.items[0].catalogProductId,null)
await assert.rejects(confirmUnpricedWorkshopCompletionCost(adapter,3,12),e=>e.code==='unpriced_cost_still_unresolved')

// Legacy direct order-item links may have neither an item.variant_id nor task.variant_id.
// Exactly one active full-SKU match is safe to price; near matches must remain unresolved.
dbRaw.exec(`
  INSERT INTO order_items VALUES(22,1,NULL,101);
  INSERT INTO workshop_tasks VALUES(13,1,22,NULL,101,'ШАПАН',2,'done','М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48');
`)
insert.run('legacy-full-match',day,now,13,1,22,'ORDER-3','ШАПАН',details,2)
queue=await listUnpricedWorkshopCompletions(adapter)
assert.equal(queue.items.length,2)
assert.equal(queue.total,2)
assert.equal(queue.items[0].availableUnitCost,9000)
assert.equal(queue.items[0].catalogProductId,101)
assert.equal(queue.items[0].resolutionState,'ready')
const legacyFixed=await confirmUnpricedWorkshopCompletionCost(adapter,5,12)
assert.equal(legacyFixed.replayed,false)
assert.equal(dbRaw.prepare('SELECT amount_delta FROM workshop_settlement_events WHERE id=?').get(legacyFixed.id).amount_delta,18000)
assert.equal(dbRaw.prepare('SELECT amount_delta FROM workshop_settlement_events WHERE id=5').get().amount_delta,null)
assert.equal((await confirmUnpricedWorkshopCompletionCost(adapter,5,12)).replayed,true)

// Ambiguity: a duplicate SKU must NOT silently charge either execution.
dbRaw.exec(`
  INSERT INTO catalog_variants VALUES(302,402,'adult',101,'М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48',1);
  INSERT INTO catalog_execution_prices VALUES(402,'adult',9500);
  INSERT INTO workshop_tasks VALUES(14,1,22,NULL,101,'ШАПАН',1,'done','М','СИНИЙ','ХЛОПОК','КОРОТКИЙ','48');
`)
insert.run('legacy-ambiguous',day,now,14,1,22,'ORDER-4','ШАПАН',details,1)
queue=await listUnpricedWorkshopCompletions(adapter)
assert.equal(queue.items.length,2)
assert.equal(queue.items[0].availableUnitCost,null)
assert.equal(queue.items[0].resolutionState,'needs_match')
await assert.rejects(confirmUnpricedWorkshopCompletionCost(adapter,7,12),e=>e.code==='unpriced_cost_still_unresolved')
dbRaw.exec('UPDATE catalog_variants SET is_active=0 WHERE id=302')
queue=await listUnpricedWorkshopCompletions(adapter)
assert.equal(queue.items[0].availableUnitCost,9000)
assert.equal(queue.items[0].resolutionState,'ready')

// Similar color/size but different material/length must never be borrowed.
dbRaw.exec("UPDATE workshop_tasks SET material_snapshot='ШЁЛК' WHERE id=14")
queue=await listUnpricedWorkshopCompletions(adapter)
assert.equal(queue.items[0].resolutionState,'needs_match')
await assert.rejects(confirmUnpricedWorkshopCompletionCost(adapter,7,12),e=>e.code==='unpriced_cost_still_unresolved')

// Reversed missing-price completions leave the queue.
dbRaw.exec(`INSERT INTO workshop_settlement_events
 (event_key,event_type,business_date,occurred_at,related_event_id,workshop_task_id,order_id,amount_delta)
 VALUES('reversal','completion_reversal','2026-10-11','2026-10-11T11:00:00Z',3,12,1,NULL)`)
assert.equal((await listUnpricedWorkshopCompletions(adapter)).items.length,1)
assert.equal((await listUnpricedWorkshopCompletions(adapter)).items[0].id,7)
dbRaw.close()

const section=fs.readFileSync('src/features/sections/WorkshopSection.tsx','utf8')
const ui=fs.readFileSync('src/features/workshop/WorkshopSettlementsPanel.tsx','utf8')
const worker=fs.readFileSync('worker/index.ts','utf8')
assert.match(section,/Расчёты с Цехом/)
assert.match(section,/canSeeSettlements/)
assert.match(section,/WorkshopSettlementsPanel/)
assert.match(ui,/aria-label="Расчёты с Цехом"/)
assert.match(ui,/openCatalogPrice/)
assert.match(ui,/Указать себестоимость/)
assert.match(ui,/Проверить товар/)
const workshopApp=fs.readFileSync('src/App.tsx','utf8')
assert.match(workshopApp,/openWorkshopCatalogPrice/)
assert.match(workshopApp,/setExpandedCatalogProducts\(exactProductId/)
assert.match(workshopApp,/window.location.hash = '#catalog'/)
assert.match(section,/ws-unpriced-attention/)
assert.match(section,/ws-unpriced-tab-count/)
assert.match(section,/unpricedCount/)
assert.match(section,/openUnpricedRequest/)
assert.match(section,/canSeeSettlements && unpricedCount/)

assert.match(ui,/captureEnabled/)
assert.match(ui,/confirmedDebt/)
assert.match(ui,/paymentIdempotency/)
assert.match(ui,/role="alert"/)
assert.match(ui,/Начисления|начисления|выплаты/i)
assert.match(worker,/\/api\/workshop\/settlements\/unpriced/)
assert.match(worker,/requireAdminUser\(authUser/)
console.log('STAGE04-D WORKSHOP SETTLEMENTS PASSED — immutable price confirmation, mismatched SKU rejection, replay, reversal queue, protected UI and admin routes')
