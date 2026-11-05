import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { buildOrderShipmentPlan } from '../worker/domains/order-shipment-plan.ts'
import { confirmPriorIssuedOrderShipping, correctPriorIssuedOrderShippingIfApplicable } from '../worker/domains/order-prior-issued-shipping.ts'
import { projectOrderShipmentDisplay } from '../src/app/orderShipmentProjection.ts'

const sql = new DatabaseSync(':memory:')
for (const migration of fs.readdirSync('migrations').filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
  sql.exec(fs.readFileSync('migrations/' + migration, 'utf8'))
}
const stmt = (query, bindings = []) => ({
  bind(...values) { return stmt(query, values) },
  async first() { return sql.prepare(query).get(...bindings) || null },
  async all() { return { results: sql.prepare(query).all(...bindings) } },
  async run() {
    const result = sql.prepare(query).run(...bindings)
    return { meta: { changes: Number(result.changes) } }
  },
})
const db = {
  prepare: query => stmt(query),
  async batch(statements) {
    sql.exec('SAVEPOINT prior_issue_atomic')
    try {
      const result = []
      for (const statement of statements) result.push(await statement.run())
      sql.exec('RELEASE prior_issue_atomic')
      return result
    } catch (error) {
      sql.exec('ROLLBACK TO SAVEPOINT prior_issue_atomic')
      sql.exec('RELEASE prior_issue_atomic')
      throw error
    }
  },
}
sql.prepare("INSERT OR IGNORE INTO managers(id,name) VALUES (1,'Prior issue tester')").run()
sql.prepare("INSERT INTO catalog_products(id,name,category,is_active) VALUES (9021,'PRIOR ISSUE TEST','adult',1)").run()
sql.prepare("INSERT INTO catalog_variants(id,product_id,gender,color,material,length,size_label,is_active) VALUES(9031,9021,'МУЖ','БЕЖ','СТАНДАРТ','СТАНДАРТ','50',1)").run()
sql.prepare("INSERT INTO inventory_stock(id,inventory_source,product_id,variant_id,product_name_snapshot,quantity,reserved_quantity) VALUES (9041,'warehouse',9021,9031,'PRIOR ISSUE TEST',8,0)").run()

function seed(orderId, itemStatuses, reservations = itemStatuses) {
  sql.prepare(`INSERT INTO orders(id,external_id,order_date,manager_id,order_status,source_type,workshop_status,shipping_status,created_at,updated_at)
    VALUES(?,?,'2026-11-05',1,'active','warehouse','ready','not_sent','2026-11-05T00:00:00Z','2026-11-05T00:00:00Z')`)
    .run(orderId, 'ORD-TEST-ISSUED-' + orderId)
  return itemStatuses.map((stockWriteoffStatus, index) => {
    const id = orderId * 10 + index
    sql.prepare(`INSERT INTO order_items(id,order_id,product_id,variant_id,product_name_snapshot,quantity,
      unit_price,line_total,is_workshop,source_type,stock_writeoff_status,created_at)
      VALUES(?,?,9021,9031,'PRIOR ISSUE TEST',1,5000,5000,0,'warehouse',?,'2026-11-05T00:00:00Z')`)
      .run(id, orderId, stockWriteoffStatus)
    if (reservations[index]) {
      sql.prepare(`INSERT INTO inventory_reservations(order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,created_at,updated_at)
        VALUES(?,?,'warehouse',9021,9031,1,?,'2026-11-05T00:00:00Z','2026-11-05T00:00:00Z')`)
        .run(orderId, id, reservations[index] === 'fulfilled' ? 'fulfilled' : 'active')
    }
    return { id, quantity: 1, productName: 'PRIOR ISSUE TEST',
      stockWriteoffStatus, sourceType: 'warehouse', isWorkshop: false }
  })
}
const readReservations = orderId => sql.prepare(
  'SELECT order_item_id,quantity,status,variant_id FROM inventory_reservations WHERE order_id=?',
).all(orderId)
const plan = (id, items) => buildOrderShipmentPlan({
  id, external_id: 'ORD-TEST-ISSUED-' + id, shipping_status: 'not_sent', items,
}, readReservations(id))
const confirm = id => confirmPriorIssuedOrderShipping(db, id, { shippingDate: '2026-11-05', actor: 'QA' })
const stockBefore = sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get()
const movementsBefore = sql.prepare('SELECT COUNT(*) AS c FROM inventory_movements').get().c

const items = seed(9501, ['fulfilled', 'fulfilled'])
const draft = plan(9501, items)
assert.equal(draft.canConfirmIssuedOnly, true)
assert.equal(draft.selectedQuantity, 0)
assert.equal(draft.lines.filter(row => row.reason === 'Уже выдан').length, 2)
assert.equal(projectOrderShipmentDisplay({ shipping_status: 'not_sent', items }).state, 'not_sent')
// Failed activity logging must roll back the shipping marker atomically.
const activityTrigger = `CREATE TRIGGER reject_prior_issue_log BEFORE INSERT ON activity_log
  WHEN NEW.event_type='order_prior_issued_shipping_confirmed'
  BEGIN SELECT RAISE(ABORT,'fixture activity storage unavailable'); END`
sql.exec(activityTrigger)
await assert.rejects(confirm(9501), /fixture activity storage unavailable/)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9501').get().shipping_status,'not_sent')
sql.exec('DROP TRIGGER reject_prior_issue_log')
const result = await confirm(9501)
assert.equal(result.statusOnly, true)
assert.equal(result.stockDeducted, 0)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9501').get().shipping_status, 'sent')
assert.equal(projectOrderShipmentDisplay({ shipping_status: 'sent', items }).state, 'sent')
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get(), stockBefore)
assert.equal(sql.prepare('SELECT COUNT(*) AS c FROM inventory_movements').get().c, movementsBefore)
assert.deepEqual(readReservations(9501).map(row => row.status), ['fulfilled', 'fulfilled'])
await assert.rejects(confirm(9501), /Обновите отправку/)
const corrected = await correctPriorIssuedOrderShippingIfApplicable(db, 9501, {
  actor: 'QA', physicalOutcome: 'not_issued',
})
assert.equal(corrected.statusOnly, true)
assert.equal(corrected.restoredPhysicalQuantity, 0)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9501').get().shipping_status, 'not_sent')
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get(), stockBefore)
assert.deepEqual(readReservations(9501).map(row => row.status), ['fulfilled', 'fulfilled'])
await assert.rejects(correctPriorIssuedOrderShippingIfApplicable(db, 9501, {
  actor: 'QA', physicalOutcome: 'not_issued',
}), /изменился/)
await confirm(9501)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9501').get().shipping_status, 'sent')
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get(), stockBefore)

const mixed = seed(9502, ['fulfilled', 'reserved'])
assert.equal(plan(9502, mixed).canConfirmIssuedOnly, false)
await assert.rejects(confirm(9502), /Обновите отправку/)
assert.equal(sql.prepare('SELECT shipping_status FROM orders WHERE id=9502').get().shipping_status, 'not_sent')

const missing = seed(9503, ['fulfilled'], [null])
assert.equal(plan(9503, missing).canConfirmIssuedOnly, false)
await assert.rejects(confirm(9503), /Обновите отправку/)

const returned = seed(9504, ['fulfilled'])
sql.prepare(`INSERT INTO returns(id,order_id,manager_id,return_date,amount,comment,created_at)
  VALUES(9544,9504,1,'2026-11-05',0,'Physical return','2026-11-05T00:00:00Z')`).run()
sql.prepare(`INSERT INTO return_items(return_id,order_item_id,product_name_snapshot,quantity,amount,created_at)
  VALUES(9544,?, 'PRIOR ISSUE TEST',1,0,'2026-11-05T00:00:00Z')`).run(returned[0].id)
await assert.rejects(confirm(9504), /Обновите отправку/)

seed(9505, ['fulfilled'])
sql.prepare(`INSERT INTO order_dispatches(order_id,request_id,dispatch_date,created_at,actor,status)
  VALUES(9505,'test-earlier-dispatch-9505','2026-11-05','2026-11-05T00:00:00Z','QA','sent')`).run()
await assert.rejects(confirm(9505), /Обновите отправку/)
assert.deepEqual(sql.prepare('SELECT quantity,reserved_quantity FROM inventory_stock WHERE id=9041').get(), stockBefore)

const view = fs.readFileSync('src/features/sections/OrdersTableSection.tsx', 'utf8')
assert(view.includes('confirmAlreadyIssued:true'))
assert(view.includes('Подтвердить отправку без повторного списания'))
console.log('MAIN_PRIOR_ISSUED_SHIPPING_SAFE_PASS')
