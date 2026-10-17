// Read-only verification of a very narrow, real-world order-delete inconsistency:
// A replacement Exchange item is STILL reserved / not handed to the customer,
// yet the Exchange already booked a physical outbound inventory movement.
// Cancelling it must reverse exactly the recorded outbound movement and release
// the active reservation. No implicit stocktake and no claim about actual
// human possession; all uncertain cases remain blocked.
import { cleanText, toInt } from '../core/text.ts'

export type UnissuedExchangeStockUndo = {
  eventId:number;exchangeId:number;orderItemId:number;name:string;
  source:string;variantId:number;quantity:number;
  recordedOutbound:number;physicalRestore:number;reserveRelease:number;
}
export type AdminDeleteAppliedStockReview = {
  allowed:boolean;appliedCount:number;
  reversals:UnissuedExchangeStockUndo[];blockers:string[];
}
const reason='Есть проведённое складское движение без доказанного безопасного сторно. Удаление остановлено; требуется проверка физической истории.'
const bad=(appliedCount:number,message=reason):AdminDeleteAppliedStockReview=>({
  allowed:false,appliedCount,reversals:[],blockers:[message],
})

export async function reviewAdminDeleteAppliedStock(
  db:D1Database,orderId:number,
):Promise<AdminDeleteAppliedStockReview>{
  const count=await db.prepare(
    "SELECT COUNT(*) AS n FROM inventory_lifecycle_events WHERE order_id=? AND status='applied'"
  ).bind(orderId).first<{n:number}>()
  const appliedCount=Math.max(0,toInt(count?.n,0))
  if(!appliedCount)return {allowed:true,appliedCount:0,reversals:[],blockers:[]}
  if(appliedCount>100)return bad(appliedCount,'Слишком много применённых складских движений для безопасной проверки.')

  let rows:Record<string,unknown>[]=[]
  try {
    const result=await db.prepare(
      \`SELECT le.id,le.order_item_id,le.operation_id,le.operation_type,le.event_type,
          le.direction,le.status,le.quantity,le.variant_id,le.inventory_source,
          le.movement_id,le.applied_at,le.created_at,
          ex.status AS exchange_status,
          ei.id AS exchange_item_id,ei.role AS exchange_item_role,
          ei.product_name_snapshot,ei.quantity AS exchange_item_quantity,
          ei.physical_tracking,ei.physical_received_at,
          oi.quantity AS current_item_quantity,oi.stock_writeoff_status,
          r.id AS reservation_id,r.status AS reservation_status,
          r.quantity AS reservation_quantity,r.variant_id AS reservation_variant_id,
          r.inventory_source AS reservation_source,r.fulfilled_at,
          m.quantity_delta AS movement_delta,
          m.variant_id AS movement_variant_id,m.inventory_source AS movement_source,
          (SELECT COUNT(*) FROM inventory_stock_checks ch
            WHERE ch.inventory_source=le.inventory_source AND ch.variant_id=le.variant_id
              AND datetime(ch.checked_at)>datetime(COALESCE(le.applied_at,le.created_at))
          ) AS later_physical_checks,
          (SELECT COUNT(*) FROM inventory_stocktake_sessions ss
            WHERE ss.inventory_source=le.inventory_source
              AND (ss.status='active'
                OR datetime(ss.started_at)>datetime(COALESCE(le.applied_at,le.created_at)))
          ) AS stocktake_conflicts,
          (SELECT COUNT(*) FROM catalog_variants v
             JOIN catalog_products cp ON cp.id=v.product_id
            WHERE v.id=le.variant_id AND v.is_active=1 AND cp.is_active=1
          ) AS live_variant,
          (SELECT st.quantity FROM inventory_stock st
            WHERE st.inventory_source=le.inventory_source AND st.variant_id=le.variant_id
            ORDER BY st.id LIMIT 1) AS current_physical,
          (SELECT st.reserved_quantity FROM inventory_stock st
            WHERE st.inventory_source=le.inventory_source AND st.variant_id=le.variant_id
            ORDER BY st.id LIMIT 1) AS current_reserved
        FROM inventory_lifecycle_events le
        LEFT JOIN exchanges ex ON ex.id=le.operation_id AND ex.order_id=le.order_id
        LEFT JOIN exchange_items ei ON ei.id=le.operation_item_id AND ei.exchange_id=ex.id
        LEFT JOIN order_items oi ON oi.id=le.order_item_id AND oi.order_id=le.order_id
        LEFT JOIN inventory_reservations r ON r.order_item_id=le.order_item_id
          AND r.order_id=le.order_id
        LEFT JOIN inventory_movements m ON m.id=le.movement_id
        WHERE le.order_id=? AND le.status='applied'
        ORDER BY le.id LIMIT 101\`
    ).bind(orderId).all<Record<string,unknown>>()
    rows=result.results||[]
  } catch {
    // Legacy or partial rows must never become an excuse for skipping physical checks.
    return bad(appliedCount,'Не удалось полностью сверить складскую историю обмена. Удаление остановлено.')
  }
  if(rows.length!==appliedCount)return bad(appliedCount,'Складские движения заказа не удалось однозначно сопоставить.')

  const reversals:UnissuedExchangeStockUndo[]=[]
  for(const x of rows){
    const eventId=toInt(x.id,0),exchangeId=toInt(x.operation_id,0),
      orderItemId=toInt(x.order_item_id,0),source=cleanText(x.inventory_source),
      variantId=toInt(x.variant_id,0),qty=toInt(x.quantity,0),
      delta=toInt(x.movement_delta,0),reserveQty=toInt(x.reservation_quantity,0)
    // EXACT case: V2 replacement is not handed over, a live matching reservation
    // still exists, and the original sale movement is traceable and reversible.
    // Other applied events (returns, inbound movements, fulfilled handovers,
    // different SKUs, stale revisions) intentionally remain forbidden.
    const valid=Boolean(
      eventId>0&&exchangeId>0&&orderItemId>0&&variantId>0&&qty>0
      &&cleanText(x.operation_type)==='exchange'
      &&cleanText(x.event_type)==='exchange_new_out'
      &&cleanText(x.direction)==='out'
      &&cleanText(x.exchange_status)==='completed'
      &&toInt(x.exchange_item_id,0)>0
      &&cleanText(x.exchange_item_role)==='new'
      &&toInt(x.exchange_item_quantity,0)===qty
      &&toInt(x.physical_tracking,1)===0
      &&!cleanText(x.physical_received_at)
      &&toInt(x.current_item_quantity,0)===qty
      &&cleanText(x.stock_writeoff_status)==='reserved'
      &&toInt(x.reservation_id,0)>0
      &&cleanText(x.reservation_status)==='active'
      &&!cleanText(x.fulfilled_at)
      &&toInt(x.reservation_variant_id,0)===variantId
      &&cleanText(x.reservation_source)===source
      &&reserveQty===qty
      &&toInt(x.movement_id,0)>0
      &&toInt(x.movement_variant_id,0)===variantId
      &&cleanText(x.movement_source)===source
      &&delta===-qty
      &&toInt(x.later_physical_checks,0)===0
      &&toInt(x.stocktake_conflicts,0)===0
      &&toInt(x.live_variant,0)===1
      &&x.current_physical!=null&&toInt(x.current_physical,-1)>=0
      &&x.current_reserved!=null&&toInt(x.current_reserved,-1)>=reserveQty
      &&Boolean(cleanText(x.applied_at)||cleanText(x.created_at))
    )
    if(!valid)return bad(appliedCount,
      'Складское событие #'+String(eventId)+' нельзя безопасно отменить: отсутствует доказательство невыданного резерва, надёжное списание или актуальная физическая история.')
    reversals.push({
      eventId,exchangeId,orderItemId,name:cleanText(x.product_name_snapshot)||'Товар обмена',
      source,variantId,quantity:qty,recordedOutbound:delta,
      physicalRestore:-delta,reserveRelease:reserveQty,
    })
  }
  return {allowed:true,appliedCount,reversals,blockers:[]}
}
