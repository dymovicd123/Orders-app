// Stage04-D: review only unpriced Workshop completion facts.
// Never guess a missing cost or mutate the original immutable snapshot.
import { WorkshopSettlementError, assertWorkshopSettlementSchema } from './workshop-settlements.ts'

const completionUnpriced = `
  c.event_type='completion' AND c.amount_delta IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM workshop_settlement_events r
    WHERE r.related_event_id=c.id AND r.event_type='completion_reversal'
  )
  AND NOT EXISTS (
    SELECT 1 FROM workshop_settlement_events a
    WHERE a.related_event_id=c.id AND a.event_type='price_adjustment'
  )
`

// Exact frozen completion and current task/item identities must still agree;
// otherwise an admin must reconcile the item before confirming a price.
const compatibleVariant = `
  wt.id=c.workshop_task_id AND wt.order_id=c.order_id
  AND wt.status IN ('done','ready')
  AND wt.quantity=c.quantity
  AND wt.product_name_snapshot=c.product_name_snapshot
  AND (c.order_item_id IS NULL OR wt.order_item_id=c.order_item_id)
  AND COALESCE(wt.gender_snapshot,'')=COALESCE(json_extract(c.details_snapshot,'$.gender'),'')
  AND COALESCE(wt.color_snapshot,'')=COALESCE(json_extract(c.details_snapshot,'$.color'),'')
  AND COALESCE(wt.material_snapshot,'')=COALESCE(json_extract(c.details_snapshot,'$.material'),'')
  AND COALESCE(wt.length_snapshot,'')=COALESCE(json_extract(c.details_snapshot,'$.length'),'')
  AND COALESCE(wt.size_snapshot,'')=COALESCE(json_extract(c.details_snapshot,'$.size'),'')
  AND (c.order_item_id IS NULL OR oi.id=c.order_item_id)
  AND (c.order_item_id IS NULL OR oi.order_id=c.order_id)
  AND (wt.variant_id IS NULL OR oi.variant_id IS NULL OR wt.variant_id=oi.variant_id)
  AND (wt.product_id IS NULL OR wt.product_id=cv.product_id)
  AND (oi.product_id IS NULL OR oi.product_id=cv.product_id)
  AND cv.id IS NOT NULL AND cv.stock_position_id IS NOT NULL
`

// Legacy tasks sometimes have no variant_id on either the order item or the
// Workshop task. The frozen completion still identifies the exact combination.
// Recover a variant for *financial pricing only* when precisely ONE active
// Catalog SKU matches all five frozen facts and the linked order-item product.
// This does not alter order items or inventory identities.
const resolvedVariantJoin = `
  LEFT JOIN catalog_variants cv ON cv.id = COALESCE(
    oi.variant_id,
    wt.variant_id,
    (
      SELECT CASE WHEN COUNT(*)=1 THEN MAX(v2.id) ELSE NULL END
      FROM catalog_variants v2
      WHERE c.order_item_id IS NOT NULL
        AND oi.id=c.order_item_id AND oi.order_id=c.order_id
        AND wt.order_item_id=c.order_item_id
        AND oi.product_id IS NOT NULL
        AND oi.variant_id IS NULL AND wt.variant_id IS NULL
        AND v2.product_id=oi.product_id
        AND v2.is_active=1 AND v2.stock_position_id IS NOT NULL
        AND UPPER(TRIM(COALESCE(v2.gender,'')))=UPPER(TRIM(COALESCE(json_extract(c.details_snapshot,'$.gender'),'')))
        AND UPPER(TRIM(COALESCE(v2.color,'')))=UPPER(TRIM(COALESCE(json_extract(c.details_snapshot,'$.color'),'')))
        AND UPPER(TRIM(COALESCE(v2.material,'')))=UPPER(TRIM(COALESCE(json_extract(c.details_snapshot,'$.material'),'')))
        AND UPPER(TRIM(COALESCE(v2.length,'')))=UPPER(TRIM(COALESCE(json_extract(c.details_snapshot,'$.length'),'')))
        AND UPPER(TRIM(COALESCE(v2.size_label,'')))=UPPER(TRIM(COALESCE(json_extract(c.details_snapshot,'$.size'),'')))
    )
  )
`

export async function countUnpricedWorkshopCompletions(db: D1Database) {
  await assertWorkshopSettlementSchema(db)
  const row=await db.prepare(`
    SELECT COUNT(*) AS total FROM workshop_settlement_events c
    WHERE ${completionUnpriced}
  `).first<{total:number}>()
  return {ok:true,total:Number(row?.total||0)}
}

export async function listUnpricedWorkshopCompletions(db: D1Database) {
  await assertWorkshopSettlementSchema(db)
  const [rows, total] = await Promise.all([
    db.prepare(`
    SELECT c.id,c.workshop_task_id AS taskId,c.external_order_id AS orderRef,
      c.product_name_snapshot AS productName,c.quantity,c.business_date AS completedDate,
      CASE WHEN ${compatibleVariant} THEN ep.cost_price ELSE NULL END AS availableUnitCost,
      CASE WHEN ${compatibleVariant} THEN cv.product_id ELSE NULL END AS catalogProductId,
      CASE WHEN NOT (${compatibleVariant}) THEN 'needs_match'
           WHEN ep.cost_price IS NULL THEN 'missing_cost'
           ELSE 'ready' END AS resolutionState
    FROM workshop_settlement_events c
    LEFT JOIN workshop_tasks wt ON wt.id=c.workshop_task_id
    LEFT JOIN order_items oi ON oi.id=c.order_item_id
    ${resolvedVariantJoin}
    LEFT JOIN catalog_execution_prices ep
      ON ep.stock_position_id=cv.stock_position_id AND ep.category=cv.category
    WHERE ${completionUnpriced}
    ORDER BY c.id DESC LIMIT 51
  `).all<Record<string,unknown>>(),
    db.prepare(`SELECT COUNT(*) AS total FROM workshop_settlement_events c
      WHERE ${completionUnpriced}`).first<{ total:number }>(),
  ])
  const items=(rows.results||[]).slice(0,50).map(row=>({
    id:Number(row.id),
    taskId:Number(row.taskId),
    orderRef:String(row.orderRef||''),
    productName:String(row.productName||''),
    quantity:Number(row.quantity),
    completedDate:String(row.completedDate||''),
    availableUnitCost:row.availableUnitCost==null?null:Number(row.availableUnitCost),
    catalogProductId:row.catalogProductId==null?null:Number(row.catalogProductId),
    resolutionState:row.resolutionState==='missing_cost'?'missing_cost':row.resolutionState==='ready'?'ready':'needs_match',
  }))
  return {ok:true,items,total:Number(total?.total||0),hasMore:(rows.results||[]).length>50}
}

export async function confirmUnpricedWorkshopCompletionCost(
  db: D1Database, completionId: number, actorUserId: number
) {
  if(!Number.isSafeInteger(completionId)||completionId<=0||!Number.isSafeInteger(actorUserId)||actorUserId<=0)
    throw new WorkshopSettlementError('Не удалось определить позицию или администратора.',400,'invalid_price_confirmation')

  const enabled=await assertWorkshopSettlementSchema(db)
  const key='workshop:price-resolution:'+completionId
  const previous=await db.prepare('SELECT id FROM workshop_settlement_events WHERE event_key=?')
    .bind(key).first<{id:number}>()
  if(previous)return {ok:true,id:Number(previous.id),replayed:true}
  if(!enabled)
    throw new WorkshopSettlementError('Начисления ещё не включены. Изменение стоимости недоступно.',409,'settlements_not_active')

  // One atomic write. A cost becomes a price_adjustment tied to the original
  // NULL-priced completion; it is never backfilled into its immutable row.
  // Retried or racing confirmations cannot post two charges.
  await db.prepare(`
    INSERT INTO workshop_settlement_events (
      event_key,event_type,business_date,occurred_at,
      workshop_task_id,order_id,order_item_id,external_order_id,product_name_snapshot,
      quantity,unit_cost,amount_delta,related_event_id,actor_user_id,comment
    )
    SELECT ?, 'price_adjustment',date('now','+5 hours'),
      strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      c.workshop_task_id,c.order_id,c.order_item_id,c.external_order_id,c.product_name_snapshot,
      c.quantity,ep.cost_price,ep.cost_price*c.quantity,c.id,?,'Себестоимость подтверждена по каталогу'
    FROM workshop_settlement_events c
    JOIN workshop_tasks wt ON wt.id=c.workshop_task_id
    LEFT JOIN order_items oi ON oi.id=c.order_item_id
    ${resolvedVariantJoin}
    JOIN catalog_execution_prices ep
      ON ep.stock_position_id=cv.stock_position_id AND ep.category=cv.category
    WHERE c.id=? AND ${completionUnpriced}
      AND ${compatibleVariant}
      AND ep.cost_price IS NOT NULL
      AND ep.cost_price>=0 AND ep.cost_price<=1000000000000/c.quantity
      AND (SELECT enabled FROM workshop_settlement_capture_control WHERE id=1)=1
      AND NOT EXISTS(SELECT 1 FROM workshop_settlement_events WHERE event_key=?)
  `).bind(key,actorUserId,completionId,key).run()

  const written=await db.prepare('SELECT id FROM workshop_settlement_events WHERE event_key=?')
    .bind(key).first<{id:number}>()
  if(written)return {ok:true,id:Number(written.id),replayed:false}
  throw new WorkshopSettlementError(
    'Не удалось подтвердить стоимость. Проверьте себестоимость и характеристики товара в каталоге, затем обновите список.',
    409,'unpriced_cost_still_unresolved'
  )
}
