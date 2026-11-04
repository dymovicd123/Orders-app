import {cleanText} from '../core/text.ts'
import {CriticalOperationConflictError} from './critical.ts'

const conflict=(message:string):never=>{throw new CriticalOperationConflictError(message)}
type Chosen={orderItemId:number;quantity:number}
type RetiredLine={
 id:number;quantity:number;variant_id:number;product_id:number;source_type:string;
 stock_writeoff_status:string;watch_variant_id:number;model_name:string;engraving_text:string;
 ready_text:string|null;brand_id:number;retirement_id:number|null;
 reservation_id:number|null;reservation_quantity:number|null;reservation_status:string|null;
 retirement_count:number;open_returns:number;open_old_exchanges:number;shipped:number;
 replacement_id:number|null;replacement_event_id:number|null;replacement_quantity:number|null
}
export const retiredWatchShippingProjectionSql=`UPDATE orders SET
 shipping_status=CASE WHEN NOT EXISTS(
   SELECT 1 FROM order_items oi WHERE oi.order_id=orders.id AND oi.quantity>0
     AND (COALESCE(oi.stock_writeoff_status,'') NOT IN
       ('fulfilled','exchanged','cancelled','returned','retired_physically_issued')
       OR (oi.stock_writeoff_status='retired_physically_issued' AND NOT EXISTS(
         SELECT 1 FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
         WHERE di.order_item_id=oi.id AND d.order_id=oi.order_id
           AND di.quantity>COALESCE(di.cancelled_quantity,0)
       )))
 ) THEN 'sent' ELSE 'not_sent' END,
 shipping_date=CASE WHEN NOT EXISTS(
   SELECT 1 FROM order_items oi WHERE oi.order_id=orders.id AND oi.quantity>0
     AND (COALESCE(oi.stock_writeoff_status,'') NOT IN
       ('fulfilled','exchanged','cancelled','returned','retired_physically_issued')
       OR (oi.stock_writeoff_status='retired_physically_issued' AND NOT EXISTS(
         SELECT 1 FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
         WHERE di.order_item_id=oi.id AND d.order_id=oi.order_id
           AND di.quantity>COALESCE(di.cancelled_quantity,0)
       )))
 ) THEN ? ELSE NULL END,updated_at=? WHERE id=?`

/** Client3-only physical delivery of an ALREADY retired watch SKU.
 * Main removed stock and released reservations at catalog retirement.
 * We create the SAME regular order_dispatches/dispatch_items ledger used by
 * normal logistics, but NEVER create a sale movement, reserve or stock row.
 *
 * D1 batch is atomic. A deliberately duplicate inventory_model_meta key aborts
 * the entire batch if the order, retirement, reservation, or item changes.
 */
export async function dispatchRetiredClient3WatchLines(
 db:D1Database,brandId:number,orderId:number,input:{
  requestId:string;actor:string;dispatchDate:string;items:Chosen[]
 }){
 const requestId=cleanText(input.requestId)
 if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId))
   conflict('Неверный идентификатор отправки.')
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>40||
    input.items.some(i=>!Number.isSafeInteger(i.orderItemId)||i.orderItemId<1||
      !Number.isSafeInteger(i.quantity)||i.quantity<1)||
    new Set(input.items.map(i=>i.orderItemId)).size!==input.items.length)
   conflict('Укажите неповторяющиеся позиции архивных часов и количество.')
 const prior=await db.prepare('SELECT id,order_id FROM order_dispatches WHERE request_id=?')
   .bind(requestId).first<{id:number;order_id:number}>()
 if(prior){
   const saved=await db.prepare(`SELECT order_item_id,quantity FROM order_dispatch_items
     WHERE dispatch_id=? ORDER BY order_item_id`).bind(prior.id).all<{order_item_id:number;quantity:number}>()
   const previous=(saved.results||[]).map(x=>x.order_item_id+':'+x.quantity).sort()
   const wanted=input.items.map(x=>x.orderItemId+':'+x.quantity).sort()
   if(prior.order_id!==orderId||JSON.stringify(previous)!==JSON.stringify(wanted))
     conflict('Идентификатор отправки уже применялся к другим часам.')
   return {ok:true,alreadyCommitted:true,dispatchId:prior.id,retiredWithoutStockChange:true}
 }
 const order=await db.prepare(`SELECT o.id,o.external_id,o.order_status,
    o.archived_at,o.shipping_status,wd.brand_id FROM orders o
    JOIN watch_order_details wd ON wd.order_id=o.id WHERE o.id=? AND wd.brand_id=?`)
   .bind(orderId,brandId).first<Record<string,unknown>>()
 if(!order||String(order.order_status)!=='active'||order.archived_at)
   throw new CriticalOperationConflictError('Архивная отправка разрешена только для действующего заказа выбранного бренда.')
 const rows=await db.prepare(`
  SELECT oi.id,oi.quantity,oi.variant_id,oi.product_id,oi.source_type,oi.stock_writeoff_status,
    wi.watch_variant_id,wi.engraving_text,wp.model_name,wp.brand_id,
    ready.engraving_text AS ready_text,rv.retirement_id,
    r.id AS reservation_id,r.quantity AS reservation_quantity,r.status AS reservation_status,
    (SELECT COUNT(*) FROM catalog_retirement_variants snap
       JOIN catalog_retirement_operations op ON op.id=snap.retirement_id
       WHERE snap.variant_id=oi.variant_id AND op.status='completed'
         AND op.entity_type='product' AND op.product_id=oi.product_id) AS retirement_count,
    (SELECT COUNT(*) FROM return_items ri JOIN returns rt ON rt.id=ri.return_id
       WHERE ri.order_item_id=oi.id AND ri.quantity>0
         AND COALESCE(rt.status,'completed')<>'cancelled') AS open_returns,
    (SELECT COUNT(*) FROM exchange_items ei JOIN exchanges ex ON ex.id=ei.exchange_id
       WHERE ei.order_item_id=oi.id AND ei.role='old'
         AND COALESCE(ex.status,'completed')<>'cancelled') AS open_old_exchanges,
    (SELECT COALESCE(SUM(di.quantity-COALESCE(di.cancelled_quantity,0)),0)
       FROM order_dispatch_items di JOIN order_dispatches d ON d.id=di.dispatch_id
       WHERE di.order_item_id=oi.id AND d.order_id=oi.order_id) AS shipped,
    le.operation_id AS replacement_id,le.id AS replacement_event_id,
    le.quantity AS replacement_quantity
  FROM order_items oi
  JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
  JOIN watch_variants v ON v.id=wi.watch_variant_id AND v.catalog_variant_id=oi.variant_id
  JOIN watch_products wp ON wp.id=v.watch_product_id
  JOIN catalog_variants cv ON cv.id=oi.variant_id AND cv.is_active=0
  JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.is_active=0
  JOIN catalog_products cp ON cp.id=cv.product_id AND cp.is_active=0
  JOIN catalog_retirement_variants rv ON rv.variant_id=cv.id
  JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
    AND op.status='completed' AND op.entity_type='product' AND op.product_id=cp.id
  LEFT JOIN inventory_reservations r ON r.order_item_id=oi.id
  LEFT JOIN watch_engraving_item_readiness ready ON ready.order_item_id=oi.id
  LEFT JOIN inventory_lifecycle_events le ON le.order_item_id=oi.id
    AND le.order_id=oi.order_id AND le.operation_type='exchange'
    AND le.event_type='exchange_new_out' AND le.status='pending'
    AND le.pending_reason='awaiting_dispatch'
  WHERE oi.order_id=? AND oi.id IN (${input.items.map(()=>'?').join(',')})
   AND oi.quantity>0 AND oi.is_workshop=0
  ORDER BY oi.id`)
   .bind(orderId,...input.items.map(x=>x.orderItemId)).all<RetiredLine>()
 const byId=new Map<number,RetiredLine>()
 for(const r of rows.results||[]){
   if(byId.has(Number(r.id)))conflict('У архивной позиции несколько резервов или записей обмена. Требуется ручная проверка.')
   byId.set(Number(r.id),r)
 }
 if(byId.size!==input.items.length)conflict('Архивная позиция или её журнал удаления не найдены. Проверьте историю.')
 const prepared=input.items.map(item=>{
   const line=byId.get(item.orderItemId)!
   if(line.brand_id!==brandId||line.stock_writeoff_status!=='catalog_retired'||
      !['warehouse','boutique'].includes(line.source_type)||line.retirement_count!==1||
      !line.retirement_id||line.reservation_status!=='released'||
      line.reservation_quantity!==line.quantity||
      Number(line.open_returns)!==0||Number(line.open_old_exchanges)!==0||
      Number(line.shipped)!==0)
     conflict('Состояние архивных часов, резерва или связанных операций изменилось. Проверьте заказ.')
   if(item.quantity>line.quantity)conflict('Нельзя отправить больше архивных часов, чем осталось в заказе.')
   if(line.engraving_text?.trim()&&line.ready_text!==line.engraving_text)
     conflict('Гравировка этих часов ещё не подтверждена.')
   if(line.replacement_id&&(
      item.quantity!==line.quantity||
      line.replacement_quantity!==line.quantity))
     conflict('Архивную замену по обмену можно отправить только всей позицией.')
   return {...item,line}
 })
 if(String(order.shipping_status)==='sent'&&prepared.some(x=>!x.line.replacement_id))
   conflict('Ранее завершённый заказ нельзя повторно отправить.')
 const stamp=new Date().toISOString(),date=cleanText(input.dispatchDate)||stamp.slice(0,10)
 const statements:D1PreparedStatement[]=[
   db.prepare(`INSERT INTO order_dispatches(order_id,request_id,dispatch_date,created_at,actor,status)
     VALUES(?,?,?,?,?,'sent')`).bind(orderId,requestId,date,stamp,cleanText(input.actor)),
 ]
 for(const item of prepared){
   const {line}=item
   const remaining=line.quantity-item.quantity
   const splitKey=`retired-dispatch-rem:${requestId}:${line.id}`
   // The Main retirement journal and one released reservation establish
   // eligibility; recheck at WRITE time to prevent a race with correction.
   statements.push(db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
     SELECT 'human_inventory_v2','__retired_dispatch_conflict__',?
     WHERE NOT EXISTS (
       SELECT 1 FROM order_items oi
       JOIN orders o ON o.id=oi.order_id
       JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
       JOIN watch_variants wv ON wv.id=wi.watch_variant_id AND wv.catalog_variant_id=oi.variant_id
       JOIN watch_products wp ON wp.id=wv.watch_product_id AND wp.brand_id=?
       JOIN catalog_variants cv ON cv.id=oi.variant_id AND cv.is_active=0
       JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id AND sp.is_active=0
       JOIN catalog_products cp ON cp.id=cv.product_id AND cp.is_active=0
       JOIN catalog_retirement_variants rv ON rv.variant_id=cv.id
       JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
         AND op.status='completed' AND op.entity_type='product' AND op.product_id=cp.id
       JOIN inventory_reservations ir ON ir.order_item_id=oi.id AND ir.id=?
         AND ir.status='released' AND ir.quantity=?
       WHERE oi.id=? AND oi.order_id=? AND oi.variant_id=? AND oi.quantity=?
         AND oi.stock_writeoff_status='catalog_retired'
         AND o.order_status='active' AND COALESCE(o.archived_at,'')=''
         AND NOT EXISTS (SELECT 1 FROM inventory_reservations more
            WHERE more.order_item_id=oi.id AND more.status IN ('active','unresolved','fulfilled'))
         AND NOT EXISTS (SELECT 1 FROM order_dispatch_items di
            WHERE di.order_item_id=oi.id AND di.quantity>COALESCE(di.cancelled_quantity,0))
         AND NOT EXISTS (SELECT 1 FROM return_items ri JOIN returns rt ON rt.id=ri.return_id
            WHERE ri.order_item_id=oi.id AND COALESCE(rt.status,'completed')<>'cancelled')
       LIMIT 1
     )`).bind(stamp,brandId,line.reservation_id,line.quantity,line.id,orderId,
       line.variant_id,line.quantity))
   if(remaining){
     statements.push(
       db.prepare(`INSERT INTO order_items(
         order_id,product_id,variant_id,product_name_snapshot,audience_type,gender_snapshot,
         color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,
         catalog_price_snapshot,is_workshop,source_type,workshop_comment,workshop_urgent,
         workshop_due_date,workshop_due_time,stock_writeoff_status,created_at,
         inventory_obligation_key,inventory_obligation_origin_at
       ) SELECT order_id,product_id,variant_id,product_name_snapshot,audience_type,gender_snapshot,
         color_snapshot,material_snapshot,length_snapshot,size_snapshot,?,unit_price,
         unit_price*?,catalog_price_snapshot,is_workshop,source_type,workshop_comment,workshop_urgent,
         workshop_due_date,workshop_due_time,'catalog_retired',?,
         ?,inventory_obligation_origin_at
         FROM order_items WHERE id=? AND order_id=? AND quantity=? AND stock_writeoff_status='catalog_retired'`)
         .bind(remaining,remaining,stamp,splitKey,line.id,orderId,line.quantity),
       db.prepare(`INSERT INTO watch_order_item_details(order_item_id,watch_variant_id,engraving_text,created_at)
         SELECT oi.id,wi.watch_variant_id,wi.engraving_text,?
         FROM order_items oi JOIN watch_order_item_details wi ON wi.order_item_id=?
         WHERE oi.order_id=? AND oi.inventory_obligation_key=?`)
         .bind(stamp,line.id,orderId,splitKey),
       db.prepare(`INSERT INTO watch_engraving_item_readiness
         (order_item_id,engraving_text,ready_at,ready_by_user_id,request_id)
         SELECT oi.id,r.engraving_text,r.ready_at,r.ready_by_user_id,
           'watch-retired-split:'||oi.id
         FROM order_items oi JOIN watch_engraving_item_readiness r ON r.order_item_id=?
         WHERE oi.order_id=? AND oi.inventory_obligation_key=?`)
         .bind(line.id,orderId,splitKey),
       db.prepare(`INSERT INTO inventory_reservations(
         order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,
         reference_type,reference_id,unresolved_reason,released_at,created_at,updated_at)
         SELECT ir.order_id,oi.id,ir.inventory_source,ir.product_id,ir.variant_id,?,
           'released',ir.reference_type,ir.reference_id,ir.unresolved_reason,ir.released_at,ir.created_at,?
         FROM inventory_reservations ir
         JOIN order_items oi ON oi.order_id=ir.order_id AND oi.inventory_obligation_key=?
         WHERE ir.id=? AND ir.status='released' AND ir.quantity=?`)
         .bind(remaining,stamp,splitKey,line.reservation_id,line.quantity),
       db.prepare(`UPDATE inventory_reservations SET quantity=?,updated_at=?
         WHERE id=? AND status='released' AND quantity=?`)
         .bind(item.quantity,stamp,line.reservation_id,line.quantity),
       db.prepare(`UPDATE order_items SET quantity=?,line_total=unit_price*?
         WHERE id=? AND order_id=? AND quantity=? AND stock_writeoff_status='catalog_retired'`)
         .bind(item.quantity,item.quantity,line.id,orderId,line.quantity),
     )
   }
   statements.push(
     db.prepare(`INSERT OR IGNORE INTO retired_order_item_issues(
       order_item_id,order_id,retired_variant_id,quantity,confirmed_by,confirmed_at)
       VALUES(?,?,?,?,?,?)`).bind(line.id,orderId,line.variant_id,item.quantity,
         cleanText(input.actor),stamp),
     db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
       SELECT 'human_inventory_v2','__retired_journal_conflict__',?
       WHERE NOT EXISTS(SELECT 1 FROM retired_order_item_issues
         WHERE order_item_id=? AND order_id=? AND retired_variant_id=? AND quantity=?)`)
       .bind(stamp,line.id,orderId,line.variant_id,item.quantity),
     db.prepare(`UPDATE order_items SET stock_writeoff_status='retired_physically_issued',
       stock_quantity_before=NULL,stock_quantity_after=NULL
       WHERE id=? AND order_id=? AND quantity=? AND stock_writeoff_status='catalog_retired'`)
       .bind(line.id,orderId,item.quantity),
     db.prepare(`INSERT INTO order_dispatch_items
       (dispatch_id,order_item_id,source_type,variant_id,quantity,created_at)
       SELECT d.id,oi.id,oi.source_type,oi.variant_id,oi.quantity,?
       FROM order_dispatches d JOIN order_items oi ON oi.id=?
       WHERE d.request_id=? AND d.order_id=? AND oi.quantity=?
         AND oi.stock_writeoff_status='retired_physically_issued'`)
       .bind(stamp,line.id,requestId,orderId,item.quantity),
   )
   if(line.replacement_event_id){
     statements.push(db.prepare(`UPDATE inventory_lifecycle_events
       SET status='applied',pending_reason=NULL,applied_at=?,updated_at=?,
         movement_id=NULL,resolution_comment=?
       WHERE id=? AND order_id=? AND order_item_id=? AND status='pending'
         AND pending_reason='awaiting_dispatch' AND quantity=?`)
       .bind(stamp,stamp,'Архивные часы переданы клиенту без повторного складского списания',
         line.replacement_event_id,orderId,line.id,item.quantity))
   }
 }
 // Assert every concrete dispatched line AND remaining split record before
 // committing the atomic D1 batch. Zero-row INSERT...SELECT is not success.
 for(const picked of prepared){
   const remaining=picked.line.quantity-picked.quantity
   const splitKey='retired-dispatch-rem:'+requestId+':'+picked.line.id
   statements.push(db.prepare(`
     INSERT INTO inventory_model_meta(key,value,updated_at)
     SELECT 'human_inventory_v2','__retired_postcondition_conflict__',?
     WHERE NOT EXISTS(
       SELECT 1 FROM order_dispatch_items di
       JOIN order_dispatches d ON d.id=di.dispatch_id
       JOIN order_items oi ON oi.id=di.order_item_id
       JOIN retired_order_item_issues j ON j.order_item_id=oi.id
       WHERE d.request_id=? AND d.order_id=? AND oi.id=?
         AND di.quantity=? AND oi.quantity=?
         AND oi.stock_writeoff_status='retired_physically_issued'
         AND di.movement_id IS NULL AND di.reservation_id IS NULL
         AND j.quantity=di.quantity AND j.retired_variant_id=oi.variant_id
     ) OR (? > 0 AND NOT EXISTS(
       SELECT 1 FROM order_items oi
       JOIN watch_order_item_details wi ON wi.order_item_id=oi.id
       JOIN inventory_reservations ir ON ir.order_item_id=oi.id
       WHERE oi.order_id=? AND oi.inventory_obligation_key=?
         AND oi.quantity=? AND oi.line_total=oi.unit_price*oi.quantity
         AND oi.stock_writeoff_status='catalog_retired'
         AND wi.watch_variant_id=? AND ir.status='released' AND ir.quantity=?
     ))
   `).bind(stamp,requestId,orderId,picked.line.id,picked.quantity,picked.quantity,
     remaining,orderId,splitKey,remaining,picked.line.watch_variant_id,remaining))
 }
 statements.push(db.prepare(retiredWatchShippingProjectionSql).bind(date,stamp,orderId))
 try{
   await db.batch(statements)
 }catch(error){
   const found=await db.prepare('SELECT id,order_id FROM order_dispatches WHERE request_id=?')
     .bind(requestId).first<{id:number;order_id:number}>()
   if(found?.order_id===orderId){
     const saved=await db.prepare('SELECT order_item_id,quantity FROM order_dispatch_items WHERE dispatch_id=?')
       .bind(found.id).all<{order_item_id:number;quantity:number}>()
     const a=(saved.results||[]).map(x=>x.order_item_id+':'+x.quantity).sort()
     const b=input.items.map(x=>x.orderItemId+':'+x.quantity).sort()
     if(JSON.stringify(a)===JSON.stringify(b))
       return {ok:true,alreadyCommitted:true,dispatchId:found.id,retiredWithoutStockChange:true}
   }
   const msg=cleanText(error instanceof Error?error.message:error)
   if(/unique constraint failed|__retired_.*conflict__/i.test(msg))
     conflict('Архивная позиция изменилась одновременно с отправкой. Обновите логистику.')
   throw error
 }
 const saved=await db.prepare('SELECT id FROM order_dispatches WHERE request_id=?')
   .bind(requestId).first<{id:number}>()
 if(!saved?.id)throw new CriticalOperationConflictError('Журнал отправки не подтверждён.')
 return {ok:true,dispatchId:saved.id,retiredWithoutStockChange:true,
   shippedQuantity:input.items.reduce((n,i)=>n+i.quantity,0)}
}
