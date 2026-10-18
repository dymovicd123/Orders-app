import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'

const app=readFileSync('src/App.tsx','utf8')
const table=readFileSync('src/features/sections/OrdersTableSection.tsx','utf8')
const worker=readFileSync('worker/domains/orders-write.ts','utf8')
const projection=readFileSync('src/app/orderOperationalProjection.ts','utf8')
const source=(start,end)=>worker.slice(worker.indexOf(start),worker.indexOf(end,worker.indexOf(start)))
const edit=source('export async function updateOrderCritical(','export async function getOrder(')
assert(projection.includes('canEdit: mutableWorkingOrder && !hasCommittedDownstreamOperation && simpleAdmin'))
assert(worker.includes("actor?.role!=='admin' && options.lifecycleAction!=='order_delete'"))
assert(edit.includes("const isolatedPaymentMethodRequest = rawPaymentCorrections.length>0"))
assert(edit.includes("Object.keys(input as Record<string, unknown>).every(key=>"))
assert(edit.includes("key==='requestId'||key==='paymentCorrections'"))
assert(edit.includes('if(isolatedPaymentMethodRequest && nonMethodChanged)'))
assert(edit.includes("if(isolatedPaymentMethodRequest && requestedPaymentCorrections.has(paymentId))"))
assert(edit.includes('if (isolatedMetadataRequest || isolatedPaymentMethodRequest)'))
assert(edit.includes('isolatedPaymentMethodRequest ? (toInt(existingAny.customer_id,0)||null)'))
assert(edit.includes('} else if(p.isolatedPaymentMethodRequest){'))
assert(edit.includes("SELECT json('ORDER_PAYMENT_METHOD_STALE')"))
assert(edit.includes('statements.unshift(db.prepare('))
assert(edit.includes('await db.batch(statements)'))
assert(edit.includes("financialEventStatement(db, {"))
assert(edit.includes("eventType: 'payment_reversal'"))
assert(edit.includes("eventType: correction.newRelatedType"))
assert(edit.includes('newTrackedCashAmount - oldTrackedCashAmount'))
assert(edit.includes('ORDER_PAYMENT_METHOD_STALE|malformed JSON'))
assert(edit.includes("if (isExchangeExtra && nonMethodChanged)"))
assert(!edit.includes("if(p.isolatedPaymentMethodRequest) await orderUpdateStatement.run()"),
  'Method correction must not overwrite the order row')
assert(app.includes('async function correctRecordedPaymentMethod('))
assert(app.includes('if(!isAdmin)return {ok:false'))
assert(app.includes('expectedPaymentDate:String(payment.paymentDate'))
assert(app.includes('expectedMethod:String(payment.method'))
assert(app.includes('expectedAmount:Number(payment.amount'))
assert(app.includes('expectedPaymentKind:String(payment.paymentKind'))
assert(app.includes('expectedComment:String(payment.comment'))
assert(app.includes('prepareCriticalRequest(key,payload)'))
assert(app.includes('completeCriticalRequest(key,critical.requestId)'))
assert((app.match(/correctRecordedPaymentMethod, loadRetiredExchangePriceOptions/g)||[]).length===2,
  'Regular and Kaspi lists must share the same admin payment-method action')
assert(table.includes('linkedPaymentDraft'))
assert(table.includes('Исправить способ оплаты'))
assert(table.includes('Сохранить способ оплаты'))
assert(table.includes('correctRecordedPaymentMethod(draft.order,payment,draft.method)'))
assert(table.includes('!linkedPaymentDraft.method.trim()'))
assert(table.includes('Array.isArray(linkedAdminEditOrder.payments)'))
assert(table.includes('Array.isArray(linkedAdminEditOrder.items)'))

// Atomic stale check: must not apply a payment method correction if a cash or
// exchange handler has since changed the same recorded payment/order balance.
const db=new DatabaseSync(':memory:')
db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY,total_amount INTEGER,received_amount INTEGER,debt_amount INTEGER,return_amount INTEGER,shipping_status TEXT,order_status TEXT);"+
  "CREATE TABLE payments(id INTEGER PRIMARY KEY,order_id INTEGER,payment_date TEXT,method TEXT,amount INTEGER,payment_kind TEXT,comment TEXT);"+
  "INSERT INTO orders VALUES(17,25000,10000,15000,0,'not_sent','active');"+
  "INSERT INTO payments VALUES(35,17,'2026-10-01','ТЕРМИНАЛ',10000,'primary','')")
const cas = "SELECT json('ORDER_PAYMENT_METHOD_STALE') WHERE NOT EXISTS(SELECT 1 FROM orders o JOIN payments pay ON pay.order_id=o.id"+
  " WHERE o.id=? AND pay.id=? AND o.total_amount=? AND o.received_amount=? AND o.debt_amount=? AND COALESCE(o.return_amount,0)=?"+
  " AND COALESCE(o.shipping_status,'')=? AND COALESCE(o.order_status,'')=?"+
  " AND COALESCE(pay.payment_date,'')=? AND UPPER(TRIM(COALESCE(pay.method,'')))=?"+
  " AND pay.amount=? AND COALESCE(pay.payment_kind,'primary')=? AND COALESCE(pay.comment,'')=?)"
const params=[17,35,25000,10000,15000,0,'not_sent','active','2026-10-01','ТЕРМИНАЛ',10000,'primary','']
const apply=()=>{
  db.exec('BEGIN')
  try {
    db.prepare(cas).get(...params)
    db.prepare("UPDATE payments SET method='KASPI PAY' WHERE id=35").run()
    db.exec('COMMIT')
    return true
  }catch(e){db.exec('ROLLBACK');return false}
}
assert.equal(apply(),true)
assert.equal(db.prepare('SELECT method FROM payments WHERE id=35').get().method,'KASPI PAY')
assert.equal(db.prepare('SELECT total_amount FROM orders WHERE id=17').get().total_amount,25000)
assert.equal(apply(),false)
assert.equal(db.prepare('SELECT method FROM payments WHERE id=35').get().method,'KASPI PAY')
db.close()
console.log('ADMIN_LINKED_ORDER_PAYMENT_METHOD_ISOLATION_CAS_AND_EDITOR_UI_PASSED')
