import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
const read=(p)=>readFileSync(p,'utf8')
const app=read('src/App.tsx')
const orders=read('worker/domains/orders-write.ts')
const worker=read('worker/index.ts')
const header=read('src/features/sections/OrdersHeaderSection.tsx')
const filter=read('src/features/sections/OrderFiltersSection.tsx')
const table=read('src/features/sections/OrdersTableSection.tsx')
const create=read('src/features/sections/CreateOrderSection.tsx')
const workshop=read('src/features/sections/WorkshopSection.tsx')
assert(!app.includes('confirmKaspiPayment('))
assert(!app.includes('kaspiPaymentDraft'))
assert(!app.includes('openKaspiCreate'))
assert(!header.includes('openKaspiCreate'))
assert(!table.includes('Подтвердить оплату'))
assert(!filter.includes('Ожидают оплату'))
assert(!app.includes('activeSector === \'kaspi\' && orderPanel === \'zammler\''))
assert(app.includes("params.set('orderPaymentMethod', 'КАСПИ МАГАЗИН')"))
assert(app.includes("params.set('excludeOrderPaymentMethod', 'КАСПИ МАГАЗИН')"))
assert(app.includes('payments: isKaspiCreate ? [] : createDraft.payments'))
assert(app.includes('receivedAmount: isKaspi ? 0'))
assert(app.includes('debtAmount: isKaspi ? createPricing.totalAmount'))
assert(create.includes('Kaspi-заказ сохраняется с долгом'))
assert(create.includes('при нажатии «Отправлено»'))
assert(orders.includes('Kaspi is debt-first'))
assert(!orders.includes('Оплата Kaspi магазин учтена при создании заказа'))
assert(worker.includes('async function reconcileKaspiPaymentAfterShipping'))
assert(worker.includes('kaspi-shipping-payment:${orderId}:v1'))
assert(worker.includes('readOrderFinancialLedger(db, orderId)'))
assert(worker.includes("paymentKind: 'debt_close'"))
assert(worker.includes('Kaspi payment reconciliation after already-sent retry failed'))
assert(worker.includes('Kaspi payment reconciliation after committed shipping failed'))
assert(worker.includes('kaspiPaymentPending: true'))
assert(worker.includes('Оплата Kaspi магазин учитывается автоматически при отправке заказа'))
assert(app.includes('if (response.ok && result.kaspiPaymentPending)'))
assert(workshop.includes("workshopChannel === 'kaspi'"))
assert(workshop.includes("'КАСПИ МАГАЗИН'"))
// SQL exercise: no payment on creation, conditional paid-on-shipping, remaining
// debt only, order-scoped operation ID for retries, unrelated orders intact.
const db=new DatabaseSync(':memory:')
db.exec(`CREATE TABLE orders(id INTEGER PRIMARY KEY,method TEXT,shipping TEXT,total INTEGER,received INTEGER,debt INTEGER);
CREATE TABLE payments(order_id INTEGER,operation TEXT UNIQUE,amount INTEGER);
INSERT INTO orders VALUES(1,'КАСПИ МАГАЗИН','not_sent',20000,0,20000);
INSERT INTO orders VALUES(2,'КАСПИ МАГАЗИН','sent',25000,5000,20000);
INSERT INTO orders VALUES(3,'TERMINAL','sent',10000,10000,0);`)
function pay(id){
 const o=db.prepare('SELECT * FROM orders WHERE id=?').get(id)
 if(!o||o.method!=='КАСПИ МАГАЗИН'||o.shipping!=='sent'||o.debt===0)return
 db.prepare('INSERT OR IGNORE INTO payments VALUES(?,?,?)').run(id,'kaspi-shipping-payment:'+id+':v1',o.debt)
 const payment=db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE order_id=?').get(id).s
 const preexisting=id===2?5000:0
 db.prepare('UPDATE orders SET received=?,debt=MAX(0,total-?) WHERE id=?').run(preexisting+payment,preexisting+payment,id)
}
pay(1);assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,0)
db.prepare("UPDATE orders SET shipping='sent' WHERE id=1").run()
pay(1);pay(1);pay(2);pay(2);pay(3)
assert.equal(db.prepare('SELECT COUNT(*) n FROM payments').get().n,2)
assert.equal(db.prepare('SELECT debt FROM orders WHERE id=1').get().debt,0)
assert.equal(db.prepare('SELECT received FROM orders WHERE id=2').get().received,25000)
assert.equal(db.prepare('SELECT received FROM orders WHERE id=3').get().received,10000)
console.log('MAIN_KASPI_DEBT_FIRST_SENT_PAYMENT_NO_DUPLICATES_AND_UI_SEPARATION_PASSED')
