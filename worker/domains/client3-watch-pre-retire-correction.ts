import {cleanText,toInt} from '../core/text.ts'
import {CriticalOperationConflictError} from './critical.ts'
import {retiredWatchShippingProjectionSql} from './client3-watch-retired-dispatch.ts'

const stop=(message:string):never=>{throw new CriticalOperationConflictError(message)}
type Source='warehouse'|'boutique'
type OldDispatch={
  id:number;dispatch_id:number;order_item_id:number;quantity:number;cancelled_quantity:number
  source_type:Source;variant_id:number;movement_id:number|null;reservation_id:number|null
  order_qty:number;stock_writeoff_status:string;order_status:string;archived_at:string|null
  reservation_status:string|null;reservation_qty:number|null;reservation_variant:number|null
  reservation_source:string|null;movement_type:string|null;movement_variant:number|null
  movement_source:string|null;movement_quantity:number|null;retirement_id:number|null
  stock_quantity:number|null;stock_reserved:number|null;replacement_event:number|null
  other_issues:number;returns_count:number;exchange_old_count:number
}

/** An ordinary shipment was recorded while the SKU was active, then Main
 * retired the whole product and zeroed its remaining stock.
 *
 * Correct the erroneous DELIVERY only: keep original sale and retirement
 * movements immutable, release its old fulfilled reservation with retirement
 * provenance, and write the normal Main dispatch correction audit. Reissue
 * after this point uses Client3's archived dispatch and never touches stock.
 */
export async function correctPreRetirementWatchDispatch(db:D1Database,brandId:number,
 orderId:number,input:{dispatchItemId:number;requestId:string;actor:string;reason:string}
){
 const id=toInt(input.dispatchItemId,0),requestId=cleanText(input.requestId)
 const reason=cleanText(input.reason),actor=cleanText(input.actor)
 if(!id||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId)||
   reason.length<8||reason.length>500||!actor)
   stop('Нужна точная отправка и причина исправления.')
 const replay=await db.prepare(
   'SELECT dispatch_item_id FROM order_dispatch_corrections WHERE request_id=?'
 ).bind(requestId).first<{dispatch_item_id:number}>()
 if(replay){
   if(replay.dispatch_item_id!==id)stop('Номер исправления уже использован для другой отправки.')
   return {ok:true,alreadyCorrected:true,dispatchItemId:id,
     physicalRestoredQuantity:0,retiredWithoutStockChange:true}
 }
 const line=await db.prepare(`
   SELECT di.id,di.dispatch_id,di.order_item_id,di.quantity,di.cancelled_quantity,
     di.source_type,di.variant_id,di.movement_id,di.reservation_id,
     oi.quantity AS order_qty,oi.stock_writeoff_status,o.order_status,o.archived_at,
     ir.status AS reservation_status,ir.quantity AS reservation_qty,
     ir.variant_id AS reservation_variant,ir.inventory_source AS reservation_source,
     m.movement_type,m.variant_id AS movement_variant,
     m.inventory_source AS movement_source,m.quantity_delta AS movement_quantity,
     rv.retirement_id,s.quantity AS stock_quantity,s.reserved_quantity AS stock_reserved,
     (SELECT le.id FROM inventory_lifecycle_events le
        JOIN exchanges ex ON ex.id=le.operation_id AND ex.order_id=oi.order_id
       WHERE le.order_item_id=oi.id AND le.operation_type='exchange'
         AND le.event_type='exchange_new_out' AND le.status='applied'
         AND le.movement_id=di.movement_id
         AND COALESCE(ex.status,'completed')<>'cancelled'
       ORDER BY le.id DESC LIMIT 1) AS replacement_event,
     (SELECT COUNT(*) FROM order_dispatch_items other WHERE other.order_item_id=oi.id
        AND other.id<>di.id AND other.quantity>COALESCE(other.cancelled_quantity,0)) AS other_issues,
     (SELECT COUNT(*) FROM return_items ri JOIN returns ret ON ret.id=ri.return_id
       WHERE ri.order_item_id=oi.id AND ri.quantity>0 AND COALESCE(ret.status,'completed')<>'cancelled') AS returns_count,
     (SELECT COUNT(*) FROM exchange_items ei JOIN exchanges ex ON ex.id=ei.exchange_id
       WHERE ei.order_item_id=oi.id AND ei.role='old'
         AND COALESCE(ex.status,'completed')<>'cancelled') AS exchange_old_count
   FROM order_dispatch_items di
   JOIN order_dispatches d ON d.id=di.dispatch_id
   JOIN orders o ON o.id=d.order_id
   JOIN watch_order_details wd ON wd.order_id=o.id AND wd.brand_id=?
   JOIN order_items oi ON oi.id=di.order_item_id AND oi.order_id=d.order_id
   JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
   JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
   JOIN watch_products wp ON wp.id=wv.watch_product_id AND wp.brand_id=wd.brand_id
   JOIN catalog_variants cv ON cv.id=oi.variant_id AND cv.is_active=0
   JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.is_active=0
   JOIN catalog_products cp ON cp.id=cv.product_id AND cp.is_active=0
   JOIN catalog_retirement_variants rv ON rv.variant_id=cv.id
   JOIN catalog_retirement_operations op ON op.id=rv.retirement_id AND
     op.status='completed' AND op.entity_type='product' AND op.product_id=cp.id
   LEFT JOIN inventory_reservations ir ON ir.id=di.reservation_id AND ir.order_item_id=oi.id
   LEFT JOIN inventory_movements m ON m.id=di.movement_id
   LEFT JOIN inventory_stock s ON s.variant_id=oi.variant_id AND s.inventory_source=di.source_type
   WHERE di.id=? AND d.order_id=?`).bind(brandId,id,orderId).first<OldDispatch>()
 if(!line)throw new CriticalOperationConflictError('Не удалось подтвердить отправку, архивный SKU и журнал удаления этого бренда.')
 if(line.order_status!=='active'||line.archived_at||
   line.quantity<1||line.quantity!==line.order_qty||line.cancelled_quantity!==0||
   !['warehouse','boutique'].includes(line.source_type)||
   !line.movement_id||!line.reservation_id||
   line.stock_writeoff_status!=='fulfilled'||
   line.reservation_status!=='fulfilled'||line.reservation_qty!==line.quantity||
   line.reservation_variant!==line.variant_id||line.reservation_source!==line.source_type||
   line.movement_type!=='sale'||line.movement_variant!==line.variant_id||
   line.movement_source!==line.source_type||
   line.movement_quantity==null||line.movement_quantity>0||
   line.retirement_id==null||Number(line.stock_quantity||0)!==0||
   Number(line.stock_reserved||0)!==0||
   line.other_issues>0||line.returns_count>0||line.exchange_old_count>0)
   stop('Архивная отправка имеет неоднозначную историю или связанные операции. Исправление остановлено.')
 const conflicts=await db.prepare(`
   SELECT COUNT(*) AS n FROM inventory_lifecycle_events le
   JOIN exchanges ex ON ex.id=le.operation_id
   WHERE le.order_item_id=? AND le.operation_type='exchange'
     AND le.status='applied' AND COALESCE(ex.status,'completed')<>'cancelled'
     AND (le.id<>? OR le.event_type<>'exchange_new_out' OR le.movement_id<>?)`)
   .bind(line.order_item_id,toInt(line.replacement_event,0),line.movement_id)
   .first<{n:number}>()
 if(Number(conflicts?.n||0)>0)
   stop('У отправленных часов есть другие действующие обмены. Сначала разберите цепочку обмена.')
 const stamp=new Date().toISOString()
 const newest=await db.prepare(`SELECT MAX(d.dispatch_date) AS date
   FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
   WHERE d.order_id=? AND di.id<>? AND di.quantity>COALESCE(di.cancelled_quantity,0)`)
   .bind(orderId,id).first<{date:string|null}>()
 const statements:D1PreparedStatement[]=[
   db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
     SELECT 'human_inventory_v2','__watch_pre_retire_cancel_conflict__',?
     WHERE NOT EXISTS(
       SELECT 1 FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
       JOIN order_items oi ON oi.id=di.order_item_id AND oi.order_id=d.order_id
       JOIN orders o ON o.id=d.order_id
       JOIN inventory_reservations ir ON ir.id=di.reservation_id AND ir.order_item_id=oi.id
       JOIN inventory_movements m ON m.id=di.movement_id AND m.movement_type='sale'
         AND m.variant_id=di.variant_id AND m.inventory_source=di.source_type
       JOIN catalog_variants cv ON cv.id=oi.variant_id AND cv.is_active=0
       JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.is_active=0
       JOIN catalog_products cp ON cp.id=cv.product_id AND cp.is_active=0
       JOIN catalog_retirement_variants rv ON rv.variant_id=cv.id
       JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
          AND op.status='completed' AND op.entity_type='product' AND op.product_id=cp.id
       JOIN watch_order_details wd ON wd.order_id=o.id AND wd.brand_id=?
       WHERE di.id=? AND d.order_id=? AND di.cancelled_quantity=0
         AND di.quantity=? AND oi.quantity=di.quantity
         AND oi.stock_writeoff_status='fulfilled'
         AND COALESCE(o.order_status,'active')='active' AND COALESCE(o.archived_at,'')=''
         AND ir.status='fulfilled' AND ir.variant_id=di.variant_id
         AND ir.quantity=di.quantity AND ir.inventory_source=di.source_type
         AND NOT EXISTS(SELECT 1 FROM inventory_reservations other
           WHERE other.order_item_id=oi.id AND other.id<>ir.id
             AND other.status IN ('active','unresolved','fulfilled'))
         AND NOT EXISTS(SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
           WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled')
         AND NOT EXISTS(SELECT 1 FROM exchange_items ei JOIN exchanges ex ON ex.id=ei.exchange_id
           WHERE ei.order_item_id=oi.id AND ei.role='old' AND COALESCE(ex.status,'completed')<>'cancelled')
         AND NOT EXISTS(SELECT 1 FROM order_dispatch_items other
           WHERE other.order_item_id=oi.id AND other.id<>di.id
             AND other.quantity>COALESCE(other.cancelled_quantity,0))
         AND NOT EXISTS(SELECT 1 FROM inventory_stock s
           WHERE s.variant_id=oi.variant_id AND
             (s.quantity<>0 OR s.reserved_quantity<>0))
     )`).bind(stamp,brandId,id,orderId,line.quantity),
   db.prepare(`UPDATE order_dispatch_items SET cancelled_quantity=quantity
       WHERE id=? AND cancelled_quantity=0 AND reservation_id=? AND movement_id=?`)
     .bind(id,line.reservation_id,line.movement_id),
   db.prepare(`UPDATE inventory_reservations SET
       status='released',released_at=?,fulfilled_at=NULL,
       unresolved_reason='catalog_retired',updated_at=?
       WHERE id=? AND status='fulfilled' AND order_item_id=? AND quantity=?`)
     .bind(stamp,stamp,line.reservation_id,line.order_item_id,line.quantity),
   db.prepare(`UPDATE order_items SET stock_writeoff_status='catalog_retired',
       stock_quantity_before=NULL,stock_quantity_after=NULL
       WHERE id=? AND order_id=? AND variant_id=? AND stock_writeoff_status='fulfilled'
         AND quantity=?`).bind(line.order_item_id,orderId,line.variant_id,line.quantity),
   db.prepare(`INSERT INTO order_dispatch_corrections(
       dispatch_item_id,request_id,quantity,stock_restored,reason,actor,created_at
     ) VALUES(?,?,?,0,?,?,?)`)
     .bind(id,requestId,line.quantity,'После удаления товара: '+reason,actor,stamp),
   db.prepare(`UPDATE order_dispatches SET
       status=CASE WHEN NOT EXISTS(SELECT 1 FROM order_dispatch_items other
         WHERE other.dispatch_id=order_dispatches.id
           AND other.quantity>COALESCE(other.cancelled_quantity,0))
         THEN 'cancelled' ELSE 'partially_cancelled' END,
       cancelled_at=?,cancel_actor=? WHERE id=?`)
     .bind(stamp,actor,line.dispatch_id)
 ]
 if(line.replacement_event){
   statements.push(db.prepare(`UPDATE inventory_lifecycle_events SET
      status='pending',pending_reason='awaiting_dispatch',applied_at=NULL,
      movement_id=NULL,resolution_comment=?,updated_at=?
      WHERE id=? AND order_id=? AND order_item_id=? AND status='applied' AND movement_id=?`)
     .bind('Ошибка отправки исправлена после удаления SKU; склад не восстановлен',
       stamp,line.replacement_event,orderId,line.order_item_id,line.movement_id))
 }
 statements.push(
   db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
     SELECT 'human_inventory_v2','__watch_pre_retire_cancel_postcondition__',?
     WHERE NOT EXISTS(
       SELECT 1 FROM order_dispatch_items di JOIN order_items oi ON oi.id=di.order_item_id
       JOIN inventory_reservations ir ON ir.id=di.reservation_id
       JOIN order_dispatch_corrections dc ON dc.dispatch_item_id=di.id
       WHERE di.id=? AND di.cancelled_quantity=di.quantity
         AND oi.stock_writeoff_status='catalog_retired'
         AND ir.status='released' AND ir.unresolved_reason='catalog_retired'
         AND ir.quantity=di.quantity AND dc.request_id=? AND dc.stock_restored=0
     )`).bind(stamp,id,requestId),
   db.prepare(retiredWatchShippingProjectionSql).bind(newest?.date||stamp.slice(0,10),stamp,orderId)
 )
 try{await db.batch(statements)}
 catch(err){
   const saved=await db.prepare(
     'SELECT dispatch_item_id FROM order_dispatch_corrections WHERE request_id=?'
   ).bind(requestId).first<{dispatch_item_id:number}>()
   if(saved?.dispatch_item_id===id)
     return {ok:true,alreadyCorrected:true,dispatchItemId:id,
       physicalRestoredQuantity:0,retiredWithoutStockChange:true}
   const m=cleanText(err instanceof Error?err.message:err)
   if(/unique constraint|__watch_pre_retire_cancel_/i.test(m))
     stop('Связи изменились во время исправления. Повторите после обновления заказа.')
   throw err
 }
 return {ok:true,dispatchItemId:id,cancelledQuantity:line.quantity,
   physicalRestoredQuantity:0,retiredWithoutStockChange:true,
   historicalMovementPreserved:true,archivedReissueAvailable:true,needsStockCheck:false}
}
