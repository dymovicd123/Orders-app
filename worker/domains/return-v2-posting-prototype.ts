// Isolated Return V2 transactional posting PROTOTYPE.
// NOT imported by worker/index.ts or by any live HTTP, UI, automation, or existing route.
// Requires 0124-0126 and full compatibility with cancellation/Exchange/editor BEFORE activation.
import { previewStandaloneReturnV2 } from './return-v2-shadow-preview.ts'

export class ReturnV2PostingConflict extends Error {
  readonly status=409
  readonly code='return_v2_posting_conflict'
}
function fail(message:string):never { throw new ReturnV2PostingConflict(message) }
type PreparedHeader={
  id:number;request_id:string;order_id:number;status:string;
  baseline_total:number;baseline_received:number;baseline_order_updated_at:string|null;
  projected_total:number;reduced_value:number;planned_refund:number;planned_refund_method:string|null;
}
type PreparedItem={
  order_item_id:number;quantity:number;sold_unit_price:number;
  reduced_value:number;baseline_order_item_quantity:number|null;
}
type PostedRow={preparation_id:number;return_id:number;order_id:number;contract_total_after:number;net_held_after:number}
function safeMoney(n:unknown):number {
  if(!Number.isSafeInteger(n)||Number(n)<0)fail('Подготовленные суммы некорректны.')
  return Number(n)
}
function positiveId(n:unknown):number {
  if(!Number.isSafeInteger(n)||Number(n)<1)fail('Неверный номер подготовленного возврата.')
  return Number(n)
}
function checkChanged(db:D1Database,label:string):D1PreparedStatement {
  // SELECT changes() checks the immediately preceding UPDATE/INSERT in the
  // SAME SQLite batch. Deliberately malformed json rolls back the whole batch.
  return db.prepare(`SELECT json('RETURN_V2_ATOMIC_CONFLICT_`+label+`') WHERE changes()<>1`)
}
async function postedRecord(db:D1Database,preparedId:number) {
  return db.prepare(
    `SELECT preparation_id,return_id,order_id,contract_total_after,net_held_after
     FROM return_v2_postings WHERE preparation_id=? LIMIT 1`
  ).bind(preparedId).first<PostedRow>()
}

export async function postPreparedReturnV2Prototype(db:D1Database,preparedIdInput:number){
  const preparationId=positiveId(preparedIdInput)
  const existing=await postedRecord(db,preparationId)
  if(existing) {
    const valid=await db.prepare(
      `SELECT id FROM returns WHERE id=? AND order_id=? AND status='completed'`
    ).bind(existing.return_id,existing.order_id).first<{id:number}>()
    if(!valid)fail('Зарегистрированный V2 возврат изменён после проведения. Автоматический повтор запрещён.')
    return {ok:true,posted:true,replayed:true,returnId:existing.return_id,
      orderId:existing.order_id,currentSale:existing.contract_total_after,
      netHeld:existing.net_held_after}
  }

  const prepared=await db.prepare(
    `SELECT id,request_id,order_id,status,baseline_total,baseline_received,
       baseline_order_updated_at,projected_total,reduced_value,planned_refund,planned_refund_method
     FROM return_v2_prepared_operations WHERE id=?`
  ).bind(preparationId).first<PreparedHeader>()
  if(!prepared||prepared.status!=='prepared')fail('Нет безопасно подготовленного возврата.')
  const rows=(await db.prepare(
    `SELECT order_item_id,quantity,sold_unit_price,reduced_value,baseline_order_item_quantity
     FROM return_v2_prepared_items WHERE operation_id=? ORDER BY order_item_id`
  ).bind(preparationId).all<PreparedItem>()).results||[]
  if(!rows.length||rows.length>100)fail('Подготовка не содержит допустимых товаров.')
  if(!prepared.baseline_order_updated_at)fail('Отсутствует сохранённая версия заказа. Нельзя проводить старую подготовку.')
  const initialTotal=safeMoney(prepared.baseline_total)
  const initialPaid=safeMoney(prepared.baseline_received)
  const reduced=safeMoney(prepared.reduced_value)
  const refund=safeMoney(prepared.planned_refund)
  const finalTotal=safeMoney(prepared.projected_total)
  if(finalTotal!==initialTotal-reduced||reduced===0||refund>initialPaid)fail('Суммы подготовки не согласованы.')
  const method=String(prepared.planned_refund_method||'').trim()
  if((refund>0&&!method)||(refund===0&&method))fail('Способ выплаты не согласован с суммой.')
  if(!rows.every(row=> Number.isSafeInteger(row.quantity)&&row.quantity>0
    &&Number.isSafeInteger(row.sold_unit_price)&&row.sold_unit_price>=0
    &&Number.isSafeInteger(row.baseline_order_item_quantity)&&Number(row.baseline_order_item_quantity)>=row.quantity
    &&Number.isSafeInteger(row.reduced_value)&&row.reduced_value===row.quantity*row.sold_unit_price)
    ||rows.reduce((sum,row)=>sum+row.reduced_value,0)!==reduced) {
    fail('В подготовке повреждён снимок количества или исторической цены.')
  }

  // Use current Worker read-only validation as a separate preflight.
  // SQL below independently checks the same facts INSIDE the atomic transaction.
  const preview=await previewStandaloneReturnV2(db,{
    orderId:prepared.order_id,expectedTotalAmount:initialTotal,refundAmount:refund,
    items:rows.map(x=>({orderItemId:x.order_item_id,quantity:x.quantity}))
  })
  if(!preview.cashCovered||preview.suggestedRefundAmount!==reduced
    ||preview.baseline.updatedAt!==prepared.baseline_order_updated_at
    ||preview.baseline.receivedAmount!==initialPaid
    ||preview.projected.currentSale!==finalTotal) {
    fail('Заказ изменился после подготовки. Обновите расчёт.')
  }
  for(const row of rows) {
    const shown=preview.selected.find(i=>i.orderItemId===row.order_item_id)
    if(!shown||shown.orderLineQuantity!==row.baseline_order_item_quantity
      ||shown.unitSoldPrice!==row.sold_unit_price)fail('Количество или цена позиции изменились.')
  }

  const stamp=new Date().toISOString()
  const date=stamp.slice(0,10)
  const statements:D1PreparedStatement[]=[]
  // Commit header only after complete financial and itemized consistency proof.
  // Any zero-row claim fails via checkChanged and causes the atomic D1 rollback.
  statements.push(db.prepare(
    `INSERT INTO returns(order_id,manager_id,return_date,amount,payment_method,comment,status,created_at)
     SELECT o.id,o.manager_id,?,p.planned_refund,p.planned_refund_method,
            'Return V2 isolated posting', 'completed', ?
     FROM return_v2_prepared_operations p JOIN orders o ON o.id=p.order_id
     WHERE p.id=? AND p.status='prepared' AND p.order_id=?
       AND p.baseline_order_updated_at=o.updated_at
       AND o.pricing_mode='itemized_v1'
       AND o.order_status NOT IN ('deleted','archived') AND o.archived_at IS NULL
       AND o.total_amount=p.baseline_total AND p.baseline_total=?
       AND p.baseline_received=?
       AND p.projected_total=p.baseline_total-p.reduced_value
       AND p.planned_refund BETWEEN 0 AND p.baseline_received
       AND ((p.planned_refund=0 AND p.planned_refund_method IS NULL)
         OR (p.planned_refund>0 AND COALESCE(p.planned_refund_method,'')<>''))
       AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
            WHERE oi.order_id=o.id AND oi.quantity>0)=p.baseline_total
       AND (SELECT COALESCE(SUM(CASE WHEN pay.amount>0 THEN pay.amount ELSE 0 END),0)
            FROM payments pay WHERE pay.order_id=o.id)=p.baseline_received
       AND (SELECT COUNT(*) FROM return_v2_prepared_items pi WHERE pi.operation_id=p.id)=?
       AND (SELECT COALESCE(SUM(pi.reduced_value),0) FROM return_v2_prepared_items pi
            WHERE pi.operation_id=p.id)=p.reduced_value
       AND NOT EXISTS(SELECT 1 FROM returns ret WHERE ret.order_id=o.id)
       AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.order_id=o.id)
       AND NOT EXISTS(SELECT 1 FROM return_v2_postings post WHERE post.preparation_id=p.id)`
  ).bind(date,stamp,preparationId,prepared.order_id,initialTotal,initialPaid,rows.length))
  statements.push(checkChanged(db,'header'))

  // last_insert_rowid() still points to Return header (SELECT changes() does
  // not alter it). The posting ID is then used as a stable reference below.
  statements.push(db.prepare(
    `INSERT INTO return_v2_postings(preparation_id,return_id,order_id,posted_at,contract_total_after,net_held_after)
     VALUES(?,last_insert_rowid(),?,?,?,?)`
  ).bind(preparationId,prepared.order_id,stamp,finalTotal,initialPaid-refund))
  statements.push(checkChanged(db,'posting_mapping'))

  for(const item of rows) {
    statements.push(db.prepare(
      `UPDATE order_items SET quantity=quantity-?,line_total=(quantity-?)*unit_price
       WHERE id=? AND order_id=? AND quantity=? AND quantity>=?
         AND unit_price=? AND line_total=quantity*unit_price
         AND ((SELECT COALESCE(SUM(MAX(0,di.quantity-di.cancelled_quantity)),0) FROM order_dispatch_items di
              WHERE di.order_item_id=order_items.id)>=?
           OR (NOT EXISTS(SELECT 1 FROM order_dispatch_items di WHERE di.order_item_id=order_items.id)
             AND order_items.stock_writeoff_status IN ('fulfilled','written_off','negative','retired_physically_issued')))
         AND NOT EXISTS(SELECT 1 FROM inventory_reservations ir
          WHERE ir.order_item_id=order_items.id AND ir.status IN ('active','unresolved'))
         AND NOT EXISTS(SELECT 1 FROM return_items ri JOIN returns rt ON rt.id=ri.return_id
          WHERE ri.order_item_id=order_items.id AND rt.status<>'cancelled'
            AND ri.return_id<>(SELECT post.return_id FROM return_v2_postings post WHERE post.preparation_id=?))`
    ).bind(item.quantity,item.quantity,item.order_item_id,prepared.order_id,
      item.baseline_order_item_quantity,item.quantity,item.sold_unit_price,
      item.quantity,preparationId))
    statements.push(checkChanged(db,'item_claim'))
    statements.push(db.prepare(
      `INSERT INTO return_items(
        return_id,order_item_id,product_name_snapshot,quantity,amount,
        inventory_source,restocked,physical_tracking,physical_received_at,
        gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
        created_at,contract_quantity_applied)
       SELECT post.return_id,oi.id,oi.product_name_snapshot,?,?,
        NULL,0,1,NULL,
        oi.gender_snapshot,oi.color_snapshot,oi.material_snapshot,oi.length_snapshot,oi.size_snapshot,?,1
       FROM order_items oi
       JOIN return_v2_postings post ON post.order_id=oi.order_id
       WHERE oi.id=? AND oi.order_id=? AND post.preparation_id=?`
    ).bind(item.quantity,item.reduced_value,stamp,item.order_item_id,prepared.order_id,preparationId))
    statements.push(checkChanged(db,'return_item'))
  }

  statements.push(db.prepare(
    `UPDATE orders SET total_amount=?,received_amount=?,return_amount=?,
      debt_amount=MAX(0,?-(?-?)),updated_at=?
     WHERE id=? AND total_amount=? AND updated_at=?
       AND (SELECT COALESCE(SUM(oi.line_total),0) FROM order_items oi
            WHERE oi.order_id=orders.id AND oi.quantity>0)=?`
  ).bind(finalTotal,initialPaid,refund,finalTotal,initialPaid,refund,
    stamp,prepared.order_id,initialTotal,prepared.baseline_order_updated_at,finalTotal))
  statements.push(checkChanged(db,'order_total'))

  if(refund>0){
    // Exactly one negative cash event, sourced from the real Return ID.
    statements.push(db.prepare(
      `INSERT INTO financial_events(event_key,order_id,external_order_id,event_date,event_at,event_type,
         related_type,amount_delta,payment_method,source_type,source_id,source_ref,reason,comment,is_backfill,created_at)
       SELECT 'return-v2:posted:'||post.preparation_id,o.id,o.external_id,?,?, 'order_refund',
          NULL,-?,?,'return',post.return_id,'returns:'||post.return_id,'return_v2_posted',NULL,0,?
       FROM return_v2_postings post JOIN orders o ON o.id=post.order_id
       WHERE post.preparation_id=? AND post.return_id IN
        (SELECT id FROM returns WHERE order_id=o.id AND status='completed')`
    ).bind(date,stamp,refund,method,stamp,preparationId))
    statements.push(checkChanged(db,'financial_event'))
  }
  try {
    await db.batch(statements)
  } catch(error) {
    const now=await postedRecord(db,preparationId)
    if(now)return {ok:true,posted:true,replayed:true,returnId:now.return_id,orderId:now.order_id,
      currentSale:now.contract_total_after,netHeld:now.net_held_after}
    const message=error instanceof Error?error.message:String(error)
    if(/RETURN_V2_ATOMIC_CONFLICT|malformed JSON|constraint failed|UNIQUE|FOREIGN KEY/i.test(message))
      fail('Заказ, товар или оплата изменились. Проведение целиком отменено, обновите расчёт.')
    throw error
  }
  const posted=await postedRecord(db,preparationId)
  if(!posted)throw Error('Транзакция завершилась, но подтверждение проведения не найдено.')
  return {ok:true,posted:true,replayed:false,returnId:posted.return_id,orderId:posted.order_id,
    currentSale:posted.contract_total_after,netHeld:posted.net_held_after}
}
