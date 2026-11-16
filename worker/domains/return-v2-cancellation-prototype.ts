// EXPERIMENTAL V2 Return cancellation. No HTTP route and no live caller.
// Safe scope is intentionally narrow: no received goods, no dependent operations,
// and, if money was refunded, an explicit confirmation that it was recovered.
// Restores the contractual line and records real cash recovery in ONE D1 batch.
export class ReturnV2CancellationConflict extends Error {
  readonly status=409
  readonly code='return_v2_cancellation_conflict'
}
function reject(message:string):never { throw new ReturnV2CancellationConflict(message) }
function exact(n:unknown,name:string) {
  if(!Number.isSafeInteger(n)||Number(n)<0)reject('Некорректно сохранено значение: '+name)
  return Number(n)
}
function requiredId(n:unknown,name:string) {
  const k=exact(n,name)
  if(k===0)reject('Укажите '+name)
  return k
}
function check(db:D1Database,step:string) {
  return db.prepare(`SELECT json('RETURN_V2_CANCEL_CONFLICT_`+step+`') WHERE changes()<>1`)
}
type CancelInput={
  preparationId:number
  requestId:string
  reason:string
  goodsWithCustomerConfirmed:boolean
  refundRecoveredConfirmed:boolean
  recoveryMethod?:string
}
type Posting={
  preparation_id:number;return_id:number;order_id:number;posted_at:string;
  contract_total_after:number;net_held_after:number;
  original_total:number;original_paid:number;planned_refund:number;
  payment_method:string|null;order_version:string;
  return_status:string;return_amount:number;return_method:string|null;
  current_total:number;current_version:string;current_pricing:string;
  received_cash:number;return_count:number;exchange_count:number;
  subsequent_money_events:number;new_payments:number;
}
type Line={
  order_item_id:number;quantity:number;sold_unit_price:number;
  baseline_order_item_quantity:number;reduced_value:number;
  current_quantity:number;current_unit_price:number;current_line_total:number;
  returned_quantity:number;returned_amount:number;
  contract_quantity_applied:number;physical_tracking:number;
  physical_received_at:string|null;restocked:number;
  lifecycle_count:number;active_reservations:number;new_dispatches:number;
}
type Cancelled={preparation_id:number;return_id:number;order_id:number;
 request_id:string;reason:string;reversed_amount:number;recovery_method:string|null}
async function existingCancellation(db:D1Database,preparationId:number){
 return db.prepare(
  `SELECT preparation_id,return_id,order_id,request_id,reason,reversed_amount,recovery_method
    FROM return_v2_cancellations WHERE preparation_id=?`
 ).bind(preparationId).first<Cancelled>()
}
function canReplay(saved:Cancelled,requestId:string,reason:string,method:string){
 if(saved.request_id!==requestId||saved.reason!==reason
   ||String(saved.recovery_method||'')!==method)
   reject('Этот возврат уже отменён другим запросом. Повторная отмена запрещена.')
 return {ok:true,cancelled:true,replayed:true,returnId:saved.return_id,
   orderId:saved.order_id,contractRestored:true,cashRecovered:saved.reversed_amount}
}

export async function cancelPostedReturnV2Prototype(db:D1Database,input:CancelInput) {
 const id=requiredId(input.preparationId,'подготовленный возврат')
 const requestId=String(input.requestId||'').trim()
 if(!/^[a-zA-Z0-9._:-]{1,160}$/.test(requestId))
   reject('Для отмены требуется уникальный идентификатор запроса.')
 const reason=String(input.reason||'').trim()
 if(!reason||reason.length>300)reject('Укажите краткую причину отмены.')
 if(input.goodsWithCustomerConfirmed!==true)
   reject('Сначала подтвердите, что все вещи остаются у покупателя и ещё не поступили в магазин.')
 const method=String(input.recoveryMethod||'').trim().toUpperCase()
 if(method.length>100)reject('Некорректный способ возврата денег магазину.')
 const prior=await existingCancellation(db,id)
 if(prior)return canReplay(prior,requestId,reason,method)

 const posting=await db.prepare(
  `SELECT vp.preparation_id,vp.return_id,vp.order_id,vp.posted_at,
       vp.contract_total_after,vp.net_held_after,
       p.baseline_total AS original_total,p.baseline_received AS original_paid,
       p.planned_refund,p.planned_refund_method AS payment_method,
       p.baseline_order_updated_at AS order_version,
       r.status AS return_status,r.amount AS return_amount,r.payment_method AS return_method,
       o.total_amount AS current_total,o.updated_at AS current_version,
       o.pricing_mode AS current_pricing,
       (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
          FROM payments pay WHERE pay.order_id=vp.order_id) AS received_cash,
       (SELECT COUNT(*) FROM returns ret WHERE ret.order_id=vp.order_id) AS return_count,
       (SELECT COUNT(*) FROM exchanges ex WHERE ex.order_id=vp.order_id) AS exchange_count,
       (SELECT COUNT(*) FROM financial_events fe
          WHERE fe.order_id=vp.order_id AND fe.event_at>vp.posted_at
          AND fe.event_key<>'return-v2:posted:'||vp.preparation_id) AS subsequent_money_events,
       (SELECT COUNT(*) FROM payments pay WHERE pay.order_id=vp.order_id
          AND julianday(pay.created_at)>julianday(vp.posted_at)) AS new_payments
     FROM return_v2_postings vp
     JOIN return_v2_prepared_operations p ON p.id=vp.preparation_id
     JOIN returns r ON r.id=vp.return_id AND r.order_id=vp.order_id
     JOIN orders o ON o.id=vp.order_id
     WHERE vp.preparation_id=? LIMIT 1`
 ).bind(id).first<Posting>()
 if(!posting)reject('Проведённый Return V2 не найден.')
 const refund=exact(posting.planned_refund,'сумма выплаты')
 const originalTotal=exact(posting.original_total,'исходная стоимость')
 const paid=exact(posting.original_paid,'исходная оплата')
 const finalTotal=exact(posting.contract_total_after,'стоимость после возврата')
 const current=exact(posting.current_total,'текущая сумма заказа')
 if(posting.return_status!=='completed'
   ||posting.current_pricing!=='itemized_v1'
   ||posting.current_version!==posting.posted_at
   ||current!==finalTotal
   ||exact(posting.received_cash,'оплаты')!==paid
   ||exact(posting.return_amount,'возврат денег')!==refund
   ||posting.return_method!==posting.payment_method
   ||exact(posting.net_held_after,'деньги после возврата')!==paid-refund
   ||posting.return_count!==1 || posting.exchange_count!==0
   ||posting.subsequent_money_events!==0 || posting.new_payments!==0)
   reject('После возврата уже изменились заказ, деньги или операции. Автоматическая отмена запрещена.')
 if(refund>0 && (input.refundRecoveredConfirmed!==true || !method))
   reject('Отмена денежного возврата допускается только после фактического получения денег обратно от клиента и выбора способа.')
 if(refund===0&&(method||input.refundRecoveredConfirmed===true))
   reject('При нулевой выплате обратная денежная операция не требуется.')
 if(refund>0){
  const event=await db.prepare(
    `SELECT amount_delta,payment_method,event_type,source_id
      FROM financial_events WHERE event_key=? LIMIT 1`
  ).bind('return-v2:posted:'+id).first<Record<string,unknown>>()
  if(!event||event.event_type!=='order_refund'||event.amount_delta!==-refund
    ||event.source_id!==posting.return_id ||event.payment_method!==posting.payment_method)
    reject('Подтверждение первоначальной денежной выплаты повреждено или отсутствует.')
 }
 const lines=(await db.prepare(
   `SELECT pi.order_item_id,pi.quantity,pi.sold_unit_price,pi.baseline_order_item_quantity,
     pi.reduced_value,oi.quantity AS current_quantity,oi.unit_price AS current_unit_price,
     oi.line_total AS current_line_total,
     ri.quantity AS returned_quantity,ri.amount AS returned_amount,
     ri.contract_quantity_applied,ri.physical_tracking,ri.physical_received_at,ri.restocked,
     (SELECT COUNT(*) FROM inventory_lifecycle_events le
      WHERE le.operation_type='return' AND le.operation_id=? AND le.operation_item_id=ri.id) AS lifecycle_count,
     (SELECT COUNT(*) FROM inventory_reservations ir
      WHERE ir.order_item_id=pi.order_item_id AND ir.status IN ('active','unresolved')) AS active_reservations,
     (SELECT COUNT(*) FROM order_dispatch_items di JOIN order_dispatches od ON od.id=di.dispatch_id
      WHERE di.order_item_id=pi.order_item_id AND julianday(od.created_at)>julianday(?)) AS new_dispatches
    FROM return_v2_prepared_items pi
    JOIN order_items oi ON oi.id=pi.order_item_id AND oi.order_id=?
    JOIN return_items ri ON ri.order_item_id=pi.order_item_id AND ri.return_id=?
    WHERE pi.operation_id=? ORDER BY pi.order_item_id`
 ).bind(posting.return_id,posting.posted_at,posting.order_id,posting.return_id,id).all<Line>()).results||[]
 if(!lines.length || lines.length>100)reject('Не найдены подтверждённые позиции возврата.')
 for(const line of lines) {
  const qty=requiredId(line.quantity,'количество')
  const unit=exact(line.sold_unit_price,'историческая цена')
  const original=requiredId(line.baseline_order_item_quantity,'исходное количество')
  if(original<qty || exact(line.current_quantity,'оставшееся количество')!==original-qty
    ||exact(line.current_unit_price,'текущая цена')!==unit
    ||exact(line.current_line_total,'стоимость строки')!==(original-qty)*unit
    ||exact(line.reduced_value,'стоимость возврата')!==qty*unit
    ||exact(line.returned_quantity,'количество физического возврата')!==qty
    ||exact(line.returned_amount,'стоимость физического возврата')!==qty*unit
    ||line.contract_quantity_applied!==1 ||line.physical_tracking!==1
    ||line.physical_received_at!==null ||line.restocked!==0
    ||line.lifecycle_count!==0 ||line.active_reservations!==0 ||line.new_dispatches!==0)
   reject('Позиция уже менялась, поступила или использовалась. Нельзя отменить автоматически.')
 }
 if(lines.reduce((n,x)=>n+x.reduced_value,0)!==originalTotal-finalTotal)
   reject('Стоимость всех возвращённых позиций не совпадает с заказом.')
 const stamp=new Date().toISOString()
 const date=stamp.slice(0,10)
 const statements:D1PreparedStatement[]=[]
 // All independent business guards are rechecked DURING the same D1 batch.
 statements.push(db.prepare(
   `UPDATE returns SET status='cancelled',cancelled_at=?,cancellation_comment=?
    WHERE id=? AND order_id=? AND status='completed' AND amount=?
    AND payment_method IS ?
    AND EXISTS(
      SELECT 1 FROM return_v2_postings vp
      JOIN return_v2_prepared_operations p ON p.id=vp.preparation_id
      JOIN orders o ON o.id=vp.order_id
      WHERE vp.preparation_id=? AND vp.return_id=returns.id
       AND o.pricing_mode='itemized_v1'
       AND o.total_amount=? AND o.updated_at=vp.posted_at
       AND p.baseline_total=? AND p.baseline_received=?
       AND (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
            FROM payments pay WHERE pay.order_id=o.id)=?
       AND (SELECT COUNT(*) FROM returns ret WHERE ret.order_id=o.id)=1
       AND NOT EXISTS(SELECT 1 FROM exchanges ex WHERE ex.order_id=o.id)
       AND NOT EXISTS(SELECT 1 FROM return_v2_cancellations c WHERE c.preparation_id=vp.preparation_id)
       AND NOT EXISTS(SELECT 1 FROM financial_events fe WHERE fe.order_id=o.id
         AND fe.event_at>vp.posted_at AND fe.event_key<>'return-v2:posted:'||vp.preparation_id)
       AND NOT EXISTS(SELECT 1 FROM payments pay WHERE pay.order_id=o.id
         AND julianday(pay.created_at)>julianday(vp.posted_at))
       AND NOT EXISTS(
         SELECT 1 FROM return_items ri WHERE ri.return_id=returns.id
          AND (ri.physical_tracking<>1 OR ri.contract_quantity_applied<>1
            OR ri.physical_received_at IS NOT NULL OR ri.restocked<>0
            OR EXISTS(SELECT 1 FROM inventory_lifecycle_events le
              WHERE le.operation_type='return' AND le.operation_id=returns.id
                AND le.operation_item_id=ri.id))
       )
    )`
 ).bind(stamp,reason,posting.return_id,posting.order_id,refund,posting.payment_method,
   id,finalTotal,originalTotal,paid,paid))
 statements.push(check(db,'header'))
 statements.push(db.prepare(
   `INSERT INTO return_v2_cancellations(
      preparation_id,request_id,return_id,order_id,cancelled_at,reason,
      goods_with_customer_confirmed,refund_recovered_at,recovery_method,
      reversed_amount,original_contract_total,original_paid_in
    ) VALUES(?,?,?,?,?,?,1,?,?,?,?,?)`
 ).bind(id,requestId,posting.return_id,posting.order_id,stamp,reason,
  refund>0?stamp:null,refund>0?method:null,refund,originalTotal,paid))
 statements.push(check(db,'cancel_mapping'))
 for(const line of lines){
  statements.push(db.prepare(
    `UPDATE order_items SET quantity=quantity+?,line_total=(quantity+?)*unit_price
      WHERE id=? AND order_id=? AND quantity=? AND unit_price=?
       AND line_total=quantity*unit_price
       AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir
         WHERE ir.order_item_id=order_items.id AND ir.status IN ('active','unresolved'))
       AND EXISTS(
         SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
         WHERE ri.order_item_id=order_items.id AND ri.return_id=?
          AND r.status='cancelled' AND ri.quantity=?
          AND ri.amount=? AND ri.contract_quantity_applied=1
          AND ri.physical_tracking=1 AND ri.physical_received_at IS NULL AND ri.restocked=0
          AND NOT EXISTS(SELECT 1 FROM inventory_lifecycle_events le
            WHERE le.operation_type='return' AND le.operation_id=r.id
             AND le.operation_item_id=ri.id)
       )
       AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
         JOIN order_dispatches od ON od.id=di.dispatch_id
         WHERE di.order_item_id=order_items.id AND julianday(od.created_at)>julianday(?))`
  ).bind(line.quantity,line.quantity,line.order_item_id,posting.order_id,
    line.current_quantity,line.sold_unit_price,posting.return_id,
    line.quantity,line.reduced_value,posting.posted_at))
  statements.push(check(db,'restore_line'))
 }
 statements.push(db.prepare(
   `UPDATE orders SET total_amount=?,received_amount=?,return_amount=0,
      debt_amount=MAX(0,?-?),updated_at=?
     WHERE id=? AND updated_at=? AND total_amount=?
       AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
          WHERE oi.order_id=orders.id AND oi.quantity>0)=?
       AND (SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount ELSE 0 END),0)
            FROM payments p WHERE p.order_id=orders.id)=?
       AND NOT EXISTS(SELECT 1 FROM returns r WHERE r.order_id=orders.id AND r.status<>'cancelled')
       AND EXISTS(SELECT 1 FROM return_v2_cancellations c
        WHERE c.preparation_id=? AND c.return_id=? AND c.order_id=orders.id)`
 ).bind(originalTotal,paid,originalTotal,paid,stamp,posting.order_id,posting.posted_at,
     finalTotal,originalTotal,paid,id,posting.return_id))
 statements.push(check(db,'restore_contract_total'))
 if(refund>0){
  statements.push(db.prepare(
    `INSERT INTO financial_events(event_key,order_id,external_order_id,event_date,event_at,
      event_type,related_type,amount_delta,payment_method,source_type,source_id,
      source_ref,reason,comment,is_backfill,created_at)
     SELECT 'return-v2:cancelled:'||c.preparation_id,c.order_id,o.external_id,?,?,
       'refund_reversal','order_refund',?,?,'return',c.return_id,
       'returns:'||c.return_id,'return_cancel',?,0,?
     FROM return_v2_cancellations c JOIN orders o ON o.id=c.order_id
     WHERE c.preparation_id=? AND c.return_id=?
       AND c.reversed_amount=? AND c.recovery_method=?
       AND EXISTS(SELECT 1 FROM financial_events fe
         WHERE fe.event_key='return-v2:posted:'||c.preparation_id
           AND fe.order_id=c.order_id AND fe.source_id=c.return_id
           AND fe.amount_delta=-c.reversed_amount AND fe.event_type='order_refund')`
  ).bind(date,stamp,refund,method,reason,stamp,id,posting.return_id,refund,method))
  statements.push(check(db,'refund_recovery'))
 }
 try {
  await db.batch(statements)
 } catch(error) {
  const latest=await existingCancellation(db,id)
  if(latest) return canReplay(latest,requestId,reason,method)
  const message=error instanceof Error?error.message:String(error)
  if(/RETURN_V2_CANCEL_CONFLICT|malformed JSON|constraint failed|UNIQUE|FOREIGN KEY/i.test(message))
    reject('Заказ, физический статус или деньги изменились параллельно. Отмена целиком отклонена.')
  throw error
 }
 const saved=await existingCancellation(db,id)
 if(!saved)throw Error('Транзакция завершилась, но подтверждения отмены нет.')
 return {ok:true,cancelled:true,replayed:false,returnId:saved.return_id,
  orderId:saved.order_id,contractRestored:true,cashRecovered:saved.reversed_amount}
}
