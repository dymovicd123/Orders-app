import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { correctShippingMarkerAfterStandaloneReturn } from '../worker/domains/order-shipping-scoped-correction.ts'

const sql = new DatabaseSync(':memory:')
sql.exec(`
  CREATE TABLE orders(id INTEGER PRIMARY KEY,external_id TEXT,shipping_status TEXT,shipping_date TEXT,order_status TEXT,archived_at TEXT,updated_at TEXT);
  CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY,order_id INTEGER,status TEXT,fulfilled_at TEXT);
  CREATE TABLE inventory_movements(id INTEGER PRIMARY KEY,reference_id TEXT,movement_type TEXT,created_at TEXT,quantity_delta INTEGER);
  CREATE TABLE activity_log(id INTEGER PRIMARY KEY,event_type TEXT,entity_type TEXT,entity_id INTEGER,order_id INTEGER,external_order_id TEXT,title TEXT,details TEXT,amount INTEGER,created_at TEXT);
`)
const db = {
  prepare(query) {
    let bindings = []
    return {
      bind(...args) { bindings = args; return this },
      async first() { return sql.prepare(query).get(...bindings) || null },
      async all() { return { results: sql.prepare(query).all(...bindings) } },
      async run() { return { meta: { changes: sql.prepare(query).run(...bindings).changes } } },
    }
  },
}
function reset() {
  for (const table of ['orders', 'inventory_reservations', 'inventory_movements', 'activity_log']) sql.exec('DELETE FROM ' + table)
  sql.exec(`
    INSERT INTO orders VALUES(2197,'ORD-20261101075119-1D6E28C0','sent','2026-11-01','active',NULL,'2026-11-01T09:00:00.000Z');
    INSERT INTO inventory_reservations VALUES(2209,2197,'fulfilled','2026-11-01T07:50:00.000Z');
    INSERT INTO inventory_movements VALUES(6669,'ORD-20261101075119-1D6E28C0','sale','2026-11-01T07:50:00.000Z',-2);
    INSERT INTO activity_log VALUES(1,'order_shipping_updated','order',2197,2197,'ORD-20261101075119-1D6E28C0','Отправлен',NULL,0,'2026-11-01T09:00:00.000Z');
  `)
}
function state() {
  return {
    shipping: sql.prepare('SELECT shipping_status FROM orders WHERE id=2197').get().shipping_status,
    reserve: (() => { const r = sql.prepare('SELECT status,fulfilled_at FROM inventory_reservations WHERE id=2209').get(); return { status: r.status, fulfilled_at: r.fulfilled_at } })(),
    movementCount: sql.prepare('SELECT COUNT(*) AS n FROM inventory_movements').get().n,
    correctionLogs: sql.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE event_type='order_partial_final_shipping_corrected'").get().n,
  }
}
const correct = () => correctShippingMarkerAfterStandaloneReturn(db,2197,{actor:'QA manager'})
reset()
let response = await correct()
assert.equal(response.statusOnly,true)
assert.equal(response.restoredPhysicalQuantity,0)
assert.deepEqual(state(),{
  shipping:'not_sent',
  reserve:{status:'fulfilled',fulfilled_at:'2026-11-01T07:50:00.000Z'},
  movementCount:1,
  correctionLogs:1,
},'Previous partial handover, stock movement and return must remain immutable')
response = await correct()
assert.equal(response.alreadyCorrected,true)
assert.equal(state().correctionLogs,1,'Idempotent repeat must not create new events')

reset()
sql.exec("INSERT INTO inventory_movements VALUES(6671,'ORD-20261101075119-1D6E28C0','sale','2026-11-01T09:00:00.000Z',-1)")
await assert.rejects(correct(),/списала складские вещи/)
assert.equal(state().shipping,'sent','New physical movement in the last send must not be silently reversed')

reset()
sql.exec("UPDATE inventory_reservations SET fulfilled_at='2026-11-01T09:00:00.000Z' WHERE id=2209")
await assert.rejects(correct(),/списала складские вещи/)
assert.equal(state().shipping,'sent')

reset()
sql.exec("DELETE FROM activity_log")
await assert.rejects(correct(),/Нельзя установить/)
assert.equal(state().shipping,'sent','Missing evidence does not imply absence of issued stock')

reset()
sql.exec("UPDATE orders SET order_status='archived'")
await assert.rejects(correct(),/Архивный/)
assert.equal(state().shipping,'sent')
sql.close()
console.log('WORK733_PARTIAL_RETURN_LAST_SEND_UNDO_PASS: marker-only, idempotent, immutable prior physical/Return, issued and unknown evidence blocked')
