import { cleanText, toInt } from '../core/text.ts'
import { CriticalOperationConflictError } from './critical.ts'

const fail = (message:string):never => { throw new CriticalOperationConflictError(message) }

/** Cancel only one identified shipped line, not unrelated items or returns. */
export async function cancelExactOrderDispatchItem(
  db:D1Database, orderId:number,
  input:{dispatchItemId:number;requestId:string;actor:string;reason:string},
) {
  const requestId=cleanText(input.requestId)
  const dispatchItemId=toInt(input.dispatchItemId,0)
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId) || !dispatchItemId) {
    fail('Обновите заказ и выберите отправленную вещь.')
  }
  const replay=await db.prepare(
    'SELECT dispatch_item_id FROM order_dispatch_corrections WHERE request_id=?'
  ).bind(requestId).first<{dispatch_item_id:number}>()
  if(replay){
    if(replay.dispatch_item_id!==dispatchItemId)fail('Это действие уже использовано для другой вещи.')
    return {ok:true,alreadyCorrected:true,dispatchItemId}
  }
  const line=await db.prepare(
    `SELECT di.*,d.order_id,d.created_at AS dispatch_created_at,d.status AS dispatch_status,
            o.order_status,o.archived_at,oi.stock_writeoff_status,oi.quantity AS order_item_quantity
     FROM order_dispatch_items di
     JOIN order_dispatches d ON d.id=di.dispatch_id
     JOIN orders o ON o.id=d.order_id
     JOIN order_items oi ON oi.id=di.order_item_id AND oi.order_id=d.order_id
     WHERE di.id=? AND d.order_id=?`
  ).bind(dispatchItemId,orderId).first<Record<string,unknown>>()
  if(!line) throw new CriticalOperationConflictError('Отправленная вещь не найдена.')
  if(['archived','deleted'].includes(cleanText(line.order_status))||cleanText(line.archived_at))fail('Заказ закрыт.')
  if(toInt(line.cancelled_quantity,0)!==0)fail('Эту отправку уже исправили. Обновите заказ.')
  const itemId=toInt(line.order_item_id,0),quantity=toInt(line.quantity,0)
  if(quantity<=0 || quantity!==toInt(line.order_item_quantity,0))fail('Количество позиции изменилось. Обновите заказ.')
  const returnConflict=await db.prepare(
    `SELECT ri.id FROM return_items ri JOIN returns r ON r.id=ri.return_id
     WHERE ri.order_item_id=? AND r.order_id=? AND ri.quantity>0
       AND COALESCE(r.status,'completed')<>'cancelled' LIMIT 1`
  ).bind(itemId,orderId).first<{id:number}>()
  if(returnConflict?.id)fail('Эта вещь участвует в возврате. Исправьте её через возврат; остальные товары доступны.')
  const exchangeConflict=await db.prepare(
    `SELECT e.id FROM exchanges e
     JOIN inventory_lifecycle_events le ON le.operation_id=e.id AND le.operation_type='exchange'
     WHERE e.order_id=? AND le.order_item_id=? AND COALESCE(e.status,'completed')<>'cancelled' LIMIT 1`
  ).bind(orderId,itemId).first<{id:number}>()
  // A NEW exchange replacement that was sent through the canonical dispatch
  // ledger may be corrected by its exact dispatch item. The OLD exchanged
  // item or a legacy exchange still needs the exchange-specific correction.
  const replacement=await db.prepare(
    `SELECT le.id,le.operation_id,le.quantity,le.variant_id,le.inventory_source
     FROM inventory_lifecycle_events le
     JOIN exchanges e ON e.id=le.operation_id AND e.order_id=le.order_id
     WHERE le.order_id=? AND le.order_item_id=? AND (e.new_order_item_id=le.order_item_id OR EXISTS(
           SELECT 1 FROM exchange_items ei WHERE ei.exchange_id=e.id
             AND ei.id=le.operation_item_id AND ei.role='new'
             AND ei.order_item_id=le.order_item_id))
       AND le.operation_type='exchange' AND le.event_type='exchange_new_out'
       AND le.status='applied' AND le.movement_id=?
       AND COALESCE(e.status,'completed')<>'cancelled'
     LIMIT 1`
  ).bind(orderId,itemId,toInt(line.movement_id,0)).first<Record<string,unknown>>()
  const workshopReplacement=cleanText(line.source_type)==='workshop'
    ? await db.prepare(
       `SELECT e.id FROM exchanges e WHERE e.order_id=? AND e.new_order_item_id=?
         AND COALESCE(e.status,'completed')<>'cancelled' LIMIT 1`
      ).bind(orderId,itemId).first<{id:number}>()
    : null
  if (exchangeConflict?.id && !replacement?.id && !workshopReplacement?.id)
    fail('Эта вещь участвует в другом обмене. Исправьте её через обмен; остальные товары доступны.')
  if (replacement?.id && (toInt(replacement.quantity,0)!==quantity
      || toInt(replacement.variant_id,0)!==toInt(line.variant_id,0)
      || cleanText(replacement.inventory_source)!==cleanText(line.source_type))) {
    fail('Идентичность отправленной замены не совпадает с обменом. Обновите заказ.')
  }
  const isWorkshop=cleanText(line.source_type)==='workshop'
  const stamp=new Date().toISOString()
  let stock:{id:number;quantity:number;reserved_quantity:number}|null=null
  let restorePhysical=false
  const reservationId=toInt(line.reservation_id,0)
  const movementId=toInt(line.movement_id,0)
  if(!isWorkshop){
    const r=await db.prepare(
      'SELECT id,order_item_id,quantity,status,inventory_source,variant_id FROM inventory_reservations WHERE id=?'
    ).bind(reservationId).first<Record<string,unknown>>()
    if(!r || toInt(r.order_item_id,0)!==itemId || toInt(r.quantity,0)!==quantity
       || cleanText(r.status)!=='fulfilled' || cleanText(r.inventory_source)!==cleanText(line.source_type)
       || toInt(r.variant_id,0)!==toInt(line.variant_id,0)
       || cleanText(line.stock_writeoff_status)!=='fulfilled')fail('Складская запись вещи изменилась. Обновите заказ.')
    stock=await db.prepare(
      'SELECT id,quantity,reserved_quantity FROM inventory_stock WHERE inventory_source=? AND variant_id=?'
    ).bind(line.source_type,line.variant_id).first<{id:number;quantity:number;reserved_quantity:number}>()
    if(!stock?.id || !movementId)fail('Не найдена подтверждённая складская выдача этой вещи.')
    const recent=await db.prepare(
      `SELECT
         EXISTS(SELECT 1 FROM inventory_stock_checks c
          WHERE c.inventory_source=? AND c.variant_id=?
            AND julianday(c.checked_at)>julianday(?)
            AND c.check_type<>'shipping_observation') AS newer_check,
         EXISTS(SELECT 1 FROM inventory_movements m
          WHERE m.inventory_source=? AND m.variant_id=? AND m.id>?
            AND m.movement_type IN ('revision','manual_set')
            AND m.reference_type NOT IN ('return_cancel','exchange_cancel')) AS newer_revision`
    ).bind(line.source_type,line.variant_id,line.dispatch_created_at,
      line.source_type,line.variant_id,movementId).first<{newer_check:number;newer_revision:number}>()
    restorePhysical=!toInt(recent?.newer_check,0)&&!toInt(recent?.newer_revision,0)
  }

  const statements:D1PreparedStatement[]=[]
  statements.push(db.prepare(
    `INSERT INTO inventory_model_meta(key,value,updated_at)
     SELECT 'human_inventory_v2','__dispatch_cancel_conflict__',?
     WHERE NOT EXISTS(
       SELECT 1 FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
       JOIN order_items oi ON oi.id=di.order_item_id
       WHERE di.id=? AND d.order_id=? AND di.cancelled_quantity=0 AND di.quantity=?
         AND oi.quantity=?
         AND NOT EXISTS(SELECT 1 FROM return_items ri JOIN returns r ON r.id=ri.return_id
          WHERE ri.order_item_id=oi.id AND ri.quantity>0 AND COALESCE(r.status,'completed')<>'cancelled')
     )`
  ).bind(stamp,dispatchItemId,orderId,quantity,quantity))
  if(!isWorkshop){
    statements.push(
      db.prepare(
        `INSERT INTO inventory_model_meta(key,value,updated_at)
         SELECT 'human_inventory_v2','__dispatch_cancel_stock_changed__',?
         WHERE NOT EXISTS(SELECT 1 FROM inventory_stock WHERE id=? AND quantity=? AND reserved_quantity=?)
           OR NOT EXISTS(SELECT 1 FROM inventory_reservations
             WHERE id=? AND order_item_id=? AND quantity=? AND status='fulfilled')`
      ).bind(stamp,stock!.id,stock!.quantity,stock!.reserved_quantity,reservationId,itemId,quantity),
      db.prepare(
        `UPDATE inventory_stock
         SET quantity=quantity+?,reserved_quantity=reserved_quantity+?,
             last_action='Исправлена отправка',last_source_ref=?,updated_at=?
         WHERE id=? AND quantity=? AND reserved_quantity=?`
      ).bind(restorePhysical?quantity:0,restorePhysical?quantity:0,`dispatch_cancel:${requestId}`,stamp,
        stock!.id,stock!.quantity,stock!.reserved_quantity),
      db.prepare(
        `UPDATE inventory_reservations SET
           status=?,unresolved_reason=?,fulfilled_at=NULL,updated_at=?
         WHERE id=? AND status='fulfilled' AND quantity=?`
      ).bind(restorePhysical?'active':'unresolved',restorePhysical?null:'concurrent_shortage',
        stamp,reservationId,quantity),
      db.prepare(
        `UPDATE order_items SET stock_writeoff_status=?,stock_quantity_before=NULL,stock_quantity_after=NULL
         WHERE id=? AND stock_writeoff_status='fulfilled'`
      ).bind(restorePhysical?'reserved':'pending_reservation',itemId),
    )
    if(restorePhysical) statements.push(db.prepare(
      `INSERT INTO inventory_movements(
        inventory_source,movement_type,product_id,variant_id,product_name_snapshot,
        gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
        quantity_delta,quantity_after,reference_type,reference_id,comment,created_at
      ) SELECT inventory_source,'return',product_id,variant_id,product_name_snapshot,
          gender_snapshot,color_snapshot,material_snapshot,length_snapshot,size_snapshot,
          ?,?,'order_dispatch_correction',?, ?,?
        FROM inventory_movements WHERE id=? AND movement_type='sale'`
    ).bind(quantity,stock!.quantity+quantity,`dispatch_cancel:${requestId}:item:${itemId}`,
      'Отменена ошибочная отправка',stamp,movementId))
  }
  if (replacement?.id) {
    statements.push(
      db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
         SELECT 'human_inventory_v2','__replacement_cancel_conflict__',?
         WHERE NOT EXISTS(
           SELECT 1 FROM inventory_lifecycle_events le
           JOIN exchanges e ON e.id=le.operation_id AND e.order_id=le.order_id
           WHERE le.id=? AND le.order_id=? AND le.order_item_id=?
             AND le.status='applied' AND le.movement_id=?
             AND COALESCE(e.status,'completed')<>'cancelled'
         )`).bind(stamp,toInt(replacement.id,0),orderId,itemId,movementId),
      db.prepare(`UPDATE inventory_lifecycle_events SET
        status='pending',pending_reason='awaiting_dispatch',applied_at=NULL,movement_id=NULL,
        resolution_comment=?,updated_at=?
        WHERE id=? AND order_id=? AND order_item_id=? AND status='applied' AND movement_id=?`)
        .bind('Отмена точной отправки замены; повторная выдача только после проверки резерва',
          stamp,toInt(replacement.id,0),orderId,itemId,movementId),
    )
  }
  statements.push(
    db.prepare('UPDATE order_dispatch_items SET cancelled_quantity=quantity WHERE id=? AND cancelled_quantity=0')
      .bind(dispatchItemId),
    db.prepare(
      `INSERT INTO order_dispatch_corrections(dispatch_item_id,request_id,quantity,stock_restored,reason,actor,created_at)
       VALUES(?,?,?,?,?,?,?)`
    ).bind(dispatchItemId,requestId,quantity,restorePhysical?1:0,cleanText(input.reason)||'Ошибочная отправка',
      cleanText(input.actor),stamp),
    db.prepare(
      `UPDATE order_dispatches
       SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM order_dispatch_items
        WHERE dispatch_id=order_dispatches.id AND cancelled_quantity<quantity) THEN 'cancelled'
        ELSE 'partially_cancelled' END,
       cancelled_at=?,cancel_actor=? WHERE id=?`
    ).bind(stamp,cleanText(input.actor),toInt(line.dispatch_id,0)),
    db.prepare("UPDATE orders SET shipping_status='not_sent',shipping_date=NULL,updated_at=? WHERE id=?")
      .bind(stamp,orderId),
  )
  try{await db.batch(statements)}catch(error){
    const reason=cleanText(error instanceof Error?error.message:error)
    if(/unique constraint failed/i.test(reason)){
      const found=await db.prepare('SELECT dispatch_item_id FROM order_dispatch_corrections WHERE request_id=?').bind(requestId).first<{dispatch_item_id:number}>()
      if(found?.dispatch_item_id===dispatchItemId)return {ok:true,alreadyCorrected:true,dispatchItemId}
      fail('Данные изменились. Обновите заказ — повторного складского движения не было.')
    }
    throw error
  }
  return {ok:true,dispatchItemId,cancelledQuantity:quantity,
    physicalRestoredQuantity:restorePhysical?quantity:0,
    needsStockCheck:!isWorkshop&&!restorePhysical}
}
