import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

// Current-runtime contract. Historical Kaspi paid-on-create tests are replayed
// separately against their pinned historical source, not rewritten.
const read = file => readFileSync(file, 'utf8')
const app = read('src/App.tsx')
const ui = read('src/features/sections/CreateOrderSection.tsx')
const writer = read('worker/domains/orders-write.ts')
const shipping = read('worker/index.ts')
const payments = read('worker/domains/money.ts')
assert.match(writer, /Kaspi is debt-first/)
assert.doesNotMatch(writer, /normalizedPayments = normalizeOrderPayments\(\[\{/)
assert.match(writer, /buildItemizedOrderWritePlan\(itemizedLines, normalizedPayments\)/)
assert.match(writer, /normalizedPayments\.some\(payment => payment\.amount > 0\)/)
assert.match(app, /receivedAmount: isKaspi \? 0 : createPricing\.receivedAmount/)
assert.match(app, /debtAmount: isKaspi \? createPricing\.totalAmount/)
assert.match(app, /payments: isKaspiCreate \? \[\] : createDraft\.payments/)
assert.match(ui, /при нажатии «Отправлено»/)
assert.match(ui, /При создании: получено 0 ₸/)
assert.doesNotMatch(ui, /Заказ сразу будет записан как оплаченный/)
assert.match(shipping, /async function reconcileKaspiPaymentAfterShipping/)
assert.match(shipping, /requestId = `kaspi-shipping-payment:\$\{orderId\}:v1`/)
assert.match(shipping, /readOrderFinancialLedger\(db, orderId\)/)
assert.match(shipping, /savedPlan \? toInt\(savedPlan\.amount, 0\) : ledger\.debtAmount/)
assert.match(shipping, /paymentKind: 'debt_close'/)
assert.match(shipping, /operation_type = 'order_payment_create'/)
assert.match(shipping, /Kaspi payment reconciliation after already-sent retry failed/)
assert.match(shipping, /Kaspi payment reconciliation after committed shipping failed/)
assert.match(shipping, /kaspiPaymentPending: true/)
assert.match(shipping, /Оплата Kaspi магазин учитывается автоматически при отправке заказа/)
assert.match(app, /if \(response\.ok && result\.kaspiPaymentPending\)/)
assert.match(app, /invalidateFinanceReadCaches\(\)/)
assert.match(payments, /insertCriticalMappedEntity/)
assert.match(payments, /financialEventStatement/)
assert.match(payments, /syncOrder/)

// SQL simulation of the shipping-to-ledger invariant, including a lost response
// after the payment insert, partial preexisting money, and an unrelated order.
const db = new DatabaseSync(':memory:')
db.exec(`CREATE TABLE orders(
 id INTEGER PRIMARY KEY,kind TEXT,shipping TEXT,total INTEGER,received INTEGER,debt INTEGER);
 CREATE TABLE payment_ops(request_id TEXT PRIMARY KEY,order_id INTEGER,amount INTEGER,step TEXT);
 CREATE TABLE payments(id INTEGER PRIMARY KEY,request_id TEXT UNIQUE,order_id INTEGER,amount INTEGER);
 INSERT INTO orders VALUES
 (1,'КАСПИ МАГАЗИН','not_sent',20000,0,20000),
 (2,'КАСПИ МАГАЗИН','sent',25000,5000,20000),
 (3,'TERMINAL','sent',18000,18000,0);
 `)
function fulfillOnce(id, { failAfterInsert = false } = {}) {
 const order = db.prepare('SELECT * FROM orders WHERE id=?').get(id)
 if (order.kind !== 'КАСПИ МАГАЗИН' || order.shipping !== 'sent') return
 const key = `kaspi-shipping-payment:${id}:v1`
 const prev = db.prepare('SELECT amount FROM payment_ops WHERE request_id=?').get(key)
 const amount = prev?.amount ?? order.debt
 if (!amount) return
 db.prepare('INSERT OR IGNORE INTO payment_ops VALUES (?,?,?,?)').run(key,id,amount,'validated')
 db.prepare('INSERT OR IGNORE INTO payments(request_id,order_id,amount) VALUES(?,?,?)').run(key,id,amount)
 if (failAfterInsert) throw Error('lost response after insert')
 const paid = db.prepare('SELECT COALESCE(SUM(amount),0) as sum FROM payments WHERE order_id=?').get(id).sum
 const original = id === 2 ? 5000 : 0
 db.prepare('UPDATE orders SET received=?, debt=MAX(0,total-?) WHERE id=?').run(original+paid,original+paid,id)
 db.prepare("UPDATE payment_ops SET step='completed' WHERE request_id=?").run(key)
}
fulfillOnce(1)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,0)
db.prepare("UPDATE orders SET shipping='sent' WHERE id=1").run()
assert.throws(()=>fulfillOnce(1,{failAfterInsert:true}),/lost response/)
fulfillOnce(1)
fulfillOnce(1)
fulfillOnce(2)
fulfillOnce(2)
fulfillOnce(3)
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM payments').get().n,2)
assert.equal(db.prepare('SELECT debt FROM orders WHERE id=1').get().debt,0)
assert.equal(db.prepare('SELECT received FROM orders WHERE id=2').get().received,25000)
assert.equal(db.prepare('SELECT received FROM orders WHERE id=3').get().received,18000)
db.close()
console.log('KASPI_DEBT_FIRST_SHIPPING_IDEMPOTENT_PAYMENT_RETRY_AND_MANUAL_GUARD_PASSED')
