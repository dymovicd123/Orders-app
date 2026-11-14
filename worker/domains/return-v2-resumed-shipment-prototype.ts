// Isolated follow-up after cancelling a unified Return V2.
// No Worker route or UI calls this directly. All stock writes happen through
// the existing selective dispatcher, with V2 provenance in its D1 batch.
import {cleanText} from '../core/text.ts'
import {readVersionedReturnMoney} from './return-v2-financial-projection.ts'
import {dispatchSelectedCompleteOrderLines} from './order-dispatch.ts'

type Input={
  requestId:string;postingId:number;orderId:number;orderItemId:number;
  quantity:number;expectedOrderVersion:string;actor:string;dispatchDate?:string
}
type Recorded={
  request_id:string;posting_id:number;order_id:number;order_item_id:number;
  quantity:number;expected_order_version:string;dispatch_id:number;
  dispatched_quantity:number;item_count:number
}
export class ReturnV2ResumedShipmentConflict extends Error{
  readonly status=409
  readonly code='return_v2_resumed_shipment_conflict'
}
function reject(message:string):never{throw new ReturnV2ResumedShipmentConflict(message)}
function validId(n:unknown){return Number.isSafeInteger(n)&&Number(n)>0}
function intent(w:Input){
  if(!validId(w.orderId)||!validId(w.orderItemId)||!validId(w.postingId)||
    !validId(w.quantity)||!cleanText(w.expectedOrderVersion)||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(cleanText(w.requestId))||
    !cleanText(w.actor))
    reject('Укажите заказ, исходный возврат, вещь и количество по актуальному состоянию.')
  if(w.dispatchDate && (!/^\d{4}-\d{2}-\d{2}$/.test(w.dispatchDate)
    ||new Date(w.dispatchDate+'T00:00:00Z').toISOString().slice(0,10)!==w.dispatchDate))
    reject('Дата отправки некорректна.')
}
async function findJournal(db:D1Database,requestId:string){
  return db.prepare(`SELECT rd.request_id,rd.posting_id,rd.order_id,rd.order_item_id,
    rd.quantity,rd.expected_order_version,d.id AS dispatch_id,
    COALESCE(SUM(di.quantity),0) AS dispatched_quantity,
    COUNT(di.id) AS item_count
    FROM return_v2_resumed_dispatches rd
    JOIN order_dispatches d ON d.request_id=rd.request_id AND d.order_id=rd.order_id
    LEFT JOIN order_dispatch_items di ON di.dispatch_id=d.id
    WHERE rd.request_id=?
    GROUP BY rd.request_id,rd.posting_id,rd.order_id,rd.order_item_id,
      rd.quantity,rd.expected_order_version,d.id`)
    .bind(requestId).first<Recorded>()
}
function replay(w:Input,r:Recorded){
  if(r.order_id!==w.orderId||r.posting_id!==w.postingId
    ||r.order_item_id!==w.orderItemId||r.quantity!==w.quantity
    ||r.expected_order_version!==w.expectedOrderVersion
    ||r.item_count!==1||r.dispatched_quantity!==w.quantity)
    reject('Повторный запрос не совпадает с проведённой отправкой Return V2.')
  return {ok:true,alreadyCommitted:true,dispatchId:r.dispatch_id,
    shippedLines:1,shippedQuantity:w.quantity}
}
export async function dispatchRestoredReturnV2ReservationPrototype(db:D1Database,w:Input){
  intent(w)
  const recorded=await findJournal(db,w.requestId)
  if(recorded)return replay(w,recorded)
  const oldDispatch=await db.prepare('SELECT id FROM order_dispatches WHERE request_id=?')
    .bind(w.requestId).first<{id:number}>()
  if(oldDispatch)reject('Идентификатор запроса уже занят другой отправкой.')
  const money=await readVersionedReturnMoney(db,w.orderId)
  if(money.kind!=='return_v2'||money.orderVersion!==w.expectedOrderVersion)
    reject('После отмены возврата изменились товары, деньги или версия заказа. Обновите данные.')
  // The line MUST have been unshipped, released by the V2 Return, and then
  // restored by its exact verified cancellation. Never select shipped goods.
  const proof=await db.prepare(`SELECT ul.order_item_id
     FROM return_v2_unified_postings up
     JOIN return_v2_unified_cancellations uc
       ON uc.posting_id=up.id AND uc.order_id=up.order_id
     JOIN returns ret ON ret.id=up.return_id AND ret.status='cancelled'
     JOIN return_v2_unified_lines ul ON ul.posting_id=up.id
     JOIN inventory_reservations ir ON ir.id=ul.reservation_id
       AND ir.order_id=up.order_id AND ir.order_item_id=ul.order_item_id
     JOIN order_items oi ON oi.id=ul.order_item_id AND oi.order_id=up.order_id
     WHERE up.id=? AND up.order_id=? AND ul.order_item_id=?
       AND ul.action='cancel_unshipped_reservation'
       AND uc.reservations_restore_confirmed=1
       AND ul.contracted_quantity=ul.original_line_quantity
       AND ul.original_line_quantity=?
       AND oi.quantity=? AND oi.stock_writeoff_status='reserved'
       AND ir.quantity=? AND ir.status='active'
       AND ir.inventory_source=oi.source_type
       AND ir.variant_id=oi.variant_id
       AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
          WHERE di.order_item_id=oi.id)
       AND NOT EXISTS(SELECT 1 FROM return_v2_resumed_dispatches rd
          WHERE rd.posting_id=up.id AND rd.order_item_id=oi.id)
     LIMIT 1`).bind(w.postingId,w.orderId,w.orderItemId,
       w.quantity,w.quantity,w.quantity).first<{order_item_id:number}>()
  if(!proof)reject('Эта вещь не является восстановленным неотправленным резервом отменённого Return V2.')
  // No shortage override: an uncertain physical stock position must be
  // reconciled normally, not guessed through a resume-only endpoint.
  let dispatched
  try{
    dispatched=await dispatchSelectedCompleteOrderLines(db,w.orderId,{
      requestId:w.requestId,
      items:[{orderItemId:w.orderItemId,quantity:w.quantity}],
      actor:cleanText(w.actor),dispatchDate:cleanText(w.dispatchDate),
      stockConfirmations:[],
      versionedCancelledReturn:{
        postingId:w.postingId,expectedOrderVersion:w.expectedOrderVersion
      }
    })
  }catch(e){
    const maybe=await findJournal(db,w.requestId)
    if(maybe)return replay(w,maybe)
    if(e instanceof ReturnV2ResumedShipmentConflict)throw e
    const msg=e instanceof Error?e.message:String(e)
    if(/RETURN_V2_RESUMED_DISPATCH_CONFLICT|malformed JSON|constraint failed/i.test(msg))
      reject('После открытия отправки изменилась отмена возврата, товар или резерв. Списание не проведено.')
    throw e
  }
  const committed=await findJournal(db,w.requestId)
  if(!committed)reject('Отправка требует сверки журнала Return V2. Не повторяйте её с новым идентификатором.')
  replay(w,committed)
  return {ok:true,alreadyCommitted:dispatched.alreadyCommitted,
    dispatchId:committed.dispatch_id,shippedLines:1,shippedQuantity:w.quantity,
    physicalStockDelta:-w.quantity,financialAmountDelta:0}
}
