/**
 * Main's lifecycle cancellation (cancelInventoryLifecycleEvent) already has
 * a 'retired_identity' disposition: it cancels the event, records why the
 * reverse stock movement was skipped and leaves money/operation cancellation
 * to Main's critical-operation engine. Client3 must not preempt that logic.
 *
 * This preflight distinguishes a PROVEN Main whole-product retirement from
 * an arbitrarily inactive/corrupt SKU. In the former case Main is allowed
 * to reverse commercial effects, not physical inventory. In the latter case
 * cancellation fails closed before a financial or inventory mutation.
 */
export type RetiredMovementInspection={
 retiredCount:number
 blocked:null|{id:number;eventType:string;variantId:number|null;reason:string}
}
export async function inspectRetiredAppliedMovements(
 db:D1Database,kind:'return'|'exchange',operationId:number,
):Promise<RetiredMovementInspection>{
 const response=await db.prepare(`
  SELECT e.id,e.event_type,e.variant_id,e.quantity,
    cv.is_active AS variant_active,sp.is_active AS execution_active,
    p.is_active AS product_active,
    (SELECT op.id FROM catalog_retirement_variants rv
      JOIN catalog_retirement_operations op ON op.id=rv.retirement_id
      WHERE rv.variant_id=e.variant_id
        AND op.entity_type='product' AND op.product_id=cv.product_id
        AND op.status='completed'
      ORDER BY op.id DESC LIMIT 1) AS retirement_id,
    (SELECT COUNT(*) FROM inventory_stock st WHERE st.variant_id=e.variant_id
      AND (COALESCE(st.quantity,0)<>0 OR COALESCE(st.reserved_quantity,0)<>0)
    ) AS nonzero_stock,
    (SELECT COUNT(*) FROM inventory_reservations r WHERE r.variant_id=e.variant_id
      AND r.status IN ('active','unresolved')) AS unsettled_reservations
  FROM inventory_lifecycle_events e
  LEFT JOIN catalog_variants cv ON cv.id=e.variant_id
  LEFT JOIN catalog_stock_positions sp ON sp.id=cv.stock_position_id
  LEFT JOIN catalog_products p ON p.id=cv.product_id
  WHERE e.operation_type=? AND e.operation_id=? AND e.status='applied'
    AND (cv.id IS NULL OR COALESCE(cv.is_active,0)<>1
       OR sp.id IS NULL OR COALESCE(sp.is_active,0)<>1
       OR p.id IS NULL OR COALESCE(p.is_active,0)<>1)
  ORDER BY e.id`).bind(kind,operationId).all<{
  id:number;event_type:string;variant_id:number|null;quantity:number
  variant_active:number|null;execution_active:number|null;product_active:number|null
  retirement_id:number|null;nonzero_stock:number;unsettled_reservations:number
 }>()
 const rows=response.results||[]
 for(const row of rows){
  const reason=!row.retirement_id?'Нет завершённой операции вывода товара из каталога Main.'
   :row.variant_active!==0||row.execution_active!==0||row.product_active!==0
      ?'Состояние товара, исполнения и SKU противоречит завершённому удалению.'
   :Number(row.nonzero_stock)!==0
      ?'У удалённого SKU остался физический остаток или резерв.'
   :Number(row.unsettled_reservations)!==0
      ?'У удалённого SKU остаётся активный или неразрешённый резерв.'
   :!Number.isSafeInteger(Number(row.quantity))||Number(row.quantity)<1
      ?'Применённое складское событие не имеет достоверного количества.'
   :''
  if(reason)return {retiredCount:rows.length,
    blocked:{id:row.id,eventType:row.event_type,
      variantId:row.variant_id,reason}}
 }
 return {retiredCount:rows.length,blocked:null}
}
/** Compatibility for existing call sites; only truly unsafe cases block.
 * Retired stock with a proven Main retirement is handled by Main's own
 * cancellation disposition and produces physicalReversalSkipped=true.
 */
export async function retiredAppliedMovementBlocker(
 db:D1Database,kind:'return'|'exchange',operationId:number,
){
 const inspection=await inspectRetiredAppliedMovements(db,kind,operationId)
 return inspection.blocked
}
