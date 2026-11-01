import { cleanText, toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'

const fail=(s:string):never=>{throw new CriticalOperationConflictError(s)}

/**
 * Undo ONLY one identified dispatch batch. A Return of that exact shipment's
 * units takes precedence; unrelated Returns/Exchanges cannot block the undo.
 * This version supports cancelling complete shipment lines. No partial units
 * and no optimistic physical +1 after a more recent count.
 */
export async function cancelExactOrderDispatch(
 db:D1Database, orderId:number,
 input:{dispatchId:number;requestId:string;actor:string;reason:string},
){
 const requestId=cleanText(input.requestId)
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId))fail('Обновите заказ и повторите исправление.')
 const dispatchId=toInt(input.dispatchId,0)
 if(!dispatchId)fail('Выберите отправку для отмены.')
 const dispatch=await db.prepare(
   'SELECT id,order_id,request_id,created_at,status FROM order_dispatches WHERE id=? AND order_id=?'
 ).bind(dispatchId,orderId).first<Record<string,unknown>>()
 if(!dispatch)fail('Отправка не найдена.')
 const older=await db.prepare(
   'SELECT id,dispatch_item_id FROM order_dispatch_corrections WHERE request_id=?'
 ).bind(requestId).first<{id:number;dispatch_item_id:number}>()
 if(older?.id){
   const still=await db.prepare(
     'SELECT COUNT(*) AS n FROM order_dispatch_corrections c JOIN order_dispatch_items di ON di.id=c.dispatch_item_id WHERE di.dispatch_id=? AND c.request_id=?'
   ).bind(dispatchId,requestId).first<{n:number}>()
   if(toInt(still?.n,0)>0)return {ok:true,alreadyCorrected:true,dispatchId}
   fail('Это подтверждение относится к другой отправке.')
 }
 const rows=await db.prepare(
   `SELECT di.*,oi.order_id,oi.quantity AS order_quantity,
           o.order_status,o.archived_at,o.shipping_status
    FROM order_dispatch_items di
    JOIN order_items oi ON oi.id=di.order_item_id
    JOIN orders o ON o.id=oi.order_id
    WHERE di.dispatch_id=? AND o.id=? ORDER BY di.id`
 ).bind(dispatchId,orderId).all<Record<string,unknown>>()
 const lines=rows.results||[]
 if(!lines.length)fail('В отправке нет сохранённых позиций.')
 if(lines.some(l=>toInt(l.cancelled_quantity,0)!==0)){
   fail('Часть этой отправки уже отменена. Обновите заказ и выберите оставшиеся позиции.')
 }
 if(lines.some(l=>['deleted','archived'].includes(cleanText(l.order_status))||cleanText(l.archived_at))){
   fail('Заказ закрыт. Его историю можно просмотреть, но не изменять.')
 }
 const exactIds=lines.map(l=>toInt(l.order_item_id,0))
 const placeholders=exactIds.map(()=>'?').join(',')
 const conflict=await db.prepare(
   `SELECT ri.order_item_id FROM return_items ri
    JOIN returns r ON r.id=ri.return_id
    WHERE r.order_id=? AND ri.order_item_id IN (${placeholders})
      AND ri.quantity>0 AND COALESCE(r.status,'completed')<>'cancelled'
    LIMIT 1`
 ).bind(orderId,...exactIds).first<{order_item_id:number}>()
 if(conflict?.order_item_id)fail('Эта вещь уже участвует в возврате. Отмена её отправки должна учитывать этот возврат; другие вещи заказа не затронуты.')
 const activeExchange=await db.prepare(
   `SELECT e.id FROM exchanges e
    JOIN inventory_lifecycle_events le ON le.operation_id=e.id AND le.operation_type='exchange'
    WHERE e.order_id=? AND le.order_item_id IN (${placeholders})
      AND COALESCE(e.status,'completed')<>'cancelled'
    LIMIT 1`
 ).bind(orderId,...exactIds).first<{id:number}>()
 if(activeExchange?.id)fail('Выбранная вещь уже участвует в обмене. Откройте действия именно этого обмена.')

 const stamp=new Date().toISOString()
 const adjusted:Array<{line:Record<string,unknown>;stockId:number;stockBefore:number;reservedBefore:number;restorePhysical:boolean}>=[]
 for(const line of lines) {
   if(cleanText(line.source_type)==='workshop')continue
   const r=await db.prepare(
     'SELECT id,order_id,order_item_id,status,quantity,inventory_source,variant_id FROM inventory_reservations WHERE id=?'
   ).bind(toInt(line.reservation_id,0)).first<Record<string,unknown>>()
   if(!r || toInt(r.order_item_id,0)!==toInt(line.order_item_id,0) || cleanText(r.status)!=='fulfilled'
     || toInt(r.quantity,0)!==toInt(line.quantity,0) || toInt(r.variant_id,0)!==toInt(line.variant_id,0)
     || cleanText(r.inventory_source)!==cleanText(line.source_type))fail('Состояние именно этой вещи изменилось. Обновите отправку.')
   const stock=await db.prepare(
     'SELECT id,quantity,reserved_quantity FROM inventory_stock WHERE inventory_source=? AND variant_id=?'
   ).bind(line.source_type,line.variant_id).first<Record<string,unknown>>()
   if(!stock?.id)fail('Остаток выбранной вещи не найден.')
   const newest=await db.prepare(
     `SELECT EXISTS(SELECT 1 FROM inventory_stock_checks sc
      WHERE sc.inventory_source=? AND sc.variant_id=?
       AND julianday(sc.checked_at)>julianday(?)
       AND sc.check_type NOT IN ('shipping_observation')) AS counted,
       EXISTS(SELECT 1 FROM inventory_movements m
      WHERE m.inventory_source=? AND m.variant_id=?
       AND m.id>?
       AND m.movement_type IN ('revision','manual_set')) AS revised`
   ).bind(line.source_type,line.variant_id,dispatch.created_at,line.source_type,line.variant_id,toInt(line.movement_id,0)).first<{counted:number;revised:number}>()
   adjusted.push({line,stockId:toInt(stock.id,0),stockBefore:toInt(stock.quantity,0),
     reservedBefore:toInt(stock.reserved_quantity,0),
     restorePhysical:!toInt(newest?.counted,0)&&!toInt(newest?.revised,0)})
 }
 // All SQL writes below are one D1 transaction. No stock/reservation adjustment
 // is committed unless every selected dispatch line still matches the preflight.
 const stmts:D1PreparedStatement[]=[]
 for(const item of lines){
   stmts.push(db.prepare(
     `INSERT INTO inventory_model_meta(key,value,updated_at)
      SELECT 'human_inventory_v2','__cancel_dispatch_changed__',?
      WHERE NOT EXISTS(
        SELECT 1 FROM order_dispatch_items di
        JOIN order_dispatches d ON d.id=di.dispatch_id
        WHERE di.id=? AND di.dispatch_id=? AND di.cancelled_quantity=0
          AND di.quantity=? AND d.order_id=?
          AND NOT EXISTS(SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
            WHERE ri.order_item_id=di.order_item_id AND r.order_id=d.order_id
              AND ri.quantity>0 AND COALESCE(r.status,'completed')<>'cancelled')
      )`
   ).bind(stamp,toInt(item.id,0),dispatchId,toInt(item.quantity,0),orderId))
 }
 for(const item of adjusted){
   const l=item.line,q=toInt(l.quantity,0)
   stmts.push(db.prepare(
     `INSERT INTO inventory_model_meta(key,value,updated_at)
      SELECT 'human_inventory_v2','__cancel_reservation_changed__',?
      WHERE NOT EXISTS(SELECT 1 FROM inventory_reservations
        WHERE id=? AND order_item_id=? AND status='fulfilled' AND quantity=?)
       OR NOT EXISTS(SELECT 1 FROM inventory_stock
        WHERE id=? AND quantity=? AND reserved_quantity=?)`
   ).bind(stamp,toInt(l.reservation_id,0),toInt(l.order_item_id,0),q,item.stockId,item.stockBefore,item.reservedBefore))
   stmts.push(db.prepare(
     `UPDATE inventory_stock
      SET quantity=quantity+?,reserved_quantity=reserved_quantity+?,
          last_action='Исправлена отправка',last_source_ref=?,updated_at=?
      WHERE id=? AND quantity=? AND reserved_quantity=?`
   ).bind(item.restorePhysical?q:0,q,`dispatch_cancel:${requestId}`,stamp,item.stockId,item.stockBefore,item.reservedBefore))
   stmts.push(db.prepare(
     `UPDATE inventory_reservations SET status='active',fulfilled_at=NULL,updated_at=?
       WHERE id=? AND status='fulfilled' AND quantity=?`
   ).bind(stamp,toInt(l.reservation_id,0),q))
   stmts.push(db.prepare(
     `UPDATE order_items SET stock_writeoff_status='reserved',
       stock_quantity_before=NULL,stock_quantity_after=NULL WHERE id=? AND stock_writeoff_status='fulfilled'`
   ).bind(toInt(l.order_item_id,0)))
   if(item.restorePhysical){
     stmts.push(db.prepare(
       `INSERT INTO inventory_movements(
         inventory_source,movement_type,product_id,variant_id,product_name_snapshot,
         gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
         quantity_delta,quantity_after,reference_type,reference_id,comment,created_at
       )
       SELECT inventory_source,'return',product_id,variant_id,product_name_snapshot,
         gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
         ?,?,'order_dispatch_correction',?, ?,?
       FROM inventory_movements WHERE id=? AND movement_type='sale'`
     ).bind(q,item.stockBefore+q,`dispatch_cancel:${requestId}:item:${l.order_item_id}`,
       'Отменена ошибочная отправка',stamp,toInt(l.movement_id,0)))
   }
 }
 for(const l of lines){
   stmts.push(
     db.prepare('UPDATE order_dispatch_items SET cancelled_quantity=quantity WHERE id=? AND cancelled_quantity=0')
       .bind(toInt(l.id,0)),
     db.prepare(
       `INSERT INTO order_dispatch_corrections(dispatch_item_id,request_id,quantity,stock_restored,reason,actor,created_at)
        VALUES(?,?,?,?,?,?,?)`
     ).bind(toInt(l.id,0),`${requestId}:item:${l.id}`,toInt(l.quantity,0),
       adjusted.find(x=>toInt(x.line.id,0)===toInt(l.id,0))?.restorePhysical?1:0,
       cleanText(input.reason)||'Ошибочная отправка',cleanText(input.actor),stamp),
   )
 }
 stmts.push(
   db.prepare("UPDATE order_dispatches SET status='cancelled',cancelled_at=?,cancel_actor=? WHERE id=? AND order_id=? AND status='sent'")
     .bind(stamp,cleanText(input.actor),dispatchId,orderId),
   db.prepare("UPDATE orders SET shipping_status='not_sent',shipping_date=NULL,updated_at=? WHERE id=?")
     .bind(stamp,orderId),
 )
 try{await db.batch(stmts)}catch(error){
   const msg=cleanText(error instanceof Error?error.message:error)
   if(/unique constraint failed/i.test(msg))fail('Данные изменились во время исправления. Обновите заказ; повторное складское движение не проведено.')
   throw error
 }
 return {ok:true,dispatchId,cancelledQuantity:lines.reduce((n,l)=>n+toInt(l.quantity,0),0),
   physicalRestoredQuantity:adjusted.filter(x=>x.restorePhysical).reduce((n,x)=>n+toInt(x.line.quantity,0),0),
   countNeedsReview:adjusted.filter(x=>!x.restorePhysical).length}
}
