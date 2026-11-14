// Return V2 financial ledger for a future versioned rollout.
// NOT imported into existing Worker routes or active money.ts functions.
// Legacy orders retain their unmodified current accounting until explicitly migrated.
import { readOrderFinancialLedger } from './money.ts'
import { toInt } from '../core/text.ts'

export class ReturnV2LedgerConflict extends Error {
  readonly status=409
  readonly code='return_v2_ledger_conflict'
}
function fail(message:string):never {throw new ReturnV2LedgerConflict(message)}
function exact(n:unknown,label:string):number {
  if(!Number.isSafeInteger(n)||Number(n)<0)fail(label+' не подтверждена.')
  return Number(n)
}
type LedgerRow={
 order_id:number;pricing_mode:string;total_amount:number;updated_at:string;
 received_amount:number;refund_amount:number;v2_count:number;other_returns:number;
 exchanges_count:number;invalid_posts:number;missing_events:number;line_total:number;
}
export type V2MoneyProjection={
 kind:'return_v2';orderId:number;currentSale:number;paidIn:number;
 paidOut:number;netHeld:number;signedBalance:number;customerDebt:number;customerOverpay:number;
 orderVersion:string;
}
export type LegacyProjection={
 kind:'legacy';orderId:number;totalAmount:number;receivedAmount:number;returnAmount:number;
 debtAmount:number;customerOverpay:null;
}

export async function readVersionedReturnMoney(db:D1Database,orderId:number):Promise<V2MoneyProjection|LegacyProjection> {
 if(!Number.isSafeInteger(orderId)||orderId<=0)fail('Номер заказа некорректен.')
 const row=await db.prepare(
  `SELECT o.id AS order_id,o.pricing_mode,o.total_amount,o.updated_at,
    (SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount ELSE 0 END),0)
     FROM payments p WHERE p.order_id=o.id) AS received_amount,
    (SELECT COALESCE(SUM(CASE WHEN r.amount>0 THEN r.amount ELSE 0 END),0)
     FROM returns r WHERE r.order_id=o.id
       AND COALESCE(r.status,'completed')<>'cancelled') AS refund_amount,
    (SELECT COUNT(*) FROM return_v2_postings vp WHERE vp.order_id=o.id) AS v2_count,
    (SELECT COUNT(*) FROM returns r WHERE r.order_id=o.id
       AND COALESCE(r.status,'completed')<>'cancelled'
       AND NOT EXISTS(SELECT 1 FROM return_v2_postings vp WHERE vp.return_id=r.id)) AS other_returns,
    (SELECT COUNT(*) FROM exchanges e WHERE e.order_id=o.id
       AND COALESCE(e.status,'completed')<>'cancelled') AS exchanges_count,
    (SELECT COUNT(*) FROM return_v2_postings vp
       LEFT JOIN returns r ON r.id=vp.return_id
       WHERE vp.order_id=o.id AND (
         r.id IS NULL OR r.order_id<>o.id
         OR (r.status='completed' AND EXISTS(
           SELECT 1 FROM return_v2_cancellations c WHERE c.preparation_id=vp.preparation_id))
         OR (r.status='cancelled' AND NOT EXISTS(
           SELECT 1 FROM return_v2_cancellations c
           WHERE c.preparation_id=vp.preparation_id AND c.return_id=r.id AND c.order_id=o.id
             AND c.reversed_amount=r.amount
             AND ((r.amount=0 AND c.recovery_method IS NULL)
               OR (r.amount>0 AND c.refund_recovered_at IS NOT NULL AND c.recovery_method IS NOT NULL
                 AND EXISTS(SELECT 1 FROM financial_events fe
                   WHERE fe.event_key='return-v2:cancelled:'||vp.preparation_id
                     AND fe.order_id=o.id AND fe.source_id=r.id
                     AND fe.event_type='refund_reversal'
                     AND fe.related_type='order_refund'
                     AND fe.amount_delta=r.amount AND fe.payment_method=c.recovery_method))))
         ))
         OR r.status NOT IN ('completed','cancelled'))) AS invalid_posts,
    (SELECT COUNT(*) FROM return_v2_postings vp JOIN returns r ON r.id=vp.return_id
       WHERE vp.order_id=o.id AND r.amount>0 AND NOT EXISTS(
         SELECT 1 FROM financial_events fe
         WHERE fe.event_key='return-v2:posted:'||vp.preparation_id
           AND fe.order_id=o.id AND fe.source_id=r.id
           AND fe.event_type='order_refund' AND fe.amount_delta=-r.amount
       )) AS missing_events,
    (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
     WHERE oi.order_id=o.id AND oi.quantity>0) AS line_total
   FROM orders o WHERE o.id=? LIMIT 1`
 ).bind(orderId).first<LedgerRow>()
 if(!row)fail('Заказ не найден.')
 const v2Count=toInt(row.v2_count,0)
 if(!v2Count){
  const ledger=await readOrderFinancialLedger(db,orderId)
  // No reinterpretation of old cash-only returns, discounts, or historical debt.
  return {kind:'legacy',orderId,...ledger,customerOverpay:null}
 }
 if(row.pricing_mode!=='itemized_v1'||toInt(row.other_returns,0)
   ||toInt(row.exchanges_count,0)||toInt(row.invalid_posts,0)
   ||toInt(row.missing_events,0)) {
   fail('После Return V2 появились операции или записи, не поддерживаемые новой моделью. Требуется разбор.')
 }
 const currentSale=exact(row.total_amount,'Стоимость заказа')
 const paidIn=exact(row.received_amount,'Полученные деньги')
 const paidOut=exact(row.refund_amount,'Выданные деньги')
 if(currentSale!==exact(row.line_total,'Сумма товарных позиций'))
  fail('Цена заказа и оставшихся позиций не совпадают.')
 if(paidOut>paidIn)fail('Возврат денег больше полученных оплат.')
 const netHeld=paidIn-paidOut
 const signedBalance=currentSale-netHeld
 return {kind:'return_v2',orderId,currentSale,paidIn,paidOut,netHeld,signedBalance,
  customerDebt:Math.max(0,signedBalance),customerOverpay:Math.max(0,-signedBalance),
  orderVersion:String(row.updated_at||'')}
}

// A future replacement for syncOrderFinancialLedger ONLY after V2 schema
// migration, cancellation and follow-up payments pass the rollout gate.
// A version+money CAS prevents a concurrent payment from overwriting debt.
export async function syncVersionedReturnMoneyPrototype(db:D1Database,orderId:number){
 const value=await readVersionedReturnMoney(db,orderId)
 if(value.kind!=='return_v2')fail('Исторические заказы нельзя переводить на новый расчёт.')
 const stamp=new Date().toISOString()
 const result=await db.prepare(
  `UPDATE orders SET
    received_amount=?,return_amount=?,debt_amount=?,updated_at=?
   WHERE id=? AND updated_at=? AND total_amount=?
    AND (SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount ELSE 0 END),0)
         FROM payments p WHERE p.order_id=orders.id)=?
    AND (SELECT COALESCE(SUM(CASE WHEN r.amount>0 THEN r.amount ELSE 0 END),0)
         FROM returns r WHERE r.order_id=orders.id
           AND COALESCE(r.status,'completed')<>'cancelled')=?
    AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
         WHERE oi.order_id=orders.id AND oi.quantity>0)=?
    AND EXISTS(SELECT 1 FROM return_v2_postings vp WHERE vp.order_id=orders.id)`
 ).bind(value.paidIn,value.paidOut,value.customerDebt,stamp,
    orderId,value.orderVersion,value.currentSale,value.paidIn,value.paidOut,value.currentSale).run()
 if(toInt(result.meta?.changes,0)!==1)fail('Баланс изменился во время записи. Обновите заказ.')
 return {...value,updatedAt:stamp}
}
