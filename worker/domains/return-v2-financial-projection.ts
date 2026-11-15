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
 received_amount:number;refund_amount:number;v2_count:number;unified_count:number;
 other_returns:number;invalid_unified:number;missing_unified_events:number;
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
    (SELECT COUNT(*) FROM return_v2_unified_postings up WHERE up.order_id=o.id) AS unified_count,
    (SELECT COUNT(*) FROM returns r WHERE r.order_id=o.id
       AND COALESCE(r.status,'completed')<>'cancelled'
       AND NOT EXISTS(SELECT 1 FROM return_v2_postings vp WHERE vp.return_id=r.id)
       AND NOT EXISTS(SELECT 1 FROM return_v2_unified_postings up WHERE up.return_id=r.id)) AS other_returns,
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
         )
         OR r.status NOT IN ('completed','cancelled'))) AS invalid_posts,
    (SELECT COUNT(*) FROM return_v2_postings vp JOIN returns r ON r.id=vp.return_id
       WHERE vp.order_id=o.id AND r.amount>0 AND NOT EXISTS(
         SELECT 1 FROM financial_events fe
         WHERE fe.event_key='return-v2:posted:'||vp.preparation_id
           AND fe.order_id=o.id AND fe.source_id=r.id
           AND fe.event_type='order_refund' AND fe.amount_delta=-r.amount
       )) AS missing_events,
    (SELECT COUNT(*) FROM return_v2_unified_postings up
       LEFT JOIN returns ret ON ret.id=up.return_id
       WHERE up.order_id=o.id AND (
         ret.id IS NULL OR ret.order_id<>o.id
         OR ret.status NOT IN ('completed','cancelled')
         OR (ret.status='completed' AND EXISTS(
              SELECT 1 FROM return_v2_unified_cancellations c WHERE c.posting_id=up.id))
         OR (ret.status='cancelled' AND NOT EXISTS(
              SELECT 1 FROM return_v2_unified_cancellations c
              WHERE c.posting_id=up.id AND c.return_id=ret.id AND c.order_id=o.id
                AND c.initial_total=up.initial_total AND c.initial_received=up.initial_received
                AND c.reversed_amount=up.cash_refund
                AND (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
                     FROM payments pay WHERE pay.order_id=o.id)=up.initial_received
                AND ((up.cash_refund=0 AND c.refund_recovered_at IS NULL
                         AND c.recovery_method IS NULL)
                     OR (up.cash_refund>0 AND c.refund_recovered_at IS NOT NULL
                         AND c.recovery_method IS NOT NULL
                         AND EXISTS(SELECT 1 FROM financial_events fe
                           WHERE fe.event_key='return-v2:unified:cancelled:'||up.id
                             AND fe.order_id=o.id AND fe.source_id=ret.id
                             AND fe.event_type='refund_reversal'
                             AND fe.related_type='order_refund'
                             AND fe.amount_delta=up.cash_refund
                             AND fe.payment_method=c.recovery_method)))))
         OR (ret.status='cancelled' AND EXISTS(
              SELECT 1 FROM return_items ri WHERE ri.return_id=up.return_id
                AND (ri.physical_received_at IS NOT NULL OR ri.restocked<>0)))
         OR ret.amount<>up.cash_refund
         OR COALESCE(ret.payment_method,'')<>COALESCE(up.refund_method,'')
         OR up.initial_total<up.final_total OR up.initial_received<up.cash_refund
         -- The order is the latest contract, not necessarily the initial
         -- post. Prior active Return V2 contracts must form an exact chain.
         OR (ret.status='completed' AND NOT EXISTS(
              SELECT 1 FROM return_v2_unified_postings newer
              WHERE newer.order_id=up.order_id AND newer.id>up.id)
              AND up.final_total<>o.total_amount)
         OR (ret.status='cancelled' AND up.initial_total<>o.total_amount)
         OR (ret.status='cancelled' AND EXISTS(
              SELECT 1 FROM return_v2_unified_postings newer
              WHERE newer.order_id=up.order_id AND newer.id>up.id))
         OR EXISTS(
              SELECT 1 FROM return_v2_unified_postings prev
              WHERE prev.id=(SELECT MAX(older.id) FROM return_v2_unified_postings older
                WHERE older.order_id=up.order_id AND older.id<up.id)
                AND (prev.final_total<>up.initial_total
                   OR EXISTS(SELECT 1 FROM returns old_ret
                     WHERE old_ret.id=prev.return_id AND old_ret.status<>'completed')))
         OR (up.full_termination=1 AND EXISTS(
              SELECT 1 FROM return_v2_unified_postings newer
              WHERE newer.order_id=up.order_id AND newer.id>up.id))
         OR (SELECT COALESCE(SUM(ul.contract_reduction),0)
              FROM return_v2_unified_lines ul
              WHERE ul.posting_id=up.id)<>up.initial_total-up.final_total
         OR NOT EXISTS(SELECT 1 FROM return_v2_unified_lines ul WHERE ul.posting_id=up.id)
         OR EXISTS(SELECT 1 FROM return_v2_unified_action_overrides ao
            LEFT JOIN return_v2_unified_lines ul
              ON ul.posting_id=ao.posting_id AND ul.order_item_id=ao.order_item_id
            LEFT JOIN order_items item ON item.id=ao.order_item_id
            WHERE ao.posting_id=up.id AND (
              ul.id IS NULL OR ul.action<>'cancel_unresolved_reservation'
              OR ul.reservation_id IS NOT NULL OR ul.reservation_release<>0
              OR ul.stock_quantity_change<>0 OR ul.receipt_intent<>'not_applicable'
              OR item.id IS NULL OR item.order_id<>up.order_id
              OR (ao.semantic_action='cancel_workshop_obligation'
                AND COALESCE(item.is_workshop,0)<>1)
              OR (ao.semantic_action='cancel_unreserved_obligation'
                AND COALESCE(item.is_workshop,0)<>0)
            ))
         OR EXISTS(SELECT 1 FROM return_v2_unified_lines ul
            LEFT JOIN return_v2_unified_action_overrides ao
              ON ao.posting_id=ul.posting_id AND ao.order_item_id=ul.order_item_id
            WHERE ul.posting_id=up.id AND ul.action='cancel_unresolved_reservation'
              AND ul.reservation_id IS NULL AND ao.posting_id IS NULL)
         OR (ret.status='completed' AND up.full_termination=1 AND EXISTS(
              SELECT 1 FROM order_items oi WHERE oi.order_id=o.id AND oi.quantity>0))
         OR EXISTS(SELECT 1 FROM return_v2_unified_lines ul
             LEFT JOIN order_items oi ON oi.id=ul.order_item_id
             WHERE ul.posting_id=up.id AND (
               oi.id IS NULL OR oi.order_id<>o.id OR oi.unit_price<>ul.sold_unit_price
               OR ul.contract_reduction<>ul.contracted_quantity*ul.sold_unit_price
               OR (ul.action='physical_return_pending' AND NOT EXISTS(
                  SELECT 1 FROM return_items ri WHERE ri.return_id=up.return_id
                    AND ri.order_item_id=ul.order_item_id
                    AND ri.quantity=ul.contracted_quantity
                    AND ri.amount=ul.contract_reduction
                    AND ri.physical_tracking=1 AND ri.contract_quantity_applied=1))
               OR (ul.action<>'physical_return_pending' AND EXISTS(
                  SELECT 1 FROM return_items ri WHERE ri.return_id=up.return_id
                    AND ri.order_item_id=ul.order_item_id))
             ))
         OR EXISTS(SELECT 1 FROM return_items ri WHERE ri.return_id=up.return_id
            AND NOT EXISTS(SELECT 1 FROM return_v2_unified_lines ul
              WHERE ul.posting_id=up.id AND ul.order_item_id=ri.order_item_id
                AND ul.action='physical_return_pending'))
         OR (up.cash_refund=0 AND EXISTS(
             SELECT 1 FROM financial_events fe
             WHERE fe.event_key='return-v2:unified:'||up.request_id))
       )) AS invalid_unified,
    (SELECT COUNT(*) FROM return_v2_unified_postings up
       JOIN returns ret ON ret.id=up.return_id
       WHERE up.order_id=o.id AND ret.amount>0 AND NOT EXISTS(
         SELECT 1 FROM financial_events fe
         WHERE fe.event_key='return-v2:unified:'||up.request_id
          AND fe.order_id=o.id AND fe.source_id=ret.id
          AND fe.event_type='order_refund' AND fe.amount_delta=-ret.amount
          AND fe.payment_method=up.refund_method
       )) AS missing_unified_events,
    (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
     WHERE oi.order_id=o.id AND oi.quantity>0) AS line_total
   FROM orders o WHERE o.id=? LIMIT 1`
 ).bind(orderId).first<LedgerRow>()
 if(!row)fail('Заказ не найден.')
 const v2Count=toInt(row.v2_count,0)
 const unifiedCount=toInt(row.unified_count,0)
 if(!v2Count&&!unifiedCount){
  const ledger=await readOrderFinancialLedger(db,orderId)
  // No reinterpretation of old cash-only returns, discounts, or historical debt.
  return {kind:'legacy',orderId,...ledger,customerOverpay:null}
 }
 if(row.pricing_mode!=='itemized_v1'||(v2Count>0&&unifiedCount>0)
   ||toInt(row.invalid_unified,0)||toInt(row.missing_unified_events,0)
   ||toInt(row.other_returns,0)
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
    AND (EXISTS(SELECT 1 FROM return_v2_postings vp WHERE vp.order_id=orders.id)
       OR EXISTS(SELECT 1 FROM return_v2_unified_postings up WHERE up.order_id=orders.id))`
 ).bind(value.paidIn,value.paidOut,value.customerDebt,stamp,
    orderId,value.orderVersion,value.currentSale,value.paidIn,value.paidOut,value.currentSale).run()
 if(toInt(result.meta?.changes,0)!==1)fail('Баланс изменился во время записи. Обновите заказ.')
 return {...value,updatedAt:stamp}
}
