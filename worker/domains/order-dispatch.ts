import { cleanText, normalizeSourceType, toInt } from '../core/text.ts'
import { getOrder } from './orders-write.ts'
import { buildOrderShipmentPlan } from './order-shipment-plan.ts'
import { CriticalOperationConflictError } from './critical.ts'
import { activeStocktakeSessionForHandover, getOrderStockHandoverState } from './order-reservations.ts'

type Selection = { orderItemId: number; quantity: number }
type StockKey = { source: 'warehouse' | 'boutique'; variantId: number; quantity: number; stockId: number; before: number; reservedBefore: number; productId: number; productName: string; gender: string | null; color: string | null; material: string | null; length: string | null; size: string | null }

const fail = (message: string): never => { throw new CriticalOperationConflictError(message) }

/**
 * Ships selected lines or a subset of a reserved STOCK line. When Q > shipped,
 * splits its business row and its unique reservation atomically: the original
 * row becomes the fully shipped Q_sent row, and a new row/reservation preserves
 * Q_remaining. Existing Return/Exchange consumers therefore still see complete
 * per-row physical truth instead of an ambiguous partially-fulfilled flag.
 * Workshop rows remain whole-quantity until workshop task splitting is safe.
 */
export async function dispatchSelectedCompleteOrderLines(
  db: D1Database,
  orderId: number,
  input: { requestId: string; items: Selection[]; actor: string; dispatchDate: string },
) {
  const requestId = cleanText(input.requestId)
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,119}$/.test(requestId)) fail('Повторите отправку после обновления заказа.')
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 40) fail('Выберите товары для отправки.')
  if (input.items.some(row=>!Number.isSafeInteger(row.orderItemId)||row.orderItemId<=0||!Number.isSafeInteger(row.quantity)||row.quantity<=0)) fail('Укажите корректное количество.')
  const uniqueIds = new Set(input.items.map(x=>x.orderItemId))
  if (uniqueIds.size !== input.items.length) fail('Одна позиция выбрана несколько раз.')
  const replay = await db.prepare('SELECT id,order_id FROM order_dispatches WHERE request_id=? LIMIT 1').bind(requestId).first<{id:number;order_id:number}>()
  const identicalReplay = async (dispatchId: number) => {
    const rows = await db.prepare(
      'SELECT order_item_id,quantity FROM order_dispatch_items WHERE dispatch_id=? ORDER BY order_item_id'
    ).bind(dispatchId).all<{order_item_id:number;quantity:number}>()
    const prior = (rows.results||[]).map(x=>`${x.order_item_id}:${x.quantity}`).sort()
    const requested = input.items.map(x=>`${x.orderItemId}:${x.quantity}`).sort()
    if (prior.length !== requested.length || prior.some((x,i)=>x!==requested[i])) {
      fail('Эта отправка уже сохранена с другим набором товаров. Обновите заказ.')
    }
  }
  if (replay?.id) {
    if (replay.order_id !== orderId) fail('Повторный запрос относится к другому заказу.')
    await identicalReplay(replay.id)
    return {ok:true,alreadyCommitted:true,dispatchId:replay.id}
  }
  const order = await getOrder(db,orderId)
  if (!order) throw new CriticalOperationConflictError('Заказ не найден.')
  if (['archived','deleted'].includes(cleanText(order.order_status)) || order.archived_at) fail('Заказ закрыт. Обновите список.')
  const reserved = await db.prepare(
    'SELECT id,order_item_id,quantity,status,inventory_source,variant_id FROM inventory_reservations WHERE order_id=? ORDER BY id'
  ).bind(orderId).all<Record<string,unknown>>()
  const plan = buildOrderShipmentPlan(order as any,(reserved.results||[]) as any)
  const byId = new Map(plan.lines.map(row=>[row.orderItemId,row]))
  const selected = input.items.map(row=>{
    const found=byId.get(row.orderItemId)
    if (!found || !found.selectable) throw new CriticalOperationConflictError('Товар изменился или ещё не готов. Обновите заказ.')
    if (row.quantity > found.readyQuantity || row.quantity > found.quantity ||
        (found.sourceType === 'workshop' && row.quantity !== found.quantity)) {
      fail('Укажите количество не больше доступного. Товар из цеха пока отправляется всей готовой позицией.')
    }
    return { ...found, originalQuantity: found.quantity, quantity: row.quantity }
  })
  const selectedStock=selected.filter(x=>x.sourceType!=='workshop')
  const selectedWorkshop=selected.filter(x=>x.sourceType==='workshop')
  const selectedReplacements = selectedStock.filter(x=>toInt(x.exchangeEventId,0)>0)
  // A legacy 'sent' order can acquire a NEW unshipped exchange line.
  // Never reissue an original product merely because this button is open.
  if (cleanText(order.shipping_status)==='sent'
      && selected.some(x=>toInt(x.exchangeEventId,0)<=0)) {
    fail('Ранее отправленные товары нельзя выдать снова. Выберите только новые замены.')
  }
  const replacementByItem = new Map<number,{eventId:number;exchangeId:number}>()
  for (const item of selectedReplacements) {
    if (item.quantity!==item.originalQuantity) {
      fail('Новую замену пока можно отправить только всей позицией.')
    }
    const eventId=toInt(item.exchangeEventId,0)
    const event=await db.prepare(
      `SELECT le.id,le.order_id,le.order_item_id,le.operation_id,le.quantity,
              le.variant_id,le.product_id,le.inventory_source,le.status,le.pending_reason,
              e.status AS exchange_status,oi.stock_writeoff_status,oi.quantity AS item_quantity
       FROM inventory_lifecycle_events le
       JOIN exchanges e ON e.id=le.operation_id AND e.order_id=le.order_id
         AND e.new_order_item_id=le.order_item_id
       JOIN order_items oi ON oi.id=le.order_item_id AND oi.order_id=le.order_id
       WHERE le.id=? AND le.order_id=?
         AND le.operation_type='exchange' AND le.event_type='exchange_new_out'`
    ).bind(eventId,orderId).first<Record<string,unknown>>()
    if (!event) throw new CriticalOperationConflictError('Позиция обмена больше не существует. Обновите заказ.')
    if (cleanText(event.status)!=='pending'
      || cleanText(event.pending_reason)!=='awaiting_dispatch'
      || cleanText(event.exchange_status)==='cancelled'
      || toInt(event.order_item_id,0)!==item.orderItemId
      || toInt(event.quantity,0)!==item.quantity
      || toInt(event.item_quantity,0)!==item.quantity
      || toInt(event.product_id,0)<=0 || toInt(event.variant_id,0)!==item.variantId
      || normalizeSourceType(event.inventory_source)!==item.sourceType
      || cleanText(event.stock_writeoff_status)!=='reserved') {
      fail('Позиция обмена изменилась. Обновите заказ и проверьте замену.')
    }
    replacementByItem.set(item.orderItemId,{eventId,exchangeId:toInt(event.operation_id,0)})
  }
  const reservations = (reserved.results||[]).filter(row=>selectedStock.some(x=>x.orderItemId===toInt(row.order_item_id,0)))
  if (reservations.length!==selectedStock.length || reservations.some(x=>cleanText(x.status)!=='active')) fail('Резерв товара изменился. Обновите заказ.')
  const perItemReservation = new Map(reservations.map(r=>[toInt(r.order_item_id,0),r]))
  for (const item of selectedStock) {
    const r=perItemReservation.get(item.orderItemId)
    if (!r || toInt(r.quantity,0)!==item.originalQuantity || toInt(r.variant_id,0)!==item.variantId || normalizeSourceType(r.inventory_source)!==item.sourceType) {
      fail('Резерв, склад или характеристики вещи изменились. Обновите заказ.')
    }
  }

  // Physical Returns always belong to specific old lines. Other returned
  // items cannot block this dispatch. A Return for the SAME selected item
  // would contradict its still-active reservation and must not issue stock.
  if (selectedStock.length) {
    const existingReturns = await db.prepare(
      `SELECT DISTINCT ri.order_item_id FROM return_items ri
       JOIN returns r ON r.id=ri.return_id
       WHERE r.order_id=? AND COALESCE(r.status,'completed')<>'cancelled'
         AND ri.quantity>0
         AND NOT EXISTS(SELECT 1 FROM exchanges e WHERE e.refund_return_id=r.id AND COALESCE(e.status,'completed')<>'cancelled')`
    ).bind(orderId).all<{order_item_id:number}>()
    const alreadyReturned=new Set((existingReturns.results||[]).map(x=>x.order_item_id))
    if (selectedStock.some(x=>alreadyReturned.has(x.orderItemId))) fail('Этот товар уже возвращали. Сначала уточните именно эту позицию.')
  }

  // Reuse the SAME reviewed checkpoint truth as the existing issue action.
  // A later stocktake with a recorded answer is not a blanket prohibition.
  const handover=await getOrderStockHandoverState(db,orderId)
  if (handover?.items.some(row=>selectedStock.some(item=>item.orderItemId===row.orderItemId) && row.reviewNeeded)) {
    fail('Уточните выдачу выбранного товара после последней проверки склада.')
  }

  for (const source of new Set(selectedStock.map(x=>x.sourceType))) {
    const open=await activeStocktakeSessionForHandover(db,source as 'warehouse'|'boutique')
    if(open)fail('Сейчас на этой точке идёт ревизия. Отправку выбранной вещи сохраните после окончания пересчёта.')
  }

  const groups = new Map<string,StockKey>()
  for(const item of selectedStock) {
    const key=`${item.sourceType}:${toInt(item.variantId,0)}`
    const previous=groups.get(key)
    groups.set(key,{
      source:item.sourceType as 'warehouse'|'boutique',variantId:toInt(item.variantId,0),
      quantity:(previous?.quantity||0)+item.quantity,
      stockId:0,before:0,reservedBefore:0,productId:0,productName:'',
      gender:null,color:null,material:null,length:null,size:null,
    })
  }
  for(const group of groups.values()) {
    const stock=await db.prepare(
      `SELECT s.id,s.quantity,s.reserved_quantity,v.product_id,p.name AS product_name,
              v.gender,v.color,v.material,v.length,v.size_label AS size,
              v.is_active AS variant_active,p.is_active AS product_active
       FROM inventory_stock s
       JOIN catalog_variants v ON v.id=s.variant_id
       JOIN catalog_products p ON p.id=v.product_id
       WHERE s.inventory_source=? AND s.variant_id=? LIMIT 1`
    ).bind(group.source,group.variantId).first<Record<string,unknown>>()
    if (!stock?.id || toInt(stock.variant_active,0)!==1 || toInt(stock.product_active,0)!==1) throw new CriticalOperationConflictError('Товар изменён в каталоге. Обновите заказ.')
    group.stockId=toInt(stock.id,0);group.before=toInt(stock.quantity,0);group.reservedBefore=toInt(stock.reserved_quantity,0)
    group.productId=toInt(stock.product_id,0);group.productName=cleanText(stock.product_name)
    group.gender=cleanText(stock.gender)||null;group.color=cleanText(stock.color)||null
    group.material=cleanText(stock.material)||null;group.length=cleanText(stock.length)||null;group.size=cleanText(stock.size)||null
    if(group.before<group.quantity || group.reservedBefore<group.quantity) fail(`Не хватает товара «${group.productName}». Проверьте остаток перед отправкой.`)
  }

  // Commit in one D1 transaction. A competing worker must make a required
  // predicate fail and trigger the deliberate unique-key rollback below.
  const stamp=new Date().toISOString()
  const date=cleanText(input.dispatchDate)||stamp.slice(0,10)
  const statements:D1PreparedStatement[]=[
    db.prepare(`INSERT INTO order_dispatches(order_id,request_id,dispatch_date,created_at,actor,status)
       VALUES(?,?,?,?,?,'sent')`).bind(orderId,requestId,date,stamp,cleanText(input.actor)),
  ]
  for(const item of selectedStock) {
    const r=perItemReservation.get(item.orderItemId)!
    statements.push(db.prepare(
      `INSERT INTO inventory_model_meta(key,value,updated_at)
       SELECT 'human_inventory_v2','__selected_dispatch_conflict__',?
       WHERE NOT EXISTS (
         SELECT 1 FROM inventory_reservations r JOIN order_items oi ON oi.id=r.order_item_id
         JOIN orders o ON o.id=r.order_id
         WHERE r.id=? AND r.order_id=? AND r.order_item_id=? AND r.status='active'
           AND r.quantity=? AND r.variant_id=? AND r.inventory_source=?
           AND oi.quantity=? AND oi.stock_writeoff_status='reserved'
           AND (o.shipping_status<>'sent' OR EXISTS(
             SELECT 1 FROM inventory_lifecycle_events le
             JOIN exchanges e ON e.id=le.operation_id AND e.new_order_item_id=oi.id
             WHERE le.id=? AND le.order_id=o.id AND le.order_item_id=oi.id
               AND le.operation_type='exchange' AND le.event_type='exchange_new_out'
               AND le.status='pending' AND le.pending_reason='awaiting_dispatch'
               AND COALESCE(e.status,'completed')<>'cancelled'
           ))
           AND o.order_status NOT IN ('archived','deleted')
           AND COALESCE(o.archived_at,'')=''
       )`
    ).bind(stamp,toInt(r.id,0),orderId,item.orderItemId,item.originalQuantity,item.variantId,item.sourceType,item.originalQuantity,toInt(item.exchangeEventId,0)))
  }
  for(const item of selectedWorkshop) {
    statements.push(db.prepare(
      `INSERT INTO inventory_model_meta(key,value,updated_at)
       SELECT 'human_inventory_v2','__workshop_dispatch_conflict__',?
       WHERE NOT EXISTS(
         SELECT 1 FROM order_items oi
         JOIN workshop_tasks t ON t.order_id=oi.order_id AND t.order_item_id=oi.id
         WHERE oi.order_id=? AND oi.id=? AND oi.quantity=? AND oi.is_workshop=1
           AND t.status IN ('ready','done')
           AND NOT EXISTS (SELECT 1 FROM order_dispatch_items di WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity)
       )`
    ).bind(stamp,orderId,item.orderItemId,item.quantity))
  }
  // Split each selected stock row BEFORE fulfilling it. The original item ID
  // remains the issued item; a newly minted item ID owns the remaining hold.
  // Both rows have unambiguous full-line status for legacy Return/Exchange UI.
  for (const item of selectedStock) {
    const remaining = item.originalQuantity - item.quantity
    if (remaining <= 0) continue
    const r = perItemReservation.get(item.orderItemId)!
    const splitKey = `dispatch-rem:${requestId}:${item.orderItemId}`
    const splitItemSql = `(SELECT id FROM order_items
       WHERE order_id=? AND inventory_obligation_key=? ORDER BY id DESC LIMIT 1)`
    statements.push(
      db.prepare(`INSERT INTO order_items (
        order_id,product_id,variant_id,product_name_snapshot,audience_type,gender_snapshot,
        color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity,unit_price,line_total,
        catalog_price_snapshot,is_workshop,source_type,workshop_comment,workshop_urgent,
        workshop_due_date,workshop_due_time,stock_writeoff_status,created_at,
        inventory_obligation_key,inventory_obligation_origin_at
      ) SELECT order_id,product_id,variant_id,product_name_snapshot,audience_type,gender_snapshot,
        color_snapshot,material_snapshot,length_snapshot,size_snapshot,?,unit_price,
        line_total - CAST(line_total * ? / quantity AS INTEGER),
        catalog_price_snapshot,0,source_type,workshop_comment,workshop_urgent,
        workshop_due_date,workshop_due_time,'reserved',?,
        ?,inventory_obligation_origin_at
        FROM order_items WHERE id=? AND order_id=? AND quantity=? AND stock_writeoff_status='reserved'`
      ).bind(remaining,item.quantity,stamp,splitKey,item.orderItemId,orderId,item.originalQuantity),
      db.prepare(`INSERT INTO inventory_reservations(
        order_id,order_item_id,inventory_source,product_id,variant_id,quantity,status,
        reference_type,reference_id,unresolved_reason,created_at,updated_at)
        SELECT r.order_id,${splitItemSql},r.inventory_source,r.product_id,r.variant_id,?,
               'active',r.reference_type,r.reference_id,NULL,?,?
        FROM inventory_reservations r WHERE r.id=? AND r.status='active' AND r.quantity=?`
      ).bind(orderId,splitKey,remaining,stamp,stamp,toInt(r.id,0),item.originalQuantity),
      db.prepare(`UPDATE order_items
        SET quantity=?,line_total=CAST(line_total * ? / quantity AS INTEGER)
        WHERE id=? AND quantity=? AND stock_writeoff_status='reserved'`
      ).bind(item.quantity,item.quantity,item.orderItemId,item.originalQuantity),
    )
  }
  for(const g of groups.values()){
    statements.push(
      db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
          SELECT 'human_inventory_v2','__dispatch_stock_changed__',?
          WHERE NOT EXISTS(
            SELECT 1 FROM inventory_stock WHERE id=? AND inventory_source=? AND variant_id=? AND quantity=? AND reserved_quantity=?
          )`).bind(stamp,g.stockId,g.source,g.variantId,g.before,g.reservedBefore),
      db.prepare(`UPDATE inventory_stock SET quantity=quantity-?,reserved_quantity=reserved_quantity-?,
        last_action='Отправка товаров',last_source_ref=?,updated_at=?
        WHERE id=? AND quantity=? AND reserved_quantity=?`
      ).bind(g.quantity,g.quantity,`dispatch:${requestId}`,stamp,g.stockId,g.before,g.reservedBefore),
    )
  }
  const running=new Map(Array.from(groups.entries()).map(([k,g])=>[k,g.before]))
  for(const item of selected){
    const dispatchIdSql='(SELECT id FROM order_dispatches WHERE request_id=?)'
    if(item.sourceType==='workshop'){
      statements.push(db.prepare(
        `INSERT INTO order_dispatch_items(dispatch_id,order_item_id,source_type,variant_id,quantity,created_at)
         VALUES(${dispatchIdSql},?,'workshop',?,?,?)`
      ).bind(requestId,item.orderItemId,item.variantId||null,item.quantity,stamp))
      continue
    }
    const r=perItemReservation.get(item.orderItemId)!
    const group=groups.get(`${item.sourceType}:${toInt(item.variantId,0)}`)!
    const key=`${item.sourceType}:${item.variantId}`
    const next=(running.get(key)||0)-item.quantity
    running.set(key,next)
    const ref=`dispatch:${requestId}:item:${item.orderItemId}`
    statements.push(
      db.prepare(
        `INSERT INTO inventory_movements(
          inventory_source,movement_type,product_id,variant_id,product_name_snapshot,gender_snapshot,
          color_snapshot,material_snapshot,length_snapshot,size_snapshot,quantity_delta,quantity_after,
          reference_type,reference_id,comment,created_at
        ) VALUES(?,'sale',?,?,?,?,?,?,?,?,?,?,'order_dispatch',?,?,?)`
      ).bind(group.source,group.productId,group.variantId,group.productName,group.gender,group.color,
        group.material,group.length,group.size,-item.quantity,next,ref,`Отправлен заказ ${order.external_id}`,stamp),
      db.prepare(`UPDATE inventory_reservations SET quantity=?,status='fulfilled',fulfilled_at=?,updated_at=?
         WHERE id=? AND status='active' AND quantity=?`
      ).bind(item.quantity,stamp,stamp,toInt(r.id,0),item.originalQuantity),
      db.prepare(`UPDATE order_items SET stock_writeoff_status='fulfilled',stock_quantity_before=?,stock_quantity_after=?
         WHERE id=? AND stock_writeoff_status='reserved'`
      ).bind(next+item.quantity,next,item.orderItemId),
      db.prepare(
        `INSERT INTO order_dispatch_items(
          dispatch_id,order_item_id,source_type,variant_id,reservation_id,movement_id,quantity,created_at
        ) VALUES(${dispatchIdSql},?,?,?,?,(
          SELECT id FROM inventory_movements WHERE reference_type='order_dispatch' AND reference_id=? ORDER BY id DESC LIMIT 1
        ),?,?)`
      ).bind(requestId,item.orderItemId,item.sourceType,item.variantId,toInt(r.id,0),ref,item.quantity,stamp),
    )
    const replacement = replacementByItem.get(item.orderItemId)
    if(replacement) {
      // Same D1 transaction: the exchange lifecycle and shipment ledger
      // must NEVER disagree about whether the replacement left the premises.
      statements.push(
        db.prepare(`INSERT INTO inventory_model_meta(key,value,updated_at)
          SELECT 'human_inventory_v2','__exchange_dispatch_state_conflict__',?
          WHERE NOT EXISTS(
            SELECT 1 FROM inventory_lifecycle_events le JOIN exchanges e ON e.id=le.operation_id
            WHERE le.id=? AND le.order_id=? AND le.order_item_id=?
              AND le.operation_id=? AND le.status='pending' AND le.pending_reason='awaiting_dispatch'
              AND le.variant_id=? AND le.quantity=? AND COALESCE(e.status,'completed')<>'cancelled'
          )`).bind(stamp,replacement.eventId,orderId,item.orderItemId,replacement.exchangeId,item.variantId,item.quantity),
        db.prepare(`UPDATE inventory_lifecycle_events
          SET status='applied',pending_reason=NULL,applied_at=?,updated_at=?,
              movement_id=(SELECT id FROM inventory_movements WHERE reference_type='order_dispatch'
                AND reference_id=? ORDER BY id DESC LIMIT 1),
              resolution_comment=?
          WHERE id=? AND order_id=? AND order_item_id=?
            AND status='pending' AND pending_reason='awaiting_dispatch'`)
          .bind(stamp,stamp,ref,'Отправлено в общей выдаче заказа',replacement.eventId,orderId,item.orderItemId),
      )
    }
  }
  // The legacy boolean is a compatibility projection. A partial shipment may
  // never mark the entire order sent.
  statements.push(db.prepare(
    `UPDATE orders SET
       shipping_status=CASE WHEN NOT EXISTS(
         SELECT 1 FROM order_items oi
         WHERE oi.order_id=orders.id AND oi.quantity>0
           AND ((COALESCE(oi.is_workshop,0)=0
                 AND COALESCE(oi.stock_writeoff_status,'') NOT IN ('fulfilled','exchanged','cancelled','returned'))
             OR (COALESCE(oi.is_workshop,0)=1
                 AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di
                   JOIN order_dispatches d ON d.id=di.dispatch_id
                   WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity)))
       ) THEN 'sent' ELSE 'not_sent' END,
       shipping_date=CASE WHEN NOT EXISTS(
         SELECT 1 FROM order_items oi
         WHERE oi.order_id=orders.id AND oi.quantity>0
           AND ((COALESCE(oi.is_workshop,0)=0 AND COALESCE(oi.stock_writeoff_status,'') NOT IN ('fulfilled','exchanged','cancelled','returned'))
                OR (COALESCE(oi.is_workshop,0)=1 AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di WHERE di.order_item_id=oi.id AND di.cancelled_quantity<di.quantity)))
       ) THEN ? ELSE NULL END,
       updated_at=? WHERE id=? AND COALESCE(shipping_status,'not_sent')<>'sent'`
  ).bind(date,stamp,orderId))
  try{
    const result=await db.batch(statements)
    const first=result[0]
    if(toInt(first?.meta?.changes,0)!==1)fail('Отправка уже выполняется. Обновите заказ.')
  }catch(error){
    const msg=cleanText(error instanceof Error?error.message:error)
    if(/unique constraint failed/i.test(msg)){
      const recorded=await db.prepare('SELECT id,order_id FROM order_dispatches WHERE request_id=?').bind(requestId).first<{id:number;order_id:number}>()
      if(recorded?.id && recorded.order_id===orderId) {
        await identicalReplay(recorded.id)
        return {ok:true,alreadyCommitted:true,dispatchId:recorded.id}
      }
      fail('Заказ или остаток изменился одновременно с отправкой. Обновите заказ.')
    }
    throw error
  }
  const saved=await db.prepare('SELECT id FROM order_dispatches WHERE request_id=?').bind(requestId).first<{id:number}>()
  return {ok:true,alreadyCommitted:false,dispatchId:saved?.id||null,shippedLines:selected.length,
    shippedQuantity:selected.reduce((n,x)=>n+x.quantity,0)}
}
