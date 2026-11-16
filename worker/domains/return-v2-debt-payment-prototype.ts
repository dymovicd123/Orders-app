// ISOLATED: debt-close after a verified Return V2. NOT registered in Worker HTTP.
// The active V1 manual payment writer ignores refunded cash and MUST NOT handle V2.
// Payment, cash event and versioned cached debt are one guarded D1 batch.
import {readVersionedReturnMoney, type V2MoneyProjection} from './return-v2-financial-projection.ts'

export class ReturnV2DebtPaymentConflict extends Error {
  readonly status=409
  readonly code='return_v2_debt_payment_conflict'
}
function fail(message:string):never{throw new ReturnV2DebtPaymentConflict(message)}
type Input={
  orderId:number;requestId:string;paymentDate:string;method:string;
  amount:number;comment?:string
}
type Existing={
  order_id:number;amount_delta:number;event_date:string;payment_method:string;
  event_type:string;source_type:string;payment_id:number|null;
  payment_order_id:number|null;payment_amount:number|null;
  payment_date:string|null;method:string|null;payment_kind:string|null;
  payment_comment:string|null
}
function normalized(input:Input){
  if(!Number.isSafeInteger(input.orderId)||input.orderId<1)fail('Некорректный заказ.')
  if(!Number.isSafeInteger(input.amount)||input.amount<1)fail('Сумма должна быть положительным целым числом.')
  const requestId=String(input.requestId||'').trim()
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/.test(requestId))
    fail('Укажите уникальный идентификатор операции.')
  const date=String(input.paymentDate||'').trim()
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+'T00:00:00Z'))
     ||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)
    fail('Дата платежа некорректна.')
  const method=String(input.method||'').trim().toLocaleUpperCase('ru-RU')
  if(!method||method.length>100)fail('Выберите способ реального поступления денег.')
  const comment=String(input.comment||'').trim()
  if(comment.length>300)fail('Комментарий слишком длинный.')
  return {orderId:input.orderId,requestId,amount:input.amount,date,method,comment,
    eventKey:'return-v2:debt-close:'+requestId}
}
type Wanted=ReturnType<typeof normalized>
async function findPayment(db:D1Database,w:Wanted) {
  return db.prepare(`SELECT fe.order_id,fe.amount_delta,fe.event_date,
       fe.payment_method,fe.event_type,fe.source_type,
       p.id AS payment_id,p.order_id AS payment_order_id,p.amount AS payment_amount,
       p.payment_date,p.method,p.payment_kind,p.comment AS payment_comment
     FROM financial_events fe LEFT JOIN payments p ON p.id=fe.source_id
     WHERE fe.event_key=? LIMIT 1`).bind(w.eventKey).first<Existing>()
}
async function replay(db:D1Database,w:Wanted,saved:Existing){
  if(saved.order_id!==w.orderId||saved.payment_order_id!==w.orderId||
    !saved.payment_id||saved.event_type!=='debt_close'||saved.source_type!=='payment'||
    saved.payment_kind!=='debt_close'||saved.amount_delta!==w.amount||
    saved.payment_amount!==w.amount||saved.event_date!==w.date||
    saved.payment_date!==w.date||saved.payment_method!==w.method||
    saved.method!==w.method||String(saved.payment_comment||'')!==w.comment)
    fail('Этот идентификатор уже использован для другого платежа.')
  const ledger=await readVersionedReturnMoney(db,w.orderId)
  if(ledger.kind!=='return_v2')fail('Платёж не связан с проверенным Return V2.')
  return {ok:true,replayed:true,orderId:w.orderId,paymentId:saved.payment_id,
    amount:w.amount,method:w.method,debt:ledger.customerDebt,overpay:ledger.customerOverpay}
}
function checked(db:D1Database,part:string){
  return db.prepare(`SELECT json('RETURN_V2_DEBT_CONFLICT_${part}') WHERE changes()<>1`)
}

export async function createVersionedReturnV2DebtPaymentPrototype(db:D1Database,input:Input){
  const w=normalized(input)
  const saved=await findPayment(db,w)
  if(saved)return replay(db,w,saved)
  const ledger=await readVersionedReturnMoney(db,w.orderId)
  if(ledger.kind!=='return_v2')fail('Для исторического заказа используйте обычный путь оплаты.')
  const v2=ledger as V2MoneyProjection
  if(v2.customerDebt===0)fail('Долг клиента по заказу уже закрыт.')
  if(w.amount>v2.customerDebt)fail('Сумма превышает текущий долг клиента.')
  if(!Number.isSafeInteger(v2.paidIn+w.amount))fail('Сумма оплат выходит за допустимые пределы.')
  const stamp=new Date().toISOString()
  const updatedPaid=v2.paidIn+w.amount
  const afterDebt=v2.customerDebt-w.amount
  const statements:D1PreparedStatement[]=[
    db.prepare(`INSERT INTO payments(order_id,payment_date,method,amount,payment_kind,comment,created_at)
      SELECT o.id,?,?,?,'debt_close',?,?
      FROM orders o
      WHERE o.id=? AND o.pricing_mode='itemized_v1'
        AND o.order_status NOT IN ('archived','deleted') AND o.archived_at IS NULL
        AND o.updated_at=? AND o.total_amount=?
        AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
             WHERE oi.order_id=o.id AND oi.quantity>0)=?
        AND (SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount ELSE 0 END),0)
             FROM payments p WHERE p.order_id=o.id)=?
        AND (SELECT COALESCE(SUM(CASE WHEN r.amount>0 THEN r.amount ELSE 0 END),0)
             FROM returns r WHERE r.order_id=o.id AND COALESCE(r.status,'completed')<>'cancelled')=?
        AND (SELECT COUNT(*) FROM return_v2_unified_postings up WHERE up.order_id=o.id)
          +(SELECT COUNT(*) FROM return_v2_postings vp WHERE vp.order_id=o.id)=1
        AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id
             AND COALESCE(e.status,'completed')<>'cancelled')
        AND NOT EXISTS(SELECT 1 FROM returns r WHERE r.order_id=o.id
             AND COALESCE(r.status,'completed')<>'cancelled'
             AND NOT EXISTS(SELECT 1 FROM return_v2_unified_postings up WHERE up.return_id=r.id)
             AND NOT EXISTS(SELECT 1 FROM return_v2_postings vp WHERE vp.return_id=r.id))
        AND ?<=o.total_amount-(?-?)`)
      .bind(w.date,w.method,w.amount,w.comment||null,stamp,w.orderId,
        v2.orderVersion,v2.currentSale,v2.currentSale,v2.paidIn,v2.paidOut,
        w.amount,v2.paidIn,v2.paidOut),
    checked(db,'payment'),
    db.prepare(`INSERT INTO financial_events(
      event_key,order_id,external_order_id,event_date,event_at,event_type,related_type,
      amount_delta,payment_method,source_type,source_id,source_ref,reason,comment,
      is_backfill,created_at)
      SELECT ?,o.id,o.external_id,?,?,'debt_close',NULL,?,?,'payment',p.id,
         'payments:'||p.id,'return_v2_debt_payment',?,0,?
      FROM payments p JOIN orders o ON o.id=p.order_id
      WHERE p.id=last_insert_rowid() AND p.order_id=? AND p.amount=?`)
      .bind(w.eventKey,w.date,stamp,w.amount,w.method,w.comment||null,stamp,w.orderId,w.amount),
    checked(db,'event'),
    db.prepare(`UPDATE orders SET received_amount=?,return_amount=?,debt_amount=?,updated_at=?
      WHERE id=? AND updated_at=? AND total_amount=?
        AND (SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount ELSE 0 END),0)
             FROM payments p WHERE p.order_id=orders.id)=?
        AND (SELECT COALESCE(SUM(CASE WHEN r.amount>0 THEN r.amount ELSE 0 END),0)
             FROM returns r WHERE r.order_id=orders.id
             AND COALESCE(r.status,'completed')<>'cancelled')=?
        AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
             WHERE oi.order_id=orders.id AND oi.quantity>0)=?`)
      .bind(updatedPaid,v2.paidOut,afterDebt,stamp,w.orderId,v2.orderVersion,
        v2.currentSale,updatedPaid,v2.paidOut,v2.currentSale),
    checked(db,'balance'),
  ]
  try{await db.batch(statements)}
  catch(error){
    const existing=await findPayment(db,w)
    if(existing)return replay(db,w,existing)
    const msg=error instanceof Error?error.message:String(error)
    if(/RETURN_V2_DEBT_CONFLICT|malformed JSON|UNIQUE|constraint failed|FOREIGN KEY/i.test(msg))
      fail('Оплата или заказ изменились. Ничего не списано и не добавлено.')
    throw error
  }
  const final=await findPayment(db,w)
  if(!final)throw new Error('Платёж проведён, но его журнал не найден.')
  const answer=await replay(db,w,final)
  if(answer.debt!==afterDebt)fail('После платежа выявлено другое состояние долга. Нужна сверка.')
  return {...answer,replayed:false}
}
