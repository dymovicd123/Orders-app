import {cleanText,toInt} from '../core/text.ts'
import {CriticalOperationConflictError} from './critical.ts'
import {retiredWatchShippingProjectionSql} from './client3-watch-retired-dispatch.ts'

const stop=(m:string):never=>{throw new CriticalOperationConflictError(m)}

/** Correct a genuine Client3 archived watch dispatch. No inventory or reserve
 * restoration is allowed because Main's catalog retirement already wrote off
 * all stock. Corrections remain item-scoped in Main's dispatch correction log. */
export async function cancelRetiredWatchDispatch(db:D1Database,brandId:number,orderId:number,
 input:{dispatchItemId:number;requestId:string;actor:string;reason:string}){
 const id=toInt(input.dispatchItemId,0),requestId=cleanText(input.requestId)
 if(!id||!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId)||
   cleanText(input.reason).length<8)stop('Необходимо указать отправку и причину исправления.')
 const previous=await db.prepare('SELECT dispatch_item_id FROM order_dispatch_corrections WHERE request_id=?')
   .bind(requestId).first<{dispatch_item_id:number}>()
 if(previous){
   if(previous.dispatch_item_id!==id)stop('Номер исправления использован для другой отправки.')
   return {ok:true,alreadyCorrected:true,dispatchItemId:id,physicalRestoredQuantity:0}
 }
 const line=await db.prepare(`
   SELECT di.id,di.dispatch_id,di.order_item_id,di.quantity,di.variant_id,
     di.cancelled_quantity,di.reservation_id,di.movement_id,
     oi.quantity AS order_qty,oi.stock_writeoff_status,oi.variant_id AS item_variant,
     j.quantity AS journal_qty,j.retired_variant_id,
     (SELECT COUNT(*) FROM return_items ri JOIN returns r ON r.id=ri.return_id
       WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled') AS returns,
     (SELECT COUNT(*) FROM exchange_items ei JOIN exchanges e ON e.id=ei.exchange_id
       WHERE ei.order_item_id=oi.id AND ei.role='old'
         AND COALESCE(e.status,'completed')<>'cancelled') AS old_exchanges,
     (SELECT COUNT(*) FROM order_dispatch_items di2 WHERE di2.order_item_id=oi.id
       AND di2.id<>di.id AND di2.quantity>COALESCE(di2.cancelled_quantity,0)) AS other_dispatch,
     (SELECT le.id FROM inventory_lifecycle_events le
       WHERE le.order_id=oi.order_id AND le.order_item_id=oi.id
         AND le.operation_type='exchange' AND le.event_type='exchange_new_out'
         AND le.status='applied' AND le.movement_id IS NULL LIMIT 1) AS replacement_event
   FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
   JOIN order_items oi ON oi.id=di.order_item_id AND oi.order_id=d.order_id
   JOIN watch_order_details wd ON wd.order_id=d.order_id
   JOIN retired_order_item_issues j ON j.order_item_id=oi.id
   WHERE di.id=? AND d.order_id=? AND wd.brand_id=?`)
   .bind(id,orderId,brandId).first<Record<string,unknown>>()
 if(!line)throw new CriticalOperationConflictError('Запись архивной отправки не найдена.')
 if(line.reservation_id!=null||line.movement_id!=null||
    toInt(line.cancelled_quantity,0)!==0||
    toInt(line.quantity,0)!==toInt(line.order_qty,0)||
    toInt(line.variant_id,0)!==toInt(line.item_variant,0)||
    toInt(line.variant_id,0)!==toInt(line.retired_variant_id,0)||
    toInt(line.journal_qty,0)!==toInt(line.quantity,0)||
    line.stock_writeoff_status!=='retired_physically_issued'||
    toInt(line.returns,0)>0||toInt(line.old_exchanges,0)>0||
    toInt(line.other_dispatch,0)>0)
   stop('Архивная отправка изменилась или участвует в возврате/обмене. Исправление остановлено.')
 const stamp=new Date().toISOString()
 const last=await db.prepare(`SELECT MAX(d.dispatch_date) AS date
   FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
   WHERE d.order_id=? AND di.id<>? AND di.quantity>COALESCE(di.cancelled_quantity,0)`)
   .bind(orderId,id).first<{date:string|null}>()
 const statements:D1PreparedStatement[]=[
   db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
     SELECT 'human_inventory_v2','__retired_cancel_conflict__',?
     WHERE NOT EXISTS(
       SELECT 1 FROM order_dispatch_items di
       JOIN order_dispatches d ON d.id=di.dispatch_id
       JOIN order_items oi ON oi.id=di.order_item_id
       WHERE di.id=? AND d.order_id=? AND di.cancelled_quantity=0
         AND di.reservation_id IS NULL AND di.movement_id IS NULL
         AND di.quantity=oi.quantity AND oi.stock_writeoff_status='retired_physically_issued'
         AND NOT EXISTS(SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
           WHERE ri.order_item_id=oi.id AND COALESCE(r.status,'completed')<>'cancelled')
     )`).bind(stamp,id,orderId),
   db.prepare(`UPDATE order_dispatch_items SET cancelled_quantity=quantity
     WHERE id=? AND cancelled_quantity=0 AND movement_id IS NULL AND reservation_id IS NULL`).bind(id),
   db.prepare(`UPDATE order_items SET stock_writeoff_status='catalog_retired',
     stock_quantity_before=NULL,stock_quantity_after=NULL
     WHERE id=? AND stock_writeoff_status='retired_physically_issued'`)
     .bind(toInt(line.order_item_id,0)),
   db.prepare(`INSERT INTO order_dispatch_corrections(
     dispatch_item_id,request_id,quantity,stock_restored,reason,actor,created_at
   ) VALUES(?,?,?,0,?,?,?)`).bind(id,requestId,toInt(line.quantity,0),
     cleanText(input.reason),cleanText(input.actor),stamp),
   db.prepare(`UPDATE order_dispatches SET
     status=CASE WHEN NOT EXISTS(SELECT 1 FROM order_dispatch_items i
       WHERE i.dispatch_id=order_dispatches.id
         AND i.quantity>COALESCE(i.cancelled_quantity,0))
       THEN 'cancelled' ELSE 'partially_cancelled' END,
     cancelled_at=?,cancel_actor=? WHERE id=?`)
     .bind(stamp,cleanText(input.actor),toInt(line.dispatch_id,0)),
 ]
 if(line.replacement_event)statements.push(db.prepare(`
   UPDATE inventory_lifecycle_events SET status='pending',pending_reason='awaiting_dispatch',
     applied_at=NULL,movement_id=NULL,resolution_comment=?,updated_at=?
   WHERE id=? AND order_id=? AND order_item_id=? AND status='applied'
     AND movement_id IS NULL`).bind('Исправлена отправка архивной замены без восстановления остатка',
       stamp,toInt(line.replacement_event,0),orderId,toInt(line.order_item_id,0)))
 statements.push(db.prepare(retiredWatchShippingProjectionSql)
   .bind(last?.date||stamp.slice(0,10),stamp,orderId))
 try{await db.batch(statements)}catch(e){
   const replay=await db.prepare('SELECT dispatch_item_id FROM order_dispatch_corrections WHERE request_id=?')
     .bind(requestId).first<{dispatch_item_id:number}>()
   if(replay?.dispatch_item_id===id)
     return {ok:true,alreadyCorrected:true,dispatchItemId:id,physicalRestoredQuantity:0}
   const m=cleanText(e instanceof Error?e.message:e)
   if(/unique constraint|__retired_cancel_conflict__/.test(m))
     stop('Отправка изменилась параллельно с исправлением. Обновите заказ.')
   throw e
 }
 return {ok:true,dispatchItemId:id,cancelledQuantity:toInt(line.quantity,0),
   physicalRestoredQuantity:0,needsStockCheck:false,retiredWithoutStockChange:true}
}
