// Transition cleanup for orders preceding the current shipping UI.
// Admin-only endpoint calls these functions; NO physical stock movement.
// A legacy order is treated as issued by owner policy, not by its modern
// shipping_status. Late returns/exchanges are excluded from automatic cleanup.
import {cleanText,toInt} from '../core/text.ts'

export const LEGACY_RESERVATION_CUTOFF='2026-10-01'
type DbRow=Record<string,unknown>
type RequestShape={reservationId?:unknown;orderId?:unknown;orderItemId?:unknown;source?:unknown;variantId?:unknown;quantity?:unknown;confirm?:unknown}
const selectSql =
  "SELECT r.id,r.order_id,r.order_item_id,r.inventory_source,r.variant_id,r.quantity,r.status,r.created_at,"
  +"oi.stock_writeoff_status,o.external_id,o.order_date,o.shipping_status,"
  +"EXISTS(SELECT 1 FROM exchanges x WHERE x.order_id=r.order_id AND x.exchange_date >= '2026-10-01') AS newer_exchange,"
  +"EXISTS(SELECT 1 FROM returns t WHERE t.order_id=r.order_id AND t.return_date >= '2026-10-01') AS newer_return "
  +"FROM inventory_reservations r JOIN orders o ON o.id=r.order_id "
  +"JOIN order_items oi ON oi.id=r.order_item_id AND oi.order_id=r.order_id "
  +"WHERE r.status='active' AND o.order_date < '2026-10-01' "
function classify(row:DbRow){
  if(toInt(row.newer_exchange,0)||toInt(row.newer_return,0))return 'late_operation_review'
  if(toInt(row.variant_id,0)<=0||!['warehouse','boutique'].includes(cleanText(row.inventory_source)))return 'identity_review'
  return 'stale_legacy_reservation'
}
function shape(row:DbRow){
  return {
    reservationId:toInt(row.id,0),orderId:toInt(row.order_id,0),orderItemId:toInt(row.order_item_id,0),
    externalId:cleanText(row.external_id),orderDate:cleanText(row.order_date),
    modernShippingStatus:cleanText(row.shipping_status),source:cleanText(row.inventory_source),
    variantId:toInt(row.variant_id,0),quantity:toInt(row.quantity,0),
    reservationCreatedAt:cleanText(row.created_at),itemStockStatus:cleanText(row.stock_writeoff_status),
    classification:classify(row),
  }
}
export async function previewHistoricalReservations(db:D1Database,url:URL){
 const limit=Math.max(1,Math.min(200,toInt(url.searchParams.get('limit'),100)))
 const result=await db.prepare(selectSql+" ORDER BY o.order_date,r.id LIMIT ?").bind(limit).all<DbRow>()
 const items=(result.results||[]).map(shape)
 return {ok:true,cutoffExclusive:LEGACY_RESERVATION_CUTOFF,items,
   eligible:items.filter(x=>x.classification==='stale_legacy_reservation').length,
   flagged:items.filter(x=>x.classification!=='stale_legacy_reservation').length,
   hasMore:items.length===limit,
   note:'Только просмотр: дата старого заказа подтверждает состоявшуюся выдачу. Поздние операции требуют отдельного расследования.'}
}
export async function releaseHistoricalReservation(db:D1Database,input:RequestShape,actor:{id:number;displayName:string}){
 const id=toInt(input.reservationId,0),orderId=toInt(input.orderId,0),itemId=toInt(input.orderItemId,0)
 const variantId=toInt(input.variantId,0),quantity=toInt(input.quantity,0),source=cleanText(input.source)
 if(cleanText(input.confirm)!=='СНЯТЬ ИСТОРИЧЕСКИЙ РЕЗЕРВ'
    || ![id,orderId,itemId,variantId,quantity].every(v=>Number.isSafeInteger(v)&&v>0)
    || !['warehouse','boutique'].includes(source))
  return {status:400,body:{ok:false,code:'confirmation_required',message:'Выберите резерв и подтвердите его точные данные.'}}
 const row=await db.prepare(selectSql+" AND r.id=? LIMIT 1").bind(id).first<DbRow>()
 if(!row){
  const current=await db.prepare('SELECT status FROM inventory_reservations WHERE id=?').bind(id).first<{status:string}>()
  return current?.status==='released'
    ? {status:200,body:{ok:true,alreadyReleased:true,reservationId:id,physicalQuantityChanged:false}}
    : {status:409,body:{ok:false,code:'not_active',message:'Резерв уже изменился. Обновите список.'}}
 }
 const actual=shape(row)
 if(actual.classification!=='stale_legacy_reservation')
  return {status:409,body:{ok:false,code:actual.classification,message:'У этого заказа есть поздняя операция или спорная идентичность.'}}
 if(actual.orderId!==orderId||actual.orderItemId!==itemId||actual.variantId!==variantId
   ||actual.source!==source||actual.quantity!==quantity)
  return {status:409,body:{ok:false,code:'changed',message:'Данные резерва изменились. Обновите список.'}}
 const at=new Date().toISOString()
 // All steps execute in one D1 transaction; "changes()" ensures that no
 // concurrent actor already took or changed this exact original reservation.
 const claim=db.prepare(
  "UPDATE inventory_reservations SET status='released',released_at=?,updated_at=? "
  +"WHERE id=? AND status='active' AND order_id=? AND order_item_id=? "
  +"AND inventory_source=? AND variant_id=? AND quantity=? "
  +"AND EXISTS(SELECT 1 FROM orders WHERE id=? AND order_date<'2026-10-01') "
  +"AND NOT EXISTS(SELECT 1 FROM exchanges WHERE order_id=? AND exchange_date>='2026-10-01') "
  +"AND NOT EXISTS(SELECT 1 FROM returns WHERE order_id=? AND return_date>='2026-10-01')"
 ).bind(at,at,id,orderId,itemId,source,variantId,quantity,orderId,orderId,orderId)
 const conflict=db.prepare("SELECT json('HISTORICAL_RESERVATION_CHANGED') WHERE changes() <> 1")
 const counter=db.prepare(
  "UPDATE inventory_stock SET reserved_quantity=COALESCE((SELECT SUM(quantity) FROM inventory_reservations "
  +"WHERE inventory_source=? AND variant_id=? AND status='active'),0), "
  +"last_action='Снят старый резерв',last_source_ref=?,updated_at=? "
  +"WHERE id=(SELECT id FROM inventory_stock WHERE inventory_source=? AND variant_id=? ORDER BY id LIMIT 1)"
 ).bind(source,variantId,'legacy-reservation:'+id,at,source,variantId)
 const audit=db.prepare(
  "INSERT INTO activity_log(event_type,entity_type,entity_id,order_id,external_order_id,title,details,amount,created_at) "
  +"VALUES('historical_reservation_released','inventory_reservation',?,?,?,?,?,0,?)"
 ).bind(id,orderId,actual.externalId,'Устранение исторического резерва',
  'Администратор: '+cleanText(actor.displayName||String(actor.id))
  +'; резерв '+id+'; позиция '+itemId+'; SKU '+variantId+'; '+source
  +'; снято '+quantity+' шт.; физическое количество и заказ НЕ изменялись',at)
 try{await db.batch([claim,conflict,counter,audit])}catch(error){
  const message=cleanText(error instanceof Error?error.message:error)
  if(/HISTORICAL_RESERVATION_CHANGED|malformed JSON/i.test(message))
   return {status:409,body:{ok:false,code:'changed',message:'Резерв изменился параллельно. Снятие отменено целиком.'}}
  throw error
 }
 return {status:200,body:{ok:true,reservationId:id,orderId,itemId,source,variantId,quantityReleased:quantity,
  physicalQuantityChanged:false,message:'Исторический резерв закрыт без изменения физического остатка.'}}
}
