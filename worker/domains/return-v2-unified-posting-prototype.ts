// Isolated Stage 2 prototype: mixed physical Return + cancellation of unshipped reservations.
// NO Worker route, UI, or old Return/Exchange/financial consumer imports this module.
// Any legacy/reconciled item is fail-closed. Full cancellation/reversal is NOT implemented.
import { previewUnifiedReturnV2LineEvidence, type ReturnV2LineAction } from './return-v2-unified-line-evidence.ts'

export type ReturnV2ReceiptIntent='pending'|'warehouse'|'boutique'|'no_stock'
type Selection={orderItemId:number;quantity:number;receiptIntent?:ReturnV2ReceiptIntent}
type Input={
  requestId:string;orderId:number;expectedOrderVersion:string;
  items:Selection[];refundAmount:number;refundMethod?:string
}
type Posted={id:number;request_id:string;intent_fingerprint:string;order_id:number;
  return_id:number;final_total:number;cash_refund:number;full_termination:number}
type Res={id:number;order_item_id:number;quantity:number;status:string;
  inventory_source:string;variant_id:number}
type Stock={id:number;inventory_source:string;variant_id:number;quantity:number;reserved_quantity:number}
type PreparedLine={orderItemId:number;quantity:number;originalQty:number;unitPrice:number;
  value:number;action:Exclude<ReturnV2LineAction,'needs_review'>;reservation:Res|null;
  source:string;variant:number|null;oldStatus:string;receiptIntent:ReturnV2ReceiptIntent}
export class ReturnV2UnifiedPostingConflict extends Error {
  readonly status=409
  readonly code='return_v2_unified_posting_conflict'
}
function reject(msg:string):never{throw new ReturnV2UnifiedPostingConflict(msg)}
function safeInt(value:unknown,min=0):number{
  if(!Number.isSafeInteger(value)||Number(value)<min)reject('Цена, количество или сумма недостоверны.')
  return Number(value)
}
function changed(db:D1Database,step:string):D1PreparedStatement{
  return db.prepare(`SELECT json('RETURN_V2_UNIFIED_CONFLICT_`+step+`') WHERE changes()<>1`)
}
async function getPosted(db:D1Database,requestId:string){
  return db.prepare(`SELECT id,request_id,intent_fingerprint,order_id,return_id,
       final_total,cash_refund,full_termination FROM return_v2_unified_postings
       WHERE request_id=? LIMIT 1`).bind(requestId).first<Posted>()
}
function normalizedInput(input:Input){
  const requestId=String(input.requestId||'').trim()
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/.test(requestId))
    reject('Некорректный идентификатор операции.')
  const orderId=safeInt(input.orderId,1)
  const version=String(input.expectedOrderVersion||'')
  if(!version)reject('Сначала обновите заказ и повторите выбор.')
  if(!Array.isArray(input.items)||input.items.length<1||input.items.length>100)
    reject('Выберите хотя бы одну позицию.')
  const items=input.items.map(x=>({
    orderItemId:safeInt(x.orderItemId,1),quantity:safeInt(x.quantity,1),
    receiptIntent:x.receiptIntent===undefined?'pending':x.receiptIntent,
  }))
    .sort((a,b)=>a.orderItemId-b.orderItemId)
  if(items.some(x=>!['pending','warehouse','boutique','no_stock'].includes(x.receiptIntent)))
    reject('Неизвестное решение о физическом приёме товара.')
  if(new Set(items.map(x=>x.orderItemId)).size!==items.length)
    reject('Повторная позиция в списке.')
  const refund=safeInt(input.refundAmount)
  const method=String(input.refundMethod||'').trim().toLocaleUpperCase('ru-RU')
  if((refund>0&&!method)||(refund===0&&method)||method.length>100)
    reject('Способ выплаты должен соответствовать фактической сумме.')
  const fingerprint=JSON.stringify({orderId,version,items,refund,method})
  return {requestId,orderId,version,items,refund,method,fingerprint}
}

export async function postUnifiedReturnV2Prototype(db:D1Database,input:Input){
  const wanted=normalizedInput(input)
  const replay=async (row:Posted)=>{
    const r=await db.prepare(`SELECT status FROM returns WHERE id=? AND order_id=?`)
      .bind(row.return_id,row.order_id).first<{status:string}>()
    if(row.intent_fingerprint!==wanted.fingerprint||row.order_id!==wanted.orderId
      ||r?.status!=='completed')reject('Идентификатор повторно использован для другого или отменённого возврата.')
    return {ok:true,replayed:true,returnId:row.return_id,postingId:row.id,
      orderId:row.order_id,remainingSale:row.final_total,cashRefund:row.cash_refund,
      fullTermination:row.full_termination===1}
  }
  const already=await getPosted(db,wanted.requestId)
  if(already)return replay(already)
  const preview=await previewUnifiedReturnV2LineEvidence(db,wanted.orderId)
  if(preview.orderVersion!==wanted.version)reject('Заказ изменился после открытия формы.')
  if(preview.lines.some(line=>line.requiresReview))
    reject('В заказе есть неоднозначные выдачи, цены или резервы. Оформление остановлено.')
  const byId=new Map(preview.lines.map(line=>[line.orderItemId,line]))
  let totalReduction=0
  const lines:PreparedLine[]=[]
  for(const requested of wanted.items) {
    const line=byId.get(requested.orderItemId)
    if(!line||line.requiresReview||requested.quantity>line.availableQuantity)
      reject('Выбранная позиция или количество изменились.')
    const act=line.proposedAction
    if(act==='needs_review')reject('Товар требует уточнения.')
    if(act!=='physical_return_pending'&&requested.receiptIntent!=='pending')
      reject('Неотправленную позицию нельзя физически принять повторно: она уже в остатке.')
    const value=requested.quantity*line.soldUnitPrice
    if(!Number.isSafeInteger(value)||!Number.isSafeInteger(totalReduction+value))
      reject('Стоимость позиций слишком велика.')
    totalReduction+=value
    const result=(await db.prepare(
      `SELECT id,order_item_id,quantity,status,inventory_source,variant_id
        FROM inventory_reservations WHERE order_item_id=?`
    ).bind(line.orderItemId).all<Res>()).results||[]
    let reservation:Res|null=null
    if(act==='physical_return_pending'){
      if(result.length!==1||result[0].status!=='fulfilled'
        ||result[0].quantity!==line.contractQuantity
        ||line.dispatchedQuantity!==line.contractQuantity)
        reject('Выдача позиции перестала соответствовать журналу отправок.')
    }else{
      if(result.length!==1||result[0].status!==(act==='cancel_unshipped_reservation'?'active':'unresolved')
        ||result[0].quantity!==line.contractQuantity
        ||result[0].inventory_source!==line.sourceType)
        reject('Резерв позиции изменился после расчёта.')
      reservation=result[0]
    }
    const actual=await db.prepare(
      `SELECT quantity,unit_price,stock_writeoff_status,source_type,variant_id
        FROM order_items WHERE id=? AND order_id=?`
    ).bind(line.orderItemId,wanted.orderId).first<{quantity:number;unit_price:number;
      stock_writeoff_status:string;source_type:string;variant_id:number|null}>()
    if(!actual||actual.quantity!==line.contractQuantity||actual.unit_price!==line.soldUnitPrice)
      reject('Количество или цена позиции уже изменились.')
    lines.push({orderItemId:line.orderItemId,quantity:requested.quantity,
      originalQty:line.contractQuantity,unitPrice:line.soldUnitPrice,value,action:act,
      reservation,source:actual.source_type,variant:actual.variant_id,
      oldStatus:actual.stock_writeoff_status,receiptIntent:requested.receiptIntent})
  }
  const order=await db.prepare(
    `SELECT total_amount,updated_at,pricing_mode,external_id,manager_id
      FROM orders WHERE id=?`
  ).bind(wanted.orderId).first<{total_amount:number;updated_at:string;
    pricing_mode:string;external_id:string;manager_id:number|null}>()
  if(!order||order.updated_at!==wanted.version||order.pricing_mode!=='itemized_v1')
    reject('Стоимость заказа или тип цены изменились.')
  const initialTotal=safeInt(order.total_amount)
  const finalTotal=initialTotal-totalReduction
  if(finalTotal<0||totalReduction<=0)reject('Нечего исключать из продажи.')
  const paid=await db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS sum
      FROM payments WHERE order_id=?`
  ).bind(wanted.orderId).first<{sum:number}>()
  const received=safeInt(paid?.sum)
  if(wanted.refund>received)reject('Выплата превышает деньги, полученные от клиента.')
  const fullTermination=lines.length===preview.lines.length &&
    lines.every(l=>l.quantity===l.originalQty)
  const grouped=new Map<string,{stock:Stock;release:number}>()
  for(const line of lines.filter(l=>l.action==='cancel_unshipped_reservation')){
    const r=line.reservation!
    if(!r.variant_id)reject('Не найден проверенный артикул резерва.')
    const key=r.inventory_source+':'+r.variant_id
    if(!grouped.has(key)){
      const stockRows=(await db.prepare(
        `SELECT id,inventory_source,variant_id,quantity,reserved_quantity
          FROM inventory_stock WHERE inventory_source=? AND variant_id=?`
      ).bind(r.inventory_source,r.variant_id).all<Stock>()).results||[]
      if(stockRows.length!==1)reject('Складская позиция неоднозначна.')
      const stock=stockRows[0]
      if(stock.quantity<0||stock.reserved_quantity<0)
        reject('Остаток склада требует проверки.')
      grouped.set(key,{stock,release:0})
    }
    grouped.get(key)!.release+=line.quantity
  }
  for(const group of grouped.values()){
    if(group.release>group.stock.reserved_quantity)
      reject('Указанный резерв больше фактического зарезервированного количества.')
  }
  const stamp=new Date().toISOString(),date=stamp.slice(0,10)
  const statements:D1PreparedStatement[]=[
    db.prepare(
      `INSERT INTO returns(order_id,manager_id,return_date,amount,payment_method,
           status,comment,created_at)
        SELECT o.id,o.manager_id,?,?,?,'completed','Return V2 unified isolated',?
        FROM orders o WHERE o.id=? AND o.pricing_mode='itemized_v1'
          AND o.total_amount=? AND o.updated_at=?
          AND o.order_status NOT IN ('archived','deleted') AND o.archived_at IS NULL
          AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
             WHERE oi.order_id=o.id AND oi.quantity>0)=?
          AND (SELECT COALESCE(SUM(CASE WHEN p.amount>0 THEN p.amount ELSE 0 END),0)
             FROM payments p WHERE p.order_id=o.id)=?
          AND NOT EXISTS(SELECT 1 FROM returns r WHERE r.order_id=o.id)
          AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id)
          AND NOT EXISTS(SELECT 1 FROM return_v2_unified_postings up WHERE up.order_id=o.id)
       AND NOT EXISTS(
         SELECT 1 FROM critical_operations co
         WHERE co.operation_type='order_edit' AND co.status='started'
           AND CAST(json_extract(co.context_json,'$.orderId') AS INTEGER)=o.id)
       AND NOT EXISTS(
         SELECT 1 FROM admin_order_delete_sagas saga
         WHERE saga.order_id=o.id
           AND saga.status IN ('planned','running','review_required','ready_for_final_delete'))
          -- Old critical payment stages can leave a real payment before its
          -- financial event/cache is finished. Posting V2 during that window
          -- would orphan the old event, so refuse the Return atomically.
          AND NOT EXISTS(
            SELECT 1 FROM critical_operations co
            WHERE co.operation_type='order_payment_create' AND co.status='started'
              AND (CAST(json_extract(co.context_json,'$.orderId') AS INTEGER)=o.id
                OR CAST(json_extract(co.context_json,'$.plan.orderId') AS INTEGER)=o.id)
              AND (co.step<>'started' OR co.lease_token IS NOT NULL OR co.target_id IS NOT NULL)
          )`
    ).bind(date,wanted.refund,wanted.method||null,stamp,wanted.orderId,initialTotal,
      wanted.version,initialTotal,received),
    changed(db,'return_header'),
    db.prepare(
      `INSERT INTO return_v2_unified_postings(request_id,intent_fingerprint,order_id,
       return_id,posted_at,initial_total,final_total,initial_received,cash_refund,
       refund_method,full_termination)
       VALUES(?,?,?,last_insert_rowid(),?,?,?,?,?,?,?)`
    ).bind(wanted.requestId,wanted.fingerprint,wanted.orderId,stamp,initialTotal,
      finalTotal,received,wanted.refund,wanted.method||null,fullTermination?1:0),
    changed(db,'posting'),
  ]
  // One reserved_quantity compare-and-swap per SKU, even when multiple lines
  // share the same physical stock. The physical 'quantity' is NEVER updated.
  for(const {stock,release} of grouped.values()){
    statements.push(db.prepare(
      `UPDATE inventory_stock SET reserved_quantity=reserved_quantity-?,
        last_action='Отмена неотправленной позиции V2',last_source_ref=?,updated_at=?
        WHERE id=? AND quantity=? AND reserved_quantity=? AND reserved_quantity>=?`
    ).bind(release,'return-v2:unified:'+wanted.requestId,stamp,stock.id,
      stock.quantity,stock.reserved_quantity,release))
    statements.push(changed(db,'release_reserved_cache'))
  }
  for(const line of lines){
    const r=line.reservation
    if(r){
      statements.push(db.prepare(
        `UPDATE inventory_reservations SET
          quantity=CASE WHEN quantity=? THEN quantity ELSE quantity-? END,
          status=CASE WHEN quantity=? THEN 'released' ELSE status END,
          released_at=CASE WHEN quantity=? THEN ? ELSE released_at END,
          updated_at=?
          WHERE id=? AND order_id=? AND order_item_id=?
            AND status=? AND quantity=? AND inventory_source=?
            AND variant_id IS ?
            AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
              WHERE di.order_item_id=inventory_reservations.order_item_id)`
      ).bind(line.quantity,line.quantity,line.quantity,line.quantity,stamp,stamp,
        r.id,wanted.orderId,line.orderItemId,r.status,r.quantity,
        r.inventory_source,r.variant_id))
      statements.push(changed(db,'release_item_reservation'))
    }
    const guard=line.action==='physical_return_pending'
      ? `AND EXISTS(
          SELECT 1 FROM inventory_reservations r WHERE r.order_item_id=order_items.id
            AND r.status='fulfilled' AND r.quantity=?
        ) AND (SELECT COALESCE(SUM(di.quantity-di.cancelled_quantity),0)
             FROM order_dispatch_items di WHERE di.order_item_id=order_items.id)=?
          AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
             WHERE di.order_item_id=order_items.id
               AND (di.cancelled_quantity>0 OR
                (di.source_type<>'workshop' AND di.movement_id IS NOT NULL
                  AND NOT EXISTS(SELECT 1 FROM inventory_movements m
                     WHERE m.id=di.movement_id AND m.movement_type='sale'
                       AND m.reference_type='order_dispatch'))))
          AND NOT EXISTS(SELECT 1 FROM inventory_reservations r
             WHERE r.order_item_id=order_items.id AND r.status IN ('active','unresolved'))`
      : `AND EXISTS(SELECT 1 FROM inventory_reservations r
          WHERE r.id=? AND r.order_item_id=order_items.id
            AND r.quantity=? AND r.status=?)
         AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
           WHERE di.order_item_id=order_items.id)`
    const guardArgs=line.action==='physical_return_pending'
      ? [line.originalQty,line.originalQty] : [r!.id,line.quantity===r!.quantity?r!.quantity:r!.quantity-line.quantity,
        line.quantity===r!.quantity?'released':r!.status]
    statements.push(db.prepare(
      `UPDATE order_items SET quantity=quantity-?,line_total=(quantity-?)*unit_price,
       stock_writeoff_status=CASE WHEN quantity=? AND ?<>'physical_return_pending'
         THEN 'reservation_released' ELSE stock_writeoff_status END
       WHERE id=? AND order_id=? AND quantity=? AND unit_price=?
         AND stock_writeoff_status=? AND line_total=quantity*unit_price
         AND NOT EXISTS(SELECT 1 FROM return_items ri JOIN returns ret
           ON ret.id=ri.return_id WHERE ri.order_item_id=order_items.id
            AND ret.id<>(SELECT return_id FROM return_v2_unified_postings WHERE request_id=?))
         `+guard
    ).bind(line.quantity,line.quantity,line.quantity,line.action,
      line.orderItemId,wanted.orderId,line.originalQty,line.unitPrice,
      line.oldStatus,wanted.requestId,...guardArgs))
    statements.push(changed(db,'contract_line'))
    statements.push(db.prepare(
      `INSERT INTO return_v2_unified_lines(
        posting_id,order_item_id,action,contracted_quantity,original_line_quantity,
        sold_unit_price,contract_reduction,reservation_id,reservation_release,stock_quantity_change,receipt_intent)
       SELECT id,?,?,?,?,?,?,?,?,0,? FROM return_v2_unified_postings WHERE request_id=?`
    ).bind(line.orderItemId,line.action,line.quantity,line.originalQty,line.unitPrice,
      line.value,r?.id||null,
      line.action==='cancel_unshipped_reservation'?line.quantity:0,
      line.action==='physical_return_pending'?line.receiptIntent:'not_applicable',wanted.requestId))
    statements.push(changed(db,'line_provenance'))
    if(line.action==='physical_return_pending'){
      statements.push(db.prepare(
        `INSERT INTO return_items(return_id,order_item_id,product_name_snapshot,quantity,
         amount,inventory_source,restocked,physical_tracking,physical_received_at,
         created_at,contract_quantity_applied)
        SELECT up.return_id,oi.id,oi.product_name_snapshot,?,?,NULL,0,1,NULL,?,1
        FROM return_v2_unified_postings up JOIN order_items oi
          ON oi.order_id=up.order_id
        WHERE up.request_id=? AND oi.id=?`
      ).bind(line.quantity,line.value,stamp,wanted.requestId,line.orderItemId))
      statements.push(changed(db,'pending_physical_receipt'))
    }
  }
  statements.push(db.prepare(
    `UPDATE orders SET total_amount=?,received_amount=?,return_amount=?,
       debt_amount=MAX(0,?-(?-?)),updated_at=?
       WHERE id=? AND total_amount=? AND updated_at=?
         AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
              WHERE oi.order_id=orders.id AND oi.quantity>0)=?
         AND (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
              FROM payments pay WHERE pay.order_id=orders.id)=?`
  ).bind(finalTotal,received,wanted.refund,finalTotal,received,wanted.refund,stamp,
    wanted.orderId,initialTotal,wanted.version,finalTotal,received))
  statements.push(changed(db,'order_money'))
  if(wanted.refund>0){
    statements.push(db.prepare(
      `INSERT INTO financial_events(event_key,order_id,external_order_id,event_date,event_at,
         event_type,related_type,amount_delta,payment_method,source_type,source_id,
         source_ref,reason,comment,is_backfill,created_at)
        SELECT 'return-v2:unified:'||up.request_id,up.order_id,o.external_id,?,?,
         'order_refund',NULL,-?,?,'return',up.return_id,'returns:'||up.return_id,
         'return_v2_unified',NULL,0,?
        FROM return_v2_unified_postings up JOIN orders o ON o.id=up.order_id
        WHERE up.request_id=?`
    ).bind(date,stamp,wanted.refund,wanted.method,stamp,wanted.requestId))
    statements.push(changed(db,'refund_event'))
  }
  try { await db.batch(statements) }
  catch(error){
    const now=await getPosted(db,wanted.requestId)
    if(now)return replay(now)
    const msg=error instanceof Error?error.message:String(error)
    if(/RETURN_V2_UNIFIED_CONFLICT|malformed JSON|constraint failed|UNIQUE|FOREIGN KEY/i.test(msg)) {
      const stage=msg.match(/RETURN_V2_UNIFIED_CONFLICT_([a-z_]+)/)?.[1]||'sql_integrity'
      reject('Заказ, цена, отправка, резерв или оплата изменились (проверка: '+stage+'). Ничего не проведено.')
    }
    throw error
  }
  const created=await getPosted(db,wanted.requestId)
  if(!created)throw Error('Не найден журнал завершённой транзакции.')
  return {ok:true,replayed:false,returnId:created.return_id,postingId:created.id,
    orderId:created.order_id,remainingSale:created.final_total,
    cashRefund:created.cash_refund,fullTermination:created.full_termination===1}
}
