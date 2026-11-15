// Isolated unified Return V2 cancellation. NO HTTP route or live caller.
// Only a pending physical return may be undone: goods already received by the
// store require a separate evidenced correction, never a fictional reverse stock.
// Restores unshipped reservations ONLY when exact free physical capacity remains.
// Cash recovery is recorded ONLY after explicit confirmation of actual receipt.
import {readVersionedReturnMoney} from './return-v2-financial-projection.ts'

export class ReturnV2UnifiedCancelConflict extends Error{
 readonly status=409
 readonly code='return_v2_unified_cancel_conflict'
}
function fail(msg:string):never{throw new ReturnV2UnifiedCancelConflict(msg)}
function number(n:unknown,label:string,min=0){
 if(!Number.isSafeInteger(n)||Number(n)<min)fail('Недостоверное значение: '+label)
 return Number(n)
}
function checked(db:D1Database,stage:string){
 return db.prepare(`SELECT json('RETURN_V2_UNIFIED_CANCEL_CONFLICT_${stage}') WHERE changes()<>1`)
}
type Input={
 postingId:number;requestId:string;reason:string;
 shippedGoodsUnreceivedConfirmed:boolean;reservationsRestoreConfirmed:boolean;
 refundRecoveredConfirmed:boolean;recoveryMethod?:string
}
type Posting={
 id:number;request_id:string;return_id:number;order_id:number;posted_at:string;
 initial_total:number;final_total:number;initial_received:number;
 cash_refund:number;refund_method:string|null;full_termination:number;
 return_status:string;return_amount:number;return_method:string|null;
 current_total:number;current_version:string;current_pricing:string;
 order_status:string;archived_at:string|null;
 received_cash:number;return_count:number;exchange_count:number;
 later_payments:number;later_money_events:number
}
type Line={
 id:number;order_item_id:number;action:string;contracted_quantity:number;
 original_line_quantity:number;sold_unit_price:number;contract_reduction:number;
 reservation_id:number|null;reservation_release:number;receipt_intent:string;
 current_quantity:number;current_unit_price:number;current_line_total:number;
 current_status:string;source_type:string;variant_id:number|null;is_workshop:number;
 reservation_quantity:number|null;reservation_status:string|null;
 reservation_source:string|null;reservation_variant:number|null;
 reservation_updated_at:string|null;reservation_released_at:string|null;
 physical_id:number|null;physical_qty:number|null;physical_amount:number|null;
 physical_tracking:number|null;contract_quantity_applied:number|null;
 physical_received_at:string|null;physical_restocked:number|null;
 lifecycle_count:number;new_dispatches:number
}
type Saved={
 posting_id:number;request_id:string;return_id:number;order_id:number;
 reason:string;shipped_goods_unreceived_confirmed:number;
 reservations_restore_confirmed:number;reversed_amount:number;
 recovery_method:string|null
}
type Stock={id:number;quantity:number;reserved_quantity:number;last_source_ref:string|null}
const standardized=(input:Input)=>{
 const postingId=number(input.postingId,'возврат',1)
 const requestId=String(input.requestId||'').trim()
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/.test(requestId))
  fail('Нужен уникальный идентификатор операции.')
 const reason=String(input.reason||'').trim()
 if(!reason||reason.length>300)fail('Укажите причину отмены.')
 const method=String(input.recoveryMethod||'').trim().toLocaleUpperCase('ru-RU')
 if(method.length>100)fail('Некорректный способ поступления денег.')
 return {postingId,requestId,reason,method,
  shipped:Boolean(input.shippedGoodsUnreceivedConfirmed),
  reservations:Boolean(input.reservationsRestoreConfirmed),
  refunded:Boolean(input.refundRecoveredConfirmed)}
}
type Wanted=ReturnType<typeof standardized>
async function findCancel(db:D1Database,postingId:number){
 return db.prepare(`SELECT posting_id,request_id,return_id,order_id,reason,
     shipped_goods_unreceived_confirmed,reservations_restore_confirmed,
     reversed_amount,recovery_method
   FROM return_v2_unified_cancellations WHERE posting_id=?`).bind(postingId).first<Saved>()
}
async function replay(db:D1Database,w:Wanted,s:Saved){
 if(s.request_id!==w.requestId||s.reason!==w.reason||
   String(s.recovery_method||'')!==w.method||
   Boolean(s.shipped_goods_unreceived_confirmed)!==w.shipped||
   Boolean(s.reservations_restore_confirmed)!==w.reservations||
   Boolean(s.reversed_amount>0)!==w.refunded)
   fail('Возврат уже отменён с другими подтверждениями.')
 const ledger=await readVersionedReturnMoney(db,s.order_id)
 if(ledger.kind!=='return_v2')fail('Журнал отменённого Return V2 не подтверждён.')
 return {ok:true,replayed:true,cancelled:true,postingId:s.posting_id,
   returnId:s.return_id,orderId:s.order_id,cashRecovered:s.reversed_amount,
   physicalStockDelta:0,customerDebt:ledger.customerDebt,storeOwesCustomer:ledger.customerOverpay}
}
export async function cancelUnifiedReturnV2Prototype(db:D1Database,input:Input){
 const w=standardized(input)
 const old=await findCancel(db,w.postingId)
 if(old)return replay(db,w,old)
 const p=await db.prepare(`SELECT up.id,up.request_id,up.return_id,up.order_id,up.posted_at,
    up.initial_total,up.final_total,up.initial_received,up.cash_refund,up.refund_method,
    up.full_termination,r.status AS return_status,r.amount AS return_amount,
    r.payment_method AS return_method,o.total_amount AS current_total,
    o.updated_at AS current_version,o.pricing_mode AS current_pricing,
    o.order_status,o.archived_at,
    (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
      FROM payments pay WHERE pay.order_id=up.order_id) AS received_cash,
    (SELECT COUNT(*) FROM returns r2 WHERE r2.order_id=up.order_id) AS return_count,
    (SELECT COUNT(*) FROM exchanges e WHERE e.order_id=up.order_id
      AND COALESCE(e.status,'completed')<>'cancelled') AS exchange_count,
    (SELECT COUNT(*) FROM payments pay WHERE pay.order_id=up.order_id
      AND julianday(pay.created_at)>julianday(up.posted_at)) AS later_payments,
    (SELECT COUNT(*) FROM financial_events fe WHERE fe.order_id=up.order_id
      AND fe.event_at>up.posted_at AND fe.event_key<>'return-v2:unified:'||up.request_id)
      AS later_money_events
   FROM return_v2_unified_postings up JOIN returns r ON r.id=up.return_id
   JOIN orders o ON o.id=up.order_id WHERE up.id=? LIMIT 1`)
    .bind(w.postingId).first<Posting>()
 if(!p)fail('Проведённый смешанный возврат не найден.')
 const ledger=await readVersionedReturnMoney(db,p.order_id)
 if(ledger.kind!=='return_v2')fail('Финансовая история возврата не подтверждена.')
 const orig=number(p.initial_total,'исходная стоимость'),final=number(p.final_total,'остаточная стоимость')
 const paid=number(p.initial_received,'полученные оплаты'),refund=number(p.cash_refund,'выплата')
 if(p.return_status!=='completed'||p.return_amount!==refund||
   String(p.return_method||'')!==String(p.refund_method||'')||
   p.current_pricing!=='itemized_v1'||p.current_total!==final||
   p.current_version!==p.posted_at||p.received_cash!==paid||
   p.return_count!==1||p.exchange_count!==0||p.later_payments!==0||
   p.later_money_events!==0||p.archived_at!==null||
   ['archived','deleted'].includes(p.order_status)||orig<final||
   ledger.currentSale!==final||ledger.paidIn!==paid||ledger.paidOut!==refund)
   fail('Заказ, деньги или другая операция уже изменились. Автоматическая отмена запрещена.')
 if(refund>0&&(!w.refunded||!w.method))
   fail('Сначала подтвердите фактический возврат выплаченных денег магазину и способ поступления.')
 if(refund===0&&(w.refunded||w.method))
   fail('Денежной выплаты не было: нельзя создавать обратный платёж.')
 const lines=(await db.prepare(`SELECT ul.id,ul.order_item_id,COALESCE(ao.semantic_action,ul.action) AS action,ul.contracted_quantity,
   ul.original_line_quantity,ul.sold_unit_price,ul.contract_reduction,
   ul.reservation_id,ul.reservation_release,ul.receipt_intent,
   oi.quantity AS current_quantity,oi.unit_price AS current_unit_price,
   oi.line_total AS current_line_total,oi.stock_writeoff_status AS current_status,
   oi.source_type,oi.variant_id,oi.is_workshop,
   ir.quantity AS reservation_quantity,ir.status AS reservation_status,
   ir.inventory_source AS reservation_source,ir.variant_id AS reservation_variant,
   ir.updated_at AS reservation_updated_at,ir.released_at AS reservation_released_at,
   ri.id AS physical_id,ri.quantity AS physical_qty,ri.amount AS physical_amount,
   ri.physical_tracking,ri.contract_quantity_applied,
   ri.physical_received_at,ri.restocked AS physical_restocked,
   (SELECT COUNT(*) FROM inventory_lifecycle_events le
     WHERE le.operation_type='return' AND le.operation_id=? AND le.operation_item_id=ri.id)
       AS lifecycle_count,
   (SELECT COUNT(*) FROM order_dispatch_items di
     JOIN order_dispatches d ON d.id=di.dispatch_id
     WHERE di.order_item_id=ul.order_item_id AND d.created_at>?) AS new_dispatches
   FROM return_v2_unified_lines ul
   LEFT JOIN return_v2_unified_action_overrides ao
     ON ao.posting_id=ul.posting_id AND ao.order_item_id=ul.order_item_id
   JOIN order_items oi ON oi.id=ul.order_item_id AND oi.order_id=?
   LEFT JOIN inventory_reservations ir ON ir.id=ul.reservation_id AND ir.order_item_id=oi.id
   LEFT JOIN return_items ri ON ri.return_id=? AND ri.order_item_id=oi.id
   WHERE ul.posting_id=? ORDER BY ul.id`)
   .bind(p.return_id,p.posted_at,p.order_id,p.return_id,p.id).all<Line>()).results||[]
 if(!lines.length||lines.length>100||new Set(lines.map(x=>x.order_item_id)).size!==lines.length)
   fail('Состав возврата требует сверки.')
 const shipped=lines.some(x=>x.action==='physical_return_pending')
 const reserved=lines.some(x=>x.action==='cancel_unshipped_reservation'||x.action==='cancel_unresolved_reservation')
 if((shipped&&!w.shipped)||(!shipped&&w.shipped))
   fail('Подтверждение физически отправленных товаров не соответствует операции.')
 if((reserved&&!w.reservations)||(!reserved&&w.reservations))
   fail('Подтвердите восстановление неотправленных резервов.')
 const stockGroups=new Map<string,{stock:Stock;amount:number;source:string;variant:number}>()
 let totalReduced=0
 const pendingLines:Line[]=[]
 for(const l of lines){
   const qty=number(l.contracted_quantity,'количество',1)
   const originalQty=number(l.original_line_quantity,'исходное количество',1)
   const price=number(l.sold_unit_price,'цена продажи')
   const reduced=number(l.contract_reduction,'стоимость сокращения')
   const remaining=originalQty-qty
   if(originalQty<qty||!Number.isSafeInteger(qty*price)||reduced!==qty*price||
      l.current_quantity!==remaining||l.current_unit_price!==price||
      l.current_line_total!==remaining*price||l.new_dispatches!==0)
      fail('После операции изменили количество, цену или отправку позиции.')
   totalReduced+=reduced
   if(!Number.isSafeInteger(totalReduced))fail('Стоимость позиций некорректна.')
   if(l.action==='physical_return_pending'){
     if(l.reservation_id!==null||l.reservation_release!==0||!l.physical_id||
       l.physical_qty!==qty||l.physical_amount!==reduced||
       l.physical_tracking!==1||l.contract_quantity_applied!==1||
       l.physical_received_at!==null||l.physical_restocked!==0||
       l.lifecycle_count!==0)
       fail('Отправленный товар уже поступил, списан или физическая история неоднозначна.')
   }else if(l.action==='cancel_unreserved_obligation'){
     if(l.is_workshop!==0||l.reservation_id!==null||l.reservation_release!==0||
       l.physical_id!==null||l.receipt_intent!=='not_applicable'||
       l.lifecycle_count!==0||l.new_dispatches!==0||
       !['pending_reservation','not_reserved','unreserved',''].includes(String(l.current_status||'')))
       fail('У товара появилась выдача, резерв или несогласованный статус.')
   }else if(l.action==='cancel_workshop_obligation'){
     if(l.is_workshop!==1||l.reservation_id!==null||l.reservation_release!==0||
       l.physical_id!==null||l.receipt_intent!=='not_applicable'||
       l.lifecycle_count!==0||l.new_dispatches!==0)
       fail('Отмена цеховой позиции не должна менять производство, резерв или физический товар.')
   }else if(l.action==='cancel_unshipped_reservation'||
            l.action==='cancel_unresolved_reservation'){
     const active=l.action==='cancel_unshipped_reservation'
     const originalStatus=active?'active':'unresolved'
     const originallyReserved=active?'reserved':'pending_reservation'
     const full=qty===originalQty
     if(!l.reservation_id||l.physical_id!==null||
       l.receipt_intent!=='not_applicable'||l.reservation_source!==l.source_type||
       l.reservation_updated_at!==p.posted_at||
       l.reservation_quantity!==(full?originalQty:originalQty-qty)||
       l.reservation_status!==(full?'released':originalStatus)||
       (full&&l.reservation_released_at!==p.posted_at)||
       l.current_status!==(full?'reservation_released':originallyReserved)||
       (active?l.reservation_release!==qty:l.reservation_release!==0))
       fail('Снятый резерв или статус не соответствует исходному списанию.')
     if(active){
       const variant=number(l.reservation_variant,'артикул резерва',1)
       const source=String(l.reservation_source||'')
       const key=source+':'+variant
       const found=stockGroups.get(key)
       if(found)found.amount+=qty
       else{
         const rows=(await db.prepare(`SELECT id,quantity,reserved_quantity,last_source_ref
          FROM inventory_stock WHERE inventory_source=? AND variant_id=?`)
          .bind(source,variant).all<Stock>()).results||[]
         if(rows.length!==1)fail('Складская позиция резерва неоднозначна.')
         stockGroups.set(key,{stock:rows[0],amount:qty,source,variant})
       }
     }
   }else fail('Неизвестное действие в журнале возврата.')
   pendingLines.push(l)
 }
 if(totalReduced!==orig-final)fail('Восстановленная сумма не равна исходной стоимости заказа.')
 for(const {stock,amount} of stockGroups.values()){
   if(stock.quantity<0||stock.reserved_quantity<0||
      stock.quantity-stock.reserved_quantity<amount||
      stock.last_source_ref!=='return-v2:unified:'+p.request_id)
     fail('Резерв нельзя восстановить: товар уже зарезервирован, выдан или пересчитан.')
 }
 if(refund>0){
  const e=await db.prepare(`SELECT amount_delta,payment_method,event_type,source_id
    FROM financial_events WHERE event_key=?`).bind('return-v2:unified:'+p.request_id)
    .first<{amount_delta:number;payment_method:string;event_type:string;source_id:number}>()
  if(!e||e.amount_delta!==-refund||e.event_type!=='order_refund'||
     e.source_id!==p.return_id||e.payment_method!==p.refund_method)
    fail('Первоначальное денежное событие не подтверждено.')
 }
 const stamp=new Date().toISOString(),date=stamp.slice(0,10)
 const statements:D1PreparedStatement[]=[
   db.prepare(`UPDATE returns SET status='cancelled',cancelled_at=?,cancellation_comment=?
     WHERE id=? AND order_id=? AND status='completed' AND amount=?
       AND payment_method IS ?
       AND EXISTS(SELECT 1 FROM return_v2_unified_postings up
         JOIN orders o ON o.id=up.order_id
         WHERE up.id=? AND up.return_id=returns.id AND up.order_id=returns.order_id
           AND o.pricing_mode='itemized_v1' AND o.total_amount=? AND o.updated_at=up.posted_at
           AND (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
                FROM payments pay WHERE pay.order_id=o.id)=?
           AND (SELECT COUNT(*) FROM returns r WHERE r.order_id=o.id)=1
           AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id
             AND COALESCE(e.status,'completed')<>'cancelled')
           AND NOT EXISTS(SELECT 1 FROM return_v2_unified_cancellations uc WHERE uc.posting_id=up.id)
           AND NOT EXISTS(SELECT 1 FROM financial_events fe WHERE fe.order_id=o.id
              AND fe.event_at>up.posted_at
              AND fe.event_key<>'return-v2:unified:'||up.request_id)
           AND NOT EXISTS(SELECT 1 FROM return_items ri WHERE ri.return_id=up.return_id
             AND (ri.physical_received_at IS NOT NULL OR ri.restocked<>0 OR
              EXISTS(SELECT 1 FROM inventory_lifecycle_events le
               WHERE le.operation_type='return' AND le.operation_id=up.return_id
                 AND le.operation_item_id=ri.id)))
           AND (?=0 OR EXISTS(SELECT 1 FROM financial_events fe
             WHERE fe.event_key='return-v2:unified:'||up.request_id
               AND fe.order_id=o.id AND fe.source_id=up.return_id
               AND fe.event_type='order_refund' AND fe.amount_delta=-?
               AND fe.payment_method=up.refund_method))
       )`)
      .bind(stamp,w.reason,p.return_id,p.order_id,refund,p.refund_method,
        p.id,final,paid,refund,refund),
   checked(db,'return_header'),
   db.prepare(`INSERT INTO return_v2_unified_cancellations(
     posting_id,request_id,return_id,order_id,cancelled_at,reason,
     shipped_goods_unreceived_confirmed,reservations_restore_confirmed,
     refund_recovered_at,recovery_method,reversed_amount,initial_total,initial_received)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(p.id,w.requestId,p.return_id,p.order_id,stamp,w.reason,
        shipped?1:0,reserved?1:0,refund>0?stamp:null,refund>0?w.method:null,
        refund,orig,paid),
   checked(db,'cancel_provenance'),
 ]
 for(const {stock,amount} of stockGroups.values()){
   statements.push(db.prepare(`UPDATE inventory_stock SET
     reserved_quantity=reserved_quantity+?,
     last_action='Отмена смешанного Return V2 — восстановлен резерв',
     last_source_ref=?,updated_at=?
     WHERE id=? AND quantity=? AND reserved_quantity=? AND last_source_ref=?
       AND quantity-reserved_quantity>=?`)
       .bind(amount,'return-v2:unified:cancelled:'+w.requestId,stamp,
         stock.id,stock.quantity,stock.reserved_quantity,
         'return-v2:unified:'+p.request_id,amount))
   statements.push(checked(db,'restore_reserved_stock'))
 }
 for(const l of pendingLines){
   const qty=l.contracted_quantity,full=qty===l.original_line_quantity
   const isPhysical=l.action==='physical_return_pending'
   const withoutReservation=['cancel_workshop_obligation','cancel_unreserved_obligation'].includes(l.action)
   if(!isPhysical&&!withoutReservation){
     const active=l.action==='cancel_unshipped_reservation'
     const targetStatus=active?'active':'unresolved'
     statements.push(db.prepare(`UPDATE inventory_reservations
       SET quantity=?,status=?,released_at=NULL,updated_at=?
       WHERE id=? AND order_id=? AND order_item_id=? AND quantity=?
         AND status=? AND updated_at=?
         AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
           WHERE di.order_item_id=inventory_reservations.order_item_id)`)
       .bind(l.original_line_quantity,targetStatus,stamp,l.reservation_id,
         p.order_id,l.order_item_id,l.reservation_quantity,
         l.reservation_status,p.posted_at))
     statements.push(checked(db,'restore_reservation_row'))
   }
   const expectedStatus=isPhysical||withoutReservation?l.current_status:
     (full?'reservation_released':l.action==='cancel_unshipped_reservation'?'reserved':'pending_reservation')
   const restoredStatus=isPhysical||withoutReservation?l.current_status:
     (l.action==='cancel_unshipped_reservation'?'reserved':'pending_reservation')
   statements.push(db.prepare(`UPDATE order_items SET quantity=quantity+?,
      line_total=(quantity+?)*unit_price,stock_writeoff_status=?
      WHERE id=? AND order_id=? AND quantity=? AND unit_price=? AND line_total=quantity*unit_price
        AND stock_writeoff_status IS ?
        AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
          JOIN order_dispatches d ON d.id=di.dispatch_id
          WHERE di.order_item_id=order_items.id AND d.created_at>?)
        AND EXISTS(SELECT 1 FROM return_v2_unified_cancellations uc
          WHERE uc.posting_id=? AND uc.return_id=? AND uc.order_id=order_items.order_id)`)
      .bind(qty,qty,restoredStatus,l.order_item_id,p.order_id,l.current_quantity,
        l.sold_unit_price,expectedStatus,p.posted_at,p.id,p.return_id))
   statements.push(checked(db,'restore_contract_line'))
 }
 statements.push(db.prepare(`UPDATE orders SET total_amount=?,received_amount=?,
     return_amount=0,debt_amount=MAX(0,?-?),updated_at=?
    WHERE id=? AND total_amount=? AND updated_at=?
      AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
       WHERE oi.order_id=orders.id AND oi.quantity>0)=?
      AND (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
       FROM payments pay WHERE pay.order_id=orders.id)=?
      AND NOT EXISTS(SELECT 1 FROM returns ret WHERE ret.order_id=orders.id
       AND ret.status<>'cancelled')
      AND EXISTS(SELECT 1 FROM return_v2_unified_cancellations uc
       WHERE uc.posting_id=? AND uc.return_id=? AND uc.order_id=orders.id)`)
     .bind(orig,paid,orig,paid,stamp,p.order_id,final,p.posted_at,orig,paid,p.id,p.return_id))
 statements.push(checked(db,'restore_order_total'))
 if(refund>0){
   statements.push(db.prepare(`INSERT INTO financial_events(event_key,order_id,external_order_id,
      event_date,event_at,event_type,related_type,amount_delta,payment_method,
      source_type,source_id,source_ref,reason,comment,is_backfill,created_at)
      SELECT 'return-v2:unified:cancelled:'||uc.posting_id,uc.order_id,o.external_id,
       ?,?,'refund_reversal','order_refund',?,?,'return',uc.return_id,
       'returns:'||uc.return_id,'return_cancel',?,0,?
      FROM return_v2_unified_cancellations uc JOIN orders o ON o.id=uc.order_id
      WHERE uc.posting_id=? AND uc.return_id=? AND uc.reversed_amount=?
        AND uc.recovery_method=?
        AND EXISTS(SELECT 1 FROM financial_events fe
         WHERE fe.event_key='return-v2:unified:'||?
           AND fe.order_id=uc.order_id AND fe.source_id=uc.return_id
           AND fe.event_type='order_refund' AND fe.amount_delta=-uc.reversed_amount)`)
     .bind(date,stamp,refund,w.method,w.reason,stamp,p.id,p.return_id,refund,
       w.method,p.request_id))
   statements.push(checked(db,'cash_recovered'))
 }
 try{await db.batch(statements)}
 catch(error){
   const current=await findCancel(db,w.postingId)
   if(current)return replay(db,w,current)
   const msg=error instanceof Error?error.message:String(error)
   if(/RETURN_V2_UNIFIED_CANCEL_CONFLICT|malformed JSON|constraint failed|UNIQUE|FOREIGN KEY/i.test(msg))
     fail('Операции, резервы или деньги изменились. Отмена полностью отклонена.')
   throw error
 }
 const saved=await findCancel(db,w.postingId)
 if(!saved)throw new Error('Отмена проведена, но запись подтверждения отсутствует.')
 const result=await replay(db,w,saved)
 return {...result,replayed:false}
}
