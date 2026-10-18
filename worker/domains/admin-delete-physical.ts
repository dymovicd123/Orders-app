// Read-only verification of a very narrow, real-world order-delete inconsistency:
// A replacement Exchange item is STILL reserved / not handed to the customer,
// yet the Exchange already booked a physical outbound inventory movement.
// Cancelling it must reverse exactly the recorded outbound movement and release
// the active reservation. No implicit stocktake and no claim about actual
// human possession; all uncertain cases remain blocked.
import { cleanText, toInt } from '../core/text.ts'

export type ExchangeMovementCompensation = {
  state:'none'|'compensated'|'ambiguous';movementId:number|null;
}
// A 2nd outward undo is WRONG when an explicit false-handover correction
// already restored the same unit. Require exact order+SKU+source+quantity and
// the ONLY subsequent movement for this SKU. Ordinary arrivals/revisions are
// never misidentified as compensation.
export async function findExchangeFalseHandoverCompensation(
  db:D1Database,input:{
    orderId:number;source:string;variantId:number;movementId:number;
    outboundQuantity:number;eventAt:string;
  },
):Promise<ExchangeMovementCompensation>{
  if(!input.orderId||!input.variantId||!input.movementId
    ||input.outboundQuantity<=0||!input.eventAt)
    return {state:'ambiguous',movementId:null}
  try{
    const found=await db.prepare(`SELECT m.id,m.movement_type,m.quantity_delta,
        m.quantity_after,m.reference_type,m.reference_id,m.created_at,
        o.external_id AS expected_order_ref
      FROM inventory_movements m
      JOIN orders o ON o.id=?
      WHERE m.inventory_source=? AND m.variant_id=? AND m.id>?
      ORDER BY m.id LIMIT 3`
    ).bind(input.orderId,input.source,input.variantId,input.movementId)
      .all<Record<string,unknown>>()
    const rows=found.results||[]
    if(!rows.length)return {state:'none',movementId:null}
    if(rows.length!==1)return {state:'ambiguous',movementId:null}
    const row=rows[0],at=Date.parse(cleanText(row.created_at)),
      prior=Date.parse(input.eventAt)
    if(cleanText(row.movement_type)!=='revision'
      ||cleanText(row.reference_type)!=='order_handover_correction'
      ||!cleanText(row.expected_order_ref)
      ||cleanText(row.reference_id)!==cleanText(row.expected_order_ref)
      ||toInt(row.quantity_delta,0)!==input.outboundQuantity
      ||!Number.isFinite(at)||!Number.isFinite(prior)||at<=prior)
      return {state:'ambiguous',movementId:null}
    const stock=await db.prepare(`SELECT quantity FROM inventory_stock
      WHERE inventory_source=? AND variant_id=? ORDER BY id LIMIT 1`
    ).bind(input.source,input.variantId).first<{quantity:number}>()
    if(!stock||toInt(stock.quantity,-1)!==toInt(row.quantity_after,-2))
      return {state:'ambiguous',movementId:null}
    return {state:'compensated',movementId:toInt(row.id,0)}
  }catch{
    return {state:'ambiguous',movementId:null}
  }
}

export type UnissuedExchangeStockUndo = {
  eventId:number;exchangeId:number;orderItemId:number;name:string;
  source:string;variantId:number;quantity:number;
  recordedOutbound:number;physicalRestore:number;reserveRelease:number;
  alreadyCompensated:boolean;correctionMovementId:number|null;
  bookkeepingFulfillmentOnly:boolean;
}
export type AdminDeleteAppliedStockReview = {
  allowed:boolean;appliedCount:number;
  bookkeepingFulfilledCount:number;
  reversals:UnissuedExchangeStockUndo[];blockers:string[];
}
const reason='Есть проведённое складское движение без доказанного безопасного сторно. Удаление остановлено; требуется проверка физической истории.'
const bad=(appliedCount:number,message=reason):AdminDeleteAppliedStockReview=>({
  allowed:false,appliedCount,bookkeepingFulfilledCount:0,reversals:[],blockers:[message],
})

export async function reviewAdminDeleteAppliedStock(
  db:D1Database,orderId:number,
):Promise<AdminDeleteAppliedStockReview>{
  const count=await db.prepare(
    "SELECT COUNT(*) AS n FROM inventory_lifecycle_events WHERE order_id=? AND status='applied'"
  ).bind(orderId).first<{n:number}>()
  const appliedCount=Math.max(0,toInt(count?.n,0))
  if(!appliedCount)return {allowed:true,appliedCount:0,bookkeepingFulfilledCount:0,reversals:[],blockers:[]}
  if(appliedCount>100)return bad(appliedCount,'Слишком много применённых складских движений для безопасной проверки.')

  let rows:Record<string,unknown>[]=[]
  try {
    const result=await db.prepare(
      `SELECT le.id,le.order_item_id,le.operation_id,le.operation_type,le.event_type,
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
          m.quantity_delta AS movement_delta,m.quantity_after AS movement_quantity_after,
          m.movement_type AS movement_type,m.reference_type AS movement_reference_type,
          m.reference_id AS movement_reference_id,
          (SELECT COUNT(*) FROM inventory_movements newer
            WHERE newer.inventory_source=le.inventory_source
              AND newer.variant_id=le.variant_id AND newer.id>le.movement_id
          ) AS later_movement_count,
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
        ORDER BY le.id LIMIT 101`
    ).bind(orderId).all<Record<string,unknown>>()
    rows=result.results||[]
  } catch {
    // Legacy or partial rows must never become an excuse for skipping physical checks.
    return bad(appliedCount,'Не удалось полностью сверить складскую историю обмена. Удаление остановлено.')
  }
  if(rows.length!==appliedCount)return bad(appliedCount,'Складские движения заказа не удалось однозначно сопоставить.')

  const reversals:UnissuedExchangeStockUndo[]=[]
  let bookkeepingFulfilledCount=0
  for(const x of rows){
    const eventId=toInt(x.id,0),exchangeId=toInt(x.operation_id,0),
      orderItemId=toInt(x.order_item_id,0),source=cleanText(x.inventory_source),
      variantId=toInt(x.variant_id,0),qty=toInt(x.quantity,0),
      delta=toInt(x.movement_delta,0),reserveQty=toInt(x.reservation_quantity,0)
    // Two distinct proved states:
    // (a) reserved replacement with a real negative sale movement,
    // (b) zero-stock replacement whose bookkeeping is "fulfilled", but
    //     the actual sale movement is exactly ZERO. Confirmation by the
    //     administrator is mandatory at saga planning time for both.
    // A zero booking cannot authorize +1 physical stock on cancellation.
    const zeroBookedFulfillment=Boolean(
      delta===0
      &&cleanText(x.movement_type)==='sale'
      &&cleanText(x.movement_reference_type)==='exchange_new'
      &&cleanText(x.movement_reference_id)===String(exchangeId)
      &&toInt(x.movement_quantity_after,-1)===0
      &&toInt(x.later_movement_count,-1)===0
      &&toInt(x.current_physical,-1)===0
      &&toInt(x.current_reserved,-1)===0
      &&cleanText(x.reservation_status)==='fulfilled'
      &&Boolean(cleanText(x.fulfilled_at))
      &&cleanText(x.stock_writeoff_status)==='fulfilled'
    )
    const negativeBookedReserve=Boolean(
      delta===-qty
      &&cleanText(x.reservation_status)==='active'
      &&!cleanText(x.fulfilled_at)
      &&cleanText(x.stock_writeoff_status)==='reserved'
      &&toInt(x.current_reserved,-1)>=reserveQty
    )
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
      &&(zeroBookedFulfillment||negativeBookedReserve)
      &&toInt(x.reservation_id,0)>0
      &&toInt(x.reservation_variant_id,0)===variantId
      &&cleanText(x.reservation_source)===source
      &&reserveQty===qty
      &&toInt(x.movement_id,0)>0
      &&toInt(x.movement_variant_id,0)===variantId
      &&cleanText(x.movement_source)===source
      &&toInt(x.later_physical_checks,0)===0
      &&toInt(x.stocktake_conflicts,0)===0
      &&toInt(x.live_variant,0)===1
      &&x.current_physical!=null&&toInt(x.current_physical,-1)>=0
      &&x.current_reserved!=null
      &&Boolean(cleanText(x.applied_at)||cleanText(x.created_at))
    )
    if(!valid)return bad(appliedCount,
      'Складское событие #'+String(eventId)+' нельзя безопасно отменить: отсутствует доказательство невыданного резерва, надёжное списание или актуальная физическая история.')
    const eventAt=cleanText(x.applied_at)||cleanText(x.created_at)
    // A ZERO-delta booking did not move physical stock; no compensation
    // lookup can possibly authorize adding stock.
    const correction=zeroBookedFulfillment
      ?{state:'none' as const,movementId:null}
      :await findExchangeFalseHandoverCompensation(db,{
      orderId,source,variantId,movementId:toInt(x.movement_id,0),
      outboundQuantity:-delta,eventAt,
    })
    if(correction.state==='ambiguous')
      return bad(appliedCount,
        'После списания по обмену #'+String(exchangeId)+' обнаружены другие или неоднозначные складские движения. Автоматическое сторно остановлено.')
    if(correction.state==='none'
      &&toInt(x.current_physical,-1)!==toInt(x.movement_quantity_after,-2))
      return bad(appliedCount,'Физический остаток отличается от последнего списания без понятной истории. Требуется сверка.')
    if(zeroBookedFulfillment)bookkeepingFulfilledCount++
    reversals.push({
      eventId,exchangeId,orderItemId,name:cleanText(x.product_name_snapshot)||'Товар обмена',
      source,variantId,quantity:qty,recordedOutbound:delta,
      physicalRestore:zeroBookedFulfillment?0:correction.state==='compensated'?0:-delta,
      reserveRelease:zeroBookedFulfillment?0:reserveQty,
      alreadyCompensated:correction.state==='compensated',
      correctionMovementId:correction.movementId,
      bookkeepingFulfillmentOnly:zeroBookedFulfillment,
    })
  }
  return {allowed:true,appliedCount,bookkeepingFulfilledCount,reversals,blockers:[]}
}
