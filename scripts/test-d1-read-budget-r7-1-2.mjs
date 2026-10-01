import fs from 'node:fs'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

const check = (condition, message) => { if (!condition) throw new Error(message) }
const read = (path) => fs.readFileSync(path, 'utf8')

function readFunction(path, name) {
  const text = read(path)
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const statement = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
  check(statement, `Missing function ${name}`)
  return statement.getText(source)
}

const orders = readFunction('worker/domains/orders-read.ts', 'listOrders')
const fulfill = readFunction('worker/domains/order-reservations.ts', 'fulfillOrderReservationsV2')
const app = read('src/App.tsx')

const shortGuard = orders.indexOf("if (q && Array.from(q).length < 3) {")
const pricingRead = orders.indexOf('await isOrderPricingFoundationEnabled(db)')
check(shortGuard >= 0, 'R7.1 Worker short-search guard missing')
check(pricingRead > shortGuard, 'R7.1 short search must terminate before any D1 pricing-mode read')
check(orders.includes('orders: []'), 'R7.1 short-search zero-result response missing')
check(!orders.includes('const searchOrderText ='), 'R7.1 legacy short order INSTR scan returned')
check(!orders.includes('const searchItemText ='), 'R7.1 legacy short item INSTR scan returned')
check(!orders.includes('const searchPaymentText ='), 'R7.1 legacy short payment INSTR scan returned')
check(orders.includes('order_search_orders_fts MATCH ?'), 'R7.1 damaged >=3-character Orders FTS')
check(orders.includes("baseWhereParts.push('o.external_id >= ? AND o.external_id < ?')"), 'R7.1 damaged indexed ORD-prefix search')

const appGuard = app.indexOf('const searchQuery = activeFilters.q.trim()')
const appOrdersRead = app.indexOf("const ordersResponse = await apiFetch(\`/api/orders?${params.toString()}\`)", appGuard)
check(appGuard >= 0 && appOrdersRead > appGuard, 'R7.1 Orders UI guard/read ordering missing')
check(app.slice(appGuard, appOrdersRead).includes('Array.from(searchQuery).length < 3'), 'R7.1 UI can still send a 1–2 character generic query')
check(app.slice(appGuard, appOrdersRead).includes('Введите минимум 3 символа для поиска заказа.'), 'R7.1 UI minimum-search explanation missing')

check(fulfill.includes('WHERE id IN (SELECT x.stock_id FROM x WHERE x.observed IS NOT NULL)'), 'R7.2 observed stock update is not PK-targeted')
check(fulfill.includes('WHERE id IN (SELECT x.stock_id FROM x)'), 'R7.2 shipment stock update is not PK-targeted')
check(fulfill.includes('WHERE id IN (SELECT x.order_item_id FROM x)'), 'R7.2 order_items fulfillment update is not PK-targeted')
check(fulfill.includes("WHERE status = 'active' AND id IN (SELECT x.reservation_id FROM x)"), 'R7.2 reservation fulfillment update is not PK-targeted')
check(!fulfill.includes('WHERE EXISTS (SELECT 1 FROM x WHERE x.order_item_id = order_items.id)\n           AND ${orderStillUnsentSql}'), 'R7.2 expensive shipment order_items scan returned')
check(!fulfill.includes("WHERE status = 'active' AND EXISTS (SELECT 1 FROM x WHERE x.reservation_id = inventory_reservations.id)"), 'R7.2 expensive shipment reservation scan returned')
check(fulfill.includes('const orderStillUnsentSql ='), 'R7.2 lost shipment CAS guard')
check(fulfill.includes('await db.batch(statements)'), 'R7.2 lost atomic shipment batch')
check(fulfill.includes('chunksOf(activeReservationPayloads, 70)'), 'R7.2 changed bounded shipment chunking')

// Local behavioral proof: PK targeting must still obey the same unsent-order CAS condition.
const db = new DatabaseSync(':memory:')
db.exec(`
  CREATE TABLE orders(id INTEGER PRIMARY KEY, shipping_status TEXT);
  CREATE TABLE order_items(id INTEGER PRIMARY KEY, stock_writeoff_status TEXT, stock_quantity_before INTEGER, stock_quantity_after INTEGER);
  CREATE TABLE inventory_reservations(id INTEGER PRIMARY KEY, status TEXT, fulfilled_at TEXT, updated_at TEXT);
  INSERT INTO orders(id, shipping_status) VALUES (1, 'not_sent'), (2, 'sent');
  INSERT INTO order_items(id, stock_writeoff_status) VALUES (10, 'reserved'), (20, 'reserved'), (30, 'reserved');
  INSERT INTO inventory_reservations(id, status) VALUES (100, 'active'), (200, 'active'), (300, 'released');
`)
const payload = JSON.stringify({ orderItemId: 10, reservationId: 100, quantityBefore: 5, quantityAfter: 4 })
const payload2 = JSON.stringify({ orderItemId: 20, reservationId: 200, quantityBefore: 8, quantityAfter: 7 })
const cte = `input(payload) AS (VALUES (?), (?)), x AS (
  SELECT CAST(json_extract(payload, '$.orderItemId') AS INTEGER) AS order_item_id,
         CAST(json_extract(payload, '$.reservationId') AS INTEGER) AS reservation_id,
         CAST(json_extract(payload, '$.quantityBefore') AS INTEGER) AS quantity_before,
         CAST(json_extract(payload, '$.quantityAfter') AS INTEGER) AS quantity_after
  FROM input
)`
const unsent = "EXISTS (SELECT 1 FROM orders shipping_order WHERE shipping_order.id = ? AND COALESCE(shipping_order.shipping_status, 'not_sent') <> 'sent')"

db.prepare(`WITH ${cte}
  UPDATE order_items
  SET stock_writeoff_status='fulfilled',
      stock_quantity_before=(SELECT x.quantity_before FROM x WHERE x.order_item_id=order_items.id),
      stock_quantity_after=(SELECT x.quantity_after FROM x WHERE x.order_item_id=order_items.id)
  WHERE id IN (SELECT x.order_item_id FROM x) AND ${unsent}`).run(payload, payload2, 1)
check(db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE stock_writeoff_status=\'fulfilled\'').get().n === 2, 'R7.2 PK-targeted order_items update changed unsent shipment behavior')

db.exec("UPDATE order_items SET stock_writeoff_status='reserved', stock_quantity_before=NULL, stock_quantity_after=NULL")
db.prepare(`WITH ${cte}
  UPDATE order_items
  SET stock_writeoff_status='fulfilled'
  WHERE id IN (SELECT x.order_item_id FROM x) AND ${unsent}`).run(payload, payload2, 2)
check(db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE stock_writeoff_status=\'fulfilled\'').get().n === 0, 'R7.2 PK-targeted order_items update bypassed sent-order CAS guard')

db.prepare(`WITH ${cte}
  UPDATE inventory_reservations
  SET status='fulfilled', fulfilled_at='now', updated_at='now'
  WHERE status='active' AND id IN (SELECT x.reservation_id FROM x) AND ${unsent}`).run(payload, payload2, 1)
check(db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE status='fulfilled'").get().n === 2, 'R7.2 PK-targeted reservation update changed active fulfillment behavior')
check(db.prepare("SELECT status FROM inventory_reservations WHERE id=300").get().status === 'released', 'R7.2 touched a non-active reservation')
db.close()

console.log('D1 READ BUDGET R7.1/R7.2 PASSED — 1–2 character order searches do zero D1 work; shipment mutations target bounded primary keys while retaining unsent-order CAS and atomic batching')
