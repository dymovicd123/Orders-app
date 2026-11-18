import { cleanText, toInt } from '../core/text.ts'
import { assertLegacyMutationAllowedAfterReturnV2 } from './return-v2-legacy-mutation-guard.ts'
import { activeStocktakeSessionForHandover, reserveOrderItemV2 } from './order-reservations.ts'
import { catalogReviewRowToOrderItem } from './catalog-review.ts'

/**
 * A manager clicked Send. Recover only a current unissued order line which
 * already has a proven active canonical SKU but lost its reservation before
 * dispatch. This NEVER records a physical shipment or changes physical stock.
 * No cross-order aliases, catalogue guesses, historic issue, returns or V2.
 */
export async function prepareOrderShippingReservations(db:D1Database, orderId:number) {
  if (!Number.isSafeInteger(orderId) || orderId<1) throw new Error('Неверный номер заказа.')
  const candidates=await db.prepare(
    `SELECT oi.*,o.external_id,o.shipping_status,o.order_status,o.archived_at,
            v.is_active AS variant_active,p.is_active AS product_active,
            v.product_id AS canonical_product_id
     FROM order_items oi JOIN orders o ON o.id=oi.order_id
     LEFT JOIN catalog_variants v ON v.id=oi.variant_id
     LEFT JOIN catalog_products p ON p.id=v.product_id
     WHERE oi.order_id=?
       AND o.order_status='active' AND COALESCE(o.archived_at,'')=''
       AND COALESCE(o.shipping_status,'not_sent')<>'sent'
       AND COALESCE(oi.is_workshop,0)=0
       AND oi.quantity>0
       AND oi.stock_writeoff_status IN ('pending_reservation','reserved')
       AND oi.product_id IS NOT NULL AND oi.variant_id IS NOT NULL
       AND v.is_active=1 AND p.is_active=1 AND v.product_id=oi.product_id
       AND oi.source_type IN ('warehouse','boutique')
       AND NOT EXISTS(SELECT 1 FROM inventory_reservations r WHERE r.order_item_id=oi.id)
       AND NOT EXISTS(SELECT 1 FROM order_dispatch_items di WHERE di.order_item_id=oi.id)
       AND NOT EXISTS(
         SELECT 1 FROM return_items ri JOIN returns ret ON ret.id=ri.return_id
          WHERE ri.order_item_id=oi.id AND ri.quantity>0
            AND COALESCE(ret.status,'completed')<>'cancelled')
       AND NOT EXISTS(
         SELECT 1 FROM exchanges ex WHERE ex.order_id=o.id AND
           (ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id)
           AND COALESCE(ex.status,'completed')<>'cancelled')
     ORDER BY oi.id LIMIT 20`
  ).bind(orderId).all<Record<string,unknown>>()
  const rows=candidates.results||[]
  if (!rows.length) return {ok:true,recovered:0,pending:0,skipped:0}
  // Return V2 has its own atomic lineage. Never create a legacy reservation
  // in a unified V2 chain, even if a row appears to be currently unreserved.
  await assertLegacyMutationAllowedAfterReturnV2(db,orderId,'shipping')
  let recovered=0,pending=0,skipped=0
  for (const row of rows) {
    const itemId=toInt(row.id,0)
    const source=cleanText(row.source_type)
    if (!itemId || (source!=='warehouse'&&source!=='boutique') ||
        await activeStocktakeSessionForHandover(db,source)) {skipped++;continue}
    // Revalidate immediately before stock admission. Earlier fulfilled/released
    // reservations or shipment corrections are NOT safe to reconstruct.
    const fresh=await db.prepare(
      `SELECT oi.id FROM order_items oi JOIN orders o ON o.id=oi.order_id
       JOIN catalog_variants v ON v.id=oi.variant_id AND v.is_active=1 AND v.product_id=oi.product_id
       JOIN catalog_products p ON p.id=v.product_id AND p.is_active=1
       WHERE oi.id=? AND oi.order_id=? AND oi.stock_writeoff_status IN ('pending_reservation','reserved')
         AND oi.quantity=? AND oi.product_id=? AND oi.variant_id=? AND oi.source_type=?
         AND o.order_status='active' AND COALESCE(o.archived_at,'')=''
         AND COALESCE(o.shipping_status,'not_sent')<>'sent'
         AND NOT EXISTS (SELECT 1 FROM inventory_reservations r WHERE r.order_item_id=oi.id)
         AND NOT EXISTS (SELECT 1 FROM order_dispatch_items di WHERE di.order_item_id=oi.id)
         AND NOT EXISTS (SELECT 1 FROM return_items ri JOIN returns ret ON ret.id=ri.return_id
           WHERE ri.order_item_id=oi.id AND ri.quantity>0 AND COALESCE(ret.status,'completed')<>'cancelled')
         AND NOT EXISTS (SELECT 1 FROM exchanges ex WHERE ex.order_id=o.id
           AND (ex.old_order_item_id=oi.id OR ex.new_order_item_id=oi.id)
           AND COALESCE(ex.status,'completed')<>'cancelled')
       LIMIT 1`
    ).bind(itemId,orderId,toInt(row.quantity,0),toInt(row.product_id,0),toInt(row.variant_id,0),source).first<{id:number}>()
    if (!fresh?.id){skipped++;continue}
    try {
      const outcome=await reserveOrderItemV2(db,orderId,cleanText(row.external_id),
        catalogReviewRowToOrderItem(row),toInt(row.product_id,0),toInt(row.variant_id,0),
        new Date().toISOString(),itemId,'order',cleanText(row.external_id))
      if (outcome.reservationStatus==='active') recovered++
      else if (outcome.reservationStatus==='unresolved') pending++
      else skipped++
    } catch(error) {
      console.warn('Safe known-SKU pre-dispatch recovery skipped one item',itemId,error)
      skipped++
    }
  }
  return {ok:true,recovered,pending,skipped}
}
